// Private evidence storage for self-hosting, in order of preference:
//  1. STORAGE_DIR — files on the server's own disk (a Docker volume). Simplest, fully open source.
//  2. S3_BUCKET — any S3-compatible bucket (Cloudflare R2, AWS S3, Backblaze B2, Garage...).
// When neither is set, storage.ts falls back to the original Forge storage.
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { SignJWT, jwtVerify } from "jose";
import type { Express } from "express";
import { Readable } from "node:stream";
import { createReadStream } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { ENV } from "./_core/env";

function localDir(): string | null {
  return process.env.STORAGE_DIR?.trim() || null;
}

function bucketConfigured(): boolean {
  return Boolean(process.env.S3_BUCKET && process.env.S3_ACCESS_KEY && process.env.S3_SECRET_KEY);
}

/** True when self-hosted storage (disk or S3) should be used instead of Forge. */
export function s3Configured(): boolean {
  return Boolean(localDir()) || bucketConfigured();
}

/** Resolves a storage key inside STORAGE_DIR, refusing anything that escapes it. */
function localPath(key: string): string {
  const root = path.resolve(localDir()!);
  const full = path.resolve(root, key);
  if (!full.startsWith(root + path.sep)) throw new Error("bad key");
  return full;
}

let client: S3Client | null = null;
function s3() {
  if (!client)
    client = new S3Client({
      region: process.env.S3_REGION || "auto",
      endpoint: process.env.S3_ENDPOINT || undefined,
      forcePathStyle: process.env.S3_FORCE_PATH_STYLE !== "false",
      credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY ?? "",
        secretAccessKey: process.env.S3_SECRET_KEY ?? "",
      },
    });
  return client;
}

export async function s3Put(key: string, data: Uint8Array, contentType: string) {
  if (localDir()) {
    const file = localPath(key);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, data, { flag: "wx" });
    await writeFile(`${file}.type`, contentType, { flag: "wx" });
    return { key, url: `/api/files/${encodeURIComponent(key)}` };
  }
  await s3().send(
    new PutObjectCommand({
      Bucket: process.env.S3_BUCKET,
      Key: key,
      Body: data,
      ContentType: contentType,
    }),
  );
  return { key, url: `/api/files/${encodeURIComponent(key)}` };
}

function fileSecret() {
  return new TextEncoder().encode(`${ENV.cookieSecret}:files`);
}

/**
 * A 5-minute link to one stored file, served by this API. Issued only after the caller's
 * permission was checked, so the bucket itself never needs to be public.
 */
export async function s3SignedUrl(key: string): Promise<string> {
  if (!ENV.cookieSecret) throw new Error("JWT_SECRET is not set");
  const token = await new SignJWT({ k: key })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("5m")
    .sign(fileSecret());
  const base = (process.env.PUBLIC_BASE_URL ?? "").replace(/\/+$/, "");
  return `${base}/api/files/${token}`;
}

export function registerFileRoute(app: Express) {
  app.get("/api/files/:token", async (req, res) => {
    try {
      const { payload } = await jwtVerify(req.params.token, fileSecret(), {
        algorithms: ["HS256"],
      });
      const key = typeof payload.k === "string" ? payload.k : "";
      if (!key) throw new Error("bad token");
      res.setHeader("Cache-Control", "private, no-store");
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Content-Disposition", "inline");
      if (localDir()) {
        const file = localPath(key);
        const type = await readFile(`${file}.type`, "utf8").catch(() => "application/octet-stream");
        res.setHeader("Content-Type", type);
        createReadStream(file)
          .on("error", () => res.status(404).end())
          .pipe(res);
        return;
      }
      const object = await s3().send(
        new GetObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key }),
      );
      res.setHeader("Content-Type", object.ContentType ?? "application/octet-stream");
      (object.Body as Readable).pipe(res);
    } catch {
      res.status(404).send("Link expired or file not found");
    }
  });
}
