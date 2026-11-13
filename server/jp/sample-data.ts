import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { auditEvents } from "../../drizzle/schema";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { removeSample, sampleSummary } from "../seed/sample-registry";
import { assertCanManageOrganization } from "./accounts";

function requireDb(db: Awaited<ReturnType<typeof getDb>>) {
  if (!db)
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "The business data service is temporarily unavailable.",
    });
  return db;
}

const input = z.object({ organizationId: z.string().uuid() });

/**
 * Example (SAMPLE) data: how much there is, and removing all of it in one step. Only the Super
 * Admin and company leaders (Owner, Director, Admin) may do this.
 */
export const sampleDataRouter = router({
  status: protectedProcedure.input(input).query(async ({ ctx, input }) => {
    await assertCanManageOrganization(ctx.user, input.organizationId);
    return sampleSummary(requireDb(await getDb()));
  }),

  remove: protectedProcedure
    .input(input.extend({ confirm: z.literal("REMOVE SAMPLE DATA") }))
    .mutation(async ({ ctx, input }) => {
      await assertCanManageOrganization(ctx.user, input.organizationId);
      const db = requireDb(await getDb());
      const result = await removeSample(db);
      await db.insert(auditEvents).values({
        id: randomUUID(),
        organizationId: input.organizationId,
        actorUserId: ctx.user.id,
        action: "sample_data.removed",
        entityType: "sample_data",
        entityId: input.organizationId,
        afterSummary: JSON.stringify(result),
      });
      return result;
    }),
});
