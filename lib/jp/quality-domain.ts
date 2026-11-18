/**
 * Quality test register and material reconciliation for a works contract.
 * - Concrete cubes (IS 456 / IS 516): a set cast on a day is tested at 7 and 28 days. The 28-day
 *   result passes when the average of the set is at least fck and no cube is below fck − 3 MPa
 *   (fck − 2 for M15 and below) — a per-sample check; the department applies the full
 *   statistical rule over several samples. The 7-day result is indicative (about 65% of fck).
 * - Slump and other tests pass inside the range the engineer enters.
 * - Reconciliation: theoretical cement or steel from measured work × consumption per unit,
 *   against what the store issued; CPWD allows small variations (cement ±2%, steel ±3% here).
 * Strengths are in tenths of MPa; quantities in thousandths (BigInt where summed).
 */

export const TEST_TYPES = [
  "Concrete cube 7-day",
  "Concrete cube 28-day",
  "Slump",
  "Steel tensile / bend",
  "Brick compressive",
  "Cement setting / fineness",
  "Soil compaction (FDD)",
  "Water: residual chlorine",
  "Water: bacteriological",
  "Other",
] as const;
export type TestType = (typeof TEST_TYPES)[number];

const DAY = 86_400_000;
export function addDaysIso(iso: string, days: number) {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);
}

/** fck in MPa from a grade like "M20". */
export function gradeStrength(grade: string): number | null {
  const m = /^M(\d{1,2}(?:\.5)?)$/i.exec(grade.trim());
  return m ? Number(m[1]) : null;
}

/** Due dates for a cube set cast on a day. */
export function cubeDueDates(castDate: string) {
  return { sevenDay: addDaysIso(castDate, 7), twentyEightDay: addDaysIso(castDate, 28) };
}

/** Parses "21.5, 22, 20.8" into numbers (MPa); null when any value is not a positive number. */
export function parseResults(text: string): number[] | null {
  const parts = text
    .split(/[,\s/]+/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (!parts.length) return null;
  const values = parts.map(Number);
  return values.every((v) => Number.isFinite(v) && v > 0) ? values : null;
}

export type Verdict = { pass: boolean; summary: string };

/** Cube set verdict by age and grade. */
export function cubeVerdict(
  grade: string,
  age: 7 | 28,
  results: readonly number[],
): Verdict | null {
  const fck = gradeStrength(grade);
  if (fck === null || !results.length) return null;
  const avg = results.reduce((a, b) => a + b, 0) / results.length;
  const avgText = avg.toFixed(1);
  if (age === 7) {
    const expected = 0.65 * fck;
    return {
      pass: avg >= expected,
      summary: `Average ${avgText} MPa at 7 days; about ${expected.toFixed(1)} expected (indicative).`,
    };
  }
  const floor = fck <= 15 ? fck - 2 : fck - 3;
  const lowest = Math.min(...results);
  const pass = avg >= fck && lowest >= floor;
  return {
    pass,
    summary: pass
      ? `Average ${avgText} MPa ≥ ${fck}; lowest ${lowest} ≥ ${floor}.`
      : `Average ${avgText} MPa (needs ${fck}), lowest ${lowest} (needs ${floor}). Inform the engineer-in-charge.`,
  };
}

/** Pass when every value is inside [min, max] (either bound optional). */
export function rangeVerdict(
  results: readonly number[],
  min: number | null,
  max: number | null,
): Verdict | null {
  if (!results.length || (min === null && max === null)) return null;
  const bad = results.filter((v) => (min !== null && v < min) || (max !== null && v > max));
  return {
    pass: bad.length === 0,
    summary: bad.length
      ? `${bad.length} of ${results.length} outside ${min ?? "–"} to ${max ?? "–"}.`
      : `All ${results.length} within ${min ?? "–"} to ${max ?? "–"}.`,
  };
}

export type TestState = "Due" | "Overdue" | "Passed" | "Failed" | "Done";

export function testState(
  row: { dueDate: string | null; status: string; pass: boolean | null },
  today: string,
): TestState {
  if (row.status === "Done")
    return row.pass === true ? "Passed" : row.pass === false ? "Failed" : "Done";
  if (row.dueDate && row.dueDate < today) return "Overdue";
  return "Due";
}

/** CPWD-style permitted variation between theoretical and actual consumption, percent. */
export const PERMITTED_VARIATION: Record<"Cement" | "Steel", number> = { Cement: 2, Steel: 3 };

/**
 * Reconciliation for one material: theoretical (thousandths) from work × coefficient, actual
 * issued (thousandths); variance percent to two decimals and whether it is inside the limit.
 */
export function reconcile(material: "Cement" | "Steel", theoretical: bigint, actual: bigint) {
  if (theoretical <= 0n) return { variancePct: null, ok: null as boolean | null };
  const bps = ((actual - theoretical) * 10000n) / theoretical;
  const variancePct = Number(bps) / 100;
  return { variancePct, ok: Math.abs(variancePct) <= PERMITTED_VARIATION[material] };
}

/** Theoretical quantity: Σ measured work (thousandths) × consumption per unit (thousandths). */
export function theoretical(
  lines: readonly { workThousandths: bigint; perUnitThousandths: bigint }[],
) {
  return lines.reduce(
    (sum, line) => sum + (line.workThousandths * line.perUnitThousandths + 500n) / 1000n,
    0n,
  );
}
