import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type { Express, Request, Response } from "express";
import express from "express";
import { and, desc, eq, gte } from "drizzle-orm";
import { userContactPreferences, users, whatsappBotMessages } from "../../drizzle/schema";
import { getDb } from "../db";
import { answerQuestion } from "./assistant";
import { geminiKey, sarvamKey } from "./ai";
import { whatsappConfig } from "./notify";
import { whatsappRequest } from "../../lib/jp/notify-policy";
import {
  BOT_TEXT,
  formatReply,
  parseInbound,
  shouldSendStrangerNote,
  type InboundMessage,
} from "../../lib/jp/whatsapp-bot";

/**
 * The 24-hour WhatsApp bot. OpenWA posts each incoming message to /api/whatsapp/webhook,
 * signed with HMAC-SHA256 (X-OpenWA-Signature). Staff, matched by the mobile saved in the app,
 * get answers from their own data and permissions; it never saves, approves or pays anything.
 * On only when WHATSAPP_BOT=on and OPENWA_WEBHOOK_SECRET (16+ characters) is set.
 */

const HOURLY_LIMIT = 30;

export function botEnabled(env = process.env) {
  return env.WHATSAPP_BOT === "on" && (env.OPENWA_WEBHOOK_SECRET?.length ?? 0) >= 16;
}

export function validSignature(rawBody: Buffer, header: unknown, secret: string) {
  if (typeof header !== "string") return false;
  const expected = `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`;
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function sendText(phone: string, text: string) {
  const config = whatsappConfig();
  if (!config) return false;
  const request = whatsappRequest(config, phone, text);
  const response = await fetch(request.url, {
    method: request.method,
    headers: request.headers,
    body: request.body,
    signal: AbortSignal.timeout(15_000),
  }).catch(() => null);
  await response?.body?.cancel().catch(() => undefined);
  return Boolean(response?.ok);
}

/** Handles one incoming message end to end. Exported for tests; never throws. */
export async function handleInbound(message: InboundMessage): Promise<string | null> {
  const db = await getDb();
  if (!db) return null;
  try {
    // A message id is processed once, even if the webhook is delivered again.
    try {
      await db.insert(whatsappBotMessages).values({
        id: randomUUID(),
        waMessageId: message.messageId,
        phone: message.phone,
        direction: "in",
        body: message.text || `[${message.type}]`,
      });
    } catch {
      return null;
    }
    const log = async (text: string, userId: number | null) => {
      await db
        .insert(whatsappBotMessages)
        .values({ id: randomUUID(), phone: message.phone, userId, direction: "out", body: text })
        .catch(() => undefined);
    };
    const reply = async (text: string, userId: number | null) => {
      await sendText(message.phone, text);
      await log(text, userId);
      return text;
    };

    const matches = await db
      .select({ user: users })
      .from(userContactPreferences)
      .innerJoin(users, eq(userContactPreferences.userId, users.id))
      .where(
        and(eq(userContactPreferences.phone, message.phone), eq(users.accountStatus, "Active")),
      )
      .limit(3);
    if (matches.length > 1) return reply(BOT_TEXT.twoAccounts, null);
    const user = matches[0]?.user;
    if (!user) {
      const [lastNote] = await db
        .select({ at: whatsappBotMessages.createdAt })
        .from(whatsappBotMessages)
        .where(
          and(
            eq(whatsappBotMessages.phone, message.phone),
            eq(whatsappBotMessages.direction, "out"),
            eq(whatsappBotMessages.body, BOT_TEXT.notStaff),
          ),
        )
        .orderBy(desc(whatsappBotMessages.createdAt))
        .limit(1);
      return shouldSendStrangerNote(lastNote?.at ?? null) ? reply(BOT_TEXT.notStaff, null) : null;
    }
    await db
      .update(whatsappBotMessages)
      .set({ userId: user.id })
      .where(eq(whatsappBotMessages.waMessageId, message.messageId));
    if (message.type !== "text" || !message.text) return reply(BOT_TEXT.textOnly, user.id);

    const since = new Date(Date.now() - 3_600_000);
    const recent = await db
      .select({ direction: whatsappBotMessages.direction, body: whatsappBotMessages.body })
      .from(whatsappBotMessages)
      .where(
        and(
          eq(whatsappBotMessages.phone, message.phone),
          gte(whatsappBotMessages.createdAt, since),
        ),
      )
      .orderBy(desc(whatsappBotMessages.createdAt))
      .limit(HOURLY_LIMIT * 2 + 2);
    if (recent.filter((row) => row.direction === "in").length > HOURLY_LIMIT)
      return reply(BOT_TEXT.busy, user.id);
    if (!geminiKey() && !sarvamKey()) return reply(BOT_TEXT.error, user.id);

    const history = recent
      .slice(1, 9)
      .reverse()
      .map((row) => ({
        role: row.direction === "in" ? ("user" as const) : ("assistant" as const),
        text: row.body.slice(0, 2000),
      }));
    try {
      const answer = await answerQuestion(user, {
        text: message.text,
        history,
        files: [],
        channel: "whatsapp",
      });
      return reply(formatReply(answer.reply), user.id);
    } catch {
      return reply(BOT_TEXT.error, user.id);
    }
  } catch {
    console.error("[JP] WhatsApp bot failed on a message");
    return null;
  }
}

/** Mounts the webhook. Must be registered before the JSON body parser (needs the raw body). */
export function registerWhatsAppBot(app: Express) {
  app.post(
    "/api/whatsapp/webhook",
    express.raw({ type: "*/*", limit: "2mb" }),
    (req: Request, res: Response) => {
      const secret = process.env.OPENWA_WEBHOOK_SECRET ?? "";
      if (!botEnabled()) {
        res.status(404).end();
        return;
      }
      const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      if (!validSignature(raw, req.get("X-OpenWA-Signature"), secret)) {
        res.status(401).end();
        return;
      }
      let payload: unknown = null;
      try {
        payload = JSON.parse(raw.toString("utf8"));
      } catch {
        res.status(400).end();
        return;
      }
      // Answer OpenWA at once; the reply goes out as its own WhatsApp message.
      res.status(200).json({ ok: true });
      const message = parseInbound(payload);
      if (message) void handleInbound(message);
    },
  );
}
