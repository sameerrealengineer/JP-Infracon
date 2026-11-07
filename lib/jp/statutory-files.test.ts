import { describe, expect, it } from "vitest";
import { buildEcr, buildEsicCsv, wholeRupees, type FileLine } from "./statutory-files";

const base: FileLine = {
  name: "Anil Mohanty",
  uan: "100200300402",
  esiNumber: null,
  payType: "Monthly",
  workedDaysHundredths: 0,
  paidDaysHundredths: 2950,
  grossMinor: "2200050",
  pfWageMinor: "1800000",
  pfEmployeeMinor: "216000",
  employerEpsMinor: "149900",
  employerEpfMinor: "66100",
  esiEmployeeMinor: "0",
};

describe("ECR and ESIC files", () => {
  it("rounds to whole rupees half up", () => {
    expect(wholeRupees("2200050")).toBe("22001");
    expect(wholeRupees("2200049")).toBe("22000");
  });

  it("writes ECR 2.0 lines with 11 fields and NCP days; skips people without UAN", () => {
    const ecr = buildEcr(
      [
        base,
        {
          ...base,
          name: "Ramesh #~# Behera",
          uan: "100200300401",
          payType: "Daily",
          workedDaysHundredths: 550,
          paidDaysHundredths: 550,
          grossMinor: "467500",
          pfWageMinor: "425000",
          pfEmployeeMinor: "51000",
          employerEpsMinor: "35400",
          employerEpfMinor: "15600",
        },
        { ...base, name: "No Uan", uan: null },
        { ...base, name: "Not a member", pfWageMinor: "0", pfEmployeeMinor: "0" },
      ],
      31,
      2_500_000n,
    );
    const lines = ecr.text.trim().split("\n");
    expect(lines).toEqual([
      "100200300402#~#ANIL MOHANTY#~#22001#~#18000#~#18000#~#18000#~#2160#~#1499#~#661#~#2#~#0",
      "100200300401#~#RAMESH BEHERA#~#4675#~#4250#~#4250#~#4250#~#510#~#354#~#156#~#26#~#0",
    ]);
    expect(lines[0].split("#~#")).toHaveLength(11);
    expect(ecr.skipped).toEqual([{ name: "No Uan", reason: "No UAN" }]);
  });

  it("caps EPS wages at the EPS ceiling", () => {
    const ecr = buildEcr([{ ...base, pfWageMinor: "2500000" }], 30, 1_500_000n);
    expect(ecr.text.split("#~#")[4]).toBe("15000");
  });

  it("writes the ESIC columns, days rounded up, skipping people without an IP number", () => {
    const esic = buildEsicCsv([
      {
        ...base,
        name: "Sunita Nayak",
        esiNumber: "1234567890",
        payType: "Daily",
        workedDaysHundredths: 550,
        grossMinor: "302500",
        esiEmployeeMinor: "2300",
      },
      { ...base, name: "No IP", esiEmployeeMinor: "100" },
      base,
    ]);
    const rows = esic.text.trim().split("\r\n");
    expect(rows[0]).toMatch(/^IP Number,IP Name,/);
    expect(rows[1]).toBe("1234567890,SUNITA NAYAK,6,3025,,");
    expect(esic.count).toBe(1);
    expect(esic.skipped).toEqual([{ name: "No IP", reason: "No ESI IP number" }]);
  });
});
