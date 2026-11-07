import { describe, expect, it } from "vitest";
import { cleanUnit, normalizeRequestFields } from "./ai-request-extraction";

describe("material request extraction", () => {
  it("takes the first material for the form and lists the rest", () => {
    expect(
      normalizeRequestFields(
        {
          items: [
            { name: "opc 53 cement", quantity: "50 bags", unit: "Bori" },
            { name: "TMT steel 12mm", quantity: "2", unit: "tonnes" },
            { name: "x" },
          ],
          purpose: "First floor slab casting",
        },
        ["OPC 53 Cement"],
      ),
    ).toEqual({
      itemName: "OPC 53 Cement",
      quantity: "50",
      unitCode: "bag",
      purpose: "First floor slab casting",
      otherItems: ["2 ton TMT steel 12mm"],
    });
  });

  it("returns empty fields for nonsense and never invents a quantity", () => {
    expect(normalizeRequestFields("hello")).toEqual({
      itemName: "",
      quantity: "",
      unitCode: "",
      purpose: "",
      otherItems: [],
    });
    expect(normalizeRequestFields({ items: [{ name: "Sand", quantity: "some" }] })).toMatchObject({
      itemName: "Sand",
      quantity: "",
    });
  });

  it("maps common unit words", () => {
    expect(cleanUnit("Kgs")).toBe("kg");
    expect(cleanUnit("cubic metre")).toBe("cum");
    expect(cleanUnit("sqft")).toBe("sqft");
  });
});
