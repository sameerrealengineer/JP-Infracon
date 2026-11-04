import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { and, asc, eq, ne } from "drizzle-orm";
import { auditEvents, materialItems, workTasks } from "../../drizzle/schema";
import {
  normalizeRequestFields,
  requestJsonSchema,
  requestPrompt,
} from "../../lib/jp/ai-request-extraction";
import {
  expenseJsonSchema,
  expensePrompt,
  normalizeExpenseFields,
} from "../../lib/jp/ai-expense-extraction";
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
import {
  normalizeReportFields,
  reportJsonSchema,
  reportPrompt,
} from "../../lib/jp/ai-report-extraction";

const MAX_IMAGE_BYTES = 6 * 1024 * 1024;
const MAX_AUDIO_BYTES = 3 * 1024 * 1024;
/** Up to 50 terms of up to 64 characters each (Sarvam speech-to-text limits). */
const SITE_KEYTERMS = [
  "DPR",
  "DLR",
  "mistri",
  "mason",
  "helper",
  "bar bender",
  "shuttering",
  "centering",
  "plaster",
  "brickwork",
  "RCC",
  "PCC",
  "slab",
  "column",
  "footing",
  "sqft",
  "sqm",
  "cum",
  "rmt",
  "cement",
  "TMT",
];

export function geminiKey() {
  return process.env.GEMINI_API_KEY?.trim() || "";
}
export function sarvamKey() {
  return process.env.SARVAM_API_KEY?.trim() || "";
}

/** Simple per-person limit so one phone cannot run up the AI bill. */
const usage = new Map<number, number[]>();
export function rateLimit(userId: number, perHour = 40) {
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

/** "HTTP 403: API key not valid" style text from a failed provider call; never the key itself. */
export async function providerError(response: Response | null | undefined) {
  if (!response) return "no connection to the AI service";
  let message = "";
  try {
    const body = (await response.json()) as {
      error?: { message?: string } | string;
      message?: string;
    };
    message =
      typeof body.error === "string" ? body.error : (body.error?.message ?? body.message ?? "");
  } catch {
    await response.body?.cancel().catch(() => undefined);
  }
  return `HTTP ${response.status}${message ? `: ${message.slice(0, 160)}` : ""}`;
}

/** Speech to text with Sarvam (Odia, Hindi, English and more; or "unknown" to detect). */
export async function sarvamTranscribe(bytes: Buffer, mimeType: string, language: string) {
  const key = sarvamKey();
  if (!key)
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Voice is not set up: add SARVAM_API_KEY on the server.",
    });
  const form = new FormData();
  const ext = mimeType.split("/")[1]?.replace(/[^a-z0-9]/g, "") || "m4a";
  form.append("file", new Blob([new Uint8Array(bytes)], { type: mimeType }), `note.${ext}`);
  const sttModel = process.env.SARVAM_STT_MODEL?.trim() || "saaras:v4";
  form.append("model", sttModel);
  form.append("language_code", language);
  // Site words the model should expect (supported by saaras:v4 only).
  if (sttModel === "saaras:v4") form.append("keyterms", JSON.stringify(SITE_KEYTERMS));
  const response = await fetch("https://api.sarvam.ai/speech-to-text", {
    method: "POST",
    headers: { "api-subscription-key": key },
    body: form,
    signal: AbortSignal.timeout(60_000),
  }).catch(() => null);
  if (!response?.ok) {
    const detail = await providerError(response);
    console.error(`[AI] Sarvam speech-to-text failed: ${detail}`);
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: `Speech recognition did not work (${detail}). Try again.`,
    });
  }
  const json = (await response.json()) as { transcript?: string; language_code?: string | null };
  return { transcript: (json.transcript ?? "").trim(), language: json.language_code ?? language };
}

/** Text to speech with Sarvam Bulbul; MP3 as base64. */
export async function sarvamSpeak(text: string, language: string) {
  const key = sarvamKey();
  if (!key)
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Spoken replies are not set up: add SARVAM_API_KEY on the server.",
    });
  const response = await fetch("https://api.sarvam.ai/text-to-speech", {
    method: "POST",
    headers: { "api-subscription-key": key, "Content-Type": "application/json" },
    body: JSON.stringify({
      text,
      language_code: language,
      model: process.env.SARVAM_TTS_MODEL?.trim() || "bulbul:v3",
      speaker: process.env.SARVAM_TTS_SPEAKER?.trim() || "priya",
      pace: 1.05,
      output_audio_codec: "mp3",
    }),
    signal: AbortSignal.timeout(30_000),
  }).catch(() => null);
  if (!response?.ok) {
    const detail = await providerError(response);
    console.error(`[AI] Sarvam text-to-speech failed: ${detail}`);
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: `The spoken reply could not be made (${detail}). Read the text instead.`,
    });
  }
  const json = (await response.json()) as { audios?: string[] };
  const audio = (json.audios ?? []).join("");
  if (!audio) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "No audio came back." });
  return { audioBase64: audio, mimeType: "audio/mpeg" };
}

/** A prompt part: text, or an inline photo or PDF (base64). */
export type Part = { text: string } | { image: { data: string; mimeType: string } };

/** Models tried in order: GEMINI_MODEL, then GEMINI_FALLBACK_MODELS (comma separated). */
export function geminiModels(env = process.env) {
  const primary = env.GEMINI_MODEL?.trim() || "gemini-flash-latest";
  const fallbacks = (env.GEMINI_FALLBACK_MODELS ?? "gemini-flash-latest,gemini-2.5-flash")
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);
  return [...new Set([primary, ...fallbacks])];
}

/** Busy, rate-limited or briefly broken: worth another try. */
export function retryableStatus(status: number | null) {
  return status === null || status === 429 || status >= 500;
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Calls Gemini with JSON output. Google often answers "503 high demand" for a few seconds, so
 * each model is tried twice with a short wait, then the next model. A model that does not exist
 * (404) is skipped; a bad key (400/401/403) stops at once with the reason.
 */
export async function geminiJson(parts: Part[], schema: object): Promise<unknown> {
  const key = geminiKey();
  if (!key)
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "AI is not set up: add GEMINI_API_KEY on the server.",
    });
  const contents = [
    {
      role: "user",
      parts: parts.map((part) =>
        "text" in part
          ? { text: part.text }
          : { inline_data: { mime_type: part.image.mimeType, data: part.image.data } },
      ),
    },
  ];
  let lastDetail = "no answer";
  for (const model of geminiModels()) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": key },
          signal: AbortSignal.timeout(60_000),
          body: JSON.stringify({
            contents,
            generationConfig: { responseMimeType: "application/json", responseSchema: schema },
          }),
        },
      ).catch(() => null);
      if (response?.ok) {
        const json = (await response.json()) as {
          candidates?: { content?: { parts?: { text?: string }[] } }[];
        };
        const text =
          json.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("") ?? "";
        if (text) return parseModelJson(text);
        lastDetail = `${model} gave an empty answer`;
        break;
      }
      lastDetail = `${model} ${await providerError(response)}`;
      const status = response?.status ?? null;
      console.error(`[AI] Gemini ${lastDetail}`);
      if (status === 400 || status === 401 || status === 403)
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `The AI service refused the request (${lastDetail}). Check GEMINI_API_KEY.`,
        });
      if (!retryableStatus(status)) break; // e.g. 404: try the next model
      if (attempt === 0) await pause(1200);
    }
  }
  throw new TRPCError({
    code: "PRECONDITION_FAILED",
    message: `The AI service is busy right now (${lastDetail}). Try again in a minute.`,
  });
}

/**
 * Structured JSON from Gemini, or from Sarvam when Gemini is not set up or keeps failing.
 * Sarvam reads text only, so a request with photos or PDFs never falls back.
 */
export async function aiJson(
  parts: Part[],
  schema: object,
  sarvam?: { system: string; text: string },
): Promise<unknown> {
  const textOnly = parts.every((part) => "text" in part);
  if (geminiKey()) {
    try {
      return await geminiJson(parts, schema);
    } catch (error) {
      if (!textOnly || !sarvam || !sarvamKey()) throw error;
      console.error("[AI] Gemini failed; answering with Sarvam");
    }
  }
  if (!sarvam)
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "AI is not set up: add GEMINI_API_KEY on the server.",
    });
  return sarvamJson(sarvam.system, sarvam.text);
}

/** Sarvam chat as a fallback structurer when Gemini is not configured. */
export async function sarvamJson(system: string, text: string): Promise<unknown> {
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
  if (!response?.ok) {
    const detail = await providerError(response);
    console.error(`[AI] Sarvam chat failed: ${detail}`);
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: `The AI service did not answer (${detail}).`,
    });
  }
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
      if (!mimeType?.startsWith("image/") || bytes.length > MAX_IMAGE_BYTES)
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
      const bytes = Buffer.from(input.audioBase64, "base64");
      if (bytes.length > MAX_AUDIO_BYTES)
        throw new TRPCError({ code: "BAD_REQUEST", message: "Keep voice notes under 30 seconds." });
      const result = await sarvamTranscribe(bytes, input.mimeType, input.language);
      await audit(scope.organizationId, scope.siteId, ctx.user.id, "ai.voice_transcribed");
      return result;
    }),

  /** Free text (typed or transcribed) → issue form fields. */
  fillIssue: protectedProcedure
    .input(z.object({ siteId: z.string().uuid(), text: z.string().trim().min(3).max(4000) }))
    .mutation(async ({ ctx, input }) => {
      const scope = await getSiteScope(ctx.user, input.siteId, "issue.create");
      rateLimit(ctx.user.id);
      const raw = await aiJson(
        [{ text: `${issuePrompt}\n\nWorker said:\n"""${input.text}"""` }],
        issueJsonSchema,
        {
          system: `${issuePrompt} Use keys category, severity, title, description, location, immediateAction.`,
          text: input.text,
        },
      );
      await audit(scope.organizationId, scope.siteId, ctx.user.id, "ai.issue_drafted");
      return normalizeIssueFields(raw);
    }),

  /**
   * Free text (typed or transcribed) → daily report draft fields. Task names are matched only
   * to this site's tasks; doubtful lines come back with warnings. Nothing is saved here.
   */
  fillReport: protectedProcedure
    .input(
      z.object({
        siteId: z.string().uuid(),
        reportKind: z.enum(["DPR", "DLR"]),
        text: z.string().trim().min(3).max(4000),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const scope = await getSiteScope(
        ctx.user,
        input.siteId,
        input.reportKind === "DPR" ? "dpr.create" : "dlr.create",
      );
      rateLimit(ctx.user.id);
      const db = await getDb();
      const tasks = db
        ? await db
            .select({ id: workTasks.id, title: workTasks.title })
            .from(workTasks)
            .where(and(eq(workTasks.siteId, scope.siteId), ne(workTasks.status, "Cancelled")))
            .orderBy(asc(workTasks.plannedStart))
            .limit(60)
        : [];
      const prompt = reportPrompt(
        input.reportKind,
        tasks.map((task) => task.title),
      );
      const raw = await aiJson(
        [{ text: `${prompt}\n\nSupervisor said:\n"""${input.text}"""` }],
        reportJsonSchema,
        {
          system:
            `${prompt} Use keys title, weather, siteStatus, notes, nextDayPlan and workLines ` +
            "(each with task, description, location, unit, doneToday, doneSoFar, planned).",
          text: input.text,
        },
      );
      await audit(scope.organizationId, scope.siteId, ctx.user.id, "ai.report_drafted");
      return normalizeReportFields(raw, input.reportKind, tasks);
    }),

  /** Spoken or typed material need → material request draft fields. Nothing is saved here. */
  fillRequest: protectedProcedure
    .input(z.object({ siteId: z.string().uuid(), text: z.string().trim().min(3).max(2000) }))
    .mutation(async ({ ctx, input }) => {
      const scope = await getSiteScope(ctx.user, input.siteId, "material.request");
      rateLimit(ctx.user.id);
      const db = await getDb();
      const catalogue = db
        ? (
            await db
              .select({ name: materialItems.name })
              .from(materialItems)
              .where(eq(materialItems.organizationId, scope.organizationId))
              .orderBy(asc(materialItems.name))
              .limit(120)
          ).map((row) => row.name)
        : [];
      const prompt = requestPrompt(catalogue);
      const raw = await aiJson(
        [{ text: `${prompt}\n\nThe person said:\n"""${input.text}"""` }],
        requestJsonSchema,
        {
          system: `${prompt} Reply as JSON with keys items (array of {name, quantity, unit}) and purpose.`,
          text: input.text,
        },
      );
      await audit(scope.organizationId, scope.siteId, ctx.user.id, "ai.request_drafted");
      return normalizeRequestFields(raw, catalogue);
    }),

  /** Spoken note or receipt photo → petty cash expense draft fields. Nothing is saved here. */
  fillExpense: protectedProcedure
    .input(
      z
        .object({
          siteId: z.string().uuid(),
          text: z.string().trim().min(3).max(2000).optional(),
          imageBase64: z
            .string()
            .min(16)
            .max(Math.ceil((MAX_IMAGE_BYTES * 4) / 3) + 16)
            .optional(),
        })
        .refine((input) => input.text || input.imageBase64, "Say, type or photograph the expense."),
    )
    .mutation(async ({ ctx, input }) => {
      const scope = await getSiteScope(ctx.user, input.siteId, "finance.cash.movement.create");
      rateLimit(ctx.user.id);
      const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(
        new Date(),
      );
      let raw: unknown;
      if (input.imageBase64) {
        const mimeType = sniffContentType(Buffer.from(input.imageBase64, "base64"));
        if (!mimeType?.startsWith("image/"))
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Send a clear JPEG, PNG or WebP photo.",
          });
        if (!geminiKey())
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "Reading receipt photos needs GEMINI_API_KEY on the server.",
          });
        raw = await geminiJson(
          [
            { text: `${expensePrompt} Today is ${today}.` },
            { image: { data: input.imageBase64, mimeType } },
          ],
          expenseJsonSchema,
        );
      } else {
        const prompt = `${expensePrompt} Today is ${today}.`;
        raw = await aiJson(
          [{ text: `${prompt}\n\nThe person said:\n"""${input.text}"""` }],
          expenseJsonSchema,
          {
            system: `${prompt} Reply as JSON with keys amount, date, payee, paymentMode, category, purpose, receiptNumber.`,
            text: input.text!,
          },
        );
      }
      await audit(scope.organizationId, scope.siteId, ctx.user.id, "ai.expense_drafted");
      return normalizeExpenseFields(raw, today);
    }),
});
