import { extractDocumentText } from "./document-text";
import { sniffDocumentType, type DocumentContentType } from "./document-policy";

/**
 * Files a person attaches to an assistant question: photos, PDFs (drawings, contracts),
 * Word, Excel and CSV. The type comes from the bytes, never the name. Office files become
 * text here; photos and PDFs go to the AI as they are. Nothing is stored.
 */

export const MAX_ASSISTANT_FILES = 3;
export const MAX_ASSISTANT_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_ASSISTANT_TOTAL_BYTES = 15 * 1024 * 1024;
const MAX_TEXT_PER_FILE = 30_000;

/** What the phone's file picker should offer. */
export const ASSISTANT_PICKER_TYPES = [
  "image/*",
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/csv",
  "text/comma-separated-values",
];

export type AssistantFilePart =
  | { kind: "text"; name: string; contentType: DocumentContentType; text: string }
  | { kind: "inline"; name: string; contentType: DocumentContentType; base64: string };

export type AssistantFileError = {
  code: "TOO_MANY" | "TOO_LARGE" | "UNSUPPORTED" | "EMPTY";
  message: string;
};

export function cleanFileName(name: string) {
  const cleaned = name
    .replace(/[\u0000-\u001f<>"\\]/g, "")
    .trim()
    .slice(0, 120);
  return cleaned || "file";
}

/** Base64 length to byte count without decoding. */
export function base64Bytes(base64: string) {
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
}

export function checkAssistantFileSizes(
  files: readonly { name: string; base64: string }[],
): AssistantFileError | null {
  if (files.length > MAX_ASSISTANT_FILES)
    return { code: "TOO_MANY", message: `Attach at most ${MAX_ASSISTANT_FILES} files at a time.` };
  let total = 0;
  for (const file of files) {
    const size = base64Bytes(file.base64);
    if (size > MAX_ASSISTANT_FILE_BYTES)
      return { code: "TOO_LARGE", message: `${cleanFileName(file.name)} is larger than 10 MB.` };
    total += size;
  }
  if (total > MAX_ASSISTANT_TOTAL_BYTES)
    return { code: "TOO_LARGE", message: "Attached files are larger than 15 MB together." };
  return null;
}

/** Reads one attached file into a prompt part, or explains why it cannot be used. */
export function prepareAssistantFile(
  name: string,
  bytes: Uint8Array,
): AssistantFilePart | AssistantFileError {
  const safeName = cleanFileName(name);
  if (bytes.length === 0) return { code: "EMPTY", message: `${safeName} is empty.` };
  const contentType = sniffDocumentType(bytes, safeName);
  if (!contentType)
    return {
      code: "UNSUPPORTED",
      message: /\.(dwg|dxf)$/i.test(safeName)
        ? `${safeName}: CAD files cannot be read. Export the drawing as PDF or a photo and attach that.`
        : `${safeName}: only photos, PDF, Word, Excel and CSV files can be read.`,
    };
  if (contentType === "application/pdf" || contentType.startsWith("image/"))
    return {
      kind: "inline",
      name: safeName,
      contentType,
      base64: bytesToBase64(bytes),
    };
  const text = extractDocumentText(bytes, contentType).trim();
  if (!text) return { code: "EMPTY", message: `${safeName} has no readable text.` };
  return { kind: "text", name: safeName, contentType, text: text.slice(0, MAX_TEXT_PER_FILE) };
}

export function isFileError(
  value: AssistantFilePart | AssistantFileError,
): value is AssistantFileError {
  return "code" in value;
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return btoa(binary);
}
