import { TotalRow } from "@/components/jp/commercial-ui";
import { formatMinorAsRupees } from "@/lib/jp/finance-domain";
import { useT } from "@/lib/i18n";

/** RA bill amounts: work, GST, each deduction, net payable. */
export function BillTotals({
  totals,
}: {
  totals: {
    workValueMinor: string;
    gstMinor: string;
    retentionMinor: string;
    tdsMinor: string;
    advanceRecoveryMinor: string;
    otherDeductionMinor: string;
    netPayableMinor: string;
  };
}) {
  const { t } = useT();
  return (
    <>
      <TotalRow label={t("Work done")} value={formatMinorAsRupees(totals.workValueMinor)} />
      <TotalRow label="+ GST" value={formatMinorAsRupees(totals.gstMinor)} />
      <TotalRow label={`− ${t("Retention")}`} value={formatMinorAsRupees(totals.retentionMinor)} />
      <TotalRow label="− TDS" value={formatMinorAsRupees(totals.tdsMinor)} />
      {totals.advanceRecoveryMinor !== "0" ? (
        <TotalRow
          label={`− ${t("Advance recovery")}`}
          value={formatMinorAsRupees(totals.advanceRecoveryMinor)}
        />
      ) : null}
      {totals.otherDeductionMinor !== "0" ? (
        <TotalRow
          label={`− ${t("Other deduction")}`}
          value={formatMinorAsRupees(totals.otherDeductionMinor)}
        />
      ) : null}
      <TotalRow
        label={t("Net payable")}
        value={formatMinorAsRupees(totals.netPayableMinor)}
        strong
      />
    </>
  );
}
