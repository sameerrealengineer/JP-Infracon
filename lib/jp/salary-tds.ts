/**
 * Suggested monthly salary TDS (section 192) under the new tax regime, FY 2025-26 rates:
 * standard deduction ₹75,000; slabs 0–4 lakh nil, 4–8 5%, 8–12 10%, 12–16 15%, 16–20 20%,
 * 20–24 25%, above 30%; section 87A makes tax nil up to ₹12 lakh taxable income, with marginal
 * relief just above it; 4% health and education cess. Surcharge (above ₹50 lakh), other income
 * and declarations are not considered: it is a suggestion for accounts to check, never final.
 */
const LAKH = 100_000n * 100n; // in paise
export const STANDARD_DEDUCTION = 75_000n * 100n;
const SLABS: [bigint, number][] = [
  [4n * LAKH, 0],
  [8n * LAKH, 5],
  [12n * LAKH, 10],
  [16n * LAKH, 15],
  [20n * LAKH, 20],
  [24n * LAKH, 25],
];
const REBATE_LIMIT = 12n * LAKH;

/** Annual tax in paise on taxable income in paise (before cess, after rebate and relief). */
export function annualTaxNewRegime(taxableMinor: bigint): bigint {
  if (taxableMinor <= 0n) return 0n;
  let tax = 0n;
  let lower = 0n;
  for (const [upper, rate] of SLABS) {
    if (taxableMinor > lower) {
      const part = (taxableMinor < upper ? taxableMinor : upper) - lower;
      tax += (part * BigInt(rate)) / 100n;
    }
    lower = upper;
  }
  if (taxableMinor > lower) tax += ((taxableMinor - lower) * 30n) / 100n;
  if (taxableMinor <= REBATE_LIMIT) return 0n;
  // Marginal relief: tax never more than the income above the rebate limit.
  const excess = taxableMinor - REBATE_LIMIT;
  return tax < excess ? tax : excess;
}

/** Suggested TDS for one month from a steady monthly gross, rounded up to the rupee. */
export function suggestedMonthlyTds(monthlyGrossMinor: bigint): bigint {
  const taxable = monthlyGrossMinor * 12n - STANDARD_DEDUCTION;
  const tax = annualTaxNewRegime(taxable);
  const withCess = tax + (tax * 4n) / 100n;
  const monthly = withCess / 12n;
  return ((monthly + 99n) / 100n) * 100n;
}
