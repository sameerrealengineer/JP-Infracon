import { createHash, randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  attachments,
  auditEvents,
  dailyReports,
  pettyCashMovements,
  siteIssues,
  supplierInvoices,
  supplierPayments,
  users,
} from "../../drizzle/schema";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { storageGetSignedUrl, storagePut } from "../storage";
import { getSiteScope } from "./access";
import {
  MAX_ATTACHMENT_BYTES,
  attachmentEntityTypes,
  safeFileName,
  sniffContentType,
  type AttachmentEntityType,
} from "../../lib/jp/attachment-policy";

function requireDb(db: Awaited<ReturnType<typeof getDb>>) {
  if (!db)
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "The business data service is temporarily unavailable.",
    });
  return db;
}
type Db = ReturnType<typeof requireDb>;

/** Which site a record belongs to, and the permissions needed to see or add its evidence. */
const entityRules: Record<AttachmentEntityType, { view: string; upload: readonly string[] }> = {
  site_issue: { view: "issue.view", upload: ["issue.create", "issue.manage"] },
  daily_report: { view: "dpr.view", upload: ["dpr.create", "dlr.create"] },
  supplier_invoice: { view: "finance.invoice.view", upload: ["finance.invoice.create"] },
  supplier_payment: { view: "finance.payment.view", upload: ["finance.payment.create"] },
  petty_cash_movement: { view: "finance.cash.view", upload: ["finance.cash.movement.create"] },
};

async function siteOf(db: Db, entityType: AttachmentEntityType, entityId: string) {
  const pick = async (table: { id: any; siteId: any }) => {
    const [row] = await db
      .select({ siteId: table.siteId })
      .from(table as never)
      .where(eq(table.id, entityId))
      .limit(1);
    return (row as { siteId: string } | undefined)?.siteId;
  };
  const siteId =
    entityType === "site_issue"
      ? await pick(siteIssues)
      : entityType === "daily_report"
        ? await pick(dailyReports)
        : entityType === "supplier_invoice"
          ? await pick(supplierInvoices)
          : entityType === "supplier_payment"
            ? await pick(supplierPayments)
            : await pick(pettyCashMovements);
  if (!siteId) throw new TRPCError({ code: "NOT_FOUND", message: "Record not found." });
  return siteId;
}

async function scopeFor(
  user: Parameters<typeof getSiteScope>[0],
  siteId: string,
  keys: readonly string[],
) {
  let lastError: unknown;
  for (const key of keys) {
    try {
      return await getSiteScope(user, siteId, key);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

const entityInput = {
  entityType: z.enum(attachmentEntityTypes),
  entityId: z.string().uuid(),
};

export const attachmentsRouter = router({
  list: protectedProcedure.input(z.object(entityInput)).query(async ({ ctx, input }) => {
    const db = requireDb(await getDb());
    const siteId = await siteOf(db, input.entityType, input.entityId);
    const scope = await getSiteScope(ctx.user, siteId, entityRules[input.entityType].view);
    return db
      .select({
        id: attachments.id,
        originalFilename: attachments.originalFilename,
        contentType: attachments.contentType,
        sizeBytes: attachments.sizeBytes,
        uploadedAt: attachments.uploadedAt,
        captureTime: attachments.captureTime,
        sourceType: attachments.sourceType,
        uploadedByName: users.name,
      })
      .from(attachments)
      .innerJoin(users, eq(attachments.uploadedBy, users.id))
      .where(
        and(
          eq(attachments.organizationId, scope.organizationId),
          eq(attachments.entityType, input.entityType),
          eq(attachments.entityId, input.entityId),
        ),
      )
      .orderBy(desc(attachments.uploadedAt))
      .limit(100);
  }),

  upload: protectedProcedure
    .input(
      z.object({
        ...entityInput,
        fileName: z.string().trim().min(1).max(240),
        // base64 grows data by about a third; this bounds the request before decoding.
        base64: z
          .string()
          .min(8)
          .max(Math.ceil((MAX_ATTACHMENT_BYTES * 4) / 3) + 16),
        captureTime: z.coerce.date().optional(),
        sourceType: z.enum(["Captured in app", "Selected from device"]),
        clientMutationId: z.string().trim().min(16).max(64),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const db = requireDb(await getDb());
      const siteId = await siteOf(db, input.entityType, input.entityId);
      const scope = await scopeFor(ctx.user, siteId, entityRules[input.entityType].upload);
      const [prior] = await db
        .select({ entityId: auditEvents.entityId })
        .from(auditEvents)
        .where(
          and(
            eq(auditEvents.actorUserId, ctx.user.id),
            eq(auditEvents.clientMutationId, input.clientMutationId),
          ),
        )
        .limit(1);
      if (prior) return { id: prior.entityId };
      const bytes = Buffer.from(input.base64, "base64");
      if (bytes.length === 0 || bytes.length > MAX_ATTACHMENT_BYTES)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Files must be between 1 byte and 8 MB.",
        });
      const contentType = sniffContentType(bytes);
      if (!contentType)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Only JPEG, PNG, WebP photos and PDF documents can be attached.",
        });
      const id = randomUUID();
      const fileName = safeFileName(input.fileName, contentType);
      const checksum = createHash("sha256").update(bytes).digest("hex");
      let stored: { key: string };
      try {
        stored = await storagePut(
          `evidence/${scope.organizationId}/${input.entityType}/${input.entityId}/${id}`,
          bytes,
          contentType,
        );
      } catch {
        console.error("[JP] Evidence storage upload failed");
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "File storage is unavailable right now. Try again shortly.",
        });
      }
      await db.transaction(async (tx) => {
        await tx.insert(attachments).values({
          id,
          organizationId: scope.organizationId,
          entityType: input.entityType,
          entityId: input.entityId,
          storageKey: stored.key,
          originalFilename: fileName,
          contentType,
          sizeBytes: bytes.length,
          checksum,
          uploadedBy: ctx.user.id,
          captureTime: input.captureTime ?? null,
          sourceType: input.sourceType,
          accessClassification: "Private",
          // Accepted means: size limit and file signature verified by the server. No antivirus scan is claimed.
          scanStatus: "Accepted",
        });
        await tx.insert(auditEvents).values({
          id: randomUUID(),
          organizationId: scope.organizationId,
          siteId: scope.siteId,
          actorUserId: ctx.user.id,
          action: "attachment.added",
          entityType: input.entityType,
          entityId: input.entityId,
          clientMutationId: input.clientMutationId,
          afterSummary: JSON.stringify({
            attachmentId: id,
            contentType,
            sizeBytes: bytes.length,
            checksum,
          }),
        });
      });
      return { id };
    }),

  /** Short-lived signed link, issued only after the record's view permission is rechecked. */
  open: protectedProcedure
    .input(z.object({ attachmentId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const db = requireDb(await getDb());
      const [file] = await db
        .select()
        .from(attachments)
        .where(eq(attachments.id, input.attachmentId))
        .limit(1);
      if (!file || !(attachmentEntityTypes as readonly string[]).includes(file.entityType))
        throw new TRPCError({ code: "NOT_FOUND", message: "File not found." });
      const entityType = file.entityType as AttachmentEntityType;
      const siteId = await siteOf(db, entityType, file.entityId);
      const scope = await getSiteScope(ctx.user, siteId, entityRules[entityType].view);
      if (scope.organizationId !== file.organizationId)
        throw new TRPCError({ code: "NOT_FOUND", message: "File not found." });
      try {
        return { url: await storageGetSignedUrl(file.storageKey), contentType: file.contentType };
      } catch {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "File storage is unavailable right now. Try again shortly.",
        });
      }
    }),
});
