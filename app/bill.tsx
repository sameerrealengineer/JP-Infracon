import { useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { RefreshControl, ScrollView, Text, View } from "react-native";
import { AuthGate } from "@/components/jp/auth-gate";
import { BILL_TONE, TotalRow, commercialStyles as styles } from "@/components/jp/commercial-ui";
import {
  AppHeader,
  Card,
  ChipGroup,
  Field,
  InlineError,
  LoadingBlock,
  PrimaryButton,
  Screen,
  SecondaryButton,
  SectionHeader,
  StatusPill,
  formatDateTime,
} from "@/components/jp/ui";
import { useColors } from "@/hooks/use-colors";
import { formatPercent, formatQuantity } from "@/lib/jp/billing-domain";
import { formatMinorAsRupees } from "@/lib/jp/finance-domain";
import { createClientMutationId } from "@/lib/jp/local-repository";
import { useT } from "@/lib/i18n";
import { trpc } from "@/lib/trpc";

const MODES = ["Bank transfer", "Cheque", "UPI", "Cash", "Adjustment"] as const;

/** One RA bill: lines, GST and deductions, approval, and money received against it. */
export default function BillScreen() {
  const { t } = useT();
  const colors = useColors();
  const params = useLocalSearchParams<{ id?: string }>();
  const billId = typeof params.id === "string" ? params.id : "";
  const utils = trpc.useUtils();
  const detail = trpc.jp.billing.bills.detail.useQuery({ billId }, { enabled: Boolean(billId) });
  const transition = trpc.jp.billing.bills.transition.useMutation();
  const record = trpc.jp.billing.receipts.record.useMutation();
  const reverse = trpc.jp.billing.receipts.reverse.useMutation();
  const [actionKey, setActionKey] = useState(createClientMutationId);
  const [reason, setReason] = useState("");
  const [amount, setAmount] = useState("");
  const [receivedOn, setReceivedOn] = useState(() => new Date().toISOString().slice(0, 10));
  const [mode, setMode] = useState<(typeof MODES)[number]>("Bank transfer");
  const [reference, setReference] = useState("");
  const [receiptKey, setReceiptKey] = useState(createClientMutationId);
  const [error, setError] = useState<string | null>(null);
  const data = detail.data;

  const refresh = () => utils.jp.billing.invalidate();

  const act = async (action: "submit" | "approve" | "reject" | "cancel") => {
    setError(null);
    try {
      await transition.mutateAsync({
        billId,
        action,
        reason: reason.trim() || null,
        clientMutationId: actionKey,
      });
      setActionKey(createClientMutationId());
      setReason("");
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Not saved.");
    }
  };

  const saveReceipt = async () => {
    setError(null);
    try {
      await record.mutateAsync({
        billId,
        amountRupees: amount.trim(),
        receivedOn,
        mode,
        reference: reference.trim() || null,
        clientMutationId: receiptKey,
      });
      setReceiptKey(createClientMutationId());
      setAmount("");
      setReference("");
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Not saved.");
    }
  };

  const undoReceipt = async (receiptId: string) => {
    if (!reason.trim()) {
      setError(t("Write the reason in the note box first."));
      return;
    }
    setError(null);
    try {
      await reverse.mutateAsync({
        receiptId,
        reason: reason.trim(),
        clientMutationId: createClientMutationId(),
      });
      setReason("");
      await refresh();
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
              <AppHeader eyebrow={t("RA bill")} title={t("Not available")} />
              <InlineError
                message={detail.error?.message ?? "This bill could not be opened."}
                onRetry={() => void detail.refetch()}
              />
            </>
          ) : (
            <>
              <AppHeader
                eyebrow={data.projectName}
                title={data.bill.billNumber}
                subtitle={`${data.client?.name ?? ""} · ${String(data.bill.billDate)}${
                  data.bill.periodFrom
                    ? ` · ${t("work")} ${String(data.bill.periodFrom)} → ${String(data.bill.periodTo ?? "")}`
                    : ""
                }`}
              />
              <Card>
                <View style={styles.row}>
                  <StatusPill
                    label={t(data.bill.status)}
                    tone={BILL_TONE[data.bill.status] ?? "info"}
                  />
                  {data.payment ? (
                    <StatusPill
                      label={t(data.payment.paymentStatus)}
                      tone={BILL_TONE[data.payment.paymentStatus] ?? "info"}
                    />
                  ) : null}
                </View>
                <Text style={[styles.meta, { color: colors.muted }]}>
                  {t("Made by {name}", { name: data.createdByName ?? "—" })}
                  {data.bill.reviewReason ? ` · ${data.bill.reviewReason}` : ""}
                </Text>
              </Card>

              <SectionHeader title={t("Work billed")} />
              <Card>
                {data.lines.map((line) => (
                  <View key={line.id} style={{ paddingVertical: 5 }}>
                    <Text style={[styles.meta, { color: colors.foreground, fontWeight: "700" }]}>
                      {line.description}
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
                <TotalRow
                  label={t("Work value")}
                  value={formatMinorAsRupees(data.bill.workValueMinor)}
                />
                <TotalRow
                  label={`GST ${formatPercent(data.bill.gstBps)}`}
                  value={formatMinorAsRupees(data.bill.gstMinor)}
                />
                <TotalRow
                  label={`${t("Retention")} ${formatPercent(data.bill.retentionBps)}`}
                  value={`− ${formatMinorAsRupees(data.bill.retentionMinor)}`}
                />
                <TotalRow
                  label={`TDS ${formatPercent(data.bill.tdsBps)}`}
                  value={`− ${formatMinorAsRupees(data.bill.tdsMinor)}`}
                />
                {data.bill.otherDeductionMinor !== "0" ? (
                  <TotalRow
                    label={data.bill.otherDeductionNote || t("Other deduction")}
                    value={`− ${formatMinorAsRupees(data.bill.otherDeductionMinor)}`}
                  />
                ) : null}
                <TotalRow
                  label={t("Net receivable")}
                  value={formatMinorAsRupees(data.bill.netReceivableMinor)}
                  strong
                />
                {data.payment ? (
                  <>
                    <TotalRow
                      label={t("Received")}
                      value={formatMinorAsRupees(data.payment.receivedMinor)}
                    />
                    <TotalRow
                      label={t("Outstanding")}
                      value={formatMinorAsRupees(data.payment.outstandingMinor)}
                      strong
                    />
                  </>
                ) : null}
              </Card>

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
                    <SecondaryButton label={t("Cancel bill")} onPress={() => void act("cancel")} />
                  ) : null}
                </Card>
              ) : data.bill.status === "Submitted" ? (
                <Text style={[styles.meta, { color: colors.muted, textAlign: "center" }]}>
                  {t("Waiting for approval by a director or owner (not the person who made it).")}
                </Text>
              ) : null}

              {data.bill.status === "Approved" ? (
                <>
                  <SectionHeader title={t("Money received")} />
                  {data.can.receipt && data.payment && data.payment.outstandingMinor !== "0" ? (
                    <Card>
                      <Field
                        label={t("Amount ₹")}
                        value={amount}
                        onChangeText={setAmount}
                        keyboardType="decimal-pad"
                      />
                      <Field
                        label={t("Received on (YYYY-MM-DD)")}
                        value={receivedOn}
                        onChangeText={setReceivedOn}
                      />
                      <ChipGroup
                        options={MODES}
                        value={mode}
                        onChange={setMode}
                        format={(v) => t(v)}
                      />
                      <Field
                        label={t("UTR / cheque no.")}
                        value={reference}
                        onChangeText={setReference}
                      />
                      <PrimaryButton
                        icon="payments"
                        label={t("Record receipt")}
                        loading={record.isPending}
                        disabled={!amount.trim()}
                        onPress={() => void saveReceipt()}
                      />
                    </Card>
                  ) : null}
                  {data.receipts.map((receipt) => (
                    <Card
                      key={receipt.id}
                      accent={receipt.status === "Recorded" ? "success" : "warning"}
                    >
                      <View style={styles.row}>
                        <Text style={[styles.money, { color: colors.foreground }]}>
                          {formatMinorAsRupees(receipt.amountMinor)}
                        </Text>
                        <StatusPill
                          label={t(receipt.status)}
                          tone={receipt.status === "Recorded" ? "success" : "warning"}
                          compact
                        />
                      </View>
                      <Text style={[styles.meta, { color: colors.muted }]}>
                        {String(receipt.receivedOn)} · {t(receipt.mode)}
                        {receipt.reference ? ` · ${receipt.reference}` : ""} ·{" "}
                        {receipt.byName ?? "—"} · {formatDateTime(receipt.createdAt)}
                      </Text>
                      {receipt.reversalReason ? (
                        <Text style={[styles.meta, { color: colors.error }]}>
                          {receipt.reversalReason}
                        </Text>
                      ) : null}
                      {data.can.receipt && receipt.status === "Recorded" ? (
                        <Text
                          accessibilityRole="button"
                          onPress={() => void undoReceipt(receipt.id)}
                          style={[styles.link, { color: colors.error }]}
                        >
                          {t("Reverse (cheque bounced / wrong entry)")}
                        </Text>
                      ) : null}
                    </Card>
                  ))}
                  {data.can.receipt && data.receipts.some((r) => r.status === "Recorded") ? (
                    <Field
                      label={t("Reason for reversing")}
                      value={reason}
                      onChangeText={setReason}
                    />
                  ) : null}
                </>
              ) : null}
              {error ? <InlineError message={error} /> : null}
              <Text style={[styles.meta, { color: colors.muted, textAlign: "center" }]}>
                {t("Receipts are ledger entries; no money moves through this app.")}
              </Text>
            </>
          )}
        </ScrollView>
      </Screen>
    </AuthGate>
  );
}
