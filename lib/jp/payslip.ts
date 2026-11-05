import { formatMinorAsRupees } from "./finance-domain";
import { formatDays } from "./payroll-domain";
import { escapeHtml } from "./pdf-report";

/** Printable payslip (A5) for one pay-run line. All text is escaped. */

export type PayslipLine = {
  name: string;
  trade?: string | null;
  payType: "Daily" | "Monthly";
  uan?: string | null;
  esiNumber?: string | null;
  workedDaysHundredths: number;
  paidDaysHundredths: number;
  overtimeHundredths: number;
  basicMinor: string;
  hraMinor: string;
  otherAllowanceMinor: string;
  overtimeMinor: string;
  grossMinor: string;
  pfEmployeeMinor: string;
  esiEmployeeMinor: string;
  ptMinor: string;
  tdsMinor: string;
  advanceMinor: string;
  otherDeductionMinor: string;
  otherDeductionNote?: string | null;
  totalDeductionMinor?: string;
  netMinor: string;
  employerEpfMinor: string;
  employerEpsMinor: string;
  esiEmployerMinor: string;
};

export type PayslipRun = {
  runNumber: string;
  month: string;
  siteName: string;
  status: string;
  paidOn?: string | null;
};

const money = (value: string) => escapeHtml(formatMinorAsRupees(value));
const nonZero = (value: string) => value !== "0" && value !== "";

function rows(items: [string, string][]) {
  return items
    .map(
      ([label, value]) =>
        `<tr><td>${escapeHtml(label)}</td><td class="r">${money(value)}</td></tr>`,
    )
    .join("");
}

export function payslipBody(run: PayslipRun, line: PayslipLine) {
  const earnings: [string, string][] = [
    [line.payType === "Daily" ? "Wages" : "Basic + DA", line.basicMinor],
  ];
  if (nonZero(line.hraMinor)) earnings.push(["HRA", line.hraMinor]);
  if (nonZero(line.otherAllowanceMinor))
    earnings.push(["Other allowance", line.otherAllowanceMinor]);
  if (nonZero(line.overtimeMinor))
    earnings.push([
      `Overtime (${formatDays(BigInt(line.overtimeHundredths))} h)`,
      line.overtimeMinor,
    ]);
  const deductions: [string, string][] = [];
  if (nonZero(line.pfEmployeeMinor)) deductions.push(["PF (employee)", line.pfEmployeeMinor]);
  if (nonZero(line.esiEmployeeMinor)) deductions.push(["ESI (employee)", line.esiEmployeeMinor]);
  if (nonZero(line.ptMinor)) deductions.push(["Professional tax", line.ptMinor]);
  if (nonZero(line.tdsMinor)) deductions.push(["TDS", line.tdsMinor]);
  if (nonZero(line.advanceMinor)) deductions.push(["Advance recovery", line.advanceMinor]);
  if (nonZero(line.otherDeductionMinor))
    deductions.push([
      `Other${line.otherDeductionNote ? `: ${line.otherDeductionNote}` : ""}`,
      line.otherDeductionMinor,
    ]);
  const totalDeduction =
    line.totalDeductionMinor ?? (BigInt(line.grossMinor) - BigInt(line.netMinor)).toString();
  const ids = [
    line.uan ? `UAN ${line.uan}` : null,
    line.esiNumber ? `ESI ${line.esiNumber}` : null,
  ].filter(Boolean);
  return `<section class="slip">
<header><div class="brand">JP INFRACON</div><div class="title">Payslip · ${escapeHtml(run.month)}</div></header>
<table class="meta">
<tr><th>Name</th><td>${escapeHtml(line.name)}${line.trade ? ` · ${escapeHtml(line.trade)}` : ""}</td></tr>
<tr><th>Site</th><td>${escapeHtml(run.siteName)}</td></tr>
<tr><th>Pay run</th><td>${escapeHtml(run.runNumber)} (${escapeHtml(run.status)})</td></tr>
<tr><th>Days</th><td>${line.payType === "Daily" ? "Worked" : "Paid"} ${escapeHtml(formatDays(BigInt(line.payType === "Daily" ? line.workedDaysHundredths : line.paidDaysHundredths)))}</td></tr>
${ids.length ? `<tr><th>Numbers</th><td>${escapeHtml(ids.join(" · "))}</td></tr>` : ""}
</table>
<div class="cols">
<table class="data"><thead><tr><th>Earnings</th><th class="r">₹</th></tr></thead><tbody>${rows(earnings)}
<tr class="t"><td>Gross</td><td class="r">${money(line.grossMinor)}</td></tr></tbody></table>
<table class="data"><thead><tr><th>Deductions</th><th class="r">₹</th></tr></thead><tbody>${deductions.length ? rows(deductions) : `<tr><td>None</td><td class="r">${money("0")}</td></tr>`}
<tr class="t"><td>Total</td><td class="r">${money(totalDeduction)}</td></tr></tbody></table>
</div>
<p class="net">Net pay ${money(line.netMinor)}</p>
<p class="foot">Employer also pays PF ${money((BigInt(line.employerEpfMinor) + BigInt(line.employerEpsMinor)).toString())} and ESI ${money(line.esiEmployerMinor)}.${run.paidOn ? ` Paid on ${escapeHtml(run.paidOn)}.` : ""} Generated from JP Infracon records.</p>
</section>`;
}

const STYLE = `<style>
  @page { size: A5; margin: 10mm; }
  body { font-family: "Noto Sans", "Noto Sans Devanagari", "Noto Sans Oriya", Arial, sans-serif; color: #0E1A26; font-size: 9pt; }
  .slip { page-break-after: always; }
  header { border-bottom: 3px solid #B08A3E; padding-bottom: 6px; margin-bottom: 8px; }
  .brand { font-family: Georgia, serif; font-size: 16pt; color: #16324F; letter-spacing: 2px; }
  .title { font-size: 11pt; font-weight: 700; }
  table { border-collapse: collapse; width: 100%; }
  .meta th { text-align: left; color: #68717D; width: 70px; padding: 1px 8px 1px 0; }
  .cols { display: flex; gap: 10px; margin-top: 8px; }
  .data th { background: #16324F; color: #fff; text-align: left; padding: 4px; }
  .data td { border-bottom: 1px solid #E5DFD3; padding: 3px 4px; }
  .data .t td { font-weight: 700; }
  .r { text-align: right; }
  .net { font-size: 13pt; font-weight: 800; margin: 10px 0 4px; }
  .foot { color: #68717D; font-size: 7.5pt; }
</style>`;

/** One document with a payslip per line (one page each). */
export function buildPayslipsHtml(run: PayslipRun, lines: readonly PayslipLine[]) {
  return `<!doctype html><html><head><meta charset="utf-8" /><title>${escapeHtml(`Payslips ${run.runNumber}`)}</title>${STYLE}</head><body>${lines
    .map((line) => payslipBody(run, line))
    .join("")}</body></html>`;
}
