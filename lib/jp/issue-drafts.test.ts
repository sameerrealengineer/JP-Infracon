import { describe, expect, it } from "vitest";
import { isRetryableSyncError } from "./issue-drafts";

describe("isRetryableSyncError", () => {
  it("keeps network failures and temporary server states pending", () => {
    expect(isRetryableSyncError(new TypeError("Failed to fetch"))).toBe(true);
    expect(isRetryableSyncError({ data: { code: "UNAUTHORIZED" } })).toBe(true);
    expect(isRetryableSyncError({ data: { code: "PRECONDITION_FAILED" } })).toBe(true);
  });
  it("marks validation and permission refusals as failed", () => {
    expect(isRetryableSyncError({ data: { code: "BAD_REQUEST" } })).toBe(false);
    expect(isRetryableSyncError({ data: { code: "FORBIDDEN" } })).toBe(false);
  });
});
