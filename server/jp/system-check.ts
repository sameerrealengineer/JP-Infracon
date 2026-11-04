import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { organizationMemberships } from "../../drizzle/schema";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { storagePut } from "../storage";
import { geminiJson, geminiKey, rateLimit, sarvamKey, sarvamSpeak, sarvamTranscribe } from "./ai";
import { embedTexts } from "./document-index";
import { whatsappConfig } from "./notify";

/**
 * A system check owners and admins run from their phone: each AI and storage service the app
 * depends on is called for real, and the result (with the provider's reason when it fails) is
 * shown. Nothing about the company is sent to any service.
 */

/** A 32×32 picture: left half red, right half blue. */
const TEST_PICTURE =
  "iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAALklEQVR4nO3NQQkAAAgEMJNcEvunMIwZfAqD/VeTnKTnpAQCgUAgEAgEAsGXYAHPA5w9DhJY2AAAAABJRU5ErkJggg==";

type Check = { key: string; title: string; ok: boolean; detail: string; ms: number };

async function run(key: string, title: string, work: () => Promise<string>): Promise<Check> {
  const started = Date.now();
  try {
    return { key, title, ok: true, detail: await work(), ms: Date.now() - started };
  } catch (error) {
    return {
      key,
      title,
      ok: false,
      detail: error instanceof Error ? error.message.slice(0, 300) : "Failed",
      ms: Date.now() - started,
    };
  }
}

async function requireLeader(userId: number) {
  const db = await getDb();
  if (!db)
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "The database is not reachable." });
  const rows = await db
    .select({ role: organizationMemberships.businessRole })
    .from(organizationMemberships)
    .where(
      and(eq(organizationMemberships.userId, userId), eq(organizationMemberships.status, "Active")),
    );
  if (!rows.some((row) => ["owner", "director", "admin"].includes(row.role)))
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Only the owner, a director or an admin can run the system check.",
    });
}

export const systemCheckRouter = router({
  run: protectedProcedure.mutation(async ({ ctx }) => {
    await requireLeader(ctx.user.id);
    rateLimit(ctx.user.id, 20);
    const checks: Check[] = [];
    checks.push(
      await run("database", "Database", async () => {
        if (!(await getDb())) throw new Error("Not reachable");
        return "Connected";
      }),
    );
    checks.push(
      await run("ai_text", "AI assistant (text)", async () => {
        if (!geminiKey() && !sarvamKey()) throw new Error("No GEMINI_API_KEY or SARVAM_API_KEY");
        if (!geminiKey()) return "Sarvam only (photos and PDFs need Gemini)";
        const value = (await geminiJson([{ text: 'Reply with {"ok": true}.' }], {
          type: "object",
          properties: { ok: { type: "boolean" } },
          required: ["ok"],
        })) as { ok?: boolean };
        if (value?.ok !== true) throw new Error("Unexpected answer");
        return `Gemini ${process.env.GEMINI_MODEL?.trim() || "default model"} answered`;
      }),
    );
    checks.push(
      await run("ai_scan", "Bill scan / photo reading", async () => {
        if (!geminiKey()) throw new Error("Needs GEMINI_API_KEY");
        const value = (await geminiJson(
          [
            {
              text: "This picture has two colours side by side. Name the left colour in one word.",
            },
            { image: { data: TEST_PICTURE, mimeType: "image/png" } },
          ],
          { type: "object", properties: { left: { type: "string" } }, required: ["left"] },
        )) as { left?: string };
        if (!/red/i.test(value?.left ?? ""))
          throw new Error(`Read the picture wrongly: ${value?.left}`);
        return "Read a test picture correctly";
      }),
    );
    let audio: { audioBase64: string; mimeType: string } | null = null;
    checks.push(
      await run("voice_out", "Spoken replies (Sarvam)", async () => {
        audio = await sarvamSpeak("Namaste, JP Infracon site report", "hi-IN");
        return `${Math.round((audio.audioBase64.length * 3) / 4 / 1024)} KB of audio`;
      }),
    );
    checks.push(
      await run("voice_in", "Voice to text (Sarvam)", async () => {
        if (!audio) throw new Error("Skipped: spoken reply failed");
        const result = await sarvamTranscribe(
          Buffer.from((audio as { audioBase64: string }).audioBase64, "base64"),
          "audio/mpeg",
          "unknown",
        );
        if (!result.transcript) throw new Error("Heard nothing in the test audio");
        return `Heard "${result.transcript.slice(0, 60)}" (${result.language})`;
      }),
    );
    checks.push(
      await run("storage", "File storage (uploads)", async () => {
        const stored = await storagePut(
          `system-check/${Date.now()}.txt`,
          "JP Infracon system check",
          "text/plain",
        );
        return `Saved a test file (${stored.key.split("/").pop()})`;
      }),
    );
    checks.push(
      await run("search", "Document smart search", async () => {
        if (!geminiKey()) return "Keyword search only (no GEMINI_API_KEY)";
        const vectors = await embedTexts(["cement bags delivered to site"]);
        if (!vectors?.[0]?.length) throw new Error("No search vectors came back");
        return `Vectors of ${vectors[0].length} numbers`;
      }),
    );
    checks.push(
      await run("whatsapp", "WhatsApp alerts", async () => {
        const config = whatsappConfig();
        if (!config) throw new Error("Not set up (WHATSAPP_PROVIDER)");
        return `${config.provider} configured${process.env.WHATSAPP_BOT === "on" ? ", bot on" : ""}`;
      }),
    );
    return { checks, at: new Date().toISOString() };
  }),

  /** The phone's own voice test: a short recording is turned into text. */
  voice: protectedProcedure
    .input(
      z.object({
        audioBase64: z.string().min(16).max(3_000_000),
        mimeType: z.string().regex(/^audio\/[\w.+-]+$/),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await requireLeader(ctx.user.id);
      rateLimit(ctx.user.id, 20);
      return sarvamTranscribe(Buffer.from(input.audioBase64, "base64"), input.mimeType, "unknown");
    }),
});
