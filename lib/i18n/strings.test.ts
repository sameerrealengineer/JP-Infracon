import { describe, expect, it } from "vitest";
import { hi, or, translate } from "./strings";

describe("translate", () => {
  it("translates known strings and fills variables", () => {
    expect(translate("hi", "Home")).toBe("होम");
    expect(translate("or", "Hello, {name}", { name: "Sipun" })).toBe("ନମସ୍କାର, Sipun");
    expect(translate("en", "Hello, {name}", { name: "Sipun" })).toBe("Hello, Sipun");
  });
  it("falls back to English for untranslated text", () => {
    expect(translate("hi", "Some new label")).toBe("Some new label");
  });
  it("keeps Hindi and Odia key sets in step", () => {
    expect(Object.keys(or).sort()).toEqual(Object.keys(hi).sort());
  });
  it("keeps placeholders in every translation", () => {
    for (const dictionary of [hi, or])
      for (const [key, value] of Object.entries(dictionary))
        for (const placeholder of key.match(/\{\w+\}/g) ?? [])
          expect(value, `${key} → ${value}`).toContain(placeholder);
  });
});
