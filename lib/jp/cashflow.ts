/**
 * Cash-flow forecast: money expected in (approved client bills not yet received) and out
 * (approved supplier and subcontract bills not yet paid, approved pay runs not yet paid), by
 * week, with what is already overdue first and a running balance from an opening cash figure
 * the person enters. Paise strings / BigInt. An estimate from the app's records, not a bank view.
 */

export type CashEntry = {
  date: string;
  direction: "in" | "out";
  amountMinor: string;
  kind: string;
  who: string;
  reference: string;
};

const DAY = 86_400_000;
const toDay = (iso: string) => Math.floor(Date.parse(`${iso}T00:00:00Z`) / DAY);
const fromDay = (day: number) => new Date(day * DAY).toISOString().slice(0, 10);

export function addDays(iso: string, days: number) {
  return fromDay(toDay(iso) + days);
}

/** Expected date: the due date, else the document date plus the usual credit days. */
export function expectedDate(dueDate: string | null, documentDate: string, creditDays: number) {
  return dueDate ?? addDays(documentDate, creditDays);
}

export function forecast(
  entries: readonly CashEntry[],
  today: string,
  days: number,
  openingMinor = 0n,
) {
  const end = addDays(today, days - 1);
  const weeks: { label: string; from: string; to: string; inMinor: bigint; outMinor: bigint }[] = [
    { label: "Overdue", from: "", to: addDays(today, -1), inMinor: 0n, outMinor: 0n },
  ];
  for (let start = toDay(today); start <= toDay(end); start += 7) {
    const to = Math.min(start + 6, toDay(end));
    weeks.push({
      label: fromDay(start),
      from: fromDay(start),
      to: fromDay(to),
      inMinor: 0n,
      outMinor: 0n,
    });
  }
  let later = { inMinor: 0n, outMinor: 0n };
  for (const entry of entries) {
    const amount = BigInt(entry.amountMinor);
    if (amount <= 0n) continue;
    const bucket =
      entry.date < today
        ? weeks[0]
        : weeks.find((w, i) => i > 0 && entry.date >= w.from && entry.date <= w.to);
    const target = bucket ?? later;
    if (entry.direction === "in") target.inMinor += amount;
    else target.outMinor += amount;
    if (!bucket) later = target;
  }
  let running = openingMinor;
  const rows = weeks.map((w) => {
    running += w.inMinor - w.outMinor;
    return {
      label: w.label,
      from: w.from,
      to: w.to,
      inMinor: w.inMinor.toString(),
      outMinor: w.outMinor.toString(),
      netMinor: (w.inMinor - w.outMinor).toString(),
      balanceMinor: running.toString(),
    };
  });
  const lowest = rows.reduce(
    (min, r) => (BigInt(r.balanceMinor) < BigInt(min.balanceMinor) ? r : min),
    rows[0]!,
  );
  return {
    rows,
    totalInMinor: rows.reduce((s, r) => s + BigInt(r.inMinor), 0n).toString(),
    totalOutMinor: rows.reduce((s, r) => s + BigInt(r.outMinor), 0n).toString(),
    laterInMinor: later.inMinor.toString(),
    laterOutMinor: later.outMinor.toString(),
    lowestBalance: { label: lowest.label, balanceMinor: lowest.balanceMinor },
    shortfall: BigInt(lowest.balanceMinor) < 0n,
  };
}
