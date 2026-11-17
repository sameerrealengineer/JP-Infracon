import { formatMinorAsRupees, parseRupeesToMinor } from "./finance-domain";

/**
 * Site calculators for an Indian civil contractor: concrete, brick, plaster, paint, tiles,
 * earthwork, steel, tanks, stairs, converters, estimates, bills and water O&M. Each tool is data
 * (its inputs) plus a pure `compute`, so one screen renders them all and tests pin every formula.
 * Results are planning quantities from standard thumb rules (IS practice); the site engineer
 * checks them. Money is exact paise (BigInt); physical quantities are ordinary numbers.
 */

export type ToolCategory =
  | "Concrete & masonry"
  | "Finishing"
  | "Earthwork & roads"
  | "Steel"
  | "Water & tanks"
  | "Estimate & bills"
  | "Converters & geometry";

export const TOOL_CATEGORIES: readonly ToolCategory[] = [
  "Concrete & masonry",
  "Finishing",
  "Earthwork & roads",
  "Steel",
  "Water & tanks",
  "Estimate & bills",
  "Converters & geometry",
];

export type ToolInput =
  | { key: string; label: string; kind: "number"; unit?: string; default: string; hint?: string }
  | { key: string; label: string; kind: "money"; default: string; hint?: string }
  | { key: string; label: string; kind: "choice"; options: readonly string[]; default: string };

export type ToolOutput = { label: string; value: string; unit?: string; strong?: boolean };

export type ToolResult =
  | { ok: true; outputs: ToolOutput[]; notes: string[] }
  | { ok: false; error: string };

export type CivilTool = {
  key: string;
  title: string;
  category: ToolCategory;
  about: string;
  icon: string;
  inputs: readonly ToolInput[];
  compute: (values: Record<string, string>) => ToolResult;
};

// ---------- helpers ----------

/** Cubic feet in one cubic metre. */
export const CFT_PER_M3 = 35.3147;
/** Volume of one 50 kg cement bag (m³, bulk density 1440 kg/m³). */
export const BAG_M3 = 0.0347;
/** Dry volume of concrete materials for 1 m³ wet concrete. */
export const DRY_CONCRETE = 1.54;
/** Dry volume of mortar for 1 m³ wet mortar. */
export const DRY_MORTAR = 1.33;

class InputError extends Error {}

function num(values: Record<string, string>, key: string, label: string, min = 0): number {
  const text = (values[key] ?? "").trim().replace(/,/g, "");
  const value = Number(text);
  if (text === "" || !Number.isFinite(value)) throw new InputError(`Enter ${label}.`);
  if (value < min) throw new InputError(`${label} must be at least ${min}.`);
  return value;
}

function positive(values: Record<string, string>, key: string, label: string) {
  const value = num(values, key, label);
  if (value <= 0) throw new InputError(`${label} must be more than 0.`);
  return value;
}

function money(values: Record<string, string>, key: string, label: string): bigint {
  try {
    return BigInt(parseRupeesToMinor((values[key] ?? "").replace(/,/g, ""), true));
  } catch {
    throw new InputError(`Enter ${label} in rupees (up to 2 decimals).`);
  }
}

/** Rounds to `places` and prints without trailing zeros, Indian digit grouping. */
export function fmt(value: number, places = 2): string {
  if (!Number.isFinite(value)) return "—";
  const factor = 10 ** places;
  const rounded = Math.round(value * factor) / factor;
  return rounded.toLocaleString("en-IN", { maximumFractionDigits: places });
}

/** Percent (up to 2 decimals) of an exact paise amount, rounded half up. */
export function percentOf(amountMinor: bigint, percent: number): bigint {
  const bps = BigInt(Math.round(percent * 100));
  const raw = amountMinor * bps;
  return (raw + (raw >= 0n ? 5000n : -5000n)) / 10000n;
}

function run(
  compute: (values: Record<string, string>) => Omit<Extract<ToolResult, { ok: true }>, "ok">,
) {
  return (values: Record<string, string>): ToolResult => {
    try {
      return { ok: true, ...compute(values) };
    } catch (error) {
      if (error instanceof InputError) return { ok: false, error: error.message };
      throw error;
    }
  };
}

/** Nominal mixes (IS 456 Table 9 practice). Design mixes are preferred from M25 up. */
export const NOMINAL_MIXES: Record<string, [number, number, number]> = {
  "M7.5 (1:4:8)": [1, 4, 8],
  "M10 (1:3:6)": [1, 3, 6],
  "M15 (1:2:4)": [1, 2, 4],
  "M20 (1:1.5:3)": [1, 1.5, 3],
  "M25 (1:1:2)": [1, 1, 2],
};

/** Cement bags, sand and aggregate for a wet concrete volume. */
export function concreteMaterials(wetM3: number, mix: [number, number, number], wastePct = 0) {
  const dry = wetM3 * DRY_CONCRETE * (1 + wastePct / 100);
  const parts = mix[0] + mix[1] + mix[2];
  const cementM3 = (dry * mix[0]) / parts;
  return {
    cementBags: cementM3 / BAG_M3,
    cementKg: cementM3 * 1440,
    sandM3: (dry * mix[1]) / parts,
    aggregateM3: (dry * mix[2]) / parts,
  };
}

function concreteOutputs(wetM3: number, mixName: string, wastePct: number): ToolOutput[] {
  const m = concreteMaterials(wetM3, NOMINAL_MIXES[mixName]!, wastePct);
  return [
    { label: "Concrete (wet)", value: fmt(wetM3, 3), unit: "m³" },
    {
      label: "Cement",
      value: fmt(Math.ceil(m.cementBags * 10) / 10, 1),
      unit: "bags (50 kg)",
      strong: true,
    },
    {
      label: "Sand",
      value: `${fmt(m.sandM3, 2)} m³ = ${fmt(m.sandM3 * CFT_PER_M3, 1)}`,
      unit: "cft",
      strong: true,
    },
    {
      label: "Aggregate (20 mm)",
      value: `${fmt(m.aggregateM3, 2)} m³ = ${fmt(m.aggregateM3 * CFT_PER_M3, 1)}`,
      unit: "cft",
      strong: true,
    },
    { label: "Water (w/c 0.5)", value: fmt(m.cementKg * 0.5, 0), unit: "litres" },
  ];
}

const mixChoice: ToolInput = {
  key: "mix",
  label: "Mix",
  kind: "choice",
  options: Object.keys(NOMINAL_MIXES),
  default: "M20 (1:1.5:3)",
};
const waste: ToolInput = {
  key: "waste",
  label: "Wastage",
  kind: "number",
  unit: "%",
  default: "2",
};

/** Unit weight of a steel bar (kg per metre) = d² / 162. */
export function steelKgPerM(diaMm: number) {
  return (diaMm * diaMm) / 162;
}

// ---------- the tools ----------

export const CIVIL_TOOLS: readonly CivilTool[] = [
  {
    key: "concrete",
    title: "Concrete quantity",
    category: "Concrete & masonry",
    icon: "foundation",
    about:
      "Cement bags, sand and aggregate for slab, beam, column or PCC (nominal mix, dry volume 1.54).",
    inputs: [
      { key: "l", label: "Length", kind: "number", unit: "m", default: "5" },
      { key: "b", label: "Width", kind: "number", unit: "m", default: "4" },
      { key: "d", label: "Thickness / depth", kind: "number", unit: "m", default: "0.125" },
      { key: "n", label: "How many", kind: "number", unit: "nos", default: "1" },
      mixChoice,
      waste,
    ],
    compute: run((v) => {
      const wet =
        positive(v, "l", "Length") *
        positive(v, "b", "Width") *
        positive(v, "d", "Thickness") *
        positive(v, "n", "How many");
      return {
        outputs: concreteOutputs(wet, v.mix ?? "M20 (1:1.5:3)", num(v, "waste", "Wastage")),
        notes: ["Nominal mix. From M25 use a design mix from a lab.", "1 bag = 50 kg = 0.0347 m³."],
      };
    }),
  },
  {
    key: "footing",
    title: "Footing concrete",
    category: "Concrete & masonry",
    icon: "view-in-ar",
    about: "Isolated sloped (trapezoidal) footing: rectangular base plus frustum, with materials.",
    inputs: [
      { key: "a", label: "Base length", kind: "number", unit: "m", default: "1.8" },
      { key: "b", label: "Base width", kind: "number", unit: "m", default: "1.8" },
      { key: "h1", label: "Base (straight) depth", kind: "number", unit: "m", default: "0.3" },
      {
        key: "c",
        label: "Top length (column + offset)",
        kind: "number",
        unit: "m",
        default: "0.5",
      },
      { key: "d", label: "Top width", kind: "number", unit: "m", default: "0.5" },
      { key: "h2", label: "Sloped depth", kind: "number", unit: "m", default: "0.3" },
      { key: "n", label: "Number of footings", kind: "number", unit: "nos", default: "1" },
      mixChoice,
    ],
    compute: run((v) => {
      const a1 = positive(v, "a", "Base length") * positive(v, "b", "Base width");
      const a2 = positive(v, "c", "Top length") * positive(v, "d", "Top width");
      const h1 = positive(v, "h1", "Base depth");
      const h2 = num(v, "h2", "Sloped depth");
      const one = a1 * h1 + (h2 / 3) * (a1 + a2 + Math.sqrt(a1 * a2));
      const wet = one * positive(v, "n", "Number of footings");
      return {
        outputs: [
          { label: "One footing", value: fmt(one, 3), unit: "m³" },
          ...concreteOutputs(wet, v.mix ?? "M20 (1:1.5:3)", 0),
        ],
        notes: ["Frustum volume = h/3 × (A1 + A2 + √(A1·A2))."],
      };
    }),
  },
  {
    key: "brickwork",
    title: "Brickwork",
    category: "Concrete & masonry",
    icon: "grid-view",
    about:
      "Bricks and mortar for a wall (modular brick 190×90×90 mm, 10 mm joints), openings deducted.",
    inputs: [
      { key: "l", label: "Wall length", kind: "number", unit: "m", default: "10" },
      { key: "h", label: "Wall height", kind: "number", unit: "m", default: "3" },
      { key: "t", label: "Wall thickness", kind: "number", unit: "m", default: "0.23" },
      { key: "open", label: "Doors & windows area", kind: "number", unit: "m²", default: "0" },
      {
        key: "ratio",
        label: "Mortar",
        kind: "choice",
        options: ["1:4", "1:5", "1:6"],
        default: "1:6",
      },
      { key: "waste", label: "Brick wastage", kind: "number", unit: "%", default: "5" },
    ],
    compute: run((v) => {
      const area =
        positive(v, "l", "Wall length") * positive(v, "h", "Wall height") -
        num(v, "open", "Openings");
      if (area <= 0) throw new InputError("Openings are larger than the wall.");
      const volume = area * positive(v, "t", "Wall thickness");
      const bricks = volume / (0.2 * 0.1 * 0.1);
      const wetMortar = volume - bricks * (0.19 * 0.09 * 0.09);
      const dry = wetMortar * DRY_MORTAR * 1.15; // + frog filling and waste
      const sandParts = Number((v.ratio ?? "1:6").split(":")[1]);
      const cementM3 = dry / (1 + sandParts);
      return {
        outputs: [
          { label: "Brickwork", value: fmt(volume, 3), unit: "m³" },
          {
            label: "Bricks",
            value: fmt(Math.ceil(bricks * (1 + num(v, "waste", "Wastage") / 100)), 0),
            unit: "nos",
            strong: true,
          },
          { label: "Cement", value: fmt(cementM3 / BAG_M3, 1), unit: "bags", strong: true },
          {
            label: "Sand",
            value: `${fmt(dry - cementM3, 2)} m³ = ${fmt((dry - cementM3) * CFT_PER_M3, 1)}`,
            unit: "cft",
            strong: true,
          },
        ],
        notes: [
          "500 bricks per m³ with joints.",
          "Mortar dry factor 1.33 plus 15% for frogs and waste.",
        ],
      };
    }),
  },
  {
    key: "plaster",
    title: "Plastering",
    category: "Finishing",
    icon: "format-paint",
    about:
      "Cement and sand for wall or ceiling plaster (dry factor 1.27, 20% for joints and waste).",
    inputs: [
      { key: "area", label: "Plaster area", kind: "number", unit: "m²", default: "100" },
      {
        key: "t",
        label: "Thickness",
        kind: "choice",
        options: ["6 mm", "12 mm", "15 mm", "20 mm"],
        default: "12 mm",
      },
      {
        key: "ratio",
        label: "Mortar",
        kind: "choice",
        options: ["1:3", "1:4", "1:5", "1:6"],
        default: "1:4",
      },
    ],
    compute: run((v) => {
      const t = Number((v.t ?? "12 mm").split(" ")[0]) / 1000;
      const wet = positive(v, "area", "Plaster area") * t * 1.2;
      const dry = wet * 1.27;
      const sandParts = Number((v.ratio ?? "1:4").split(":")[1]);
      const cementM3 = dry / (1 + sandParts);
      return {
        outputs: [
          { label: "Mortar (dry)", value: fmt(dry, 3), unit: "m³" },
          { label: "Cement", value: fmt(cementM3 / BAG_M3, 1), unit: "bags", strong: true },
          {
            label: "Sand",
            value: `${fmt(dry - cementM3, 2)} m³ = ${fmt((dry - cementM3) * CFT_PER_M3, 1)}`,
            unit: "cft",
            strong: true,
          },
        ],
        notes: ["Ceiling 6 mm 1:3, inside walls 12 mm 1:4–1:6, outside 15–20 mm."],
      };
    }),
  },
  {
    key: "paint",
    title: "Paint quantity",
    category: "Finishing",
    icon: "imagesearch-roller",
    about: "Primer, putty and paint for walls (coverage per litre per coat).",
    inputs: [
      { key: "area", label: "Area to paint", kind: "number", unit: "m²", default: "200" },
      { key: "coats", label: "Paint coats", kind: "number", unit: "coats", default: "2" },
      { key: "cover", label: "Paint coverage", kind: "number", unit: "m²/L/coat", default: "10" },
      { key: "putty", label: "Putty", kind: "choice", options: ["Yes", "No"], default: "Yes" },
    ],
    compute: run((v) => {
      const area = positive(v, "area", "Area");
      const paint = (area * positive(v, "coats", "Coats")) / positive(v, "cover", "Coverage");
      const outputs: ToolOutput[] = [
        { label: "Paint", value: fmt(Math.ceil(paint), 0), unit: "litres", strong: true },
        { label: "Primer (1 coat, 10 m²/L)", value: fmt(Math.ceil(area / 10), 0), unit: "litres" },
      ];
      if (v.putty !== "No")
        outputs.push({
          label: "Wall putty (2 coats, ~1 kg per 1.2 m²)",
          value: fmt(Math.ceil(area / 1.2), 0),
          unit: "kg",
        });
      return {
        outputs,
        notes: ["Check the coverage printed on the paint can; rough walls take more."],
      };
    }),
  },
  {
    key: "tiles",
    title: "Tiles / flooring",
    category: "Finishing",
    icon: "grid-on",
    about: "Number of tiles and boxes for a floor or wall, with wastage, and bedding mortar.",
    inputs: [
      { key: "area", label: "Area", kind: "number", unit: "m²", default: "40" },
      { key: "tl", label: "Tile length", kind: "number", unit: "mm", default: "600" },
      { key: "tb", label: "Tile width", kind: "number", unit: "mm", default: "600" },
      { key: "box", label: "Tiles per box", kind: "number", unit: "nos", default: "4" },
      { key: "waste", label: "Wastage", kind: "number", unit: "%", default: "7" },
    ],
    compute: run((v) => {
      const area = positive(v, "area", "Area");
      const tileArea =
        (positive(v, "tl", "Tile length") / 1000) * (positive(v, "tb", "Tile width") / 1000);
      const tiles = Math.ceil((area / tileArea) * (1 + num(v, "waste", "Wastage") / 100));
      const bed = area * 0.02 * DRY_MORTAR; // 20 mm 1:4 bedding
      return {
        outputs: [
          { label: "Tiles", value: fmt(tiles, 0), unit: "nos", strong: true },
          {
            label: "Boxes",
            value: fmt(Math.ceil(tiles / positive(v, "box", "Tiles per box")), 0),
            unit: "boxes",
            strong: true,
          },
          { label: "Bedding cement (20 mm, 1:4)", value: fmt(bed / 5 / BAG_M3, 1), unit: "bags" },
          { label: "Bedding sand", value: fmt(((bed * 4) / 5) * CFT_PER_M3, 1), unit: "cft" },
        ],
        notes: ["Use 10% wastage for diagonal laying or many cuts."],
      };
    }),
  },
  {
    key: "excavation",
    title: "Excavation & trips",
    category: "Earthwork & roads",
    icon: "agriculture",
    about: "Earth to dig, loose volume after bulking, and tipper trips.",
    inputs: [
      { key: "l", label: "Length", kind: "number", unit: "m", default: "20" },
      { key: "b", label: "Width", kind: "number", unit: "m", default: "1" },
      { key: "d", label: "Depth", kind: "number", unit: "m", default: "1.5" },
      {
        key: "soil",
        label: "Soil",
        kind: "choice",
        options: ["Ordinary soil (25%)", "Hard soil / murrum (30%)", "Sand (12%)", "Rock (50%)"],
        default: "Ordinary soil (25%)",
      },
      { key: "truck", label: "Tipper capacity", kind: "number", unit: "m³", default: "6" },
    ],
    compute: run((v) => {
      const bank =
        positive(v, "l", "Length") * positive(v, "b", "Width") * positive(v, "d", "Depth");
      const swell = Number(/\((\d+)%\)/.exec(v.soil ?? "")?.[1] ?? "25") / 100;
      const loose = bank * (1 + swell);
      return {
        outputs: [
          {
            label: "Excavation (in place)",
            value: `${fmt(bank, 2)} m³ = ${fmt(bank * CFT_PER_M3, 0)}`,
            unit: "cft",
            strong: true,
          },
          { label: "Loose earth", value: fmt(loose, 2), unit: "m³" },
          {
            label: "Tipper trips",
            value: fmt(Math.ceil(loose / positive(v, "truck", "Tipper capacity")), 0),
            unit: "trips",
            strong: true,
          },
        ],
        notes: ["Pay is on the in-place (bank) volume; trucks carry the loose volume."],
      };
    }),
  },
  {
    key: "filling",
    title: "Earth filling",
    category: "Earthwork & roads",
    icon: "landscape",
    about: "Loose earth to buy for a compacted fill (compaction factor).",
    inputs: [
      { key: "area", label: "Area", kind: "number", unit: "m²", default: "100" },
      { key: "d", label: "Compacted depth", kind: "number", unit: "m", default: "0.6" },
      { key: "factor", label: "Compaction factor", kind: "number", unit: "×", default: "1.25" },
      { key: "truck", label: "Tipper capacity", kind: "number", unit: "m³", default: "6" },
    ],
    compute: run((v) => {
      const compacted = positive(v, "area", "Area") * positive(v, "d", "Depth");
      const loose = compacted * positive(v, "factor", "Compaction factor");
      return {
        outputs: [
          { label: "Compacted fill", value: fmt(compacted, 2), unit: "m³" },
          {
            label: "Loose earth needed",
            value: `${fmt(loose, 2)} m³ = ${fmt(loose * CFT_PER_M3, 0)}`,
            unit: "cft",
            strong: true,
          },
          {
            label: "Trips",
            value: fmt(Math.ceil(loose / positive(v, "truck", "Tipper capacity")), 0),
            unit: "trips",
            strong: true,
          },
        ],
        notes: ["Fill and compact in layers of 150–200 mm with water."],
      };
    }),
  },
  {
    key: "road",
    title: "Road layer (WBM / GSB / BT)",
    category: "Earthwork & roads",
    icon: "add-road",
    about: "Material for a road layer, and prime/tack coat bitumen.",
    inputs: [
      { key: "l", label: "Road length", kind: "number", unit: "m", default: "500" },
      { key: "w", label: "Width", kind: "number", unit: "m", default: "3.75" },
      { key: "t", label: "Compacted thickness", kind: "number", unit: "mm", default: "75" },
      { key: "factor", label: "Loose / compacted", kind: "number", unit: "×", default: "1.33" },
    ],
    compute: run((v) => {
      const area = positive(v, "l", "Length") * positive(v, "w", "Width");
      const compacted = (area * positive(v, "t", "Thickness")) / 1000;
      return {
        outputs: [
          { label: "Road area", value: fmt(area, 1), unit: "m²" },
          { label: "Compacted volume", value: fmt(compacted, 2), unit: "m³" },
          {
            label: "Loose material",
            value: fmt(compacted * positive(v, "factor", "Factor"), 2),
            unit: "m³",
            strong: true,
          },
          { label: "Prime coat (0.75 kg/m²)", value: fmt(area * 0.75, 0), unit: "kg" },
          { label: "Tack coat (0.25 kg/m²)", value: fmt(area * 0.25, 0), unit: "kg" },
        ],
        notes: ["Rates per MoRTH; check your contract's specification."],
      };
    }),
  },
  {
    key: "steel-weight",
    title: "Steel bar weight",
    category: "Steel",
    icon: "line-weight",
    about: "Weight of TMT bars from diameter, length and number (d²/162 kg per metre).",
    inputs: [
      {
        key: "dia",
        label: "Diameter",
        kind: "choice",
        options: ["6", "8", "10", "12", "16", "20", "25", "32"],
        default: "12",
      },
      { key: "len", label: "Length of one bar", kind: "number", unit: "m", default: "12" },
      { key: "n", label: "Number of bars", kind: "number", unit: "nos", default: "10" },
    ],
    compute: run((v) => {
      const dia = Number(v.dia ?? "12");
      const kg =
        steelKgPerM(dia) * positive(v, "len", "Length") * positive(v, "n", "Number of bars");
      return {
        outputs: [
          { label: "Per metre", value: fmt(steelKgPerM(dia), 3), unit: "kg/m" },
          { label: "Total", value: fmt(kg, 2), unit: "kg", strong: true },
          { label: "In tonnes", value: fmt(kg / 1000, 3), unit: "t" },
        ],
        notes: ["Standard bar length is 12 m."],
      };
    }),
  },
  {
    key: "steel-table",
    title: "Steel weight table",
    category: "Steel",
    icon: "table-chart",
    about: "Ready reference: kg per metre and per 12 m bar for every common diameter.",
    inputs: [],
    compute: run(() => ({
      outputs: [6, 8, 10, 12, 16, 20, 25, 32].map((dia) => ({
        label: `${dia} mm`,
        value: `${fmt(steelKgPerM(dia), 3)} kg/m · ${fmt(steelKgPerM(dia) * 12, 2)} kg per 12 m`,
      })),
      notes: ["Weight per metre = d² / 162 (d in mm)."],
    })),
  },
  {
    key: "steel-thumb",
    title: "Steel by thumb rule",
    category: "Steel",
    icon: "construction",
    about: "Quick steel estimate from concrete volume by member (kg per m³).",
    inputs: [
      { key: "vol", label: "Concrete volume", kind: "number", unit: "m³", default: "10" },
      {
        key: "member",
        label: "Member",
        kind: "choice",
        options: [
          "Slab (80 kg/m³)",
          "Beam (160 kg/m³)",
          "Column (200 kg/m³)",
          "Footing (60 kg/m³)",
          "Lintel (100 kg/m³)",
        ],
        default: "Slab (80 kg/m³)",
      },
    ],
    compute: run((v) => {
      const rate = Number(/\((\d+) kg/.exec(v.member ?? "")?.[1] ?? "80");
      const kg = positive(v, "vol", "Concrete volume") * rate;
      return {
        outputs: [
          {
            label: "Steel",
            value: `${fmt(kg, 0)} kg = ${fmt(kg / 1000, 2)}`,
            unit: "t",
            strong: true,
          },
        ],
        notes: ["Only for early estimates. The BBS from drawings is the real quantity."],
      };
    }),
  },
  {
    key: "shuttering",
    title: "Shuttering area",
    category: "Concrete & masonry",
    icon: "view-quilt",
    about: "Formwork area for a slab with beams (slab soffit + beam sides and bottoms).",
    inputs: [
      { key: "slab", label: "Slab area", kind: "number", unit: "m²", default: "100" },
      { key: "bl", label: "Total beam length", kind: "number", unit: "m", default: "60" },
      { key: "bd", label: "Beam depth below slab", kind: "number", unit: "m", default: "0.3" },
      { key: "bw", label: "Beam width", kind: "number", unit: "m", default: "0.23" },
      { key: "edge", label: "Slab edge thickness", kind: "number", unit: "m", default: "0.125" },
      { key: "perim", label: "Slab outer edge length", kind: "number", unit: "m", default: "40" },
    ],
    compute: run((v) => {
      const beams =
        positive(v, "bl", "Beam length") *
        (2 * num(v, "bd", "Beam depth") + num(v, "bw", "Beam width"));
      const edge = num(v, "perim", "Edge length") * num(v, "edge", "Edge thickness");
      const total = positive(v, "slab", "Slab area") + beams + edge;
      return {
        outputs: [
          { label: "Beam sides & bottoms", value: fmt(beams, 1), unit: "m²" },
          {
            label: "Total shuttering",
            value: `${fmt(total, 1)} m² = ${fmt(total * 10.7639, 0)}`,
            unit: "sqft",
            strong: true,
          },
        ],
        notes: ["Plywood sheet 8×4 ft = 2.97 m²."],
      };
    }),
  },
  {
    key: "anti-termite",
    title: "Anti-termite treatment",
    category: "Earthwork & roads",
    icon: "pest-control",
    about: "Chemical emulsion and concentrate for pre-construction treatment (IS 6313).",
    inputs: [
      { key: "area", label: "Plinth area", kind: "number", unit: "m²", default: "150" },
      {
        key: "trench",
        label: "Foundation trench length",
        kind: "number",
        unit: "m",
        default: "80",
      },
      {
        key: "conc",
        label: "Concentrate (1% emulsion)",
        kind: "choice",
        options: ["Chlorpyrifos 20 EC", "Imidacloprid 30.5 SC (0.075%)"],
        default: "Chlorpyrifos 20 EC",
      },
    ],
    compute: run((v) => {
      const emulsion =
        positive(v, "area", "Plinth area") * 5 + num(v, "trench", "Trench length") * 7.5;
      const concentrate = v.conc?.startsWith("Imida") ? emulsion * (0.075 / 30.5) : emulsion / 20;
      return {
        outputs: [
          { label: "Emulsion", value: fmt(emulsion, 0), unit: "litres", strong: true },
          { label: "Concentrate", value: fmt(concentrate, 1), unit: "litres", strong: true },
        ],
        notes: ["5 L/m² on surfaces, 7.5 L per metre in trenches (IS 6313-2)."],
      };
    }),
  },
  {
    key: "tank-capacity",
    title: "Tank capacity",
    category: "Water & tanks",
    icon: "water",
    about: "Capacity of a rectangular or circular water tank or sump in litres.",
    inputs: [
      {
        key: "shape",
        label: "Shape",
        kind: "choice",
        options: ["Rectangular", "Circular"],
        default: "Circular",
      },
      { key: "a", label: "Length or diameter", kind: "number", unit: "m", default: "6" },
      { key: "b", label: "Width (rectangular)", kind: "number", unit: "m", default: "0" },
      { key: "h", label: "Water depth", kind: "number", unit: "m", default: "3" },
    ],
    compute: run((v) => {
      const a = positive(v, "a", "Length or diameter");
      const h = positive(v, "h", "Water depth");
      const m3 =
        v.shape === "Rectangular" ? a * positive(v, "b", "Width") * h : Math.PI * (a / 2) ** 2 * h;
      return {
        outputs: [
          { label: "Volume", value: fmt(m3, 2), unit: "m³" },
          { label: "Capacity", value: fmt(m3 * 1000, 0), unit: "litres", strong: true },
          { label: "In kilolitres", value: fmt(m3, 1), unit: "KL" },
        ],
        notes: ["Keep 300 mm free board above the full water level."],
      };
    }),
  },
  {
    key: "oht-paint",
    title: "Overhead tank painting area",
    category: "Water & tanks",
    icon: "water-damage",
    about:
      "Area to paint on a circular OHT: container outside (and inside), staging columns and braces.",
    inputs: [
      { key: "d", label: "Container diameter", kind: "number", unit: "m", default: "8" },
      { key: "h", label: "Container wall height", kind: "number", unit: "m", default: "4" },
      {
        key: "inside",
        label: "Paint inside too",
        kind: "choice",
        options: ["No", "Yes"],
        default: "No",
      },
      { key: "cols", label: "Staging columns", kind: "number", unit: "nos", default: "6" },
      { key: "cd", label: "Column size (dia or side)", kind: "number", unit: "m", default: "0.45" },
      { key: "sh", label: "Staging height", kind: "number", unit: "m", default: "12" },
      { key: "braces", label: "Total brace length", kind: "number", unit: "m", default: "60" },
      { key: "coats", label: "Paint coats", kind: "number", unit: "coats", default: "2" },
    ],
    compute: run((v) => {
      const d = positive(v, "d", "Diameter");
      const h = positive(v, "h", "Wall height");
      const wall = Math.PI * d * h;
      const bottom = (Math.PI * d * d) / 4;
      const container = wall + bottom + (v.inside === "Yes" ? wall + bottom : 0);
      const cols =
        num(v, "cols", "Columns") *
        Math.PI *
        num(v, "cd", "Column size") *
        num(v, "sh", "Staging height");
      const braces = num(v, "braces", "Brace length") * 4 * 0.3; // four faces of a 300 mm brace
      const total = container + cols + braces;
      const coats = positive(v, "coats", "Coats");
      return {
        outputs: [
          { label: "Container", value: fmt(container, 1), unit: "m²" },
          { label: "Columns", value: fmt(cols, 1), unit: "m²" },
          { label: "Braces", value: fmt(braces, 1), unit: "m²" },
          {
            label: "Total area",
            value: `${fmt(total, 1)} m² = ${fmt(total * 10.7639, 0)}`,
            unit: "sqft",
            strong: true,
          },
          {
            label: "Exterior paint (8 m²/L/coat)",
            value: fmt(Math.ceil((total * coats) / 8), 0),
            unit: "litres",
            strong: true,
          },
        ],
        notes: [
          "Inside a drinking-water tank use only food-grade (potable) epoxy approved by the department.",
        ],
      };
    }),
  },
  {
    key: "chlorination",
    title: "Tank disinfection dose",
    category: "Water & tanks",
    icon: "science",
    about: "Bleaching powder to disinfect a tank or well at a chosen chlorine strength.",
    inputs: [
      { key: "litres", label: "Water volume", kind: "number", unit: "litres", default: "100000" },
      { key: "ppm", label: "Chlorine dose", kind: "number", unit: "mg/L (ppm)", default: "50" },
      {
        key: "avail",
        label: "Available chlorine in powder",
        kind: "number",
        unit: "%",
        default: "30",
      },
    ],
    compute: run((v) => {
      const grams =
        (positive(v, "litres", "Volume") * positive(v, "ppm", "Dose")) /
        1000 /
        (positive(v, "avail", "Available chlorine") / 100);
      return {
        outputs: [
          { label: "Bleaching powder", value: fmt(grams / 1000, 2), unit: "kg", strong: true },
        ],
        notes: [
          "New or cleaned tank: 50 mg/L for 24 hours, then flush. Routine supply: keep 0.2–0.5 mg/L residual.",
          "Mix the powder in a bucket first and pour the clear liquid.",
        ],
      };
    }),
  },
  {
    key: "pump",
    title: "Pump power",
    category: "Water & tanks",
    icon: "settings-input-component",
    about: "Motor size for a flow and total head (P = ρgQH / η).",
    inputs: [
      { key: "q", label: "Flow", kind: "number", unit: "litres/minute", default: "500" },
      {
        key: "head",
        label: "Total head (lift + losses)",
        kind: "number",
        unit: "m",
        default: "30",
      },
      { key: "eff", label: "Pump-set efficiency", kind: "number", unit: "%", default: "60" },
    ],
    compute: run((v) => {
      const q = positive(v, "q", "Flow") / 60_000; // m³/s
      const kw =
        (1000 * 9.81 * q * positive(v, "head", "Head")) /
        (positive(v, "eff", "Efficiency") / 100) /
        1000;
      return {
        outputs: [
          { label: "Power", value: fmt(kw, 2), unit: "kW", strong: true },
          { label: "In HP", value: fmt(kw / 0.746, 2), unit: "HP", strong: true },
        ],
        notes: ["Choose the next standard motor size above this."],
      };
    }),
  },
  {
    key: "pipe-flow",
    title: "Pipe flow",
    category: "Water & tanks",
    icon: "plumbing",
    about: "Flow through a pipe from its inner diameter and water speed (Q = A × v).",
    inputs: [
      { key: "d", label: "Inner diameter", kind: "number", unit: "mm", default: "100" },
      { key: "vel", label: "Velocity", kind: "number", unit: "m/s", default: "1" },
    ],
    compute: run((v) => {
      const area = Math.PI * (positive(v, "d", "Diameter") / 2000) ** 2;
      const q = area * positive(v, "vel", "Velocity");
      return {
        outputs: [
          { label: "Flow", value: fmt(q * 1000, 2), unit: "litres/second", strong: true },
          { label: "Per hour", value: fmt(q * 3600, 1), unit: "m³/h" },
          { label: "Per day (24 h)", value: fmt(q * 86_400, 0), unit: "m³" },
        ],
        notes: ["Keep 0.6–2.0 m/s in water mains."],
      };
    }),
  },
  {
    key: "rainwater",
    title: "Rainwater harvesting",
    category: "Water & tanks",
    icon: "umbrella",
    about: "Water you can collect from a roof in a year.",
    inputs: [
      { key: "area", label: "Roof area", kind: "number", unit: "m²", default: "200" },
      { key: "rain", label: "Yearly rainfall", kind: "number", unit: "mm", default: "1450" },
      { key: "runoff", label: "Runoff coefficient", kind: "number", unit: "", default: "0.8" },
    ],
    compute: run((v) => {
      const litres =
        positive(v, "area", "Roof area") *
        positive(v, "rain", "Rainfall") *
        positive(v, "runoff", "Runoff");
      return {
        outputs: [{ label: "Water per year", value: fmt(litres, 0), unit: "litres", strong: true }],
        notes: ["Odisha average rainfall is about 1,450 mm. Concrete roof 0.8, tiled 0.75."],
      };
    }),
  },
  {
    key: "staircase",
    title: "Staircase",
    category: "Converters & geometry",
    icon: "stairs",
    about: "Number of risers and treads, actual riser and going, comfort check (2R + T).",
    inputs: [
      { key: "h", label: "Floor-to-floor height", kind: "number", unit: "mm", default: "3000" },
      { key: "r", label: "Maximum riser", kind: "number", unit: "mm", default: "150" },
      { key: "t", label: "Tread (going)", kind: "number", unit: "mm", default: "300" },
      { key: "flights", label: "Flights", kind: "number", unit: "nos", default: "2" },
    ],
    compute: run((v) => {
      const h = positive(v, "h", "Height");
      const risers = Math.ceil(h / positive(v, "r", "Riser"));
      const riser = h / risers;
      const tread = positive(v, "t", "Tread");
      const flights = Math.max(1, Math.round(positive(v, "flights", "Flights")));
      const treads = risers - flights;
      const comfort = 2 * riser + tread;
      return {
        outputs: [
          { label: "Risers", value: fmt(risers, 0), unit: "nos", strong: true },
          { label: "Actual riser", value: fmt(riser, 1), unit: "mm" },
          { label: "Treads", value: fmt(treads, 0), unit: "nos" },
          { label: "Going per flight", value: fmt((treads / flights) * tread, 0), unit: "mm" },
          {
            label: "2R + T",
            value: `${fmt(comfort, 0)} mm ${comfort >= 550 && comfort <= 700 ? "✓" : "⚠"}`,
            strong: true,
          },
        ],
        notes: ["Comfortable when 2R + T is between 550 and 700 mm (NBC)."],
      };
    }),
  },
  {
    key: "slope",
    title: "Slope & gradient",
    category: "Converters & geometry",
    icon: "trending-up",
    about: "Slope as percent, ratio and angle from rise and run.",
    inputs: [
      { key: "rise", label: "Rise", kind: "number", unit: "m", default: "1" },
      { key: "run", label: "Run (horizontal)", kind: "number", unit: "m", default: "12" },
    ],
    compute: run((v) => {
      const rise = positive(v, "rise", "Rise");
      const runLen = positive(v, "run", "Run");
      return {
        outputs: [
          { label: "Percent", value: fmt((rise / runLen) * 100, 2), unit: "%", strong: true },
          { label: "Ratio", value: `1 : ${fmt(runLen / rise, 2)}` },
          { label: "Angle", value: fmt((Math.atan(rise / runLen) * 180) / Math.PI, 2), unit: "°" },
          { label: "Sloped length", value: fmt(Math.hypot(rise, runLen), 3), unit: "m" },
        ],
        notes: ["Ramps for wheelchairs: 1:12 or flatter."],
      };
    }),
  },
  {
    key: "area-convert",
    title: "Area converter (Odisha units)",
    category: "Converters & geometry",
    icon: "square-foot",
    about: "sqft, m², decimal (dismil), guntha, acre, hectare.",
    inputs: [
      { key: "value", label: "Value", kind: "number", unit: "", default: "1" },
      {
        key: "unit",
        label: "Unit",
        kind: "choice",
        options: ["Decimal", "Acre", "sqft", "m²", "Guntha", "Hectare"],
        default: "Decimal",
      },
    ],
    compute: run((v) => {
      const sqftPer: Record<string, number> = {
        sqft: 1,
        "m²": 10.7639,
        Decimal: 435.6,
        Guntha: 1089,
        Acre: 43_560,
        Hectare: 107_639.1,
      };
      const sqft = num(v, "value", "Value") * (sqftPer[v.unit ?? "Decimal"] ?? 1);
      return {
        outputs: Object.entries(sqftPer).map(([unit, per]) => ({
          label: unit,
          value: fmt(sqft / per, unit === "sqft" || unit === "m²" ? 2 : 4),
          strong: unit === "sqft",
        })),
        notes: ["1 acre = 100 decimal = 43,560 sqft; 1 decimal = 435.6 sqft."],
      };
    }),
  },
  {
    key: "volume-convert",
    title: "Volume converter",
    category: "Converters & geometry",
    icon: "inventory-2",
    about: "m³, cft, brass (100 cft), litres, sand/aggregate tonnes.",
    inputs: [
      { key: "value", label: "Value", kind: "number", unit: "", default: "1" },
      {
        key: "unit",
        label: "Unit",
        kind: "choice",
        options: ["Brass", "m³", "cft", "Litres"],
        default: "Brass",
      },
    ],
    compute: run((v) => {
      const m3Per: Record<string, number> = {
        "m³": 1,
        cft: 1 / CFT_PER_M3,
        Brass: 100 / CFT_PER_M3,
        Litres: 0.001,
      };
      const m3 = num(v, "value", "Value") * (m3Per[v.unit ?? "Brass"] ?? 1);
      return {
        outputs: [
          { label: "m³", value: fmt(m3, 3), strong: true },
          { label: "cft", value: fmt(m3 * CFT_PER_M3, 2) },
          { label: "Brass", value: fmt((m3 * CFT_PER_M3) / 100, 3) },
          { label: "Litres", value: fmt(m3 * 1000, 0) },
          { label: "Sand (≈1.6 t/m³)", value: fmt(m3 * 1.6, 2), unit: "t" },
          { label: "Aggregate (≈1.5 t/m³)", value: fmt(m3 * 1.5, 2), unit: "t" },
        ],
        notes: ["1 brass = 100 cft = 2.83 m³."],
      };
    }),
  },
  {
    key: "triangle",
    title: "Plot area (triangle method)",
    category: "Converters & geometry",
    icon: "change-history",
    about: "Area of an irregular plot split into triangles: enter the three sides of one triangle.",
    inputs: [
      { key: "a", label: "Side a", kind: "number", unit: "m", default: "30" },
      { key: "b", label: "Side b", kind: "number", unit: "m", default: "25" },
      { key: "c", label: "Side c", kind: "number", unit: "m", default: "20" },
    ],
    compute: run((v) => {
      const a = positive(v, "a", "Side a");
      const b = positive(v, "b", "Side b");
      const c = positive(v, "c", "Side c");
      const s = (a + b + c) / 2;
      const sq = s * (s - a) * (s - b) * (s - c);
      if (sq <= 0) throw new InputError("These three sides cannot make a triangle.");
      const area = Math.sqrt(sq);
      return {
        outputs: [
          { label: "Area", value: fmt(area, 2), unit: "m²", strong: true },
          { label: "In sqft", value: fmt(area * 10.7639, 1), unit: "sqft" },
          { label: "In decimal", value: fmt((area * 10.7639) / 435.6, 3), unit: "dec" },
        ],
        notes: ["Heron's formula. Add the triangles of the plot together."],
      };
    }),
  },
  {
    key: "productivity",
    title: "Labour days",
    category: "Estimate & bills",
    icon: "groups",
    about: "Mason and helper days for a quantity from the daily output of one gang.",
    inputs: [
      { key: "qty", label: "Quantity of work", kind: "number", unit: "", default: "50" },
      {
        key: "work",
        label: "Work",
        kind: "choice",
        options: [
          "Brickwork m³ (1.25/mason/day)",
          "Plaster m² (10/mason/day)",
          "Tiling m² (8/mason/day)",
          "PCC m³ (3/gang/day)",
          "Painting m² (25/painter/day)",
        ],
        default: "Brickwork m³ (1.25/mason/day)",
      },
      { key: "helpers", label: "Helpers per mason", kind: "number", unit: "nos", default: "1.5" },
      { key: "masons", label: "Masons on site", kind: "number", unit: "nos", default: "4" },
    ],
    compute: run((v) => {
      const output = Number(/\(([\d.]+)\//.exec(v.work ?? "")?.[1] ?? "1");
      const masonDays = positive(v, "qty", "Quantity") / output;
      const masons = positive(v, "masons", "Masons");
      return {
        outputs: [
          { label: "Mason days", value: fmt(masonDays, 1), unit: "days", strong: true },
          {
            label: "Helper days",
            value: fmt(masonDays * num(v, "helpers", "Helpers"), 1),
            unit: "days",
          },
          {
            label: "Calendar days with this team",
            value: fmt(Math.ceil(masonDays / masons), 0),
            unit: "days",
            strong: true,
          },
        ],
        notes: ["Outputs are typical; use your own site records when you have them."],
      };
    }),
  },
  {
    key: "carriage",
    title: "Material carriage",
    category: "Earthwork & roads",
    icon: "local-shipping",
    about: "Trips and vehicle hours to carry a quantity over a lead (distance).",
    inputs: [
      { key: "qty", label: "Quantity", kind: "number", unit: "m³", default: "60" },
      { key: "cap", label: "Vehicle capacity", kind: "number", unit: "m³", default: "6" },
      { key: "lead", label: "One-way lead", kind: "number", unit: "km", default: "8" },
      { key: "speed", label: "Average speed", kind: "number", unit: "km/h", default: "25" },
      { key: "load", label: "Loading + unloading", kind: "number", unit: "minutes", default: "30" },
    ],
    compute: run((v) => {
      const trips = Math.ceil(positive(v, "qty", "Quantity") / positive(v, "cap", "Capacity"));
      const hoursPerTrip =
        (2 * num(v, "lead", "Lead")) / positive(v, "speed", "Speed") +
        num(v, "load", "Loading time") / 60;
      return {
        outputs: [
          { label: "Trips", value: fmt(trips, 0), unit: "trips", strong: true },
          { label: "Hours per trip", value: fmt(hoursPerTrip, 2), unit: "h" },
          { label: "Vehicle hours", value: fmt(trips * hoursPerTrip, 1), unit: "h", strong: true },
          { label: "Vehicle days (8 h)", value: fmt((trips * hoursPerTrip) / 8, 1), unit: "days" },
        ],
        notes: [],
      };
    }),
  },
  {
    key: "building-estimate",
    title: "Building cost & materials",
    category: "Estimate & bills",
    icon: "home-work",
    about: "Rough cost and material for a building from built-up area and rate per sqft.",
    inputs: [
      { key: "area", label: "Built-up area", kind: "number", unit: "sqft", default: "1000" },
      { key: "rate", label: "Rate per sqft", kind: "money", default: "1800" },
    ],
    compute: run((v) => {
      const area = positive(v, "area", "Built-up area");
      const rate = money(v, "rate", "Rate per sqft");
      const areaThousandths = BigInt(Math.round(area * 1000));
      const total = (rate * areaThousandths + 500n) / 1000n;
      const split: [string, number][] = [
        ["Cement", 16.4],
        ["Steel", 24.6],
        ["Sand", 12.3],
        ["Aggregate", 7.4],
        ["Bricks", 4.4],
        ["Flooring & tiles", 5],
        ["Doors & windows", 6.4],
        ["Plumbing & sanitary", 8.5],
        ["Electrical", 6.8],
        ["Paint", 4.1],
        ["Other / labour", 4.1],
      ];
      return {
        outputs: [
          { label: "Total cost", value: formatMinorAsRupees(total), strong: true },
          ...split.map(([label, pct]) => ({
            label: `${label} (${pct}%)`,
            value: formatMinorAsRupees(percentOf(total, pct)),
          })),
          { label: "Cement (0.4 bag/sqft)", value: fmt(area * 0.4, 0), unit: "bags", strong: true },
          { label: "Steel (4 kg/sqft)", value: fmt(area * 4, 0), unit: "kg", strong: true },
          { label: "Sand (1.816 cft/sqft)", value: fmt(area * 1.816, 0), unit: "cft" },
          { label: "Aggregate (1.35 cft/sqft)", value: fmt(area * 1.35, 0), unit: "cft" },
          { label: "Bricks (8/sqft)", value: fmt(area * 8, 0), unit: "nos" },
          { label: "Paint (0.18 L/sqft)", value: fmt(area * 0.18, 0), unit: "litres" },
        ],
        notes: ["Thumb rules for a framed RCC building; the detailed estimate decides."],
      };
    }),
  },
  {
    key: "bill-deductions",
    title: "Bill: GST, TDS & deductions",
    category: "Estimate & bills",
    icon: "receipt-long",
    about: "Net payable on a works bill to a government department (GST, TDS, cess, security).",
    inputs: [
      { key: "value", label: "Work value (before GST)", kind: "money", default: "1000000" },
      { key: "gst", label: "GST", kind: "number", unit: "%", default: "18" },
      { key: "it", label: "Income tax TDS (194C)", kind: "number", unit: "%", default: "2" },
      {
        key: "gsttds",
        label: "GST TDS (CGST 1% + SGST 1%)",
        kind: "number",
        unit: "%",
        default: "2",
      },
      { key: "cess", label: "Labour welfare cess", kind: "number", unit: "%", default: "1" },
      { key: "sd", label: "Security deposit", kind: "number", unit: "%", default: "5" },
    ],
    compute: run((v) => {
      const value = money(v, "value", "Work value");
      const gst = percentOf(value, num(v, "gst", "GST"));
      const gross = value + gst;
      const it = percentOf(value, num(v, "it", "Income tax TDS"));
      const gstTds = percentOf(value, num(v, "gsttds", "GST TDS"));
      const cess = percentOf(value, num(v, "cess", "Cess"));
      const sd = percentOf(value, num(v, "sd", "Security deposit"));
      const net = gross - it - gstTds - cess - sd;
      return {
        outputs: [
          { label: "GST", value: formatMinorAsRupees(gst) },
          { label: "Gross bill", value: formatMinorAsRupees(gross), strong: true },
          { label: "Income tax TDS", value: `− ${formatMinorAsRupees(it)}` },
          { label: "GST TDS", value: `− ${formatMinorAsRupees(gstTds)}` },
          { label: "Labour cess", value: `− ${formatMinorAsRupees(cess)}` },
          { label: "Security deposit", value: `− ${formatMinorAsRupees(sd)}` },
          { label: "Net payable", value: formatMinorAsRupees(net), strong: true },
        ],
        notes: ["Deductions here are on the value before GST; check your department's practice."],
      };
    }),
  },
];

export function toolByKey(key: string) {
  return CIVIL_TOOLS.find((tool) => tool.key === key) ?? null;
}

export function defaultValues(tool: CivilTool): Record<string, string> {
  return Object.fromEntries(tool.inputs.map((input) => [input.key, input.default]));
}
