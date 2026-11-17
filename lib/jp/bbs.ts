import { steelKgPerM } from "./civil-tools";

/**
 * Bar bending schedule: cutting length per bar from its shape (IS 2502 practice: 90° bend
 * deducts 2d, 45° deducts 1d, 135° deducts 3d; a 135° stirrup hook adds 10d; a crank adds
 * 0.42 × crank height), number of bars and weight (d²/162 kg/m), with totals per diameter.
 */

export const BBS_SHAPES = [
  "Straight",
  "Straight with 2 hooks",
  "L-bar",
  "Crank (bent-up)",
  "Stirrup (rectangular)",
  "Ring (circular tie)",
] as const;
export type BbsShape = (typeof BBS_SHAPES)[number];
export const BBS_DIAS = [6, 8, 10, 12, 16, 20, 25, 32] as const;

export type BbsRow = {
  mark: string;
  member: string;
  dia: number;
  shape: BbsShape;
  /** Main length (straight, L leg 1, crank span) or stirrup/ring inner width or diameter, mm. */
  a: number;
  /** L leg 2, crank height, stirrup inner depth, mm (0 when not used). */
  b: number;
  /** Bars in one member. */
  bars: number;
  /** Number of such members. */
  members: number;
};

export type BbsLine = BbsRow & { cuttingMm: number; totalBars: number; totalM: number; kg: number };

export function cuttingLengthMm(row: Pick<BbsRow, "dia" | "shape" | "a" | "b">): number {
  const d = row.dia;
  switch (row.shape) {
    case "Straight":
      return row.a;
    case "Straight with 2 hooks":
      return row.a + 2 * 9 * d;
    case "L-bar":
      return row.a + row.b - 2 * d;
    case "Crank (bent-up)":
      // One crank: extra 0.42 × height; four 45° bends deduct 1d each.
      return row.a + 0.42 * row.b - 4 * d;
    case "Stirrup (rectangular)":
      // 2(A + B) + two 135° hooks (10d each) − three 90° bends (2d) − two 135° bends (3d).
      return 2 * (row.a + row.b) + 2 * 10 * d - 3 * 2 * d - 2 * 3 * d;
    case "Ring (circular tie)":
      return Math.PI * row.a + 2 * 10 * d;
  }
}

export function bbsLine(row: BbsRow): BbsLine {
  const cuttingMm = Math.max(0, Math.round(cuttingLengthMm(row)));
  const totalBars = Math.max(0, Math.round(row.bars * row.members));
  const totalM = (cuttingMm / 1000) * totalBars;
  return { ...row, cuttingMm, totalBars, totalM, kg: totalM * steelKgPerM(row.dia) };
}

export function bbsProblem(row: BbsRow): string | null {
  if (!BBS_DIAS.includes(row.dia as (typeof BBS_DIAS)[number])) return "Choose a bar diameter.";
  if (!(row.a > 0)) return "Enter the length (A) in mm.";
  if (["L-bar", "Crank (bent-up)", "Stirrup (rectangular)"].includes(row.shape) && !(row.b > 0))
    return "Enter B in mm for this shape.";
  if (!(row.bars > 0) || !(row.members > 0)) return "Enter bars per member and members.";
  return null;
}

export function bbsTotals(rows: readonly BbsRow[], wastePct = 3) {
  const lines = rows.map(bbsLine);
  const byDia = BBS_DIAS.map((dia) => {
    const kg = lines.filter((line) => line.dia === dia).reduce((sum, line) => sum + line.kg, 0);
    // Bars of 12 m to order, cutting waste included.
    const m = lines.filter((line) => line.dia === dia).reduce((sum, line) => sum + line.totalM, 0);
    return { dia, kg, bars12m: Math.ceil((m * (1 + wastePct / 100)) / 12) };
  }).filter((row) => row.kg > 0);
  const kg = lines.reduce((sum, line) => sum + line.kg, 0);
  return { lines, byDia, kg, kgWithWaste: kg * (1 + wastePct / 100) };
}

/** CSV text for a BBS (opens in Excel). */
export function bbsCsv(rows: readonly BbsRow[], wastePct = 3): string {
  const { lines, byDia, kg, kgWithWaste } = bbsTotals(rows, wastePct);
  const cell = (value: string | number) => {
    const text = String(value);
    return /^[=+\-@]/.test(text)
      ? `'${text}`
      : /[",\n]/.test(text)
        ? `"${text.replace(/"/g, '""')}"`
        : text;
  };
  const out = [
    [
      "Mark",
      "Member",
      "Dia (mm)",
      "Shape",
      "A (mm)",
      "B (mm)",
      "Cutting length (mm)",
      "Bars",
      "Total length (m)",
      "Weight (kg)",
    ].join(","),
    ...lines.map((line) =>
      [
        line.mark,
        line.member,
        line.dia,
        line.shape,
        line.a,
        line.b,
        line.cuttingMm,
        line.totalBars,
        line.totalM.toFixed(2),
        line.kg.toFixed(2),
      ]
        .map(cell)
        .join(","),
    ),
    "",
    ["Dia (mm)", "Weight (kg)", "12 m bars to order"].join(","),
    ...byDia.map((row) => [row.dia, row.kg.toFixed(2), row.bars12m].join(",")),
    "",
    `Total steel (kg),${kg.toFixed(2)}`,
    `With ${wastePct}% wastage (kg),${kgWithWaste.toFixed(2)}`,
  ];
  return `﻿${out.join("\n")}`;
}
