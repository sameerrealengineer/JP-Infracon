import { formatHours, parseHours, type AttendanceStatus } from "./attendance-domain";

/**
 * Daily Labour Report summary, built from the attendance marked for a site and day.
 * Hours are exact hundredths; nothing here is money (rates stay behind compensation.view).
 */

export type LabourRow = {
  trade: string | null;
  status: AttendanceStatus | string;
  regularHours: string | number | null;
  overtimeHours: string | number | null;
  approved: boolean;
};

export type TradeLine = {
  trade: string;
  fullDay: number;
  halfDay: number;
  hoursBased: number;
  absent: number;
  leave: number;
  regularHours: string;
  overtimeHours: string;
};

export type LabourSummary = {
  trades: TradeLine[];
  totals: {
    marked: number;
    onSite: number;
    absentOrLeave: number;
    regularHours: string;
    overtimeHours: string;
    approved: number;
    pending: number;
  };
};

const ON_SITE = new Set(["Full Day", "Half Day", "Present-hours-based"]);

function hours(value: string | number | null): bigint {
  if (value === null || value === undefined) return 0n;
  // MySQL returns "8.00"; trim trailing zeros past two decimals before parsing.
  return parseHours(String(value).replace(/(\.\d{2})\d*$/, "$1")) ?? 0n;
}

export function summarizeLabour(rows: readonly LabourRow[]): LabourSummary {
  const byTrade = new Map<string, TradeLine & { regular: bigint; overtime: bigint }>();
  let regular = 0n;
  let overtime = 0n;
  for (const row of rows) {
    const trade = row.trade?.trim() || "Other";
    const line =
      byTrade.get(trade) ??
      ({
        trade,
        fullDay: 0,
        halfDay: 0,
        hoursBased: 0,
        absent: 0,
        leave: 0,
        regularHours: "0",
        overtimeHours: "0",
        regular: 0n,
        overtime: 0n,
      } as TradeLine & { regular: bigint; overtime: bigint });
    if (row.status === "Full Day") line.fullDay += 1;
    else if (row.status === "Half Day") line.halfDay += 1;
    else if (row.status === "Present-hours-based") line.hoursBased += 1;
    else if (row.status === "Leave") line.leave += 1;
    else line.absent += 1;
    if (ON_SITE.has(row.status)) {
      line.regular += hours(row.regularHours);
      line.overtime += hours(row.overtimeHours);
    }
    byTrade.set(trade, line);
  }
  const trades = [...byTrade.values()]
    .sort((a, b) => a.trade.localeCompare(b.trade))
    .map(({ regular: r, overtime: o, ...line }) => {
      regular += r;
      overtime += o;
      return { ...line, regularHours: formatHours(r), overtimeHours: formatHours(o) };
    });
  const onSite = rows.filter((row) => ON_SITE.has(row.status)).length;
  const approved = rows.filter((row) => row.approved).length;
  return {
    trades,
    totals: {
      marked: rows.length,
      onSite,
      absentOrLeave: rows.length - onSite,
      regularHours: formatHours(regular),
      overtimeHours: formatHours(overtime),
      approved,
      pending: rows.length - approved,
    },
  };
}
