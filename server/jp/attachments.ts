import { createHash, randomUUID } from "node:crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  attachmentLocations,
  attachments,
  auditEvents,
  siteGeofences,
  dailyReports,
  materialRequests,
  pettyCashMovements,
  siteIssues,
  sites,
  workTasks,
  supplierInvoices,
  supplierPayments,
  users,
} from "../../drizzle/schema";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { storageGetSignedUrl, storagePut } from "../storage";
import { getSiteScope } from "./access";
import {
  MAX_VIDEO_BYTES,
  attachmentEntityTypes,
  isVideoType,
  maxBytesFor,
  safeFileName,
  sniffContentType,
  type AttachmentEntityType,
} from "../../lib/jp/attachment-policy";
import { distanceMeters, isValidLatLng } from "../../lib/jp/geo";

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
  project: { view: "site.view", upload: ["site.manage", "document.upload"] },
  site: { view: "site.view", upload: ["site.manage", "dpr.create", "issue.create"] },
  work_task: { view: "task.view", upload: ["task.manage", "task.status.update"] },
  material_request: {
    view: "material.request.view",
    upload: ["material.request", "material.review"],
  },
};

/** The site(s) a record belongs to; a project's files are reached through any of its sites. */
async function sitesOf(db: Db, entityType: AttachmentEntityType, entityId: string) {
  const pick = async (table: { id: any; siteId: any }) => {
    const [row] = await db
      .select({ siteId: table.siteId })
      .from(table as never)
      .where(eq(table.id, entityId))
      .limit(1);
    return (row as { siteId: string } | undefined)?.siteId;
  };
  let siteIds: string[] = [];
  if (entityType === "project")
    siteIds = (
      await db.select({ id: sites.id }).from(sites).where(eq(sites.projectId, entityId))
    ).map((row) => row.id);
  else {
    const table =
      entityType === "site"
        ? sites
        : entityType === "site_issue"
          ? siteIssues
          : entityType === "daily_report"
            ? dailyReports
            : entityType === "supplier_invoice"
              ? supplierInvoices
              : entityType === "supplier_payment"
                ? supplierPayments
                : entityType === "work_task"
                  ? workTasks
                  : entityType === "material_request"
                    ? materialRequests
                    : pettyCashMovements;
    const siteId =
      entityType === "site"
        ? (await db.select({ id: sites.id }).from(sites).where(eq(sites.id, entityId)).limit(1))[0]
            ?.id
        : await pick(table as { id: any; siteId: any });
    if (siteId) siteIds = [siteId];
  }
  if (siteIds.length === 0)
    throw new TRPCError({ code: "NOT_FOUND", message: "Record not found." });
  return siteIds;
}

/** The first of the record's sites where the person holds one of the keys. */
async function scopeFor(
  user: Parameters<typeof getSiteScope>[0],
  siteIds: readonly string[],
  keys: readonly string[],
) {
  let lastError: unknown;
  for (const siteId of siteIds)
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
    const siteIds = await sitesOf(db, input.entityType, input.entityId);
    const scope = await scopeFor(ctx.user, siteIds, [entityRules[input.entityType].view]);
    const files = await db
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
    let locations: (typeof attachmentLocations.$inferSelect)[] = [];
    let radius: number | null = null;
    if (files.length)
      try {
        locations = await db
          .select()
          .from(attachmentLocations)
          .where(
            inArray(
              attachmentLocations.attachmentId,
              files.map((file) => file.id),
            ),
          );
        const [fence] = await db
          .select({ radiusM: siteGeofences.radiusM })
          .from(siteGeofences)
          .where(eq(siteGeofences.siteId, scope.siteId))
          .limit(1);
        radius = fence?.radiusM ?? null;
      } catch {
        locations = [];
      }
    // Small photo previews (short-lived links) for the first photos, so lists show thumbnails.
    const previews = new Map<string, string>();
    const keyed = await db
      .select({ id: attachments.id, storageKey: attachments.storageKey })
      .from(attachments)
      .where(
        inArray(
          attachments.id,
          files
            .filter((file) => file.contentType.startsWith("image/"))
            .slice(0, 24)
            .map((file) => file.id)
            .concat(["00000000-0000-0000-0000-000000000000"]),
        ),
      );
    await Promise.all(
      keyed.map(async (row) => {
        try {
          previews.set(row.id, await storageGetSignedUrl(row.storageKey));
        } catch {
          // No preview; the app shows an icon.
        }
      }),
    );
    return files.map((file) => {
      const location = locations.find((row) => row.attachmentId === file.id);
      return {
        ...file,
        previewUrl: previews.get(file.id) ?? null,
        location: location
          ? {
              latitude: Number(location.latitude),
              longitude: Number(location.longitude),
              accuracyM: location.accuracyM,
              distanceFromSiteM: location.distanceFromSiteM,
              siteRadiusM: radius,
            }
          : null,
      };
    });
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
          .max(Math.ceil((MAX_VIDEO_BYTES * 4) / 3) + 16),
        captureTime: z.coerce.date().optional(),
        location: z
          .object({
            latitude: z.number().min(-90).max(90),
            longitude: z.number().min(-180).max(180),
            accuracyM: z.number().min(0).max(100_000).optional(),
          })
          .optional(),
        sourceType: z.enum(["Captured in app", "Selected from device"]),
        clientMutationId: z.string().trim().min(16).max(64),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const db = requireDb(await getDb());
      const siteIds = await sitesOf(db, input.entityType, input.entityId);
      const scope = await scopeFor(ctx.user, siteIds, entityRules[input.entityType].upload);
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
      const contentType = bytes.length ? sniffContentType(bytes) : null;
      if (!contentType)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "Only photos (JPEG, PNG, WebP), PDF documents and MP4/MOV/3GP videos can be attached.",
        });
      if (bytes.length > maxBytesFor(contentType))
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: isVideoType(contentType)
            ? "Videos must be under 30 MB (about a minute)."
            : "Photos and PDFs must be under 8 MB.",
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
      if (input.location && isValidLatLng(input.location)) {
        try {
          const [fence] = await db
            .select()
            .from(siteGeofences)
            .where(eq(siteGeofences.siteId, scope.siteId))
            .limit(1);
          await db.insert(attachmentLocations).values({
            attachmentId: id,
            latitude: input.location.latitude.toFixed(6),
            longitude: input.location.longitude.toFixed(6),
            accuracyM: input.location.accuracyM ? Math.round(input.location.accuracyM) : null,
            distanceFromSiteM: fence
              ? distanceMeters(input.location, {
                  latitude: Number(fence.latitude),
                  longitude: Number(fence.longitude),
                })
              : null,
            capturedAt: input.captureTime ?? new Date(),
          });
        } catch {
          // Location is optional evidence; the file itself is already saved.
        }
      }
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
      const siteIds = await sitesOf(db, entityType, file.entityId);
      const scope = await scopeFor(ctx.user, siteIds, [entityRules[entityType].view]);
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
