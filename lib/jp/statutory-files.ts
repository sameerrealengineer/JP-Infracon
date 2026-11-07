import { csvCell } from "./csv";

/**
 * Upload files from a pay run.
 * - EPFO ECR 2.0 (monthly): plain text, one member per line, no header, 11 fields joined by
 *   "#~#": UAN, name, gross, EPF wages, EPS wages, EDLI wages, EE share, EPS share, ER (EPF−EPS)
 *   share, NCP days, refund of advances. Amounts in whole rupees; NCP whole days.
 * - ESIC monthly contribution: the portal takes its own .xls template, so this is a CSV with the
 *   template's columns (IP number, IP name, days, wages, reason code, last working day) to paste
 *   into it. Days are rounded up; wages in whole rupees.
 * People without a UAN / IP number are left out and listed so accounts can fix them.
 */

export type FileLine = {
  name: string;
  uan: string | null;
  esiNumber: string | null;
  payType: "Daily" | "Monthly";
  workedDaysHundredths: number;
  paidDaysHundredths: number;
  grossMinor: string;
  pfWageMinor: string;
  pfEmployeeMinor: string;
  employerEpsMinor: string;
  employerEpfMinor: string;
  esiEmployeeMinor: string;
};

export type Skipped = { name: string; reason: string };

/** Paise → whole rupees, half up. */
export function wholeRupees(minor: string | bigint) {
  const value = BigInt(minor);
  return ((value * 2n + 100n) / 200n).toString();
}

function cleanName(name: string) {
  return name.replaceAll("#~#", " ").replace(/\s+/g, " ").trim().toUpperCase();
}

function paidDays(line: FileLine) {
  return line.payType === "Monthly" ? line.paidDaysHundredths : line.workedDaysHundredths;
}

export function buildEcr(lines: readonly FileLine[], daysInMonth: number, epsCeilingMinor: bigint) {
  const rows: string[] = [];
  const skipped: Skipped[] = [];
  for (const line of lines) {
    if (BigInt(line.pfEmployeeMinor) === 0n && BigInt(line.pfWageMinor) === 0n) continue;
    if (!line.uan || !/^\d{12}$/.test(line.uan)) {
      skipped.push({ name: line.name, reason: "No UAN" });
      continue;
    }
    const pfWage = BigInt(line.pfWageMinor);
    const epsWage = pfWage < epsCeilingMinor ? pfWage : epsCeilingMinor;
    // NCP days: days in the month not paid; a half day not paid counts as a full NCP day.
    const paidWhole = Math.floor(paidDays(line) / 100);
    const ncp = Math.max(0, Math.min(daysInMonth, daysInMonth - paidWhole));
    rows.push(
      [
        line.uan,
        cleanName(line.name),
        wholeRupees(line.grossMinor),
        wholeRupees(pfWage),
        wholeRupees(epsWage),
        wholeRupees(pfWage),
        wholeRupees(line.pfEmployeeMinor),
        wholeRupees(line.employerEpsMinor),
        wholeRupees(line.employerEpfMinor),
        String(ncp),
        "0",
      ].join("#~#"),
    );
  }
  return { text: rows.length ? `${rows.join("\n")}\n` : "", count: rows.length, skipped };
}

export function buildEsicCsv(lines: readonly FileLine[]) {
  const header = [
    "IP Number",
    "IP Name",
    "No of Days for which wages paid/payable during the month",
    "Total Monthly Wages",
    "Reason Code for Zero workings days",
    "Last Working Day",
  ];
  const rows: string[] = [header.map(csvCell).join(",")];
  const skipped: Skipped[] = [];
  let count = 0;
  for (const line of lines) {
    if (BigInt(line.esiEmployeeMinor) === 0n) continue;
    if (!line.esiNumber || !/^\d{10}$/.test(line.esiNumber)) {
      skipped.push({ name: line.name, reason: "No ESI IP number" });
      continue;
    }
    const days = Math.ceil(paidDays(line) / 100);
    rows.push(
      [line.esiNumber, cleanName(line.name), String(days), wholeRupees(line.grossMinor), "", ""]
        .map(csvCell)
        .join(","),
    );
    count += 1;
  }
  return { text: `${rows.join("\r\n")}\r\n`, count, skipped };
}
