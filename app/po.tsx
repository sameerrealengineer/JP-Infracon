import { useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { RefreshControl, ScrollView, Text, View } from "react-native";
import { AuthGate } from "@/components/jp/auth-gate";
import { PO_TONE, TotalRow, commercialStyles as styles } from "@/components/jp/commercial-ui";
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
  formatDateTime,
} from "@/components/jp/ui";
import { useColors } from "@/hooks/use-colors";
import { formatPercent, formatQuantity } from "@/lib/jp/billing-domain";
import { formatMinorAsRupees } from "@/lib/jp/finance-domain";
import { createClientMutationId } from "@/lib/jp/local-repository";
import { useT } from "@/lib/i18n";
import { trpc } from "@/lib/trpc";

/** One purchase order: items, quotes compared, approval, goods receipts and bill matching. */
export default function PurchaseOrderScreen() {
  const { t } = useT();
  const colors = useColors();
  const params = useLocalSearchParams<{ siteId?: string; id?: string }>();
  const siteId = typeof params.siteId === "string" ? params.siteId : "";
  const poId = typeof params.id === "string" ? params.id : "";
  const utils = trpc.useUtils();
  const detail = trpc.jp.purchase.detail.useQuery(
    { siteId, poId },
    { enabled: Boolean(siteId && poId) },
  );
  const transition = trpc.jp.purchase.transition.useMutation();
  const receive = trpc.jp.purchase.receive.useMutation();
  const linkBill = trpc.jp.purchase.linkBill.useMutation();
  const data = detail.data;
  const bills = trpc.jp.purchase.linkableBills.useQuery(
    { siteId, poId },
    { enabled: Boolean(data?.can.linkBill) },
  );
  const [reason, setReason] = useState("");
  const [actionKey, setActionKey] = useState(createClientMutationId);
  const [grnKey, setGrnKey] = useState(createClientMutationId);
  const [receiving, setReceiving] = useState(false);
  const [receivedOn, setReceivedOn] = useState(() => new Date().toISOString().slice(0, 10));
  const [challan, setChallan] = useState("");
  const [vehicle, setVehicle] = useState("");
  const [entries, setEntries] = useState<
    Record<string, { accepted: string; rejected: string; reason: string }>
  >({});
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = () => utils.jp.purchase.invalidate();

  const act = async (action: "submit" | "approve" | "reject" | "cancel" | "close") => {
    setError(null);
    try {
      await transition.mutateAsync({
        siteId,
        poId,
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
      const result = await receive.mutateAsync({
        siteId,
        poId,
        receivedOn,
        challanNumber: challan.trim() || null,
        vehicleNumber: vehicle.trim() || null,
        lines: Object.entries(entries).map(([poLineId, entry]) => ({
          poLineId,
          accepted: entry.accepted.trim() || "0",
          rejected: entry.rejected.trim() || "0",
          rejectReason: entry.reason.trim() || null,
        })),
        clientMutationId: grnKey,
      });
      setGrnKey(createClientMutationId());
      setEntries({});
      setReceiving(false);
      setMessage(
        result.stockEntries
          ? t("{grn} saved. {count} stock entries sent to Inventory for review.", {
              grn: result.grnNumber,
              count: result.stockEntries,
            })
          : t("{grn} saved.", { grn: result.grnNumber }),
      );
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Not saved.");
    }
  };

  const match = async (invoiceId: string) => {
    setError(null);
    try {
      await linkBill.mutateAsync({ siteId, poId, invoiceId });
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Not saved.");
    }
  };

  const setEntry = (
    lineId: string,
    change: Partial<{ accepted: string; rejected: string; reason: string }>,
  ) =>
    setEntries((prev) => ({
      ...prev,
      [lineId]: { ...(prev[lineId] ?? { accepted: "", rejected: "", reason: "" }), ...change },
    }));

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
            <LoadingBlock label="Loading order…" />
          ) : !data ? (
            <>
              <AppHeader eyebrow={t("Purchase order")} title={t("Not available")} />
              <InlineError
                message={detail.error?.message ?? "This order could not be opened."}
                onRetry={() => void detail.refetch()}
              />
            </>
          ) : (
            <>
              <AppHeader
                eyebrow={t("Purchase order")}
                title={data.order.poNumber}
                subtitle={`${data.vendor?.legalName ?? ""} · ${String(data.order.orderDate)}${
                  data.order.expectedDate
                    ? ` · ${t("delivery by")} ${String(data.order.expectedDate)}`
                    : ""
                }`}
              />
              <Card>
                <View style={styles.row}>
                  <StatusPill
                    label={t(data.order.status)}
                    tone={PO_TONE[data.order.status] ?? "info"}
                  />
                  {["Approved", "Closed"].includes(data.order.status) ? (
                    <StatusPill label={t(data.receipt)} tone={PO_TONE[data.receipt] ?? "info"} />
                  ) : null}
                </View>
                <Text style={[styles.meta, { color: colors.muted }]}>
                  {t("Made by {name}", { name: data.createdByName ?? "—" })}
                  {data.order.reviewReason ? ` · ${data.order.reviewReason}` : ""}
                </Text>
              </Card>

              <SectionHeader title={t("Items")} />
              <Card>
                {data.lines.map((line) => (
                  <View key={line.id} style={{ paddingVertical: 5 }}>
                    <Text style={[styles.meta, { color: colors.foreground, fontWeight: "700" }]}>
                      {line.description}
                    </Text>
                    <View style={styles.totalRow}>
                      <Text style={[styles.meta, { color: colors.muted }]}>
                        {formatQuantity(line.quantityThousandths)} {line.unitCode} ×{" "}
                        {formatMinorAsRupees(line.rateMinor)} · GST {formatPercent(line.gstBps)}
                      </Text>
                      <Text style={[styles.meta, { color: colors.foreground, fontWeight: "700" }]}>
                        {formatMinorAsRupees(line.amountMinor)}
                      </Text>
                    </View>
                    {["Approved", "Closed"].includes(data.order.status) ? (
                      <Text style={[styles.meta, { color: colors.muted, marginTop: 0 }]}>
                        {t("Received {done} of {total}", {
                          done: formatQuantity(line.receivedThousandths),
                          total: formatQuantity(line.quantityThousandths),
                        })}
                      </Text>
                    ) : null}
                  </View>
                ))}
                <TotalRow
                  label={t("Subtotal")}
                  value={formatMinorAsRupees(data.order.subtotalMinor)}
                />
                <TotalRow label="GST" value={formatMinorAsRupees(data.order.gstMinor)} />
                <TotalRow
                  label={t("Total")}
                  value={formatMinorAsRupees(data.order.totalMinor)}
                  strong
                />
              </Card>

              {data.quotes.length ? (
                <>
                  <SectionHeader title={t("Quotes compared")} />
                  <Card>
                    {data.quotes.map((quote) => (
                      <View key={quote.id} style={styles.totalRow}>
                        <Text
                          style={[
                            styles.meta,
                            {
                              color: colors.foreground,
                              fontWeight: quote.chosen === "Yes" ? "800" : "400",
                            },
                          ]}
                        >
                          {quote.vendorName}
                          {quote.chosen === "Yes" ? ` · ${t("chosen")}` : ""}
                          {quote.lowest ? ` · ${t("lowest")}` : ""}
                          {quote.deliveryDays ? ` · ${quote.deliveryDays} ${t("days")}` : ""}
                        </Text>
                        <Text
                          style={[
                            styles.meta,
                            {
                              color: quote.lowest ? colors.success : colors.foreground,
                              fontWeight: "700",
                            },
                          ]}
                        >
                          {formatMinorAsRupees(quote.totalMinor)}
                        </Text>
                      </View>
                    ))}
                  </Card>
                </>
              ) : null}

              {data.can.submit || data.can.review || data.can.cancel || data.can.close ? (
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
                        label={t("Approve order")}
                        loading={transition.isPending}
                        onPress={() => void act("approve")}
                      />
                      <SecondaryButton label={t("Reject")} onPress={() => void act("reject")} />
                    </>
                  ) : null}
                  {data.can.close ? (
                    <SecondaryButton
                      label={t("Close order (no more deliveries)")}
                      onPress={() => void act("close")}
                    />
                  ) : null}
                  {data.can.cancel ? (
                    <SecondaryButton label={t("Cancel order")} onPress={() => void act("cancel")} />
                  ) : null}
                </Card>
              ) : null}

              {data.order.status === "Approved" || data.receipts.length ? (
                <SectionHeader
                  title={t("Goods received (GRN)")}
                  action={data.can.receive && !receiving ? t("Receive goods") : undefined}
                  onPress={() => setReceiving(true)}
                />
              ) : null}
              {receiving ? (
                <Card>
                  <Field label={t("Received on")} value={receivedOn} onChangeText={setReceivedOn} />
                  <View style={styles.row}>
                    <View style={{ flex: 1 }}>
                      <Field label={t("Challan no.")} value={challan} onChangeText={setChallan} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Field
                        label={t("Vehicle no.")}
                        value={vehicle}
                        onChangeText={setVehicle}
                        autoCapitalize="characters"
                      />
                    </View>
                  </View>
                  {data.lines.map((line) => {
                    const entry = entries[line.id] ?? { accepted: "", rejected: "", reason: "" };
                    const due = BigInt(line.quantityThousandths) - BigInt(line.receivedThousandths);
                    if (due <= 0n) return null;
                    return (
                      <View key={line.id} style={{ marginTop: 8 }}>
                        <Text
                          style={[styles.meta, { color: colors.foreground, fontWeight: "700" }]}
                        >
                          {line.description} · {t("due")} {formatQuantity(due)} {line.unitCode}
                        </Text>
                        <View style={styles.row}>
                          <View style={{ flex: 1 }}>
                            <Field
                              label={`${t("Accepted")} (${line.unitCode})`}
                              value={entry.accepted}
                              onChangeText={(v) => setEntry(line.id, { accepted: v })}
                              keyboardType="decimal-pad"
                            />
                          </View>
                          <View style={{ flex: 1 }}>
                            <Field
                              label={`${t("Rejected")} (${line.unitCode})`}
                              value={entry.rejected}
                              onChangeText={(v) => setEntry(line.id, { rejected: v })}
                              keyboardType="decimal-pad"
                            />
                          </View>
                        </View>
                        {entry.rejected.trim() && entry.rejected.trim() !== "0" ? (
                          <Field
                            label={t("Why rejected")}
                            value={entry.reason}
                            onChangeText={(v) => setEntry(line.id, { reason: v })}
                          />
                        ) : null}
                      </View>
                    );
                  })}
                  <PrimaryButton
                    icon="inventory"
                    label={t("Save goods receipt")}
                    loading={receive.isPending}
                    onPress={() => void saveReceipt()}
                  />
                  <Text
                    accessibilityRole="button"
                    onPress={() => setReceiving(false)}
                    style={styles.cancel}
                  >
                    {t("Cancel")}
                  </Text>
                </Card>
              ) : null}
              {message ? (
                <Text style={[styles.meta, { color: colors.success }]}>{message}</Text>
              ) : null}
              {data.receipts.map((grn) => (
                <Card key={grn.id}>
                  <Text style={[styles.title, { color: colors.foreground }]}>{grn.grnNumber}</Text>
                  <Text style={[styles.meta, { color: colors.muted }]}>
                    {String(grn.receivedOn)}
                    {grn.challanNumber ? ` · ${t("challan")} ${grn.challanNumber}` : ""}
                    {grn.vehicleNumber ? ` · ${grn.vehicleNumber}` : ""} · {grn.byName ?? "—"} ·{" "}
                    {formatDateTime(grn.createdAt)}
                  </Text>
                  {grn.lines.map((line) => {
                    const poLine = data.lines.find((row) => row.id === line.purchaseOrderLineId);
                    return (
                      <Text key={line.id} style={[styles.meta, { color: colors.foreground }]}>
                        {poLine?.description}: {t("accepted")}{" "}
                        {formatQuantity(line.acceptedThousandths)}
                        {line.rejectedThousandths !== "0"
                          ? ` · ${t("rejected")} ${formatQuantity(line.rejectedThousandths)} (${line.rejectReason})`
                          : ""}
                      </Text>
                    );
                  })}
                </Card>
              ))}

              {["Approved", "Closed"].includes(data.order.status) ? (
                <>
                  <SectionHeader title={t("Bill matching")} />
                  <Card accent={PO_TONE[data.match.state] ?? "info"}>
                    <StatusPill
                      label={t(data.match.state)}
                      tone={PO_TONE[data.match.state] ?? "info"}
                    />
                    <TotalRow
                      label={t("Value received (PO rates + GST)")}
                      value={formatMinorAsRupees(data.match.receivedValueMinor)}
                    />
                    <TotalRow
                      label={t("Billed by supplier")}
                      value={formatMinorAsRupees(data.match.billedMinor)}
                    />
                    <TotalRow
                      label={t("Difference")}
                      value={formatMinorAsRupees(data.match.differenceMinor)}
                      strong
                    />
                    {data.bills.map((bill) => (
                      <Text key={bill.invoiceId} style={[styles.meta, { color: colors.muted }]}>
                        {bill.invoiceNumber} · {String(bill.invoiceDate)} ·{" "}
                        {formatMinorAsRupees(bill.totalMinor)} · {t(bill.status)}
                      </Text>
                    ))}
                    {data.can.linkBill && (bills.data?.length ?? 0) > 0 ? (
                      <>
                        <Text style={[styles.meta, { color: colors.foreground, marginTop: 10 }]}>
                          {t("Match a bill from this supplier:")}
                        </Text>
                        {bills.data?.map((bill) => (
                          <SecondaryButton
                            key={bill.id}
                            label={`${bill.invoiceNumber} · ${formatMinorAsRupees(bill.totalMinor)}`}
                            onPress={() => void match(bill.id)}
                          />
                        ))}
                      </>
                    ) : null}
                  </Card>
                </>
              ) : null}
              {error ? <InlineError message={error} /> : null}
            </>
          )}
        </ScrollView>
      </Screen>
    </AuthGate>
  );
}
