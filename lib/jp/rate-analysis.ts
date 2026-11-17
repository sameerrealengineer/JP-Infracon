import { parseRupeesToMinor } from "./finance-domain";

/**
 * Rate analysis and estimate (CPWD / Odisha SOR style): an item's rate per unit is
 * material + labour + tools & plant, plus water charges and contractor's overhead & profit;
 * the estimate abstract is quantity × rate per item, then contingency and GST. Money is exact
 * paise (BigInt); quantities are thousandths.
 */

export type RateInputs = {
  /** Rupee text per unit of the item. */
  material: string;
  labour: string;
  plant: string;
  /** Percent, e.g. "1" water charges, "15" overhead and profit. */
  waterPct: string;
  overheadProfitPct: string;
};

export type EstimateItem = {
  description: string;
  unit: string;
  /** Quantity text, up to 3 decimals. */
  quantity: string;
  rate: RateInputs;
};

function paise(text: string, label: string): bigint {
  try {
    return BigInt(parseRupeesToMinor(text.trim() || "0", true));
  } catch {
    throw new Error(`${label}: enter rupees with up to 2 decimals.`);
  }
}

function bps(text: string, label: string): bigint {
  const value = Number(text.trim() || "0");
  if (!Number.isFinite(value) || value < 0 || value > 100)
    throw new Error(`${label}: enter a percent from 0 to 100.`);
  return BigInt(Math.round(value * 100));
}

function share(amount: bigint, basisPoints: bigint) {
  return (amount * basisPoints + 5000n) / 10000n;
}

export function thousandths(text: string): bigint {
  const t = text.trim();
  if (!/^\d{1,12}(\.\d{1,3})?$/.test(t))
    throw new Error("Quantity: enter a number with up to 3 decimals.");
  const [whole, frac = ""] = t.split(".");
  return BigInt(whole!) * 1000n + BigInt(frac.padEnd(3, "0"));
}

/** Rate per unit with its build-up. */
export function analyseRate(input: RateInputs) {
  const material = paise(input.material, "Material");
  const labour = paise(input.labour, "Labour");
  const plant = paise(input.plant, "Tools & plant");
  const base = material + labour + plant;
  const water = share(base, bps(input.waterPct, "Water charges"));
  const overhead = share(base + water, bps(input.overheadProfitPct, "Overhead & profit"));
  return { material, labour, plant, base, water, overhead, rate: base + water + overhead };
}

export function estimateAbstract(
  items: readonly EstimateItem[],
  contingencyPct = "3",
  gstPct = "18",
) {
  const lines = items.map((item) => {
    const analysis = analyseRate(item.rate);
    const qty = thousandths(item.quantity);
    const amount = (analysis.rate * qty + 500n) / 1000n;
    return { ...item, analysis, amount };
  });
  const subtotal = lines.reduce((sum, line) => sum + line.amount, 0n);
  const contingency = share(subtotal, bps(contingencyPct, "Contingency"));
  const gst = share(subtotal + contingency, bps(gstPct, "GST"));
  return { lines, subtotal, contingency, gst, total: subtotal + contingency + gst };
}
