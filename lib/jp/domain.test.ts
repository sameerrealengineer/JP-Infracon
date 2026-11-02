import { describe, expect, it } from "vitest";
import {
  getPendingReportCount,
  getPendingRequestCount,
  getSiteStatusTone,
  getSyncTone,
  getUnreadCount,
  getWorkflowTone,
  initialWorkspace,
} from "./domain";

describe("JP Infracon workspace selectors", () => {
  it("counts only reports that need field action", () => {
    expect(getPendingReportCount(initialWorkspace)).toBe(2);
  });

  it("counts only requests waiting for a decision or correction", () => {
    expect(getPendingRequestCount(initialWorkspace)).toBe(2);
  });

  it("keeps notification unread count separate from workflow counts", () => {
    expect(getUnreadCount(initialWorkspace)).toBe(2);
  });

  it("maps operational states to explicit visual tones", () => {
    expect(getSiteStatusTone("On track")).toBe("success");
    expect(getSiteStatusTone("Attention")).toBe("warning");
    expect(getWorkflowTone("Returned")).toBe("error");
    expect(getWorkflowTone("Pending approval")).toBe("warning");
    expect(getSyncTone("Local Draft")).toBe("info");
    expect(getSyncTone("Sync Failed")).toBe("error");
  });
});
