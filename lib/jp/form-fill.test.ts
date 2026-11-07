import { describe, expect, it } from "vitest";
import {
  FORM_IDS,
  FORM_SPECS,
  bestNameMatch,
  fillJsonSchema,
  fillPrompt,
  normalizeFormFill,
} from "./form-fill";

describe("form specs", () => {
  it("every form has an id matching its key, a permission and at least one needed field", () => {
    for (const id of FORM_IDS) {
      const spec = FORM_SPECS[id];
      expect(spec.id).toBe(id);
      expect(spec.permission).toMatch(/^[a-z]+(\.[a-z]+)+$/);
      const needed = [...spec.fields, ...("lines" in spec ? spec.lines.fields : [])];
      expect(needed.some((field) => "required" in field && field.required)).toBe(true);
      const keys = spec.fields.map((field) => field.key);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });

  it("schema asks for every field and a question", () => {
    const schema = fillJsonSchema(FORM_SPECS.worker);
    expect(schema.required).toEqual([
      "fullName",
      "personType",
      "phone",
      "skillCategory",
      "tradeType",
      "question",
    ]);
    expect(schema.properties.skillCategory).toEqual({ type: "string" });
  });

  it("prompt carries today's date and the needed marks", () => {
    const prompt = fillPrompt(FORM_SPECS.task, "2026-11-07");
    expect(prompt).toContain("Today is 2026-11-07");
    expect(prompt).toContain("plannedStart (Start date, needed): YYYY-MM-DD");
  });
});

describe("normalizeFormFill", () => {
  it("keeps fitting values and drops the rest", () => {
    const fill = normalizeFormFill(FORM_SPECS.worker, {
      fullName: "  Ramesh   Behera ",
      personType: "WORKER",
      phone: "+91 98765 43210",
      skillCategory: "Expert",
      tradeType: "Mason",
      question: "",
    });
    expect(fill).toEqual({
      values: {
        fullName: "Ramesh Behera",
        personType: "worker",
        phone: "9876543210",
        tradeType: "Mason",
      },
      lines: [],
      missing: [],
      question: null,
    });
  });

  it("checks money, dates, numbers and phones exactly", () => {
    const fill = normalizeFormFill(FORM_SPECS.lead, {
      title: "G+2 house",
      phone: "12345",
      value: "₹25,00,000",
      followUp: "2026-02-30",
    });
    expect(fill.values).toEqual({ title: "G+2 house", value: "2500000" });
    expect(normalizeFormFill(FORM_SPECS.advance, { amount: "0", why: "x" }).values.amount).toBe(
      undefined,
    );
    expect(normalizeFormFill(FORM_SPECS.advance, { amount: "1500.5" }).values.amount).toBe(
      "1500.5",
    );
    expect(normalizeFormFill(FORM_SPECS.task, { plannedStart: "2026-11-08" }).values).toEqual({
      plannedStart: "2026-11-08",
    });
  });

  it("lists what is still needed and passes on the follow-up question", () => {
    const fill = normalizeFormFill(FORM_SPECS.advance, {
      amount: "",
      why: "",
      question: "Kitne rupaye diye?",
    });
    expect(fill.missing).toEqual(["Amount (₹)", "Why"]);
    expect(fill.question).toBe("Kitne rupaye diye?");
  });

  it("ignores a question when nothing is missing, and bad input", () => {
    expect(
      normalizeFormFill(FORM_SPECS.client, { name: "PWD Aska", question: "Anything?" }),
    ).toEqual({ values: { name: "PWD Aska" }, lines: [], missing: [], question: null });
    expect(normalizeFormFill(FORM_SPECS.client, null).missing).toEqual(["Client name"]);
  });
});

describe("forms with items", () => {
  it("schema asks for a list of rows", () => {
    const schema = fillJsonSchema(FORM_SPECS.purchaseOrder);
    expect(schema.required).toContain("lines");
    expect(schema.properties.lines).toMatchObject({ type: "array" });
  });

  it("keeps good rows, drops rows without the item or quantity, cleans money", () => {
    const fill = normalizeFormFill(FORM_SPECS.purchaseOrder, {
      supplier: "Maa Tarini",
      lines: [
        { description: "OPC cement", quantity: "100", unitCode: "bag", rateRupees: "₹380" },
        { description: "Saria", quantity: "2", unitCode: "ton", rateRupees: "62,000" },
        { description: "", quantity: "5" },
        { description: "Sand", quantity: "lots" },
      ],
      question: "",
    });
    expect(fill.values).toEqual({ supplier: "Maa Tarini" });
    expect(fill.lines).toEqual([
      { description: "OPC cement", quantity: "100", unitCode: "bag", rateRupees: "380" },
      { description: "Saria", quantity: "2", unitCode: "ton", rateRupees: "62000" },
    ]);
    expect(fill.missing).toEqual([]);
  });

  it("asks for items when none were said", () => {
    const fill = normalizeFormFill(FORM_SPECS.purchaseOrder, {
      supplier: "Maa Tarini",
      lines: [],
      question: "Kya mangwana hai?",
    });
    expect(fill.lines).toEqual([]);
    expect(fill.missing).toEqual(["Items"]);
    expect(fill.question).toBe("Kya mangwana hai?");
  });

  it("caps the rows at the form's limit", () => {
    const many = Array.from({ length: 40 }, (_, i) => ({
      description: `Item ${i}`,
      quantity: "1",
    }));
    const fill = normalizeFormFill(FORM_SPECS.purchaseOrder, { lines: many });
    expect(fill.lines).toHaveLength(30);
  });
});

describe("bestNameMatch", () => {
  const vendors = [
    { id: "a", name: "Maa Tarini Traders" },
    { id: "b", name: "Jagannath Steel" },
  ];
  it("finds a supplier by part of the name", () => {
    expect(bestNameMatch("maa tarini", vendors)?.id).toBe("a");
    expect(bestNameMatch("Jagannath", vendors)?.id).toBe("b");
  });
  it("finds a contract item by its code", () => {
    const items = [
      { id: "1", code: "2.1", name: "Earthwork in excavation" },
      { id: "2", code: "3.4", name: "PCC 1:4:8" },
    ];
    expect(bestNameMatch("2.1", items)?.id).toBe("1");
    expect(bestNameMatch("PCC", items)?.id).toBe("2");
  });
  it("returns null when nothing is close", () => {
    expect(bestNameMatch("Odisha Cement Depot", vendors)).toBeNull();
    expect(bestNameMatch("", vendors)).toBeNull();
  });
});
