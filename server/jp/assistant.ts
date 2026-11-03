import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { auditEvents } from "../../drizzle/schema";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { getAccessibleSites } from "./access";
import { geminiJson, geminiKey, rateLimit, sarvamJson, sarvamKey } from "./ai";
import { siteCapabilities } from "./capabilities";
import { buildInbox } from "./inbox";
import { placeCards } from "./places";
import {
  ASSISTANT_ACTIONS,
  availableScreens,
  resolveAssistantAction,
} from "../../lib/jp/assistant-catalog";

/**
 * The in-app assistant. It answers from the person's own data (sites, progress, what is waiting)
 * and can open a screen or start a draft that the person checks and saves. It never saves,
 * approves or pays anything by itself, and only offers what the person's role allows.
 */

const LANGUAGES = ["od-IN", "hi-IN", "en-IN"] as const;

const answerSchema = {
  type: "object",
  properties: {
    reply: { type: "string" },
    action: {
      type: "object",
      properties: {
        type: { type: "string", enum: ASSISTANT_ACTIONS },
        screen: { type: "string" },
        siteId: { type: "string" },
        text: { type: "string" },
        reportKind: { type: "string", enum: ["DPR", "DLR"] },
      },
      required: ["type"],
    },
  },
  required: ["reply", "action"],
};

function percent(tenths: number | null) {
  return tenths === null ? "no tasks yet" : `${Math.round(tenths / 10)}%`;
}

async function audit(
  organizationId: string,
  siteId: string | null,
  userId: number,
  action: string,
) {
  const db = await getDb();
  if (!db) return;
  await db
    .insert(auditEvents)
    .values({
      id: randomUUID(),
      organizationId,
      siteId,
      actorUserId: userId,
      action,
      entityType: "assistant",
      entityId: randomUUID(),
    })
    .catch(() => undefined);
}

export const assistantRouter = router({
  status: protectedProcedure.query(() => ({
    available: Boolean(geminiKey() || sarvamKey()),
    voice: Boolean(sarvamKey()),
    speech: Boolean(sarvamKey()),
  })),

  /** One turn of the conversation: a short answer and at most one safe action. */
  ask: protectedProcedure
    .input(
      z.object({
        text: z.string().trim().min(1).max(2000),
        history: z
          .array(z.object({ role: z.enum(["user", "assistant"]), text: z.string().max(2000) }))
          .max(10)
          .default([]),
        siteId: z.string().uuid().nullish(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (!geminiKey() && !sarvamKey())
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            "The assistant is not set up: add GEMINI_API_KEY or SARVAM_API_KEY on the server.",
        });
      rateLimit(ctx.user.id, 80);
      const db = await getDb();
      if (!db)
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "The business data service is temporarily unavailable.",
        });
      const accessible = await getAccessibleSites(ctx.user);
      const capabilities = await siteCapabilities(ctx.user, accessible);
      const sitePermissions = new Map(
        capabilities.map((row) => [
          row.siteId,
          new Set(
            Object.entries(row)
              .filter(([key, value]) => key !== "siteId" && value === true)
              .map(([key]) => key),
          ),
        ]),
      );
      const held = new Set([...sitePermissions.values()].flatMap((set) => [...set]));
      const [cards, inbox] = await Promise.all([
        placeCards(ctx.user).catch(() => null),
        buildInbox(db, ctx.user.id, capabilities).catch(() => null),
      ]);
      const defaultSiteId =
        (input.siteId && sitePermissions.has(input.siteId) ? input.siteId : null) ??
        accessible[0]?.id ??
        null;
      const sitesText = accessible
        .map((site) => {
          const progress = cards?.sites.find((row) => row.siteId === site.id)?.progress;
          return `- ${site.name} (id ${site.id}, project ${site.project}, ${site.status}): ${
            progress
              ? `${percent(progress.actualTenths)} done, plan ${percent(progress.expectedTenths)}, ${progress.overdue} overdue tasks, ${progress.blocked} blocked`
              : "progress unknown"
          }`;
        })
        .join("\n");
      const waiting = (inbox?.items ?? [])
        .slice(0, 10)
        .map((item) => `- ${item.title}${item.siteName ? ` (${item.siteName})` : ""}`)
        .join("\n");
      const screens = availableScreens(held)
        .map((screen) => `- ${screen.key}: ${screen.title}: ${screen.about}`)
        .join("\n");
      const history = input.history
        .map((turn) => `${turn.role === "user" ? "Person" : "Assistant"}: ${turn.text}`)
        .join("\n");
      const prompt =
        "You are the helper inside JP Infracon, a construction site app used in Odisha, India. " +
        "Answer in the same language and script the person used (Odia, Hindi, English or Hinglish), " +
        "in at most three short sentences, simply, for busy site staff. Use only the facts below; " +
        "if you do not know, say so and point to the right screen. Never say you saved, submitted, " +
        "approved or paid anything: you can only open a screen or start a draft that the person " +
        "checks and saves.\n" +
        "Actions: 'open' a screen by its key (with siteId when it is about one site); " +
        "'draft_report' when they describe today's work or labour (put their words in text, " +
        "reportKind DPR for work done, DLR for labour); 'draft_issue' when they report a hazard, " +
        "defect or problem (their words in text); otherwise 'none'.\n\n" +
        `Today: ${cards?.today ?? new Date().toISOString().slice(0, 10)}\n` +
        `Person: ${ctx.user.name ?? "user"}\n` +
        `Their sites:\n${sitesText || "- none"}\n` +
        `Waiting for them:\n${waiting || "- nothing"}\n` +
        `Screens they can open:\n${screens}\n` +
        (history ? `\nConversation so far:\n${history}\n` : "") +
        `\nPerson now says:\n"""${input.text}"""`;
      let raw: unknown;
      try {
        raw = geminiKey()
          ? await geminiJson([{ text: prompt }], answerSchema)
          : await sarvamJson(
              `${prompt}\n\nReply as JSON: {"reply": "...", "action": {"type": "none|open|draft_report|draft_issue", "screen": "...", "siteId": "...", "text": "...", "reportKind": "DPR|DLR"}}`,
              input.text,
            );
      } catch {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "The assistant did not answer. Try again in a moment.",
        });
      }
      const value = (raw ?? {}) as { reply?: unknown; action?: Record<string, unknown> };
      const action = resolveAssistantAction(value.action ?? null, {
        held,
        sitePermissions,
        defaultSiteId,
      });
      const site = accessible.find((row) => row.id === defaultSiteId);
      if (site) await audit(site.organizationId, site.id, ctx.user.id, "ai.assistant_asked");
      return {
        reply:
          typeof value.reply === "string" && value.reply.trim()
            ? value.reply.trim().slice(0, 1200)
            : "Sorry, I could not understand that. Please say it again.",
        action,
      };
    }),

  /** Speaks a reply aloud (Sarvam Bulbul), returned as MP3 for the app to play. */
  speak: protectedProcedure
    .input(z.object({ text: z.string().trim().min(1).max(1200), language: z.enum(LANGUAGES) }))
    .mutation(async ({ ctx, input }) => {
      const key = sarvamKey();
      if (!key)
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Spoken replies are not set up: add SARVAM_API_KEY on the server.",
        });
      rateLimit(ctx.user.id, 80);
      const response = await fetch("https://api.sarvam.ai/text-to-speech", {
        method: "POST",
        headers: { "api-subscription-key": key, "Content-Type": "application/json" },
        body: JSON.stringify({
          text: input.text,
          language_code: input.language,
          model: process.env.SARVAM_TTS_MODEL?.trim() || "bulbul:v3",
          speaker: process.env.SARVAM_TTS_SPEAKER?.trim() || "priya",
          pace: 1.05,
          output_audio_codec: "mp3",
        }),
        signal: AbortSignal.timeout(30_000),
      }).catch(() => null);
      if (!response?.ok) {
        await response?.body?.cancel().catch(() => undefined);
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "The spoken reply could not be made. Read the text instead.",
        });
      }
      const json = (await response.json()) as { audios?: string[] };
      const audio = (json.audios ?? []).join("");
      if (!audio)
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "No audio came back." });
      return { audioBase64: audio, mimeType: "audio/mpeg" };
    }),
});
