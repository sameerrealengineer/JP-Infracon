/**
 * Offline demo stand in for `node:crypto` (swapped in by `metro.config.js`). Covers only what
 * `server/` uses. Password hashing here is a light SHA-256 stretch, not scrypt: demo data never
 * leaves the phone, and real scrypt is too slow on a phone CPU.
 */
import { sha256 } from "@noble/hashes/sha2";
import { Buffer } from "buffer";

function fillRandom(bytes: Uint8Array): Uint8Array {
  const webCrypto = (globalThis as { crypto?: { getRandomValues?: (a: Uint8Array) => Uint8Array } })
    .crypto;
  if (webCrypto?.getRandomValues) return webCrypto.getRandomValues(bytes);
  for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  return bytes;
}

export function randomBytes(size: number): Buffer {
  return Buffer.from(fillRandom(new Uint8Array(size)));
}

export function randomUUID(): string {
  const b = fillRandom(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const hex = Buffer.from(b).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

type Data = string | Uint8Array;
const toBytes = (data: Data) =>
  typeof data === "string" ? new TextEncoder().encode(data) : new Uint8Array(data);

export function createHash(algorithm: string) {
  if (algorithm.toLowerCase() !== "sha256")
    throw new Error(`The offline demo supports sha256 only, not ${algorithm}.`);
  const parts: Uint8Array[] = [];
  const hash = {
    update(data: Data) {
      parts.push(toBytes(data));
      return hash;
    },
    digest(encoding?: "hex" | "base64") {
      const total = parts.reduce((n, p) => n + p.length, 0);
      const joined = new Uint8Array(total);
      let offset = 0;
      for (const part of parts) {
        joined.set(part, offset);
        offset += part.length;
      }
      const out = Buffer.from(sha256(joined));
      return encoding ? out.toString(encoding) : out;
    },
  };
  return hash;
}

function stretch(password: Data, salt: Data, keylen: number): Buffer {
  const saltBytes = toBytes(salt);
  const passwordBytes = toBytes(password);
  let block = sha256(new Uint8Array([...saltBytes, ...passwordBytes]));
  for (let i = 0; i < 500; i++) block = sha256(new Uint8Array([...block, ...saltBytes]));
  const out = new Uint8Array(keylen);
  for (let offset = 0, counter = 0; offset < keylen; counter++) {
    const chunk = sha256(new Uint8Array([...block, counter]));
    out.set(chunk.slice(0, keylen - offset), offset);
    offset += chunk.length;
  }
  return Buffer.from(out);
}

export function scryptSync(password: Data, salt: Data, keylen: number, _options?: unknown): Buffer {
  return stretch(password, salt, keylen);
}

export function scrypt(
  password: Data,
  salt: Data,
  keylen: number,
  options: unknown,
  callback?: (error: Error | null, key: Buffer) => void,
): void {
  const done = (typeof options === "function" ? options : callback) as (
    error: Error | null,
    key: Buffer,
  ) => void;
  setTimeout(() => done(null, stretch(password, salt, keylen)), 0);
}

export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) throw new RangeError("Input buffers must have the same byte length");
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export default { randomBytes, randomUUID, createHash, scrypt, scryptSync, timingSafeEqual };
