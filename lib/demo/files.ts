/** Demo file store used off the phone (tests): files live in memory and open as data links. */
const memory = new Map<string, { bytes: Uint8Array; contentType: string }>();

export async function saveDemoFile(
  key: string,
  bytes: Uint8Array,
  contentType: string,
): Promise<string> {
  memory.set(key, { bytes, contentType });
  return key;
}

export async function demoFileUrl(key: string): Promise<string> {
  const file = memory.get(key);
  if (!file) throw new Error("File not found.");
  let binary = "";
  for (const byte of file.bytes) binary += String.fromCharCode(byte);
  return `data:${file.contentType};base64,${btoa(binary)}`;
}
