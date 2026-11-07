import webpush from "web-push";

/**
 * Browser push (the web app on iPhone or a computer). Keys come only from the server
 * environment: WEB_PUSH_PUBLIC_KEY, WEB_PUSH_PRIVATE_KEY and WEB_PUSH_SUBJECT (a mailto: or
 * https: contact). scripts/setup-web-push.sh creates them on the server. The offline demo swaps
 * this file for lib/demo/server/web-push-send.ts, which sends nothing.
 */
export type WebPushTarget = { endpoint: string; p256dh: string; auth: string };

export function webPushPublicKey(env = process.env): string | null {
  const key = env.WEB_PUSH_PUBLIC_KEY?.trim();
  return key && env.WEB_PUSH_PRIVATE_KEY?.trim() ? key : null;
}

export async function sendWebPush(
  target: WebPushTarget,
  message: { title: string; body: string; route: string },
  env = process.env,
): Promise<{ ok: boolean; gone: boolean; detail: string }> {
  const publicKey = webPushPublicKey(env);
  const privateKey = env.WEB_PUSH_PRIVATE_KEY?.trim();
  if (!publicKey || !privateKey) return { ok: false, gone: false, detail: "web push not set up" };
  try {
    const result = await webpush.sendNotification(
      { endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } },
      JSON.stringify(message),
      {
        vapidDetails: {
          subject: env.WEB_PUSH_SUBJECT?.trim() || "mailto:admin@example.com",
          publicKey,
          privateKey,
        },
        TTL: 24 * 60 * 60,
        urgency: "high",
        timeout: 10_000,
      },
    );
    return { ok: true, gone: false, detail: `web push ${result.statusCode}` };
  } catch (error) {
    const status = (error as { statusCode?: number })?.statusCode ?? 0;
    // 404/410: the browser dropped this subscription (app removed, permission revoked).
    return {
      ok: false,
      gone: status === 404 || status === 410,
      detail: `web push ${status || "error"}`,
    };
  }
}
