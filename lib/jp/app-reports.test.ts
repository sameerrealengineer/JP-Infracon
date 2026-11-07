import { describe, expect, it } from "vitest";
import {
  cleanText,
  errorFingerprint,
  transportErrorMessage,
  trimStack,
  WORKER_PROBLEM_KEYS,
} from "./app-reports";

describe("transportErrorMessage", () => {
  it("explains a server that is down or restarting", () => {
    expect(transportErrorMessage({ message: "Unexpected token '<'", status: 502 })).toMatch(
      /not answering right now \(error 502\).*tell your admin/,
    );
    expect(transportErrorMessage({ message: "x", status: 503 })).toMatch(/error 503/);
  });
  it("explains no internet", () => {
    expect(transportErrorMessage({ message: "Network request failed" })).toMatch(
      /No connection to the server/,
    );
    expect(transportErrorMessage({ message: "TypeError: Failed to fetch" })).toMatch(
      /Check the internet/,
    );
  });
  it("explains a page instead of data", () => {
    expect(transportErrorMessage({ message: "JSON Parse error: Unexpected character: <" })).toMatch(
      /wrong answer/,
    );
    expect(transportErrorMessage({ message: "Unexpected token '<'", status: 200 })).toMatch(
      /wrong answer/,
    );
  });
  it("keeps the server's own messages", () => {
    expect(
      transportErrorMessage({ message: "Mobile number or PIN is wrong", status: 401 }),
    ).toBeNull();
    expect(transportErrorMessage({ message: "Approve it first.", status: 500 })).toBeNull();
  });
  it("asks to wait after too many tries", () => {
    expect(transportErrorMessage({ message: "x", status: 429 })).toMatch(/Wait a minute/);
  });
});

describe("report text", () => {
  it("cleans and cuts text", () => {
    expect(cleanText("  a \n b  ", 10)).toBe("a b");
    expect(cleanText("   ", 10)).toBeNull();
    expect(cleanText("abcdef", 3)).toBe("abc");
  });
  it("trims stacks and drops file paths", () => {
    const stack = Array.from(
      { length: 20 },
      (_, i) => `at fn${i} (file:///data/user/0/app/bundle/index.js:1:${i})`,
    ).join("\n");
    const trimmed = trimStack(stack)!;
    expect(trimmed.split("\n")).toHaveLength(12);
    expect(trimmed).not.toContain("/data/user");
    expect(trimmed).toContain("index.js:1:0");
    expect(trimStack(null)).toBeNull();
  });
  it("gives the same fingerprint to repeats with other ids and numbers", () => {
    expect(errorFingerprint("Row 12 of 3f2b1c9a-1111-2222-3333-444455556666 failed", "/pay")).toBe(
      errorFingerprint("Row 99 of 9a9a9a9a-1111-2222-3333-444455556666 failed", "/pay"),
    );
    expect(errorFingerprint("a", "/x")).not.toBe(errorFingerprint("a", "/y"));
  });
  it("lists worker problems", () => {
    expect(WORKER_PROBLEM_KEYS).toContain("money");
  });
});
