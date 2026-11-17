/**
 * Grouping helpers for the analytics dashboard: date ranges, weekly or daily buckets, exact
 * paise sums, ageing buckets and top-N lists. The server collects rows (within the viewer's
 * permissions) and these shape them; amounts stay paise strings.
 */

export const RANGE_DAYS = [7, 30, 90] as const;
export type RangeDays = (typeof RANGE_DAYS)[number];

const DAY = 86_400_000;
const toDay = (iso: string) => Math.floor(Date.parse(`${iso}T00:00:00Z`) / DAY);
const fromDay = (day: number) => new Date(day * DAY).toISOString().slice(0, 10);

export function addDays(iso: string, days: number) {
  return fromDay(toDay(iso) + days);
}

/** Inclusive range ending today. */
export function rangeFor(today: string, days: number) {
  return { from: addDays(today, -(days - 1)), to: today };
}

/** Bucket starts: one per day up to 31 days, else one per week (Mondays). */
export function bucketStarts(from: string, to: string): { size: "day" | "week"; starts: string[] } {
  const span = toDay(to) - toDay(from) + 1;
  if (span <= 31) {
    const starts: string[] = [];
    for (let d = toDay(from); d <= toDay(to); d++) starts.push(fromDay(d));
    return { size: "day", starts };
  }
  const first = toDay(from);
  // 1970-01-01 was a Thursday; Monday-based weeks.
  const monday = first - ((first + 3) % 7);
  const starts: string[] = [];
  for (let d = monday; d <= toDay(to); d += 7) starts.push(fromDay(d));
  return { size: "week", starts };
}

export function bucketOf(date: string, starts: readonly string[]): number {
  let index = -1;
  for (let i = 0; i < starts.length; i++) if (starts[i]! <= date) index = i;
  return index;
}

/** Sums paise per bucket and series: { series: { name: amounts[] } }. */
export function seriesByBucket(
  rows: readonly { date: string; series: string; amountMinor: string }[],
  starts: readonly string[],
  order: readonly string[],
) {
  const out: Record<string, bigint[]> = Object.fromEntries(
    order.map((name) => [name, starts.map(() => 0n)]),
  );
  for (const row of rows) {
    const index = bucketOf(row.date, starts);
    if (index < 0 || !out[row.series]) continue;
    out[row.series]![index]! += BigInt(row.amountMinor);
  }
  return Object.fromEntries(
    Object.entries(out).map(([name, values]) => [name, values.map(String)]),
  );
}

export function sumMinor(rows: readonly { amountMinor: string }[]) {
  return rows.reduce((sum, row) => sum + BigInt(row.amountMinor), 0n).toString();
}

/** Largest totals by key (paise), biggest first. */
export function topByAmount(
  rows: readonly { key: string; amountMinor: string }[],
  limit = 5,
): { key: string; amountMinor: string }[] {
  const totals = new Map<string, bigint>();
  for (const row of rows)
    totals.set(row.key, (totals.get(row.key) ?? 0n) + BigInt(row.amountMinor));
  return [...totals.entries()]
    .sort((a, b) => (b[1] > a[1] ? 1 : b[1] < a[1] ? -1 : a[0].localeCompare(b[0])))
    .slice(0, limit)
    .map(([key, amount]) => ({ key, amountMinor: amount.toString() }));
}

export const AGE_BUCKETS = [
  "Not due",
  "1–30 days",
  "31–60 days",
  "61–90 days",
  "Over 90 days",
] as const;

/** Ageing of an unpaid amount by how many days past its due date it is. */
export function ageBucket(dueDate: string | null, fallbackDate: string, today: string) {
  const late = toDay(today) - toDay(dueDate ?? fallbackDate);
  if (late <= 0) return AGE_BUCKETS[0];
  if (late <= 30) return AGE_BUCKETS[1];
  if (late <= 60) return AGE_BUCKETS[2];
  if (late <= 90) return AGE_BUCKETS[3];
  return AGE_BUCKETS[4];
}

/** Short label for a bucket start ("15 Nov"). */
export function bucketLabel(iso: string) {
  const date = new Date(`${iso}T00:00:00Z`);
  return `${date.getUTCDate()} ${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][date.getUTCMonth()]}`;
}

/** Paise to whole rupees as a number, for drawing only (never for totals). */
export function rupeesForChart(minor: string | bigint) {
  return Number(BigInt(minor) / 100n);
}

/** "₹12.5 L" / "₹3.2 Cr" / "₹45,000": short labels for chart axes and tiles. */
export function shortRupees(minor: string | bigint) {
  const rupees = BigInt(minor) / 100n;
  const negative = rupees < 0n;
  const abs = negative ? -rupees : rupees;
  const sign = negative ? "−" : "";
  if (abs >= 10_000_000n)
    return `${sign}₹${(Number(abs) / 1e7).toFixed(2).replace(/\.?0+$/, "")} Cr`;
  if (abs >= 100_000n) return `${sign}₹${(Number(abs) / 1e5).toFixed(2).replace(/\.?0+$/, "")} L`;
  return `${sign}₹${abs.toLocaleString("en-IN")}`;
}
