/**
 * The night summary (11 PM IST) each leader or site manager gets on WhatsApp and in the app:
 * per site, who came, which reports were sent, work measured, and money that went out today
 * (only the parts the person may see). Pure: the server collects the facts, this writes text.
 */

export type MoneyLine = { who: string; amountMinor: string; why: string };

export type SiteDay = {
  siteName: string;
  /** null when the person may not see attendance on this site. */
  attendance: {
    present: number;
    half: number;
    absent: number;
    leave: number;
    waiting: number;
  } | null;
  /** null when the person may not see reports. */
  reports: { dpr: string | null; dlr: string | null } | null;
  /** Subcontract measurements recorded today (null: not visible). */
  measurements: number | null;
  /** Money out today, each list only when visible (null). */
  supplierPayments: MoneyLine[] | null;
  pettyCash: MoneyLine[] | null;
  advances: MoneyLine[] | null;
};

export const SUMMARY_HOUR_IST = 23;

/** "YYYY-MM-DD" and the hour, in India time, for a moment. */
export function istClock(now: Date): { date: string; hour: number } {
  const ist = new Date(now.getTime() + 330 * 60_000);
  return { date: ist.toISOString().slice(0, 10), hour: ist.getUTCHours() };
}

/** True once it is 11 PM or later in India and today's summary has not gone yet. */
export function summaryDue(now: Date, lastSentDate: string | null): boolean {
  const { date, hour } = istClock(now);
  return hour >= SUMMARY_HOUR_IST && lastSentDate !== date;
}

/** Whole rupees the Indian way: 125000000 paise → "₹12,50,000". */
export function rupees(minor: string | bigint): string {
  const value = BigInt(minor);
  const negative = value < 0n;
  const whole = (negative ? -value : value) / 100n;
  const digits = whole.toString();
  const last3 = digits.slice(-3);
  const rest = digits.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ",");
  return `${negative ? "-" : ""}₹${rest ? `${rest},${last3}` : last3}`;
}

function total(lines: MoneyLine[]) {
  return lines.reduce((sum, line) => sum + BigInt(line.amountMinor), 0n);
}

function moneyBlock(title: string, lines: MoneyLine[] | null, out: string[]) {
  if (!lines || !lines.length) return;
  out.push(`  ${title}: ${rupees(total(lines))} (${lines.length})`);
  for (const line of lines.slice(0, 5))
    out.push(`   • ${line.who} ${rupees(line.amountMinor)}${line.why ? ` — ${line.why}` : ""}`);
  if (lines.length > 5) out.push(`   • +${lines.length - 5} more`);
}

/** The WhatsApp / in-app text. */
export function formatDailySummary(input: {
  personName: string;
  date: string;
  sites: SiteDay[];
  waitingForYou: number;
}): string {
  const out: string[] = [`JP Infracon — day summary ${input.date}`, `For ${input.personName}`];
  let moneyAll = 0n;
  for (const site of input.sites) {
    out.push("", `🏗 ${site.siteName}`);
    if (site.attendance) {
      const a = site.attendance;
      out.push(
        `  Attendance: ${a.present} present, ${a.half} half day, ${a.absent} absent, ${a.leave} on leave` +
          (a.waiting ? ` (${a.waiting} waiting for approval)` : ""),
      );
    }
    if (site.reports)
      out.push(
        `  Reports: DPR ${site.reports.dpr ?? "not sent"}, DLR ${site.reports.dlr ?? "not sent"}`,
      );
    if (site.measurements) out.push(`  Subcontract work measured: ${site.measurements} entries`);
    moneyBlock("Supplier payments", site.supplierPayments, out);
    moneyBlock("Petty cash spent", site.pettyCash, out);
    moneyBlock("Advances to workers", site.advances, out);
    for (const lines of [site.supplierPayments, site.pettyCash, site.advances])
      if (lines) moneyAll += total(lines);
  }
  if (!input.sites.length) out.push("", "No sites to report.");
  out.push("");
  if (moneyAll > 0n) out.push(`Money out today: ${rupees(moneyAll)}`);
  out.push(
    input.waitingForYou
      ? `Waiting for you in the app: ${input.waitingForYou}`
      : "Nothing is waiting for you.",
  );
  return out.join("\n");
}
