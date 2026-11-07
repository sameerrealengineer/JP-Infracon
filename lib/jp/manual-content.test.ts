import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  INPUT_STANDARDS,
  MANUAL_FORMS,
  MANUAL_MODULES,
  manualFormById,
  manualFormsOf,
  searchManual,
} from "./manual-content";

const root = path.resolve(__dirname, "../..");
function routeExists(route: string) {
  const clean = route.split("?")[0].replace(/^\//, "");
  if (!clean) return true;
  return [`app/${clean}.tsx`, `app/(tabs)/${clean}.tsx`, `app/${clean}/index.tsx`].some((file) =>
    existsSync(path.join(root, file)),
  );
}

describe("manual content", () => {
  it("has unique ids and every form belongs to a known module", () => {
    const ids = MANUAL_FORMS.map((form) => form.id);
    expect(new Set(ids).size).toBe(ids.length);
    const modules = new Set(MANUAL_MODULES.map((m) => m.key));
    for (const form of MANUAL_FORMS) expect(modules.has(form.module)).toBe(true);
  });

  it("every module has at least one form, in order", () => {
    for (const mod of MANUAL_MODULES) expect(manualFormsOf(mod.key).length).toBeGreaterThan(0);
  });

  it("every form opens a real screen and is complete", () => {
    for (const form of MANUAL_FORMS) {
      expect(routeExists(form.route), `${form.id} → ${form.route}`).toBe(true);
      expect(form.fields.length).toBeGreaterThan(0);
      expect(form.scenario.steps.length).toBeGreaterThan(0);
      expect(form.dos.length + form.donts.length).toBeGreaterThan(0);
    }
  });

  it("finds forms by id and by words", () => {
    expect(manualFormById("po")?.title).toBe("Purchase order");
    expect(manualFormById("nope")).toBeNull();
    expect(searchManual("purchase order").map((f) => f.id)).toContain("po");
    expect(searchManual("").length).toBe(MANUAL_FORMS.length);
  });

  it("input standards give a good and a bad example", () => {
    for (const rule of INPUT_STANDARDS) {
      expect(rule.good).not.toBe("");
      expect(rule.bad).not.toBe("");
    }
  });
});
