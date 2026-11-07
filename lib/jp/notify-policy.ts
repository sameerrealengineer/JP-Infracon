/**
 * Builds outbound alert requests for the supported open-source gateways, without sending them.
 * Keeping this pure lets the request shapes be tested without a network or real credentials.
 *
 * WhatsApp: OpenWA (rmyndharis/OpenWA), WAHA (devlikeapro/waha), Evolution API
 * (EvolutionAPI/evolution-api), or the official
 * WhatsApp Business Cloud API. SMS: SMS Gateway for Android (capcom6/android-sms-gateway) or
 * textbee (vernu/textbee). Push: Expo push service.
 */

export type HttpRequest = {
  url: string;
  method: "POST";
  headers: Record<string, string>;
  body: string;
};

/** "98765 43210", "+91-98765-43210", "09876543210" → "+919876543210". Null when not a valid mobile. */
export function normalizeIndianMobile(value: string | null | undefined): string | null {
  if (!value) return null;
  let digits = value.replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) digits = digits.slice(1);
  else if (digits.startsWith("0")) digits = digits.replace(/^0+/, "");
  if (digits.length === 10) digits = `91${digits}`;
  if (!/^\d{11,15}$/.test(digits)) return null;
  if (digits.startsWith("91") && !/^91[6-9]\d{9}$/.test(digits)) return null;
  return `+${digits}`;
}

export type WhatsAppConfig =
  | { provider: "openwa"; baseUrl: string; apiKey: string; session: string }
  | { provider: "waha"; baseUrl: string; apiKey?: string; session: string }
  | { provider: "evolution"; baseUrl: string; apiKey: string; instance: string }
  | { provider: "cloud"; token: string; phoneNumberId: string; apiVersion?: string };

export function whatsappRequest(config: WhatsAppConfig, to: string, text: string): HttpRequest {
  const digits = to.replace(/^\+/, "");
  const json = { "Content-Type": "application/json" };
  if (config.provider === "openwa")
    return {
      url: `${config.baseUrl.replace(/\/+$/, "")}/api/sessions/${encodeURIComponent(config.session)}/messages/send-text`,
      method: "POST",
      headers: { ...json, "X-API-Key": config.apiKey },
      body: JSON.stringify({ chatId: `${digits}@c.us`, text }),
    };
  if (config.provider === "waha")
    return {
      url: `${config.baseUrl.replace(/\/+$/, "")}/api/sendText`,
      method: "POST",
      headers: config.apiKey ? { ...json, "X-Api-Key": config.apiKey } : json,
      body: JSON.stringify({ session: config.session, chatId: `${digits}@c.us`, text }),
    };
  if (config.provider === "evolution")
    return {
      url: `${config.baseUrl.replace(/\/+$/, "")}/message/sendText/${encodeURIComponent(config.instance)}`,
      method: "POST",
      headers: { ...json, apikey: config.apiKey },
      body: JSON.stringify({ number: digits, text }),
    };
  return {
    url: `https://graph.facebook.com/${config.apiVersion ?? "v21.0"}/${config.phoneNumberId}/messages`,
    method: "POST",
    headers: { ...json, Authorization: `Bearer ${config.token}` },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: digits,
      type: "text",
      text: { body: text },
    }),
  };
}

export type WhatsAppMedia = {
  kind: "image" | "video" | "document";
  /** A short-lived https link the gateway downloads from. */
  url: string;
  mimetype: string;
  filename: string;
  caption?: string;
};

/** A photo, video or document with a caption, for gateways that can send media. */
export function whatsappMediaRequest(
  config: WhatsAppConfig,
  to: string,
  media: WhatsAppMedia,
): HttpRequest {
  const digits = to.replace(/^\+/, "");
  const json = { "Content-Type": "application/json" };
  const caption = media.caption?.slice(0, 1000);
  if (config.provider === "openwa")
    return {
      url: `${config.baseUrl.replace(/\/+$/, "")}/api/sessions/${encodeURIComponent(config.session)}/messages/send-${media.kind}`,
      method: "POST",
      headers: { ...json, "X-API-Key": config.apiKey },
      body: JSON.stringify({
        chatId: `${digits}@c.us`,
        url: media.url,
        mimetype: media.mimetype,
        filename: media.filename,
        caption,
      }),
    };
  if (config.provider === "waha") {
    const path =
      media.kind === "image" ? "sendImage" : media.kind === "video" ? "sendVideo" : "sendFile";
    return {
      url: `${config.baseUrl.replace(/\/+$/, "")}/api/${path}`,
      method: "POST",
      headers: config.apiKey ? { ...json, "X-Api-Key": config.apiKey } : json,
      body: JSON.stringify({
        session: config.session,
        chatId: `${digits}@c.us`,
        file: { mimetype: media.mimetype, url: media.url, filename: media.filename },
        caption,
      }),
    };
  }
  if (config.provider === "evolution")
    return {
      url: `${config.baseUrl.replace(/\/+$/, "")}/message/sendMedia/${encodeURIComponent(config.instance)}`,
      method: "POST",
      headers: { ...json, apikey: config.apiKey },
      body: JSON.stringify({
        number: digits,
        mediatype: media.kind,
        mimetype: media.mimetype,
        media: media.url,
        fileName: media.filename,
        caption,
      }),
    };
  return {
    url: `https://graph.facebook.com/${config.apiVersion ?? "v21.0"}/${config.phoneNumberId}/messages`,
    method: "POST",
    headers: { ...json, Authorization: `Bearer ${config.token}` },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: digits,
      type: media.kind,
      [media.kind]: {
        link: media.url,
        caption,
        ...(media.kind === "document" ? { filename: media.filename } : {}),
      },
    }),
  };
}

export type SmsConfig =
  | { provider: "android-sms-gateway"; baseUrl: string; username: string; password: string }
  | { provider: "textbee"; baseUrl: string; deviceId: string; apiKey: string };

export function smsRequest(config: SmsConfig, to: string, text: string): HttpRequest {
  const json = { "Content-Type": "application/json" };
  if (config.provider === "android-sms-gateway") {
    const auth = btoaSafe(`${config.username}:${config.password}`);
    return {
      url: `${config.baseUrl.replace(/\/+$/, "")}/message`,
      method: "POST",
      headers: { ...json, Authorization: `Basic ${auth}` },
      body: JSON.stringify({ textMessage: { text }, phoneNumbers: [to] }),
    };
  }
  return {
    url: `${config.baseUrl.replace(/\/+$/, "")}/gateway/devices/${encodeURIComponent(config.deviceId)}/send-sms`,
    method: "POST",
    headers: { ...json, "x-api-key": config.apiKey },
    body: JSON.stringify({ recipients: [to], message: text }),
  };
}

export function expoPushRequest(
  messages: { to: string; title: string; body: string; data?: Record<string, unknown> }[],
  accessToken?: string,
): HttpRequest {
  return {
    url: "https://exp.host/--/api/v2/push/send",
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    body: JSON.stringify(
      messages.map((message) => ({
        ...message,
        sound: "default",
        priority: "high",
        channelId: "alerts",
      })),
    ),
  };
}

export function isExpoPushToken(value: string): boolean {
  return /^Expo(nent)?PushToken\[[\w-]+\]$/.test(value);
}

/** WhatsApp/SMS text: short, no money amounts or identity numbers, with a pointer back to the app. */
export function alertText(input: {
  title: string;
  siteName?: string | null;
  detail?: string | null;
}) {
  const parts = [`JP Infracon: ${input.title}`];
  if (input.siteName) parts.push(`Site: ${input.siteName}`);
  if (input.detail) parts.push(input.detail.slice(0, 160));
  parts.push("Open the JP Infracon app for details.");
  return parts.join("\n");
}

function btoaSafe(value: string): string {
  if (typeof Buffer !== "undefined") return Buffer.from(value, "utf8").toString("base64");
  return btoa(unescape(encodeURIComponent(value)));
}
