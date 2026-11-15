import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { approvalLimits, auditEvents } from "../../drizzle/schema";
import {
  APPROVAL_AREAS,
  AREA_LABELS,
  LIMITABLE_ROLES,
  ceilingExceeded,
  rupeesText,
  type ApprovalArea,
} from "../../lib/jp/approval-limits";
import { mayManageRole, type ManagerRole } from "../../lib/jp/account-role-policy";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { assertCanManageOrganization } from "./accounts";
import type { BusinessRole } from "./policy";

type Tx = any;

/**
 * Refuses an approval above the approver's role ceiling for that area (inside the approving
 * transaction, on the server's own amount). No ceiling set: allowed.
 */
export async function assertWithinLimit(
  tx: Tx,
  input: {
    organizationId: string;
    role: string;
    area: ApprovalArea;
    amountMinor: bigint;
  },
) {
  let limit: bigint | null = null;
  try {
    const [row] = await tx
      .select({ limitMinor: approvalLimits.limitMinor })
      .from(approvalLimits)
      .where(
        and(
          eq(approvalLimits.organizationId, input.organizationId),
          eq(approvalLimits.role, input.role),
          eq(approvalLimits.area, input.area),
        ),
      )
      .limit(1);
    limit = row ? BigInt(row.limitMinor) : null;
  } catch {
    // Before migration 0036: no limits.
    limit = null;
  }
  const exceeded = ceilingExceeded(input.role, input.amountMinor, limit);
  if (exceeded !== null)
    throw new TRPCError({
      code: "FORBIDDEN",
      message: `This is above your approval limit of ${rupeesText(exceeded)} for ${AREA_LABELS[input.area].toLowerCase()}. Someone with a higher limit (Director or Owner) must approve it.`,
    });
}

/** The approver's role for limits: Super Admin, else their role on the site or company. */
export function approverRole(user: { role: string }, role: string) {
  return user.role === "super_admin" ? "super_admin" : role;
}

function requireDb(db: Awaited<ReturnType<typeof getDb>>) {
  if (!db)
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "The business data service is temporarily unavailable.",
    });
  return db;
}

/**
 * The company's delegation of authority: ceilings per role and area. Everyone in the company
 * may read it; leaders who manage accounts set ceilings for roles below their own.
 */
export const approvalLimitsRouter = router({
  list: protectedProcedure
    .input(z.object({ organizationId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const db = requireDb(await getDb());
      let canEdit = false;
      let managerRole: ManagerRole | null = null;
      try {
        managerRole = (await assertCanManageOrganization(ctx.user, input.organizationId))
          .managerRole;
        canEdit = true;
      } catch {
        canEdit = false;
      }
      const rows = await db
        .select()
        .from(approvalLimits)
        .where(eq(approvalLimits.organizationId, input.organizationId))
        .catch(() => []);
      return {
        canEdit,
        areas: APPROVAL_AREAS.map((area) => ({ area, label: AREA_LABELS[area] })),
        roles: LIMITABLE_ROLES.map((role) => ({
          role,
          editable:
            canEdit && managerRole !== null && mayManageRole(managerRole, role as BusinessRole),
          limits: Object.fromEntries(
            APPROVAL_AREAS.map((area) => [
              area,
              rows.find((row) => row.role === role && row.area === area)?.limitMinor ?? null,
            ]),
          ) as Record<ApprovalArea, string | null>,
        })),
      };
    }),

  set: protectedProcedure
    .input(
      z.object({
        organizationId: z.string().uuid(),
        role: z.enum(LIMITABLE_ROLES),
        area: z.enum(APPROVAL_AREAS),
        /** Whole rupees; null removes the ceiling. */
        limitRupees: z.number().int().min(0).max(1_000_000_000).nullable(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { managerRole } = await assertCanManageOrganization(ctx.user, input.organizationId);
      if (!mayManageRole(managerRole, input.role as BusinessRole))
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Only someone above this role can set its approval limit.",
        });
      const db = requireDb(await getDb());
      await db.transaction(async (tx) => {
        const [existing] = await tx
          .select()
          .from(approvalLimits)
          .where(
            and(
              eq(approvalLimits.organizationId, input.organizationId),
              eq(approvalLimits.role, input.role),
              eq(approvalLimits.area, input.area),
            ),
          )
          .limit(1);
        if (input.limitRupees === null) {
          if (existing) await tx.delete(approvalLimits).where(eq(approvalLimits.id, existing.id));
        } else {
          const limitMinor = (BigInt(input.limitRupees) * 100n).toString();
          if (existing)
            await tx
              .update(approvalLimits)
              .set({ limitMinor, updatedBy: ctx.user.id })
              .where(eq(approvalLimits.id, existing.id));
          else
            await tx.insert(approvalLimits).values({
              id: randomUUID(),
              organizationId: input.organizationId,
              role: input.role,
              area: input.area,
              limitMinor,
              updatedBy: ctx.user.id,
            });
        }
        await tx.insert(auditEvents).values({
          id: randomUUID(),
          organizationId: input.organizationId,
          actorUserId: ctx.user.id,
          action: "approval_limit.set",
          entityType: "approval_limit",
          entityId: `${input.role}:${input.area}`,
          beforeSummary: JSON.stringify({ limitMinor: existing?.limitMinor ?? null }),
          afterSummary: JSON.stringify({
            limitMinor:
              input.limitRupees === null ? null : String(BigInt(input.limitRupees) * 100n),
          }),
        });
      });
      return { ok: true as const };
    }),
});
