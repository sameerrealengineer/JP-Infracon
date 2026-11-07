/** Offline demo: no browser push from the phone (swapped in for server/web-push-send.ts). */
export type WebPushTarget = { endpoint: string; p256dh: string; auth: string };

export function webPushPublicKey(): string | null {
  return null;
}

export async function sendWebPush(): Promise<{ ok: boolean; gone: boolean; detail: string }> {
  return { ok: false, gone: false, detail: "web push not available in the demo" };
}
