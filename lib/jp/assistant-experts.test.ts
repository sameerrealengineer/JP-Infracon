import { describe, expect, it } from "vitest";
import { EXPERTS, EXPERT_KEYS, expertFor } from "./assistant-experts";

describe("assistant experts", () => {
  it("has one entry per key, with a title, examples and limits", () => {
    expect(EXPERTS.map((expert) => expert.key)).toEqual([...EXPERT_KEYS]);
    for (const expert of EXPERTS) {
      expect(expert.title).toBeTruthy();
      expect(expert.examples.length).toBeGreaterThan(0);
      expect(expert.sentences).toBeGreaterThanOrEqual(3);
    }
  });

  it("falls back to the general helper", () => {
    expect(expertFor("nope").key).toBe("general");
    expect(expertFor(undefined).key).toBe("general");
    expect(expertFor("contract").title).toBe("Contract expert");
  });

  it("asks the drawing reader never to guess a dimension", () => {
    expect(expertFor("drawing").guidance).toMatch(/never guess/);
  });
});
