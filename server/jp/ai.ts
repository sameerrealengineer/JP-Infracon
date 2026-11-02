import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { auditEvents } from "../../drizzle/schema";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { getSiteScope } from "./access";
import {
  billJsonSchema,
  billPrompt,
  issueJsonSchema,
  issuePrompt,
  normalizeBill,
  normalizeIssueFields,
  parseModelJson,
} from "../../lib/jp/ai-extraction";
import { sniffContentType } from "../../lib/jp/attachment-policy";

const MAX_IMAGE_BYTES = 6 * 1024 * 1024;
const MAX_AUDIO_BYTES = 3 * 1024 * 1024;

function geminiKey() {
  return process.env.GEMINI_API_KEY?.trim() || "";
}
function sarvamKey() {
  return process.env.SARVAM_API_KEY?.trim() || "";
}

/** Simple per-person limit so one phone cannot run up the AI bill. */
const usage = new Map<number, number[]>();
function rateLimit(userId: number, perHour = 40) {
  const now = Date.now();
  const recent = (usage.get(userId) ?? []).filter((time) => now - time < 3_600_000);
  if (recent.length >= perHour)
    throw new TRPCError({
      code: "TOO_MANY_REQUESTS",
      message: "AI limit reached for this hour. Try again later.",
    });
  recent.push(now);
  usage.set(userId, recent);
}

type Part = { text: string } | { image: { data: string; mimeType: string } };

/**
 * Calls Gemini with JSON output. Uses the Interactions API and falls back to generateContent,
 * so a change on Google's side does not break bill scanning.
 */
async function geminiJson(parts: Part[], schema: object): Promise<unknown> {
  const key = geminiKey();
  if (!key)
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "AI is not set up: add GEMINI_API_KEY on the server.",
    });
  const model = process.env.GEMINI_MODEL?.trim() || "gemini-3.8-flash";
  const headers = { "Content-Type": "application/json", "x-goog-api-key": key };
  const signal = AbortSignal.timeout(60_000);
  const first = await fetch("https://generativelanguage.googleapis.com/v1beta/interactions", {
    method: "POST",
    headers,
    signal,
    body: JSON.stringify({
      model,
      input: parts.map((part) =>
        "text" in part
          ? { type: "text", text: part.text }
          : { type: "image", data: part.image.data, mime_type: part.image.mimeType },
      ),
      response_format: { type: "text", mime_type: "application/json", schema },
    }),
  }).catch(() => null);
  if (first?.ok) {
    const json = (await first.json()) as {
      steps?: { type?: string; content?: { type?: string; text?: string }[] }[];
    };
    const text = (json.steps ?? [])
      .filter((step) => step.type === "model_output")
      .flatMap((step) => step.content ?? [])
      .map((item) => item.text ?? "")
      .join("");
    if (text) return parseModelJson(text);
  } else await first?.body?.cancel().catch(() => undefined);

  const second = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    {
      method: "POST",
      headers,
      signal: AbortSignal.timeout(60_000),
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: parts.map((part) =>
              "text" in part
                ? { text: part.text }
                : { inline_data: { mime_type: part.image.mimeType, data: part.image.data } },
            ),
          },
        ],
        generationConfig: { responseMimeType: "application/json", responseSchema: schema },
      }),
    },
  ).catch(() => null);
  if (!second?.ok) {
    await second?.body?.cancel().catch(() => undefined);
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "The AI service did not respond. Try again.",
    });
  }
  const json = (await second.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const text = json.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("") ?? "";
  return parseModelJson(text);
}

/** Sarvam chat as a fallback structurer when Gemini is not configured. */
async function sarvamJson(system: string, text: string): Promise<unknown> {
  const key = sarvamKey();
  if (!key)
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "AI is not set up on the server.",
    });
  const response = await fetch("https://api.sarvam.ai/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", "api-subscription-key": key },
    signal: AbortSignal.timeout(60_000),
    body: JSON.stringify({
      model: "sarvam-105b",
      messages: [
        { role: "system", content: `${system} Reply with one JSON object only.` },
        { role: "user", content: text },
      ],
      response_format: { type: "json_object" },
      temperature: 0.2,
    }),
  }).catch(() => null);
  if (!response?.ok)
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "The AI service did not respond.",
    });
  const json = (await response.json()) as { choices?: { message?: { content?: string } }[] };
  return parseModelJson(json.choices?.[0]?.message?.content ?? "");
}

async function audit(organizationId: string, siteId: string, userId: number, action: string) {
  const db = await getDb();
  await db
    ?.insert(auditEvents)
    .values({
      id: randomUUID(),
      organizationId,
      siteId,
      actorUserId: userId,
      action,
      entityType: "ai_assist",
      entityId: randomUUID(),
    })
    .catch(() => undefined);
}

export const aiRouter = router({
  status: protectedProcedure.query(() => ({
    billScan: Boolean(geminiKey()),
    voice: Boolean(sarvamKey()),
    formFill: Boolean(geminiKey() || sarvamKey()),
  })),

  /** Bill/invoice photo → editable invoice draft. Nothing is saved here. */
  scanBill: protectedProcedure
    .input(
      z.object({
        siteId: z.string().uuid(),
        imageBase64: z
          .string()
          .min(16)
          .max(Math.ceil((MAX_IMAGE_BYTES * 4) / 3) + 16),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const scope = await getSiteScope(ctx.user, input.siteId, "finance.invoice.create");
      rateLimit(ctx.user.id);
      const bytes = Buffer.from(input.imageBase64, "base64");
      const mimeType = sniffContentType(bytes);
      if (!mimeType || mimeType === "application/pdf" || bytes.length > MAX_IMAGE_BYTES)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Send a clear JPEG, PNG or WebP photo under 6 MB.",
        });
      const raw = await geminiJson(
        [{ text: billPrompt }, { image: { data: input.imageBase64, mimeType } }],
        billJsonSchema,
      );
      await audit(scope.organizationId, scope.siteId, ctx.user.id, "ai.bill_scanned");
      return normalizeBill(raw);
    }),

  /** Speech (Odia, Hindi, English and more) → text, using Sarvam speech-to-text. */
  transcribe: protectedProcedure
    .input(
      z.object({
        siteId: z.string().uuid(),
        audioBase64: z
          .string()
          .min(16)
          .max(Math.ceil((MAX_AUDIO_BYTES * 4) / 3) + 16),
        mimeType: z.string().regex(/^audio\/[\w.+-]+$/),
        language: z.enum(["od-IN", "hi-IN", "en-IN", "unknown"]).default("unknown"),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const scope = await getSiteScope(ctx.user, input.siteId, "site.view");
      rateLimit(ctx.user.id);
      const key = sarvamKey();
      if (!key)
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Voice is not set up: add SARVAM_API_KEY on the server.",
        });
      const bytes = Buffer.from(input.audioBase64, "base64");
      if (bytes.length > MAX_AUDIO_BYTES)
        throw new TRPCError({ code: "BAD_REQUEST", message: "Keep voice notes under 30 seconds." });
      const form = new FormData();
      const ext = input.mimeType.split("/")[1]?.replace(/[^a-z0-9]/g, "") || "m4a";
      form.append("file", new Blob([bytes], { type: input.mimeType }), `note.${ext}`);
      form.append("model", process.env.SARVAM_STT_MODEL?.trim() || "saaras:v4");
      form.append("language_code", input.language);
      const response = await fetch("https://api.sarvam.ai/speech-to-text", {
        method: "POST",
        headers: { "api-subscription-key": key },
        body: form,
        signal: AbortSignal.timeout(60_000),
      }).catch(() => null);
      if (!response?.ok) {
        await response?.body?.cancel().catch(() => undefined);
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Speech recognition did not respond. Try again.",
        });
      }
      const json = (await response.json()) as {
        transcript?: string;
        language_code?: string | null;
      };
      await audit(scope.organizationId, scope.siteId, ctx.user.id, "ai.voice_transcribed");
      return {
        transcript: (json.transcript ?? "").trim(),
        language: json.language_code ?? input.language,
      };
    }),

  /** Free text (typed or transcribed) → issue form fields. */
  fillIssue: protectedProcedure
    .input(z.object({ siteId: z.string().uuid(), text: z.string().trim().min(3).max(4000) }))
    .mutation(async ({ ctx, input }) => {
      const scope = await getSiteScope(ctx.user, input.siteId, "issue.create");
      rateLimit(ctx.user.id);
      const raw = geminiKey()
        ? await geminiJson(
            [{ text: `${issuePrompt}\n\nWorker said:\n"""${input.text}"""` }],
            issueJsonSchema,
          )
        : await sarvamJson(
            `${issuePrompt} Use keys category, severity, title, description, location, immediateAction.`,
            input.text,
          );
      await audit(scope.organizationId, scope.siteId, ctx.user.id, "ai.issue_drafted");
      return normalizeIssueFields(raw);
    }),
});
