/** Sign-up invite codes: 10 characters from an alphabet without look-alikes (no 0/O, 1/I/L). */
export const INVITE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

/** Upper-cases and strips spaces/dashes so "abcde-fghjk" and "ABCDE FGHJK" match. */
export function normalizeInviteCode(value: string): string {
  return value.toUpperCase().replace(/[\s-]+/g, "");
}

export function isWellFormedInviteCode(value: string): boolean {
  const code = normalizeInviteCode(value);
  return code.length === 10 && [...code].every((char) => INVITE_ALPHABET.includes(char));
}

export function formatInviteCode(value: string): string {
  const code = normalizeInviteCode(value);
  return `${code.slice(0, 5)}-${code.slice(5)}`;
}

/** Builds a code from random bytes (supplied by the caller's secure random source). */
export function inviteCodeFromBytes(bytes: Uint8Array): string {
  // Rejection sampling keeps every character equally likely.
  const limit = 256 - (256 % INVITE_ALPHABET.length);
  let code = "";
  for (const byte of bytes) {
    if (byte >= limit) continue;
    code += INVITE_ALPHABET[byte % INVITE_ALPHABET.length];
    if (code.length === 10) break;
  }
  return code;
}
