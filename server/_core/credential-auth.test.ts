import { describe, expect, it } from "vitest";
import {
  hashPassword,
  isValidUsername,
  normalizeBootstrapSecret,
  normalizeUsername,
  validatePassword,
  verifyPassword,
} from "./credential-auth";

describe("username/password credential domain", () => {
  it("normalizes usernames and limits their allowed shape", () => {
    expect(normalizeUsername("  Site.Supervisor  ")).toBe("site.supervisor");
    expect(isValidUsername("site.supervisor")).toBe(true);
    expect(isValidUsername("ab")).toBe(false);
    expect(isValidUsername("has spaces")).toBe(false);
    expect(isValidUsername("../admin")).toBe(false);
  });

  it("requires a non-blank 12–128 character password", () => {
    expect(validatePassword("short")).toBe(false);
    expect(validatePassword("             ")).toBe(false);
    expect(validatePassword("correct horse battery staple")).toBe(true);
    expect(validatePassword("a".repeat(129))).toBe(false);
  });

  it("ignores surrounding whitespace on bootstrap keys without accepting blank keys", () => {
    expect(normalizeBootstrapSecret("  JP-Setup-Key  \n")).toBe("JP-Setup-Key");
    expect(normalizeBootstrapSecret("  \t\n")).toBe("");
  });

  it("stores a salted scrypt verifier and accepts only the matching password", async () => {
    const password = "JP!field-account-2026";
    const encoded = await hashPassword(password);
    const secondEncoded = await hashPassword(password);
    expect(encoded).not.toContain(password);
    expect(encoded).not.toBe(secondEncoded);
    expect(await verifyPassword(password, encoded)).toBe(true);
    expect(await verifyPassword("wrong-password", encoded)).toBe(false);
  });

  it("rejects malformed or unsupported password encodings", async () => {
    expect(await verifyPassword("anything-long-enough", "plain:password")).toBe(false);
    expect(await verifyPassword("anything-long-enough", "scrypt$1$1$1$bad$bad")).toBe(false);
  });
});
