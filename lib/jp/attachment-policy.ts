/** Evidence file rules shared by the app (pre-check) and the API (authoritative check). */

export const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024;
/** Short site videos (about a minute from a phone). The API body limit is 50 MB of base64. */
export const MAX_VIDEO_BYTES = 30 * 1024 * 1024;

export const allowedAttachmentTypes = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "application/pdf": "pdf",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/3gpp": "3gp",
} as const;
export type AttachmentContentType = keyof typeof allowedAttachmentTypes;

export const attachmentEntityTypes = [
  "site_issue",
  "daily_report",
  "supplier_invoice",
  "supplier_payment",
  "petty_cash_movement",
  "project",
  "site",
  "work_task",
  "material_request",
] as const;
export type AttachmentEntityType = (typeof attachmentEntityTypes)[number];

export function isVideoType(contentType: string) {
  return contentType.startsWith("video/");
}

/** Size limit for a file of this type: videos may be larger than photos and PDFs. */
export function maxBytesFor(contentType: string) {
  return isVideoType(contentType) ? MAX_VIDEO_BYTES : MAX_ATTACHMENT_BYTES;
}

/**
 * Detects the real file type from its first bytes, so a renamed file cannot pass as a photo or PDF.
 * Returns null when the bytes match none of the allowed types.
 */
export function sniffContentType(bytes: Uint8Array): AttachmentContentType | null {
  const starts = (...sig: number[]) => sig.every((value, index) => bytes[index] === value);
  if (bytes.length >= 3 && starts(0xff, 0xd8, 0xff)) return "image/jpeg";
  if (bytes.length >= 8 && starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))
    return "image/png";
  if (
    bytes.length >= 12 &&
    starts(0x52, 0x49, 0x46, 0x46) &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  )
    return "image/webp";
  if (bytes.length >= 5 && starts(0x25, 0x50, 0x44, 0x46, 0x2d)) return "application/pdf";
  // ISO media: "ftyp" at byte 4, then the brand (mp41, isom, qt  , 3gp4, ...).
  if (
    bytes.length >= 12 &&
    bytes[4] === 0x66 &&
    bytes[5] === 0x74 &&
    bytes[6] === 0x79 &&
    bytes[7] === 0x70
  ) {
    const brand = String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]);
    if (brand.startsWith("qt")) return "video/quicktime";
    if (brand.startsWith("3g")) return "video/3gpp";
    if (/^(isom|iso\d|mp4\d|avc1|M4V |mmp4|dash|msnv)/.test(brand)) return "video/mp4";
  }
  return null;
}

/** Strips paths and unsafe characters from a user-supplied file name. */
export function safeFileName(name: string, contentType: AttachmentContentType): string {
  const base = name.split(/[\\/]/).pop() ?? "file";
  const cleaned = base
    .replace(/[^\w.\- ]+/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
  const ext = allowedAttachmentTypes[contentType];
  const withoutExt = cleaned.replace(/\.[^.]*$/, "") || "evidence";
  return `${withoutExt}.${ext}`;
}

export function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(0)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}
