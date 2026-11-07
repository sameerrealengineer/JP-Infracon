import { describe, expect, it } from "vitest";
import { buildPayslipsHtml, type PayslipLine } from "./payslip";

const line: PayslipLine = {
  name: "Ramesh <script>",
  trade: "Mason",
  payType: "Monthly",
  uan: "100200300400",
  esiNumber: null,
  workedDaysHundredths: 2600,
  paidDaysHundredths: 3000,
  overtimeHundredths: 0,
  basicMinor: "1800000",
  hraMinor: "300000",
  otherAllowanceMinor: "0",
  overtimeMinor: "0",
  grossMinor: "2100000",
  pfEmployeeMinor: "216000",
  esiEmployeeMinor: "15800",
  ptMinor: "0",
  tdsMinor: "0",
  advanceMinor: "100000",
  otherDeductionMinor: "0",
  netMinor: "1768200",
  employerEpfMinor: "66100",
  employerEpsMinor: "149900",
  esiEmployerMinor: "68300",
};

describe("payslip", () => {
  it("shows earnings, deductions and net, and escapes names", () => {
    const html = buildPayslipsHtml(
      {
        runNumber: "PR-PATIA-A-202610",
        month: "2026-10",
        siteName: "Patia",
        status: "Paid",
        paidOn: "2026-11-03",
      },
      [line],
    );
    expect(html).toContain("Ramesh &lt;script&gt;");
    expect(html).not.toContain("<script>");
    expect(html).toContain("HRA");
    expect(html).toContain("PF (employee)");
    expect(html).toContain("Advance recovery");
    expect(html).not.toContain("Professional tax");
    expect(html).toContain("UAN 100200300400");
    expect(html).toContain("Paid 30");
    expect(html).toMatch(/Net pay ₹17,682\.00/);
    expect(html).toContain("Paid on 2026-11-03");
  });
});
