import { describe, expect, it } from "vitest";
import {
  DEFAULT_RATES,
  attendanceWages,
  ceilRupee,
  checkIdentifiers,
  esiContribution,
  formatPtSlabs,
  monthBounds,
  parseDays,
  parsePtSlabs,
  payrollLine,
  pfContribution,
  previousMonth,
  professionalTax,
  prorate,
  roundRupee,
  runTotals,
  statutoryDues,
  statutoryWage,
  type LineInput,
} from "./payroll-domain";

const base: LineInput = {
  payType: "Monthly",
  basicMinor: 0n,
  hraMinor: 0n,
  otherAllowanceMinor: 0n,
  overtimeMinor: 0n,
  pfMember: true,
  esiMember: true,
  ptApplies: true,
  tdsMinor: 0n,
  advanceMinor: 0n,
  otherDeductionMinor: 0n,
};

describe("months and days", () => {
  it("knows month lengths, leap years included", () => {
    expect(monthBounds("2026-10")).toEqual({ first: "2026-10-01", last: "2026-10-31", days: 31 });
    expect(monthBounds("2028-02")?.days).toBe(29);
    expect(monthBounds("2026-13")).toBeNull();
    expect(previousMonth("2026-11-05")).toBe("2026-10");
    expect(previousMonth("2027-01-10")).toBe("2026-12");
  });
  it("parses paid days and prorates monthly pay", () => {
    expect(parseDays("27.5")).toBe(2750n);
    expect(parseDays("32")).toBeNull();
    expect(parseDays("-1")).toBeNull();
    // ₹31,000 for 30 of 31 days = ₹30,000
    expect(prorate(3_100_000n, 3000n, 31)).toBe(3_000_000n);
    expect(prorate(3_100_000n, 3100n, 31)).toBe(3_100_000n);
  });
});

describe("statutory rules", () => {
  it("rounds PF to the rupee and ESI up to the next rupee", () => {
    expect(roundRupee(12_349n)).toBe(12_300n);
    expect(roundRupee(12_350n)).toBe(12_400n);
    expect(ceilRupee(12_301n)).toBe(12_400n);
    expect(ceilRupee(12_300n)).toBe(12_300n);
  });
  it("adds allowances above half of pay to PF wages (Code on Wages)", () => {
    // basic 10,000 + allowances 15,000 = 25,000; half is 12,500, so 2,500 is added back
    expect(statutoryWage(1_000_000n, 1_500_000n, 5000)).toBe(1_250_000n);
    expect(statutoryWage(1_500_000n, 1_000_000n, 5000)).toBe(1_500_000n);
  });
  it("caps PF at the wage ceiling and splits the employer share into EPS", () => {
    const pf = pfContribution(4_000_000n, DEFAULT_RATES);
    expect(pf.pfWageMinor).toBe(2_500_000n);
    expect(pf.employeeMinor).toBe(300_000n); // 12% of ₹25,000
    expect(pf.employerEpsMinor).toBe(208_300n); // 8.33% = ₹2,082.50 → ₹2,083
    expect(pf.employerEpfMinor).toBe(91_700n);
    expect(pf.edliAdminMinor).toBe(25_000n); // 0.5% + 0.5%
  });
  it("applies ESI only up to ₹21,000 and leaves overtime out of the test", () => {
    expect(esiContribution(2_200_000n, 2_000_000n, DEFAULT_RATES)).toEqual({
      applies: true,
      employeeMinor: 16_500n, // 0.75% of ₹22,000
      employerMinor: 71_500n,
    });
    expect(esiContribution(2_200_000n, 2_200_000n, DEFAULT_RATES).applies).toBe(false);
  });
  it("reads professional tax slabs and has none by default (Odisha repealed it)", () => {
    expect(professionalTax(5_000_000n, DEFAULT_RATES.ptSlabs)).toBe(0n);
    const slabs = parsePtSlabs("13304: 0\n25000: 125\nabove: 200");
    if (typeof slabs === "string") throw new Error(slabs);
    expect(professionalTax(1_000_000n, slabs)).toBe(0n);
    expect(professionalTax(2_000_000n, slabs)).toBe(12_500n);
    expect(professionalTax(9_000_000n, slabs)).toBe(20_000n);
    expect(formatPtSlabs(slabs)).toBe("13304: 0\n25000: 125\nabove: 200");
    expect(parsePtSlabs("25000: 125\n10000: 0")).toMatch(/go up/);
    expect(parsePtSlabs("above: 200\n25000: 1")).toMatch(/last/);
    expect(parsePtSlabs("lots")).toMatch(/write it like/);
  });
  it("checks UAN and ESI numbers", () => {
    expect(checkIdentifiers("100200300400", "1234567890")).toBeNull();
    expect(checkIdentifiers("12345", "")?.code).toBe("BAD_UAN");
    expect(checkIdentifiers("", "12")?.code).toBe("BAD_ESI");
  });
});

describe("wages from attendance", () => {
  it("pays days, half days, hours and approved overtime at twice the rate", () => {
    const rate = { rateType: "daily" as const, rateMinor: 80_000 };
    const result = attendanceWages(
      [
        {
          status: "Full Day",
          ...rate,
          regularHundredths: 800n,
          overtimeHundredths: 200n,
          overtimeApproved: true,
        },
        {
          status: "Half Day",
          ...rate,
          regularHundredths: 400n,
          overtimeHundredths: 0n,
          overtimeApproved: false,
        },
        {
          status: "Present-hours-based",
          ...rate,
          regularHundredths: 600n,
          overtimeHundredths: 0n,
          overtimeApproved: false,
        },
        {
          status: "Full Day",
          ...rate,
          regularHundredths: 800n,
          overtimeHundredths: 300n,
          overtimeApproved: false,
        },
        {
          status: "Absent",
          ...rate,
          regularHundredths: 0n,
          overtimeHundredths: 0n,
          overtimeApproved: false,
        },
        {
          status: "Full Day",
          rateType: null,
          rateMinor: null,
          regularHundredths: 800n,
          overtimeHundredths: 0n,
          overtimeApproved: false,
        },
      ],
      DEFAULT_RATES.overtimeMultiplierBps,
    );
    expect(result.daysHundredths).toBe(325n); // 1 + 0.5 + 0.75 + 1
    expect(result.basicMinor).toBe(80_000n + 40_000n + 60_000n + 80_000n);
    // ₹800/day = ₹100/hour; 2 approved hours × 2 = ₹400
    expect(result.overtimeMinor).toBe(40_000n);
    expect(result.overtimeHundredths).toBe(200n);
    expect(result.missingRate).toBe(1);
  });
});

describe("pay line", () => {
  it("works out a staff salary end to end", () => {
    const line = payrollLine(
      {
        ...base,
        basicMinor: 1_800_000n,
        hraMinor: 300_000n,
        otherAllowanceMinor: 0n,
        advanceMinor: 100_000n,
      },
      DEFAULT_RATES,
    );
    if ("code" in line) throw new Error(line.message);
    expect(line.grossMinor).toBe(2_100_000n);
    expect(line.pfEmployeeMinor).toBe(216_000n); // 12% of ₹18,000
    expect(line.esiEmployeeMinor).toBe(15_800n); // 0.75% of ₹21,000 = ₹157.50 → ₹158
    expect(line.netMinor).toBe(2_100_000n - 216_000n - 15_800n - 100_000n);
    expect(line.esiEmployerMinor).toBe(68_300n); // 3.25% = ₹682.50 → ₹683
    expect(line.costMinor).toBe(
      2_100_000n + line.employerEpfMinor + line.employerEpsMinor + line.edliAdminMinor + 68_300n,
    );
  });
  it("leaves out PF and ESI for non-members and refuses deductions above pay", () => {
    const line = payrollLine(
      { ...base, payType: "Daily", basicMinor: 1_500_000n, pfMember: false, esiMember: false },
      DEFAULT_RATES,
    );
    if ("code" in line) throw new Error(line.message);
    expect(line.totalDeductionMinor).toBe(0n);
    expect(line.netMinor).toBe(1_500_000n);
    const over = payrollLine(
      { ...base, basicMinor: 100_000n, advanceMinor: 200_000n },
      DEFAULT_RATES,
    );
    expect("code" in over && over.code).toBe("DEDUCTIONS_EXCEED_PAY");
    expect("code" in payrollLine({ ...base, tdsMinor: -1n }, DEFAULT_RATES)).toBe(true);
  });
  it("totals a run and the dues to deposit", () => {
    const a = payrollLine({ ...base, basicMinor: 1_800_000n, hraMinor: 300_000n }, DEFAULT_RATES);
    const b = payrollLine({ ...base, basicMinor: 2_000_000n, tdsMinor: 50_000n }, DEFAULT_RATES);
    if ("code" in a || "code" in b) throw new Error("line failed");
    const totals = runTotals([a, b]);
    expect(totals.grossMinor).toBe(4_100_000n);
    const dues = statutoryDues(totals);
    expect(dues.pfMinor).toBe(
      a.pfEmployeeMinor +
        a.employerEpfMinor +
        a.employerEpsMinor +
        a.edliAdminMinor +
        b.pfEmployeeMinor +
        b.employerEpfMinor +
        b.employerEpsMinor +
        b.edliAdminMinor,
    );
    expect(dues.esiMinor).toBe(
      a.esiEmployeeMinor + a.esiEmployerMinor + b.esiEmployeeMinor + b.esiEmployerMinor,
    );
    expect(dues.tdsMinor).toBe(50_000n);
  });
});
