/** Offline demo stand in for `server/storage.ts`: evidence stays on the phone. */
import { demoFileUrl, saveDemoFile } from "../files";

function normalizeKey(relKey: string): string {
  return relKey.replace(/^\/+/, "");
}

export async function storagePut(
  relKey: string,
  data: Uint8Array | string,
  contentType = "application/octet-stream",
): Promise<{ key: string; url: string }> {
  const key = normalizeKey(relKey);
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : new Uint8Array(data);
  await saveDemoFile(key, bytes, contentType);
  return { key, url: await demoFileUrl(key) };
}

export async function storageGet(relKey: string): Promise<{ key: string; url: string }> {
  const key = normalizeKey(relKey);
  return { key, url: await demoFileUrl(key) };
}

export async function storageGetSignedUrl(relKey: string): Promise<string> {
  return demoFileUrl(normalizeKey(relKey));
}
