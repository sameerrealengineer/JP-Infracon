/** Evidence file rules shared by the app (pre-check) and the API (authoritative check). */

export const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024;

export const allowedAttachmentTypes = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "application/pdf": "pdf",
} as const;
export type AttachmentContentType = keyof typeof allowedAttachmentTypes;

export const attachmentEntityTypes = [
  "site_issue",
  "daily_report",
  "supplier_invoice",
  "supplier_payment",
  "petty_cash_movement",
] as const;
export type AttachmentEntityType = (typeof attachmentEntityTypes)[number];

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
