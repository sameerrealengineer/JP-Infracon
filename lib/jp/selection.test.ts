import { describe, expect, it } from "vitest";
import { clampPageIndex, resolveChoice, resolveSelectedId } from "./selection";

describe("resolveSelectedId", () => {
  const options = [{ id: "a" }, { id: "b" }];

  it("keeps a choice that is still offered", () => {
    expect(resolveSelectedId(options, "b")).toBe("b");
  });

  it("falls back to the first option when the choice is empty or no longer offered", () => {
    expect(resolveSelectedId(options, "")).toBe("a");
    expect(resolveSelectedId(options, null)).toBe("a");
    expect(resolveSelectedId(options, "gone")).toBe("a");
  });

  it("returns an empty id when nothing is offered, so stale access is dropped", () => {
    expect(resolveSelectedId([], "a")).toBe("");
  });
});

describe("resolveChoice", () => {
  it("keeps an offered choice and otherwise picks the first option", () => {
    expect(resolveChoice(["Invoices", "Payments"], "Payments")).toBe("Payments");
    expect(resolveChoice(["Invoices", "Payments"], "Petty Cash")).toBe("Invoices");
  });

  it("keeps the choice when no options are offered yet", () => {
    expect(resolveChoice([], "Invoices")).toBe("Invoices");
  });
});

describe("clampPageIndex", () => {
  it("keeps a page that still has rows", () => {
    expect(clampPageIndex(1, 45, 20)).toBe(1);
    expect(clampPageIndex(2, 45, 20)).toBe(2);
  });

  it("moves back to the last page when rows shrink", () => {
    expect(clampPageIndex(3, 45, 20)).toBe(2);
    expect(clampPageIndex(1, 20, 20)).toBe(0);
  });

  it("returns page 0 for an empty list and never goes negative", () => {
    expect(clampPageIndex(4, 0, 20)).toBe(0);
    expect(clampPageIndex(-1, 100, 20)).toBe(0);
  });
});
