import { describe, expect, it } from "vitest";
import {
  formatInviteCode,
  inviteCodeFromBytes,
  isWellFormedInviteCode,
  normalizeInviteCode,
} from "./invite-code";

describe("invite codes", () => {
  it("normalises and validates typed codes", () => {
    expect(normalizeInviteCode(" abcde-fghjk ")).toBe("ABCDEFGHJK");
    expect(isWellFormedInviteCode("abcde fghjk")).toBe(true);
    expect(isWellFormedInviteCode("ABCDE-FGHJ0")).toBe(false); // 0 is not in the alphabet
    expect(isWellFormedInviteCode("ABCDE")).toBe(false);
    expect(formatInviteCode("abcdefghjk")).toBe("ABCDE-FGHJK");
  });
  it("builds 10 alphabet characters from random bytes, skipping biased values", () => {
    const bytes = new Uint8Array([255, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    const code = inviteCodeFromBytes(bytes);
    expect(code).toHaveLength(10);
    expect(isWellFormedInviteCode(code)).toBe(true);
    expect(code.startsWith("A")).toBe(true); // 255 was skipped
  });
});
