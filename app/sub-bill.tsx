import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { RefreshControl, ScrollView, Text, View } from "react-native";
import { AuthGate } from "@/components/jp/auth-gate";
import { WO_TONE, commercialStyles as styles } from "@/components/jp/commercial-ui";
import { BillTotals } from "@/components/jp/sub-bill-totals";
import {
  AppHeader,
  Card,
  Field,
  InlineError,
  LoadingBlock,
  PrimaryButton,
  Screen,
  SecondaryButton,
  SectionHeader,
  StatusPill,
} from "@/components/jp/ui";
import { useColors } from "@/hooks/use-colors";
import { formatPercent, formatQuantity } from "@/lib/jp/billing-domain";
import { formatMinorAsRupees } from "@/lib/jp/finance-domain";
import { createClientMutationId } from "@/lib/jp/local-repository";
import { useT } from "@/lib/i18n";
import { trpc } from "@/lib/trpc";

/** One subcontractor RA bill: lines, measurements included, deductions, approval, payable. */
export default function SubcontractBillScreen() {
  const { t } = useT();
  const colors = useColors();
  const router = useRouter();
  const params = useLocalSearchParams<{ siteId?: string; id?: string }>();
  const siteId = typeof params.siteId === "string" ? params.siteId : "";
  const billId = typeof params.id === "string" ? params.id : "";
  const utils = trpc.useUtils();
  const detail = trpc.jp.subcontract.billDetail.useQuery(
    { siteId, billId },
    { enabled: Boolean(siteId && billId) },
  );
  const transition = trpc.jp.subcontract.billTransition.useMutation();
  const [reason, setReason] = useState("");
  const [actionKey, setActionKey] = useState(createClientMutationId);
  const [error, setError] = useState<string | null>(null);
  const data = detail.data;

  const act = async (action: "submit" | "approve" | "reject" | "cancel") => {
    setError(null);
    try {
      await transition.mutateAsync({
        siteId,
        billId,
        action,
        reason: reason.trim() || null,
        clientMutationId: actionKey,
      });
      setActionKey(createClientMutationId());
      setReason("");
      await Promise.all([utils.jp.subcontract.invalidate(), utils.jp.finance.invalidate()]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Not saved.");
    }
  };

  return (
    <AuthGate>
      <Screen>
        <ScrollView
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.content}
          refreshControl={
            <RefreshControl
              refreshing={detail.isRefetching}
              onRefresh={() => void detail.refetch()}
              tintColor={colors.primary}
            />
          }
        >
          {detail.isLoading ? (
            <LoadingBlock label="Loading bill…" />
          ) : !data ? (
            <>
              <AppHeader eyebrow={t("Subcontractor bill")} title={t("Not available")} />
              <InlineError
                message={detail.error?.message ?? "This bill could not be opened."}
                onRetry={() => void detail.refetch()}
              />
            </>
          ) : (
            <>
              <AppHeader
                eyebrow={t("Subcontractor bill")}
                title={data.bill.billNumber}
                subtitle={`${data.vendorName ?? ""} · ${data.order.title}`}
              />
              <Card>
                <StatusPill
                  label={t(data.bill.status)}
                  tone={WO_TONE[data.bill.status] ?? "info"}
                />
                <Text style={[styles.meta, { color: colors.muted }]}>
                  {t("Bill date {date} · measured up to {to}", {
                    date: String(data.bill.billDate),
                    to: String(data.bill.periodTo),
                  })}{" "}
                  · {t("Made by {name}", { name: data.createdByName ?? "—" })}
                  {data.bill.reviewReason ? ` · ${data.bill.reviewReason}` : ""}
                </Text>
                <Text
                  accessibilityRole="link"
                  onPress={() =>
                    router.push(`/work-order?siteId=${siteId}&id=${data.order.id}` as never)
                  }
                  style={[styles.link, { color: colors.primary }]}
                >
                  {t("Open work order {number}", { number: data.order.woNumber })}
                </Text>
              </Card>

              <SectionHeader title={t("Work done this bill")} />
              <Card>
                {data.lines.map((line) => (
                  <View key={line.id} style={{ paddingVertical: 4 }}>
                    <Text style={[styles.meta, { color: colors.foreground, fontWeight: "700" }]}>
                      {line.itemCode} · {line.description}
                    </Text>
                    <View style={styles.totalRow}>
                      <Text style={[styles.meta, { color: colors.muted }]}>
                        {formatQuantity(line.quantityThousandths)} {line.unit} ×{" "}
                        {formatMinorAsRupees(line.rateMinor)}
                      </Text>
                      <Text style={[styles.meta, { color: colors.foreground, fontWeight: "700" }]}>
                        {formatMinorAsRupees(line.amountMinor)}
                      </Text>
                    </View>
                  </View>
                ))}
                <BillTotals totals={data.bill} />
                <Text style={[styles.meta, { color: colors.muted }]}>
                  GST {formatPercent(data.order.gstBps)} · {t("Retention")}{" "}
                  {formatPercent(data.order.retentionBps)} · TDS {formatPercent(data.order.tdsBps)}
                  {data.bill.otherDeductionNote ? ` · ${data.bill.otherDeductionNote}` : ""}
                </Text>
              </Card>

              {data.invoice ? (
                <Card accent="success">
                  <Text style={[styles.title, { color: colors.foreground }]}>
                    {t("Payable {number} is in Finance", { number: data.invoice.invoiceNumber })}
                  </Text>
                  <Text style={[styles.meta, { color: colors.muted }]}>
                    {t(
                      "Accounts pays it from Finance → Payments. TDS is deposited by accounts separately.",
                    )}
                  </Text>
                </Card>
              ) : null}

              {data.can.submit || data.can.review || data.can.cancel ? (
                <Card>
                  <Field
                    label={t("Note / reason")}
                    value={reason}
                    onChangeText={setReason}
                    multiline
                  />
                  {data.can.submit ? (
                    <PrimaryButton
                      icon="send"
                      label={t("Submit for approval")}
                      loading={transition.isPending}
                      onPress={() => void act("submit")}
                    />
                  ) : null}
                  {data.can.review ? (
                    <>
                      <PrimaryButton
                        icon="check-circle"
                        label={t("Approve bill")}
                        loading={transition.isPending}
                        onPress={() => void act("approve")}
                      />
                      <SecondaryButton label={t("Reject")} onPress={() => void act("reject")} />
                    </>
                  ) : null}
                  {data.can.cancel ? (
                    <SecondaryButton
                      label={t("Cancel bill (frees its measurements)")}
                      onPress={() => void act("cancel")}
                    />
                  ) : null}
                </Card>
              ) : null}
              {error ? <InlineError message={error} /> : null}

              <SectionHeader
                title={t("Measurements in this bill")}
                caption={t("{count} entries", { count: data.measurements.length })}
              />
              {data.measurements.map((m) => (
                <Card key={m.id}>
                  <Text style={[styles.meta, { color: colors.foreground, fontWeight: "700" }]}>
                    {data.lines.find((line) => line.itemId === m.itemId)?.itemCode} · {m.location}
                  </Text>
                  <Text style={[styles.meta, { color: colors.muted }]}>
                    {String(m.measuredOn)} ·{" "}
                    {[m.nos, m.length, m.breadth, m.depth].filter(Boolean).join(" × ")} ={" "}
                    {formatQuantity(m.quantityThousandths)}
                    {m.deduction === "Yes" ? ` (${t("deduction")})` : ""}
                  </Text>
                </Card>
              ))}
            </>
          )}
        </ScrollView>
      </Screen>
    </AuthGate>
  );
}
