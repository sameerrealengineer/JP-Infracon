import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { documentChunks, projectDocuments } from "../../drizzle/schema";
import { getDb } from "../db";
import { geminiJson, geminiKey } from "./ai";
import {
  DOCUMENT_CATEGORIES,
  chunkText,
  isAiReadable,
  type DocumentContentType,
} from "../../lib/jp/document-policy";
import { extractDocumentText } from "../../lib/jp/document-text";

/**
 * Builds a document's search index after upload (DigUp style): text passages, plus meaning
 * vectors from Gemini Embedding 2 when GEMINI_API_KEY is set. Runs after the upload commits and
 * never fails the upload; the document's indexStatus says how far it got.
 */

export const EMBEDDING_MODEL = "gemini-embedding-2";
const DIMENSIONS = 768;
const MAX_CHUNKS = 120;
const AI_TEXT_LIMIT = 30_000;

const readerSchema = {
  type: "object",
  properties: {
    documentType: {
      type: "string",
      description: "e.g. tax invoice, work order, structural drawing, BOQ, site photo",
    },
    suggestedCategory: { type: "string", enum: [...DOCUMENT_CATEGORIES] },
    summary: { type: "string", description: "two or three plain English sentences" },
    documentNumber: { type: "string" },
    documentDate: { type: "string", description: "YYYY-MM-DD if shown" },
    partyName: { type: "string", description: "supplier, client or authority named" },
    gstin: { type: "string" },
    totalAmount: { type: "string", description: "as printed, digits only" },
    text: {
      type: "string",
      description:
        "all readable text in reading order (for photos: a short description of what is shown)",
    },
  },
  required: ["documentType", "summary", "text"],
} as const;

const readerPrompt =
  "You are reading a construction project document. Report only what is visible; leave a field " +
  "empty if it is not shown. Never guess amounts, GSTINs or dates.";

type Reader = {
  documentType?: string;
  suggestedCategory?: string;
  summary?: string;
  documentNumber?: string;
  documentDate?: string;
  partyName?: string;
  gstin?: string;
  totalAmount?: string;
  text?: string;
};

const clip = (value: unknown, max: number) =>
  String(value ?? "")
    .trim()
    .slice(0, max);

/** Calls Gemini Embedding 2 for up to 100 texts; null when AI is off or the call fails. */
export async function embedTexts(texts: string[]): Promise<number[][] | null> {
  const key = geminiKey();
  if (!key || texts.length === 0) return null;
  const vectors: number[][] = [];
  for (let start = 0; start < texts.length; start += 100) {
    const batch = texts.slice(start, start + 100);
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${EMBEDDING_MODEL}:batchEmbedContents`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": key },
        signal: AbortSignal.timeout(60_000),
        body: JSON.stringify({
          requests: batch.map((text) => ({
            model: `models/${EMBEDDING_MODEL}`,
            content: { parts: [{ text }] },
            output_dimensionality: DIMENSIONS,
          })),
        }),
      },
    ).catch(() => null);
    if (!response?.ok) {
      await response?.body?.cancel().catch(() => undefined);
      return null;
    }
    const json = (await response.json()) as { embeddings?: { values?: number[] }[] };
    const values = (json.embeddings ?? []).map((item) => item.values ?? []);
    if (values.length !== batch.length || values.some((row) => row.length === 0)) return null;
    vectors.push(...values);
  }
  return vectors;
}

/** A search query in Gemini Embedding 2's query format. */
export async function embedQuery(query: string): Promise<number[] | null> {
  const result = await embedTexts([`task: search result | query: ${query}`]);
  return result?.[0] ?? null;
}

function round(vector: number[]): string {
  return JSON.stringify(vector.map((value) => Math.round(value * 1e5) / 1e5));
}

export async function indexDocument(args: {
  documentId: string;
  versionNumber: number;
  title: string;
  bytes: Uint8Array;
  contentType: DocumentContentType;
}): Promise<void> {
  const db = await getDb();
  if (!db) return;
  const setStatus = (values: Partial<typeof projectDocuments.$inferInsert>) =>
    db.update(projectDocuments).set(values).where(eq(projectDocuments.id, args.documentId));
  try {
    let text = extractDocumentText(args.bytes, args.contentType);
    let reader: Reader | null = null;
    const readable = isAiReadable(args.contentType);
    // Nothing for the AI to read (a CAD drawing, an old Office file): the title still indexes it.
    if (geminiKey() && (readable || text.trim())) {
      try {
        reader = (await geminiJson(
          readable
            ? [
                { text: readerPrompt },
                {
                  image: {
                    data: Buffer.from(args.bytes).toString("base64"),
                    mimeType: args.contentType,
                  },
                },
              ]
            : [
                {
                  text: `${readerPrompt}\n\nDocument text:\n"""${text.slice(0, AI_TEXT_LIMIT)}"""`,
                },
              ],
          readerSchema,
        )) as Reader;
        if (readable) text = clip(reader?.text, 400_000);
      } catch {
        reader = null;
      }
    }
    const fields = reader
      ? Object.fromEntries(
          (
            [
              ["documentNumber", 80],
              ["documentDate", 20],
              ["partyName", 160],
              ["gstin", 20],
              ["totalAmount", 30],
            ] as const
          )
            .map(([name, max]) => [name, clip(reader?.[name], max)])
            .filter(([, value]) => value),
        )
      : null;
    const passages = chunkText(
      [args.title, reader?.summary, fields ? Object.values(fields).join(" ") : "", text]
        .filter(Boolean)
        .join("\n\n"),
    ).slice(0, MAX_CHUNKS);
    const vectors = await embedTexts(
      passages.map((passage) => `title: ${args.title || "none"} | text: ${passage}`),
    );

    await db.transaction(async (tx) => {
      await tx.delete(documentChunks).where(eq(documentChunks.documentId, args.documentId));
      if (passages.length)
        await tx.insert(documentChunks).values(
          passages.map((content, index) => ({
            id: randomUUID(),
            documentId: args.documentId,
            versionNumber: args.versionNumber,
            chunkIndex: index,
            content,
            embedding: vectors ? round(vectors[index]) : null,
            embeddingModel: vectors ? `${EMBEDDING_MODEL}@${DIMENSIONS}` : null,
          })),
        );
      await tx
        .update(projectDocuments)
        .set({
          indexStatus: vectors ? "Indexed" : passages.length ? "Keyword only" : "Failed",
          aiDocumentType: reader ? clip(reader.documentType, 80) || null : null,
          aiSummary: reader ? clip(reader.summary, 2000) || null : null,
          aiFields: fields && Object.keys(fields).length ? JSON.stringify(fields) : null,
        })
        .where(eq(projectDocuments.id, args.documentId));
    });
  } catch (error) {
    console.error("[JP] Document indexing failed", error instanceof Error ? error.message : "");
    await setStatus({ indexStatus: "Failed" }).catch(() => undefined);
  }
}
