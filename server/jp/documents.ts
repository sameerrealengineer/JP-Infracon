import { createHash, randomUUID } from "node:crypto";
import { and, desc, eq, inArray, isNull, or } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  attachments,
  auditEvents,
  documentChunks,
  projectDocumentVersions,
  projectDocuments,
  projects,
  sites,
  users,
} from "../../drizzle/schema";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { storageGetSignedUrl, storagePut } from "../storage";
import { getAccessibleSites, getSiteScope } from "./access";
import { siteCapabilities } from "./capabilities";
import { embedQuery, indexDocument } from "./document-index";
import {
  DOCUMENT_CATEGORIES,
  MAX_DOCUMENT_BYTES,
  cosineSimilarity,
  hybridScore,
  keywordScore,
  normalizeTags,
  rankDocuments,
  safeDocumentName,
  sniffDocumentType,
  snippet,
} from "../../lib/jp/document-policy";

/**
 * Project documents: upload with versions, browse, open, and smart search.
 * A document belongs to a project and optionally one site. Access follows the person's sites:
 * a site document needs the permission on that site; a project-wide document needs it on any
 * site of that project.
 */

type User = Parameters<typeof getSiteScope>[0];
type DocKey = "document.view" | "document.upload" | "document.manage";

function requireDb(db: Awaited<ReturnType<typeof getDb>>) {
  if (!db)
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "The business data service is temporarily unavailable.",
    });
  return db;
}

function requestId(value: string | string[] | undefined) {
  return typeof value === "string" && value.length <= 100 ? value : undefined;
}

/** The person's sites with their permissions, looked up once per request. */
async function siteAccess(user: User) {
  const accessible = await getAccessibleSites(user);
  return { accessible, capabilities: await siteCapabilities(user, accessible) };
}

function reachFrom(access: Awaited<ReturnType<typeof siteAccess>>, key: DocKey) {
  const { accessible, capabilities } = access;
  const allowed = new Set(capabilities.filter((row) => row[key]).map((row) => row.siteId));
  const siteRows = accessible.filter((site) => allowed.has(site.id));
  return {
    siteIds: siteRows.map((site) => site.id),
    projectIds: [...new Set(siteRows.map((site) => site.projectId))],
    sites: siteRows,
  };
}

/** The sites and projects where the person holds a document permission. */
async function documentReach(user: User, key: DocKey) {
  return reachFrom(await siteAccess(user), key);
}

/** Checks the permission for a document's place (site, or any site of its project). */
async function scopeForPlace(user: User, projectId: string, siteId: string | null, key: DocKey) {
  if (siteId) {
    const scope = await getSiteScope(user, siteId, key);
    if (scope.projectId !== projectId)
      throw new TRPCError({ code: "BAD_REQUEST", message: "That site is not in this project." });
    return scope;
  }
  const reach = await documentReach(user, key);
  const site = reach.sites.find((row) => row.projectId === projectId);
  if (!site)
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Your role does not allow this for documents of this project.",
    });
  return getSiteScope(user, site.id, key);
}

async function loadDocument(documentId: string) {
  const db = requireDb(await getDb());
  const [document] = await db
    .select()
    .from(projectDocuments)
    .where(eq(projectDocuments.id, documentId))
    .limit(1);
  if (!document) throw new TRPCError({ code: "NOT_FOUND", message: "Document not found." });
  return document;
}

/** Document rows the person may see, optionally narrowed by project, site and category. */
async function visibleCondition(
  user: User,
  filter: { projectId?: string; siteId?: string; status?: "Active" | "Archived" },
) {
  const reach = await documentReach(user, "document.view");
  if (reach.siteIds.length === 0) return null;
  const parts = [
    or(
      inArray(projectDocuments.siteId, reach.siteIds),
      and(isNull(projectDocuments.siteId), inArray(projectDocuments.projectId, reach.projectIds)),
    )!,
    eq(projectDocuments.status, filter.status ?? "Active"),
  ];
  if (filter.projectId) parts.push(eq(projectDocuments.projectId, filter.projectId));
  if (filter.siteId) parts.push(eq(projectDocuments.siteId, filter.siteId));
  return and(...parts)!;
}

const listColumns = {
  id: projectDocuments.id,
  projectId: projectDocuments.projectId,
  projectName: projects.name,
  siteId: projectDocuments.siteId,
  siteName: sites.name,
  category: projectDocuments.category,
  title: projectDocuments.title,
  description: projectDocuments.description,
  tags: projectDocuments.tags,
  currentVersion: projectDocuments.currentVersion,
  status: projectDocuments.status,
  aiDocumentType: projectDocuments.aiDocumentType,
  aiSummary: projectDocuments.aiSummary,
  indexStatus: projectDocuments.indexStatus,
  createdBy: projectDocuments.createdBy,
  creatorName: users.name,
  updatedAt: projectDocuments.updatedAt,
};

const placeInput = {
  projectId: z.string().uuid(),
  siteId: z.string().uuid().nullable().optional(),
};

const fileInput = {
  fileName: z.string().trim().min(1).max(240),
  base64: z
    .string()
    .min(8)
    .max(Math.ceil((MAX_DOCUMENT_BYTES * 4) / 3) + 16),
};

function readFile(input: { fileName: string; base64: string }) {
  const bytes = Buffer.from(input.base64, "base64");
  if (bytes.length === 0 || bytes.length > MAX_DOCUMENT_BYTES)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Files must be between 1 byte and 15 MB.",
    });
  const contentType = sniffDocumentType(bytes, input.fileName);
  if (!contentType)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        "This file type is not accepted. Upload a PDF, photo (JPEG, PNG, WebP), AutoCAD drawing (DWG, DXF), Word (DOC, DOCX), Excel (XLS, XLSX), PowerPoint (PPTX), CSV or text file.",
    });
  return { bytes, contentType, fileName: safeDocumentName(input.fileName, contentType) };
}

/** Starts indexing after the upload has committed; failures only change indexStatus. */
function indexLater(args: Parameters<typeof indexDocument>[0]) {
  void indexDocument(args).catch(() => undefined);
}

export const documentsRouter = router({
  /** Projects and sites where the person can see or upload documents, and the categories. */
  options: protectedProcedure.query(async ({ ctx }) => {
    const access = await siteAccess(ctx.user);
    const view = reachFrom(access, "document.view");
    const upload = reachFrom(access, "document.upload");
    const manage = reachFrom(access, "document.manage");
    const projectsById = new Map<string, { id: string; name: string }>();
    for (const site of view.sites)
      projectsById.set(site.projectId, { id: site.projectId, name: site.project });
    return {
      categories: DOCUMENT_CATEGORIES,
      projects: [...projectsById.values()],
      sites: view.sites.map((site) => ({
        id: site.id,
        name: site.name,
        projectId: site.projectId,
        canUpload: upload.siteIds.includes(site.id),
        canManage: manage.siteIds.includes(site.id),
      })),
    };
  }),

  list: protectedProcedure
    .input(
      z.object({
        projectId: z.string().uuid().optional(),
        siteId: z.string().uuid().optional(),
        category: z.string().max(64).optional(),
        status: z.enum(["Active", "Archived"]).default("Active"),
        limit: z.number().int().min(1).max(200).default(50),
      }),
    )
    .query(async ({ ctx, input }) => {
      const condition = await visibleCondition(ctx.user, input);
      if (!condition) return [];
      const db = requireDb(await getDb());
      return db
        .select(listColumns)
        .from(projectDocuments)
        .innerJoin(projects, eq(projectDocuments.projectId, projects.id))
        .leftJoin(sites, eq(projectDocuments.siteId, sites.id))
        .innerJoin(users, eq(projectDocuments.createdBy, users.id))
        .where(
          input.category
            ? and(condition, eq(projectDocuments.category, input.category))
            : condition,
        )
        .orderBy(desc(projectDocuments.updatedAt))
        .limit(input.limit);
    }),

  detail: protectedProcedure
    .input(z.object({ documentId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const document = await loadDocument(input.documentId);
      await scopeForPlace(ctx.user, document.projectId, document.siteId, "document.view");
      const db = requireDb(await getDb());
      const versions = await db
        .select({
          versionNumber: projectDocumentVersions.versionNumber,
          note: projectDocumentVersions.note,
          createdAt: projectDocumentVersions.createdAt,
          uploaderName: users.name,
          fileName: attachments.originalFilename,
          contentType: attachments.contentType,
          sizeBytes: attachments.sizeBytes,
        })
        .from(projectDocumentVersions)
        .innerJoin(attachments, eq(projectDocumentVersions.attachmentId, attachments.id))
        .innerJoin(users, eq(projectDocumentVersions.uploadedBy, users.id))
        .where(eq(projectDocumentVersions.documentId, document.id))
        .orderBy(desc(projectDocumentVersions.versionNumber));
      let canManage = false;
      try {
        await scopeForPlace(ctx.user, document.projectId, document.siteId, "document.manage");
        canManage = true;
      } catch {
        canManage = false;
      }
      return {
        document: {
          ...document,
          aiFields: document.aiFields
            ? (JSON.parse(document.aiFields) as Record<string, string>)
            : null,
        },
        versions,
        canManage,
        canReplace: canManage || document.createdBy === ctx.user.id,
      };
    }),

  /** A new document, or a new version of an existing one when documentId is given. */
  upload: protectedProcedure
    .input(
      z.object({
        ...placeInput,
        ...fileInput,
        documentId: z.string().uuid().optional(),
        category: z.enum(DOCUMENT_CATEGORIES),
        title: z.string().trim().min(2).max(200),
        description: z.string().trim().max(4000).optional(),
        tags: z.string().trim().max(500).optional(),
        note: z.string().trim().max(500).optional(),
        clientMutationId: z.string().trim().min(16).max(64),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const db = requireDb(await getDb());
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

      const existing = input.documentId ? await loadDocument(input.documentId) : null;
      const projectId = existing?.projectId ?? input.projectId;
      const siteId = existing ? existing.siteId : (input.siteId ?? null);
      const scope = await scopeForPlace(ctx.user, projectId, siteId, "document.upload");
      if (existing) {
        if (existing.status !== "Active")
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "Restore the document before adding a new version.",
          });
        if (existing.createdBy !== ctx.user.id)
          await scopeForPlace(ctx.user, projectId, siteId, "document.manage");
      }
      const file = readFile(input);
      const documentId = existing?.id ?? randomUUID();
      const attachmentId = randomUUID();
      const checksum = createHash("sha256").update(file.bytes).digest("hex");
      let stored: { key: string };
      try {
        stored = await storagePut(
          `documents/${scope.organizationId}/${projectId}/${documentId}/${attachmentId}`,
          file.bytes,
          file.contentType,
        );
      } catch {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "File storage is unavailable right now. Try again shortly.",
        });
      }
      const title = existing?.title ?? input.title;
      const versionNumber = await db.transaction(async (tx) => {
        let next = 1;
        if (existing) {
          const [locked] = await tx
            .select({ currentVersion: projectDocuments.currentVersion })
            .from(projectDocuments)
            .where(eq(projectDocuments.id, existing.id))
            .for("update")
            .limit(1);
          next = (locked?.currentVersion ?? existing.currentVersion) + 1;
        }
        await tx.insert(attachments).values({
          id: attachmentId,
          organizationId: scope.organizationId,
          entityType: "project_document",
          entityId: documentId,
          storageKey: stored.key,
          originalFilename: file.fileName,
          contentType: file.contentType,
          sizeBytes: file.bytes.length,
          checksum,
          uploadedBy: ctx.user.id,
          sourceType: "Selected from device",
          accessClassification: "Private",
          scanStatus: "Accepted",
        });
        if (existing) {
          await tx
            .update(projectDocuments)
            .set({ currentVersion: next, indexStatus: "Pending" })
            .where(eq(projectDocuments.id, existing.id));
        } else {
          await tx.insert(projectDocuments).values({
            id: documentId,
            organizationId: scope.organizationId,
            projectId,
            siteId,
            category: input.category,
            title: input.title,
            description: input.description || null,
            tags: normalizeTags(input.tags ?? "").join(", ") || null,
            currentVersion: 1,
            clientMutationId: input.clientMutationId,
            createdBy: ctx.user.id,
          });
        }
        await tx.insert(projectDocumentVersions).values({
          id: randomUUID(),
          documentId,
          versionNumber: next,
          attachmentId,
          note: input.note || null,
          uploadedBy: ctx.user.id,
        });
        await tx.insert(auditEvents).values({
          id: randomUUID(),
          organizationId: scope.organizationId,
          siteId: siteId ?? scope.siteId,
          actorUserId: ctx.user.id,
          action: existing ? "document.version_added" : "document.uploaded",
          entityType: "project_document",
          entityId: documentId,
          clientMutationId: input.clientMutationId,
          requestId: requestId(ctx.req.headers["x-request-id"]),
          afterSummary: JSON.stringify({
            versionNumber: next,
            category: existing?.category ?? input.category,
            contentType: file.contentType,
            sizeBytes: file.bytes.length,
            checksum,
          }),
        });
        return next;
      });
      indexLater({
        documentId,
        versionNumber,
        title,
        bytes: file.bytes,
        contentType: file.contentType,
      });
      return { id: documentId, versionNumber };
    }),

  /** Title, category, description and tags; by the uploader or a document manager. */
  update: protectedProcedure
    .input(
      z.object({
        documentId: z.string().uuid(),
        category: z.enum(DOCUMENT_CATEGORIES),
        title: z.string().trim().min(2).max(200),
        description: z.string().trim().max(4000).optional(),
        tags: z.string().trim().max(500).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const document = await loadDocument(input.documentId);
      const scope = await scopeForPlace(
        ctx.user,
        document.projectId,
        document.siteId,
        document.createdBy === ctx.user.id ? "document.upload" : "document.manage",
      );
      const db = requireDb(await getDb());
      await db.transaction(async (tx) => {
        await tx
          .update(projectDocuments)
          .set({
            category: input.category,
            title: input.title,
            description: input.description || null,
            tags: normalizeTags(input.tags ?? "").join(", ") || null,
          })
          .where(eq(projectDocuments.id, document.id));
        await tx.insert(auditEvents).values({
          id: randomUUID(),
          organizationId: scope.organizationId,
          siteId: document.siteId ?? scope.siteId,
          actorUserId: ctx.user.id,
          action: "document.details_updated",
          entityType: "project_document",
          entityId: document.id,
          beforeSummary: JSON.stringify({ title: document.title, category: document.category }),
          afterSummary: JSON.stringify({ title: input.title, category: input.category }),
        });
      });
      return { id: document.id };
    }),

  /** Archive hides a document from lists and search; restore brings it back. Needs a reason. */
  setStatus: protectedProcedure
    .input(
      z.object({
        documentId: z.string().uuid(),
        status: z.enum(["Active", "Archived"]),
        reason: z.string().trim().min(3).max(500),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const document = await loadDocument(input.documentId);
      const scope = await scopeForPlace(
        ctx.user,
        document.projectId,
        document.siteId,
        "document.manage",
      );
      const db = requireDb(await getDb());
      await db.transaction(async (tx) => {
        await tx
          .update(projectDocuments)
          .set({ status: input.status })
          .where(eq(projectDocuments.id, document.id));
        await tx.insert(auditEvents).values({
          id: randomUUID(),
          organizationId: scope.organizationId,
          siteId: document.siteId ?? scope.siteId,
          actorUserId: ctx.user.id,
          action: input.status === "Archived" ? "document.archived" : "document.restored",
          entityType: "project_document",
          entityId: document.id,
          beforeSummary: JSON.stringify({ status: document.status }),
          afterSummary: JSON.stringify({ status: input.status }),
          reason: input.reason,
        });
      });
      return { id: document.id, status: input.status };
    }),

  /** Short-lived link to a version's file (the current one by default). */
  open: protectedProcedure
    .input(
      z.object({
        documentId: z.string().uuid(),
        versionNumber: z.number().int().min(1).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const document = await loadDocument(input.documentId);
      await scopeForPlace(ctx.user, document.projectId, document.siteId, "document.view");
      const db = requireDb(await getDb());
      const [file] = await db
        .select({ storageKey: attachments.storageKey, contentType: attachments.contentType })
        .from(projectDocumentVersions)
        .innerJoin(attachments, eq(projectDocumentVersions.attachmentId, attachments.id))
        .where(
          and(
            eq(projectDocumentVersions.documentId, document.id),
            eq(
              projectDocumentVersions.versionNumber,
              input.versionNumber ?? document.currentVersion,
            ),
          ),
        )
        .limit(1);
      if (!file) throw new TRPCError({ code: "NOT_FOUND", message: "File not found." });
      try {
        return { url: await storageGetSignedUrl(file.storageKey), contentType: file.contentType };
      } catch {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "File storage is unavailable right now. Try again shortly.",
        });
      }
    }),

  /**
   * Natural-language search over the documents the person may see. Meaning (vector) match when
   * AI is set up, with keyword hits boosting exact numbers and names; keyword only otherwise.
   */
  search: protectedProcedure
    .input(
      z.object({
        query: z.string().trim().min(2).max(300),
        projectId: z.string().uuid().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const condition = await visibleCondition(ctx.user, { projectId: input.projectId });
      if (!condition) return { mode: "keyword" as const, results: [] };
      const db = requireDb(await getDb());
      const docs = await db
        .select(listColumns)
        .from(projectDocuments)
        .innerJoin(projects, eq(projectDocuments.projectId, projects.id))
        .leftJoin(sites, eq(projectDocuments.siteId, sites.id))
        .innerJoin(users, eq(projectDocuments.createdBy, users.id))
        .where(condition)
        .orderBy(desc(projectDocuments.updatedAt))
        .limit(2000);
      if (docs.length === 0) return { mode: "keyword" as const, results: [] };
      const chunks = await db
        .select({
          documentId: documentChunks.documentId,
          content: documentChunks.content,
          embedding: documentChunks.embedding,
        })
        .from(documentChunks)
        .where(
          inArray(
            documentChunks.documentId,
            docs.map((doc) => doc.id),
          ),
        )
        .limit(20_000);
      const queryVector = chunks.some((chunk) => chunk.embedding)
        ? await embedQuery(input.query).catch(() => null)
        : null;
      const passages = chunks.map((chunk) => {
        let vector: number | null = null;
        if (queryVector && chunk.embedding) {
          try {
            vector = cosineSimilarity(queryVector, JSON.parse(chunk.embedding) as number[]);
          } catch {
            vector = null;
          }
        }
        return {
          documentId: chunk.documentId,
          content: chunk.content,
          score: hybridScore(
            queryVector ? (vector ?? 0) : null,
            keywordScore(input.query, chunk.content),
          ),
        };
      });
      // Titles, tags and categories count too, so a document is found before its text is indexed.
      for (const doc of docs)
        passages.push({
          documentId: doc.id,
          content: [doc.title, doc.tags, doc.category, doc.description].filter(Boolean).join(" · "),
          score: keywordScore(
            input.query,
            [doc.title, doc.tags, doc.category, doc.description, doc.siteName, doc.projectName]
              .filter(Boolean)
              .join(" "),
          ),
        });
      const ranked = rankDocuments(passages, 20, queryVector ? 0.3 : 0.34);
      const byId = new Map(docs.map((doc) => [doc.id, doc]));
      return {
        mode: queryVector ? ("meaning" as const) : ("keyword" as const),
        results: ranked.map((row) => ({
          ...byId.get(row.documentId)!,
          score: Math.round(row.score * 100) / 100,
          excerpt: snippet(row.content, input.query),
        })),
      };
    }),

  /** Rebuild the search index of a document from its current file. */
  reindex: protectedProcedure
    .input(z.object({ documentId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const document = await loadDocument(input.documentId);
      await scopeForPlace(ctx.user, document.projectId, document.siteId, "document.manage");
      const db = requireDb(await getDb());
      const [file] = await db
        .select({ storageKey: attachments.storageKey })
        .from(projectDocumentVersions)
        .innerJoin(attachments, eq(projectDocumentVersions.attachmentId, attachments.id))
        .where(
          and(
            eq(projectDocumentVersions.documentId, document.id),
            eq(projectDocumentVersions.versionNumber, document.currentVersion),
          ),
        )
        .limit(1);
      if (!file) throw new TRPCError({ code: "NOT_FOUND", message: "File not found." });
      const response = await fetch(await storageGetSignedUrl(file.storageKey)).catch(() => null);
      if (!response?.ok)
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "The stored file could not be read. Try again shortly.",
        });
      const bytes = new Uint8Array(await response.arrayBuffer());
      const contentType = sniffDocumentType(bytes, "file.csv");
      if (!contentType)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "The stored file type is not supported.",
        });
      await db
        .update(projectDocuments)
        .set({ indexStatus: "Pending" })
        .where(eq(projectDocuments.id, document.id));
      indexLater({
        documentId: document.id,
        versionNumber: document.currentVersion,
        title: document.title,
        bytes,
        contentType,
      });
      return { id: document.id };
    }),
});
