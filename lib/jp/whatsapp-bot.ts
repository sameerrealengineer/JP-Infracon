import { normalizeIndianMobile } from "./notify-policy";

/**
 * Rules for the WhatsApp bot: which incoming webhook events it answers, who sent them, and the
 * fixed replies. The bot answers staff whose mobile is saved in the app, with that person's own
 * permissions; anyone else gets one polite note a day and nothing from company data.
 */

export type InboundMessage = {
  messageId: string;
  phone: string;
  text: string;
  type: string;
};

/** Reads an OpenWA `message.received` delivery; null for anything the bot should ignore. */
export function parseInbound(payload: unknown): InboundMessage | null {
  if (!payload || typeof payload !== "object") return null;
  const event = payload as { event?: unknown; data?: Record<string, unknown> };
  if (event.event !== "message.received" || !event.data) return null;
  const data = event.data;
  if (data.fromMe === true) return null;
  if (data.isGroup === true) return null;
  if (typeof data.kind === "string" && data.kind !== "individual") return null;
  const messageId = typeof data.id === "string" ? data.id : null;
  if (!messageId) return null;
  // A privacy id (…@lid) has no phone; OpenWA adds senderPhone when RESOLVE_LID_TO_PHONE=true.
  const from = typeof data.from === "string" ? data.from : "";
  const raw =
    typeof data.senderPhone === "string" && data.senderPhone
      ? data.senderPhone
      : from.endsWith("@c.us")
        ? from.slice(0, -"@c.us".length)
        : "";
  const phone = normalizeIndianMobile(raw ? `+${raw.replace(/^\+/, "")}` : null);
  if (!phone) return null;
  const type = typeof data.type === "string" ? data.type : "unknown";
  const text = typeof data.body === "string" ? data.body.trim().slice(0, 2000) : "";
  return { messageId, phone, text, type };
}

export const BOT_TEXT = {
  notStaff:
    "Namaste! This WhatsApp number sends JP Infracon site alerts and answers JP Infracon staff. " +
    "For anything else please call the office. If you work with us, ask your admin to save " +
    "this mobile number in your JP Infracon profile.",
  textOnly:
    "Please send your question as a text message. Voice notes, photos and files work in the " +
    "JP Infracon app (Ask JP).",
  busy: "You have asked a lot this hour. Please try again later or use the JP Infracon app.",
  error: "Sorry, I could not answer just now. Please try again in a few minutes.",
  twoAccounts:
    "This mobile number is saved on more than one JP Infracon account, so I cannot tell who you " +
    "are. Ask your admin to keep it on one account only.",
} as const;

/** Keeps a WhatsApp reply short and plain. */
export function formatReply(reply: string) {
  return reply
    .replace(/\*\*(.+?)\*\*/g, "*$1*")
    .replace(/^#+\s*/gm, "")
    .trim()
    .slice(0, 1500);
}

/** One "not staff" note per number per day, so the bot never spams strangers. */
export function shouldSendStrangerNote(lastNoteAt: Date | null, now = new Date()) {
  return !lastNoteAt || now.getTime() - lastNoteAt.getTime() > 24 * 3_600_000;
}
