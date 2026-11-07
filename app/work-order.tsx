import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { RefreshControl, ScrollView, Text, View } from "react-native";
import { AuthGate } from "@/components/jp/auth-gate";
import { BillTotals } from "@/components/jp/sub-bill-totals";
import { TotalRow, WO_TONE, commercialStyles as styles } from "@/components/jp/commercial-ui";
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
} from "@/components/jp/ui";
import { useColors } from "@/hooks/use-colors";
import { formatPercent, formatQuantity } from "@/lib/jp/billing-domain";
import { formatMinorAsRupees } from "@/lib/jp/finance-domain";
import { createClientMutationId } from "@/lib/jp/local-repository";
import { measuredQuantity } from "@/lib/jp/subcontract-domain";
import { useT } from "@/lib/i18n";
import { trpc } from "@/lib/trpc";

const todayText = () => new Date().toISOString().slice(0, 10);
type WoAction = "submit" | "approve" | "reject" | "cancel" | "close";

/**
 * One work order: value and progress, items, approval, the measurement book (record, check,
 * reject) and RA bills made from checked measurements.
 */
export default function WorkOrderScreen() {
  const { t } = useT();
  const colors = useColors();
  const router = useRouter();
  const params = useLocalSearchParams<{ siteId?: string; id?: string }>();
  const siteId = typeof params.siteId === "string" ? params.siteId : "";
  const woId = typeof params.id === "string" ? params.id : "";
  const utils = trpc.useUtils();
  const detail = trpc.jp.subcontract.detail.useQuery(
    { siteId, woId },
    { enabled: Boolean(siteId && woId) },
  );
  const transition = trpc.jp.subcontract.transition.useMutation();
  const measure = trpc.jp.subcontract.measure.useMutation();
  const check = trpc.jp.subcontract.checkMeasurement.useMutation();
  const createBill = trpc.jp.subcontract.createBill.useMutation();
  const release = trpc.jp.subcontract.releaseRetention.useMutation();
  const data = detail.data;

  const [reason, setReason] = useState("");
  const [actionKey, setActionKey] = useState(createClientMutationId);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  // Measurement form.
  const [measuring, setMeasuring] = useState(false);
  const [mbKey, setMbKey] = useState(createClientMutationId);
  const [itemId, setItemId] = useState<string | null>(null);
  const [measuredOn, setMeasuredOn] = useState(todayText);
  const [location, setLocation] = useState("");
  const [nos, setNos] = useState("");
  const [length, setLength] = useState("");
  const [breadth, setBreadth] = useState("");
  const [depth, setDepth] = useState("");
  const [kind, setKind] = useState<"Add" | "Deduct">("Add");
  const [rejectReason, setRejectReason] = useState("");

  // Bill form.
  const [billing, setBilling] = useState(false);
  const [billKey, setBillKey] = useState(createClientMutationId);
  const [periodTo, setPeriodTo] = useState(todayText);
  const [billDate, setBillDate] = useState(todayText);
  const [otherRupees, setOtherRupees] = useState("");
  const [otherNote, setOtherNote] = useState("");
  const preview = trpc.jp.subcontract.billPreview.useQuery(
    { siteId, woId, periodTo, otherDeductionRupees: otherRupees.trim() || null },
    { enabled: billing && /^\d{4}-\d{2}-\d{2}$/.test(periodTo) },
  );

  const size = measuredQuantity({ nos, length, breadth, depth });
  const refresh = () => utils.jp.subcontract.invalidate();
  const fail = (cause: unknown) => setError(cause instanceof Error ? cause.message : "Not saved.");

  const act = async (action: WoAction) => {
    setError(null);
    try {
      await transition.mutateAsync({
        siteId,
        woId,
        action,
        reason: reason.trim() || null,
        clientMutationId: actionKey,
      });
      setActionKey(createClientMutationId());
      setReason("");
      await refresh();
    } catch (cause) {
      fail(cause);
    }
  };

  const saveMeasurement = async () => {
    if (!itemId) return;
    setError(null);
    try {
      const result = await measure.mutateAsync({
        siteId,
        woId,
        itemId,
        measuredOn,
        location: location.trim(),
        nos: nos.trim() || null,
        length: length.trim() || null,
        breadth: breadth.trim() || null,
        depth: depth.trim() || null,
        deduction: kind === "Deduct",
        clientMutationId: mbKey,
      });
      setMbKey(createClientMutationId());
      setLocation("");
      setNos("");
      setLength("");
      setBreadth("");
      setDepth("");
      setKind("Add");
      setMessage(
        t("Measured {qty}. It now waits to be checked by another person.", {
          qty: formatQuantity(result.quantityThousandths),
        }),
      );
      await refresh();
    } catch (cause) {
      fail(cause);
    }
  };

  const review = async (ids: string[], action: "check" | "reject") => {
    setError(null);
    try {
      await check.mutateAsync({
        siteId,
        measurementIds: ids,
        action,
        reason: action === "reject" ? rejectReason.trim() || null : null,
        clientMutationId: createClientMutationId(),
      });
      setRejectReason("");
      await refresh();
    } catch (cause) {
      fail(cause);
    }
  };

  const saveBill = async () => {
    setError(null);
    try {
      const result = await createBill.mutateAsync({
        siteId,
        woId,
        billDate,
        periodTo,
        otherDeductionRupees: otherRupees.trim() || null,
        otherDeductionNote: otherNote.trim() || null,
        submit: true,
        clientMutationId: billKey,
      });
      setBillKey(createClientMutationId());
      setBilling(false);
      await refresh();
      router.push(`/sub-bill?siteId=${siteId}&id=${result.id}` as never);
    } catch (cause) {
      fail(cause);
    }
  };

  const releaseRetention = async () => {
    setError(null);
    try {
      const result = await release.mutateAsync({
        siteId,
        woId,
        reason: reason.trim(),
        clientMutationId: actionKey,
      });
      setActionKey(createClientMutationId());
      setReason("");
      setMessage(
        t("Retention {amount} released; accounts can now pay it from Finance.", {
          amount: formatMinorAsRupees(result.amountMinor ?? "0"),
        }),
      );
      await refresh();
    } catch (cause) {
      fail(cause);
    }
  };

  const itemName = (id: string) => {
    const item = data?.items.find((row) => row.id === id);
    return item ? `${item.itemCode} ${item.description}` : "";
  };
  const checkable = data?.measurements.filter((m) => m.canCheck) ?? [];
  const showActions =
    data &&
    (data.can.submit ||
      data.can.review ||
      data.can.cancel ||
      data.can.close ||
      data.can.releaseRetention);

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
            <LoadingBlock label="Loading work order…" />
          ) : !data ? (
            <>
              <AppHeader eyebrow={t("Work order")} title={t("Not available")} />
              <InlineError
                message={detail.error?.message ?? "This work order could not be opened."}
                onRetry={() => void detail.refetch()}
              />
            </>
          ) : (
            <>
              <AppHeader
                eyebrow={t("Work order")}
                title={data.order.woNumber}
                subtitle={`${data.order.title} · ${data.vendor?.legalName ?? ""}`}
              />
              <Card>
                <StatusPill
                  label={t(data.order.status)}
                  tone={WO_TONE[data.order.status] ?? "info"}
                />
                <Text style={[styles.meta, { color: colors.muted }]}>
                  {String(data.order.startDate)}
                  {data.order.endDate ? ` → ${String(data.order.endDate)}` : ""} ·{" "}
                  {t("Made by {name}", { name: data.createdByName ?? "—" })}
                  {data.order.reviewReason ? ` · ${data.order.reviewReason}` : ""}
                </Text>
                {data.order.scope ? (
                  <Text style={[styles.meta, { color: colors.foreground }]}>
                    {data.order.scope}
                  </Text>
                ) : null}
                <Text style={[styles.meta, { color: colors.muted }]}>
                  GST {formatPercent(data.order.gstBps)} · {t("Retention")}{" "}
                  {formatPercent(data.order.retentionBps)} · TDS {formatPercent(data.order.tdsBps)}
                  {data.order.advanceMinor !== "0"
                    ? ` · ${t("Advance")} ${formatMinorAsRupees(data.order.advanceMinor)} (${t("recover {pct} per bill", { pct: formatPercent(data.order.advanceRecoveryBps) })})`
                    : ""}
                </Text>
              </Card>

              <Card>
                <TotalRow
                  label={t("Work order value")}
                  value={formatMinorAsRupees(data.position.valueMinor)}
                  strong
                />
                <TotalRow
                  label={t("Work measured ({pct})", {
                    pct: formatPercent(data.position.progressBps),
                  })}
                  value={formatMinorAsRupees(data.position.measuredValueMinor)}
                />
                <TotalRow
                  label={t("Billed (approved)")}
                  value={formatMinorAsRupees(data.position.billedValueMinor)}
                />
                <TotalRow
                  label={t("Net payable (approved bills)")}
                  value={formatMinorAsRupees(data.position.netPayableMinor)}
                />
                <TotalRow
                  label={t("Retention held")}
                  value={formatMinorAsRupees(data.position.retentionHeldMinor)}
                />
                {data.order.advanceMinor !== "0" ? (
                  <TotalRow
                    label={t("Advance still to recover")}
                    value={formatMinorAsRupees(data.position.advanceOutstandingMinor)}
                  />
                ) : null}
              </Card>

              <SectionHeader title={t("Items")} />
              <Card>
                {data.items.map((item) => (
                  <View key={item.id} style={{ paddingVertical: 5 }}>
                    <Text style={[styles.meta, { color: colors.foreground, fontWeight: "700" }]}>
                      {item.itemCode} · {item.description}
                    </Text>
                    <View style={styles.totalRow}>
                      <Text style={[styles.meta, { color: colors.muted }]}>
                        {formatQuantity(item.quantityThousandths)} {item.unit} ×{" "}
                        {formatMinorAsRupees(item.rateMinor)}
                      </Text>
                      <Text style={[styles.meta, { color: colors.foreground, fontWeight: "700" }]}>
                        {formatMinorAsRupees(item.amountMinor)}
                      </Text>
                    </View>
                    {data.order.status !== "Draft" ? (
                      <Text style={[styles.meta, { color: colors.muted, marginTop: 0 }]}>
                        {t("Measured {done} of {total} · checked {checked}", {
                          done: formatQuantity(item.measuredThousandths),
                          total: formatQuantity(item.quantityThousandths),
                          checked: formatQuantity(item.checkedThousandths),
                        })}
                      </Text>
                    ) : null}
                  </View>
                ))}
              </Card>

              {showActions ? (
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
                        label={t("Approve work order")}
                        loading={transition.isPending}
                        onPress={() => void act("approve")}
                      />
                      <SecondaryButton label={t("Reject")} onPress={() => void act("reject")} />
                    </>
                  ) : null}
                  {data.can.close ? (
                    <SecondaryButton
                      label={t("Close work order (work finished)")}
                      onPress={() => void act("close")}
                    />
                  ) : null}
                  {data.can.releaseRetention ? (
                    <PrimaryButton
                      icon="lock-open"
                      label={t("Release retention {amount}", {
                        amount: formatMinorAsRupees(data.position.retentionHeldMinor),
                      })}
                      loading={release.isPending}
                      disabled={reason.trim().length < 3}
                      onPress={() => void releaseRetention()}
                    />
                  ) : null}
                  {data.can.cancel ? (
                    <SecondaryButton
                      label={t("Cancel work order")}
                      onPress={() => void act("cancel")}
                    />
                  ) : null}
                </Card>
              ) : null}
              {message ? (
                <Text style={[styles.meta, { color: colors.success }]}>{message}</Text>
              ) : null}
              {error ? <InlineError message={error} /> : null}

              {data.order.status !== "Draft" && data.order.status !== "Submitted" ? (
                <SectionHeader
                  title={t("Measurement book")}
                  caption={t("nos × length × breadth × depth; leave out what does not apply.")}
                  action={data.can.measure && !measuring ? t("Add measurement") : undefined}
                  onPress={() => setMeasuring(true)}
                />
              ) : null}
              {measuring ? (
                <Card>
                  <ChipGroup
                    label={t("Item")}
                    options={data.items.map((item) => item.id)}
                    value={itemId}
                    onChange={setItemId}
                    format={(id) => data.items.find((row) => row.id === id)?.itemCode ?? id}
                  />
                  {itemId ? (
                    <Text style={[styles.meta, { color: colors.muted }]}>{itemName(itemId)}</Text>
                  ) : null}
                  <View style={styles.row}>
                    <View style={{ flex: 1 }}>
                      <Field
                        label={t("Measured on")}
                        value={measuredOn}
                        onChangeText={setMeasuredOn}
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <ChipGroup
                        options={["Add", "Deduct"] as const}
                        value={kind}
                        onChange={setKind}
                        format={(value) => (value === "Add" ? t("Add") : t("Deduct (opening)"))}
                      />
                    </View>
                  </View>
                  <Field
                    label={t("Location")}
                    value={location}
                    onChangeText={setLocation}
                    placeholder={t("Ground floor, grid A-D")}
                  />
                  <View style={styles.row}>
                    {(
                      [
                        [t("Nos"), nos, setNos],
                        [t("L (m)"), length, setLength],
                        [t("B (m)"), breadth, setBreadth],
                        [t("D/H (m)"), depth, setDepth],
                      ] as const
                    ).map(([label, value, set]) => (
                      <View key={label} style={{ flex: 1 }}>
                        <Field
                          label={label}
                          value={value}
                          onChangeText={set}
                          keyboardType="decimal-pad"
                        />
                      </View>
                    ))}
                  </View>
                  <Text
                    style={[
                      styles.meta,
                      { color: typeof size === "string" ? colors.muted : colors.foreground },
                    ]}
                  >
                    {typeof size === "string"
                      ? t(size)
                      : `${kind === "Deduct" ? "−" : ""}${formatQuantity(size)} ${
                          data.items.find((row) => row.id === itemId)?.unit ?? ""
                        }`}
                  </Text>
                  <PrimaryButton
                    icon="straighten"
                    label={t("Save measurement")}
                    loading={measure.isPending}
                    disabled={!itemId || typeof size === "string" || location.trim().length < 2}
                    onPress={() => void saveMeasurement()}
                  />
                  <Text
                    accessibilityRole="button"
                    onPress={() => setMeasuring(false)}
                    style={styles.cancel}
                  >
                    {t("Cancel")}
                  </Text>
                </Card>
              ) : null}
              {checkable.length ? (
                <Card accent="warning">
                  <Text style={[styles.title, { color: colors.foreground }]}>
                    {t("{count} measurements to check", { count: checkable.length })}
                  </Text>
                  <PrimaryButton
                    icon="done-all"
                    label={t("Check all {count}", { count: checkable.length })}
                    loading={check.isPending}
                    onPress={() =>
                      void review(
                        checkable.map((m) => m.id),
                        "check",
                      )
                    }
                  />
                  <Field
                    label={t("Reason, to reject one")}
                    value={rejectReason}
                    onChangeText={setRejectReason}
                  />
                </Card>
              ) : null}
              {data.measurements.map((m) => (
                <Card key={m.id} accent={WO_TONE[m.billId ? "Billed" : m.status] ?? "info"}>
                  <View style={styles.row}>
                    <Text
                      style={[
                        styles.meta,
                        { color: colors.foreground, fontWeight: "700", flex: 1 },
                      ]}
                    >
                      {itemName(m.itemId)}
                    </Text>
                    <StatusPill
                      label={t(m.billId ? "Billed" : m.status)}
                      tone={WO_TONE[m.billId ? "Billed" : m.status] ?? "info"}
                      compact
                    />
                  </View>
                  <Text style={[styles.meta, { color: colors.muted }]}>
                    {String(m.measuredOn)} · {m.location} · {m.byName ?? "—"}
                  </Text>
                  <Text style={[styles.meta, { color: colors.foreground }]}>
                    {[m.nos, m.length, m.breadth, m.depth].filter(Boolean).join(" × ")} ={" "}
                    {formatQuantity(m.quantityThousandths)}
                    {m.deduction === "Yes" ? ` (${t("deduction")})` : ""}
                  </Text>
                  {m.rejectReason ? (
                    <Text style={[styles.meta, { color: colors.error }]}>{m.rejectReason}</Text>
                  ) : null}
                  {m.canCheck ? (
                    <View style={styles.row}>
                      <View style={{ flex: 1 }}>
                        <SecondaryButton
                          icon="check"
                          label={t("Check")}
                          onPress={() => void review([m.id], "check")}
                        />
                      </View>
                      <View style={{ flex: 1 }}>
                        <SecondaryButton
                          icon="close"
                          label={t("Reject")}
                          disabled={!rejectReason.trim()}
                          onPress={() => void review([m.id], "reject")}
                        />
                      </View>
                    </View>
                  ) : null}
                </Card>
              ))}

              {data.order.status !== "Draft" && data.order.status !== "Submitted" ? (
                <SectionHeader
                  title={t("RA bills")}
                  caption={t("{count} checked measurements not billed yet", {
                    count: data.position.unbilledChecked,
                  })}
                  action={data.can.bill && !billing ? t("Make RA bill") : undefined}
                  onPress={() => setBilling(true)}
                />
              ) : null}
              {billing ? (
                <Card>
                  <View style={styles.row}>
                    <View style={{ flex: 1 }}>
                      <Field
                        label={t("Measured up to")}
                        value={periodTo}
                        onChangeText={setPeriodTo}
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Field label={t("Bill date")} value={billDate} onChangeText={setBillDate} />
                    </View>
                  </View>
                  <View style={styles.row}>
                    <View style={{ width: 120 }}>
                      <Field
                        label={t("Other deduction ₹")}
                        value={otherRupees}
                        onChangeText={setOtherRupees}
                        keyboardType="decimal-pad"
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Field
                        label={t("For what")}
                        value={otherNote}
                        onChangeText={setOtherNote}
                        placeholder={t("Material issued, penalty…")}
                      />
                    </View>
                  </View>
                  {preview.error ? <InlineError message={preview.error.message} /> : null}
                  {preview.data ? (
                    <>
                      {preview.data.lines.map((line) => (
                        <View key={line.itemId} style={styles.totalRow}>
                          <Text style={[styles.meta, { color: colors.muted, flex: 1 }]}>
                            {line.itemCode} · {formatQuantity(line.quantityThousandths)} {line.unit}{" "}
                            × {formatMinorAsRupees(line.rateMinor)}
                          </Text>
                          <Text style={[styles.meta, { color: colors.foreground }]}>
                            {formatMinorAsRupees(line.amountMinor)}
                          </Text>
                        </View>
                      ))}
                      <BillTotals totals={preview.data.totals} />
                    </>
                  ) : null}
                  <PrimaryButton
                    icon="request-quote"
                    label={t("Make and submit bill")}
                    loading={createBill.isPending}
                    disabled={!preview.data?.lines.length}
                    onPress={() => void saveBill()}
                  />
                  <Text
                    accessibilityRole="button"
                    onPress={() => setBilling(false)}
                    style={styles.cancel}
                  >
                    {t("Cancel")}
                  </Text>
                </Card>
              ) : null}
              {data.bills.map((bill) => (
                <Card
                  key={bill.id}
                  accent={WO_TONE[bill.status] ?? "info"}
                  onPress={() => router.push(`/sub-bill?siteId=${siteId}&id=${bill.id}` as never)}
                  accessibilityLabel={`Open ${bill.billNumber}`}
                >
                  <View style={styles.row}>
                    <Text style={[styles.title, { color: colors.foreground, flex: 1 }]}>
                      {bill.billNumber}
                    </Text>
                    <StatusPill
                      label={t(bill.status)}
                      tone={WO_TONE[bill.status] ?? "info"}
                      compact
                    />
                  </View>
                  <Text style={[styles.meta, { color: colors.muted }]}>
                    {String(bill.billDate)} · {t("work")} {formatMinorAsRupees(bill.workValueMinor)}{" "}
                    · {t("net")} {formatMinorAsRupees(bill.netPayableMinor)}
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
