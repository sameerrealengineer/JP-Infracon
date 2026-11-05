import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import { useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Platform, RefreshControl, ScrollView, Text, View } from "react-native";
import { AuthGate } from "@/components/jp/auth-gate";
import { RUN_TONE, TotalRow, commercialStyles as styles } from "@/components/jp/commercial-ui";
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
import { formatMinorAsRupees } from "@/lib/jp/finance-domain";
import { createClientMutationId } from "@/lib/jp/local-repository";
import { formatDays } from "@/lib/jp/payroll-domain";
import { buildPayslipsHtml } from "@/lib/jp/payslip";
import { useT } from "@/lib/i18n";
import { trpc } from "@/lib/trpc";

const todayText = () => new Date().toISOString().slice(0, 10);
const MODES = ["Bank transfer", "UPI", "Cheque", "Cash"] as const;
type Mode = (typeof MODES)[number];

function rupeeText(minor: string) {
  const value = BigInt(minor);
  if (value === 0n) return "";
  const paise = value % 100n;
  return paise === 0n ? `${value / 100n}` : `${value / 100n}.${String(paise).padStart(2, "0")}`;
}
const sumOf = (...values: string[]) =>
  values.reduce((total, v) => total + BigInt(v), 0n).toString();

/** One pay run: totals and dues, a line per person with manual deductions, approval, paid, payslips. */
export default function PayRunScreen() {
  const { t } = useT();
  const colors = useColors();
  const params = useLocalSearchParams<{ siteId?: string; id?: string }>();
  const siteId = typeof params.siteId === "string" ? params.siteId : "";
  const runId = typeof params.id === "string" ? params.id : "";
  const utils = trpc.useUtils();
  const detail = trpc.jp.payroll.run.useQuery(
    { siteId, runId },
    { enabled: Boolean(siteId && runId) },
  );
  const transition = trpc.jp.payroll.transition.useMutation();
  const updateLine = trpc.jp.payroll.updateLine.useMutation();
  const refreshRun = trpc.jp.payroll.refresh.useMutation();
  const markPaid = trpc.jp.payroll.markPaid.useMutation();
  const data = detail.data;

  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [paidDays, setPaidDays] = useState("");
  const [tds, setTds] = useState("");
  const [advance, setAdvance] = useState("");
  const [other, setOther] = useState("");
  const [otherNote, setOtherNote] = useState("");
  const [paidOn, setPaidOn] = useState(todayText);
  const [mode, setMode] = useState<Mode>("Bank transfer");
  const [reference, setReference] = useState("");
  const [payKey, setPayKey] = useState(createClientMutationId);

  const refresh = () => utils.jp.payroll.invalidate();
  const fail = (cause: unknown) => setError(cause instanceof Error ? cause.message : "Not saved.");

  const act = async (action: "submit" | "approve" | "return" | "cancel") => {
    setError(null);
    setMessage(null);
    try {
      await transition.mutateAsync({
        siteId,
        runId,
        action,
        reason: reason.trim() || null,
        clientMutationId: createClientMutationId(),
      });
      setReason("");
      await refresh();
    } catch (cause) {
      fail(cause);
    }
  };

  const openLine = (line: NonNullable<typeof data>["lines"][number]) => {
    setEditing(line.id);
    setPaidDays(line.paidDaysEdited === "Yes" ? formatDays(BigInt(line.paidDaysHundredths)) : "");
    setTds(rupeeText(line.tdsMinor));
    setAdvance(rupeeText(line.advanceMinor));
    setOther(rupeeText(line.otherDeductionMinor));
    setOtherNote(line.otherDeductionNote ?? "");
    setError(null);
  };

  const saveLine = async (lineId: string) => {
    setError(null);
    try {
      const result = await updateLine.mutateAsync({
        siteId,
        runId,
        lineId,
        paidDays: paidDays.trim() || null,
        tdsRupees: tds.trim() || null,
        advanceRupees: advance.trim() || null,
        otherDeductionRupees: other.trim() || null,
        otherDeductionNote: otherNote.trim() || null,
        clientMutationId: createClientMutationId(),
      });
      setEditing(null);
      setMessage(result.warnings.length ? result.warnings.join(" ") : t("Line updated."));
      await refresh();
    } catch (cause) {
      fail(cause);
    }
  };

  const rebuild = async () => {
    setError(null);
    try {
      await refreshRun.mutateAsync({ siteId, runId, clientMutationId: createClientMutationId() });
      setMessage(t("Updated from the latest approved attendance and pay details."));
      await refresh();
    } catch (cause) {
      fail(cause);
    }
  };

  const pay = async () => {
    setError(null);
    try {
      await markPaid.mutateAsync({
        siteId,
        runId,
        paidOn,
        mode,
        reference: reference.trim() || null,
        clientMutationId: payKey,
      });
      setPayKey(createClientMutationId());
      setMessage(t("Recorded as paid."));
      await refresh();
    } catch (cause) {
      fail(cause);
    }
  };

  const printSlips = async (lineId?: string) => {
    if (!data) return;
    const lines = data.lines.filter((line) => !lineId || line.id === lineId);
    const html = buildPayslipsHtml(
      {
        runNumber: data.run.runNumber,
        month: data.run.month,
        siteName: data.siteName,
        status: data.run.status,
        paidOn: data.run.paidOn ? String(data.run.paidOn) : null,
      },
      lines,
    );
    try {
      if (Platform.OS === "web") await Print.printAsync({ html });
      else {
        const { uri } = await Print.printToFileAsync({ html });
        if (await Sharing.isAvailableAsync())
          await Sharing.shareAsync(uri, {
            mimeType: "application/pdf",
            dialogTitle: t("Payslips"),
          });
      }
    } catch (cause) {
      fail(cause);
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
            <LoadingBlock label="Loading pay run…" />
          ) : !data ? (
            <>
              <AppHeader eyebrow={t("Pay run")} title={t("Not available")} />
              <InlineError
                message={detail.error?.message ?? "This pay run could not be opened."}
                onRetry={() => void detail.refetch()}
              />
            </>
          ) : (
            <>
              <AppHeader
                eyebrow={t("Pay run")}
                title={data.run.runNumber}
                subtitle={`${data.siteName} · ${data.run.month}`}
              />
              <Card>
                <StatusPill label={t(data.run.status)} tone={RUN_TONE[data.run.status] ?? "info"} />
                {data.run.reviewReason ? (
                  <Text style={[styles.meta, { color: colors.muted }]}>
                    {data.run.reviewReason}
                  </Text>
                ) : null}
                {data.run.paidOn ? (
                  <Text style={[styles.meta, { color: colors.muted }]}>
                    {t("Paid on {date} by {mode}", {
                      date: String(data.run.paidOn),
                      mode: t(data.run.paymentMode ?? ""),
                    })}
                    {data.run.paymentReference ? ` · ${data.run.paymentReference}` : ""}
                  </Text>
                ) : null}
                <TotalRow label={t("People")} value={String(data.run.lineCount)} />
                <TotalRow label={t("Gross pay")} value={formatMinorAsRupees(data.run.grossMinor)} />
                <TotalRow
                  label={t("Deductions")}
                  value={formatMinorAsRupees(data.run.deductionMinor)}
                />
                <TotalRow
                  label={t("Net pay")}
                  value={formatMinorAsRupees(data.run.netMinor)}
                  strong
                />
                <TotalRow
                  label={t("Cost to company")}
                  value={formatMinorAsRupees(data.run.costMinor)}
                />
              </Card>
              <Card>
                <Text style={[styles.title, { color: colors.foreground }]}>{t("To deposit")}</Text>
                <TotalRow
                  label={t("PF (employee + employer + EDLI/admin)")}
                  value={formatMinorAsRupees(data.run.pfDueMinor)}
                />
                <TotalRow
                  label={t("ESI (employee + employer)")}
                  value={formatMinorAsRupees(data.run.esiDueMinor)}
                />
                {data.run.ptDueMinor !== "0" ? (
                  <TotalRow
                    label={t("Professional tax")}
                    value={formatMinorAsRupees(data.run.ptDueMinor)}
                  />
                ) : null}
                {data.run.tdsDueMinor !== "0" ? (
                  <TotalRow
                    label={t("TDS on salary")}
                    value={formatMinorAsRupees(data.run.tdsDueMinor)}
                  />
                ) : null}
                <Text style={[styles.meta, { color: colors.muted }]}>
                  {t(
                    "PF and ESI are due by the 15th of next month; record the challan in Accounts.",
                  )}
                </Text>
              </Card>
              {data.unapprovedAttendance > 0 &&
              (data.run.status === "Draft" || data.run.status === "Returned") ? (
                <Text style={[styles.meta, { color: colors.warning }]}>
                  {t(
                    "{count} attendance entries this month are not approved yet; they are left out.",
                    {
                      count: data.unapprovedAttendance,
                    },
                  )}
                </Text>
              ) : null}

              {data.can.submit || data.can.review || data.can.cancel ? (
                <Card>
                  <Field
                    label={t("Note / reason")}
                    value={reason}
                    onChangeText={setReason}
                    multiline
                  />
                  {data.can.edit ? (
                    <SecondaryButton
                      icon="refresh"
                      label={t("Update from attendance")}
                      onPress={() => void rebuild()}
                    />
                  ) : null}
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
                        label={t("Approve pay run")}
                        loading={transition.isPending}
                        onPress={() => void act("approve")}
                      />
                      <SecondaryButton label={t("Send back")} onPress={() => void act("return")} />
                    </>
                  ) : null}
                  {data.can.cancel ? (
                    <SecondaryButton
                      label={t("Cancel pay run")}
                      onPress={() => void act("cancel")}
                    />
                  ) : null}
                </Card>
              ) : null}
              {data.can.pay ? (
                <Card>
                  <Text style={[styles.title, { color: colors.foreground }]}>
                    {t("Record payment")}
                  </Text>
                  <Text style={[styles.meta, { color: colors.muted }]}>
                    {t("Pay {amount} outside the app, then record it here.", {
                      amount: formatMinorAsRupees(data.run.netMinor),
                    })}
                  </Text>
                  <Field label={t("Paid on")} value={paidOn} onChangeText={setPaidOn} />
                  <ChipGroup
                    label={t("Mode")}
                    options={MODES}
                    value={mode}
                    onChange={setMode}
                    format={(v) => t(v)}
                  />
                  <Field
                    label={t("Reference (bank, UPI or cheque)")}
                    value={reference}
                    onChangeText={setReference}
                  />
                  <PrimaryButton
                    icon="price-check"
                    label={t("Mark paid")}
                    loading={markPaid.isPending}
                    onPress={() => void pay()}
                  />
                </Card>
              ) : null}
              {message ? (
                <Text style={[styles.meta, { color: colors.success }]}>{message}</Text>
              ) : null}
              {error ? <InlineError message={error} /> : null}

              <SectionHeader
                title={t("Wage sheet")}
                action={data.lines.length ? t("All payslips") : undefined}
                onPress={() => void printSlips()}
              />
              {data.lines.map((line) => (
                <Card key={line.id} accent={line.warnings.length ? "warning" : undefined}>
                  <View style={styles.row}>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.title, { color: colors.foreground }]}>{line.name}</Text>
                      <Text style={[styles.meta, { color: colors.muted }]}>
                        {line.payType === "Daily"
                          ? t("Daily · {days} days worked", {
                              days: formatDays(BigInt(line.workedDaysHundredths)),
                            })
                          : t("Monthly · {days} days paid", {
                              days: formatDays(BigInt(line.paidDaysHundredths)),
                            })}
                        {line.overtimeHundredths
                          ? ` · OT ${formatDays(BigInt(line.overtimeHundredths))} h`
                          : ""}
                      </Text>
                    </View>
                    <Text style={[styles.title, { color: colors.foreground }]}>
                      {formatMinorAsRupees(line.netMinor)}
                    </Text>
                  </View>
                  <TotalRow label={t("Gross")} value={formatMinorAsRupees(line.grossMinor)} />
                  {line.pfEmployeeMinor !== "0" ? (
                    <TotalRow label="PF" value={`− ${formatMinorAsRupees(line.pfEmployeeMinor)}`} />
                  ) : null}
                  {line.esiEmployeeMinor !== "0" ? (
                    <TotalRow
                      label="ESI"
                      value={`− ${formatMinorAsRupees(line.esiEmployeeMinor)}`}
                    />
                  ) : null}
                  {line.ptMinor !== "0" ? (
                    <TotalRow
                      label={t("Professional tax")}
                      value={`− ${formatMinorAsRupees(line.ptMinor)}`}
                    />
                  ) : null}
                  {line.tdsMinor !== "0" ? (
                    <TotalRow label="TDS" value={`− ${formatMinorAsRupees(line.tdsMinor)}`} />
                  ) : null}
                  {line.advanceMinor !== "0" ? (
                    <TotalRow
                      label={t("Advance recovery")}
                      value={`− ${formatMinorAsRupees(line.advanceMinor)}`}
                    />
                  ) : null}
                  {line.otherDeductionMinor !== "0" ? (
                    <TotalRow
                      label={line.otherDeductionNote ?? t("Other deduction")}
                      value={`− ${formatMinorAsRupees(line.otherDeductionMinor)}`}
                    />
                  ) : null}
                  <Text style={[styles.meta, { color: colors.muted }]}>
                    {t("Employer PF {pf} · ESI {esi}", {
                      pf: formatMinorAsRupees(
                        sumOf(line.employerEpfMinor, line.employerEpsMinor, line.edliAdminMinor),
                      ),
                      esi: formatMinorAsRupees(line.esiEmployerMinor),
                    })}
                  </Text>
                  {line.warnings.map((warning) => (
                    <Text key={warning} style={[styles.meta, { color: colors.warning }]}>
                      {warning}
                    </Text>
                  ))}
                  <View style={[styles.row, { marginTop: 6 }]}>
                    <Text
                      style={[styles.link, { color: colors.primary }]}
                      onPress={() => void printSlips(line.id)}
                      accessibilityRole="button"
                    >
                      {t("Payslip")}
                    </Text>
                    {data.can.edit && editing !== line.id ? (
                      <Text
                        style={[styles.link, { color: colors.primary, marginLeft: 16 }]}
                        onPress={() => openLine(line)}
                        accessibilityRole="button"
                        accessibilityLabel={`Edit deductions for ${line.name}`}
                      >
                        {t("Edit deductions")}
                      </Text>
                    ) : null}
                  </View>
                  {editing === line.id ? (
                    <View style={{ marginTop: 8 }}>
                      {line.payType === "Monthly" ? (
                        <Field
                          label={t("Paid days (leave empty for automatic)")}
                          value={paidDays}
                          onChangeText={setPaidDays}
                          keyboardType="decimal-pad"
                        />
                      ) : null}
                      <Field
                        label={t("TDS (₹)")}
                        value={tds}
                        onChangeText={setTds}
                        keyboardType="decimal-pad"
                      />
                      <Field
                        label={t("Advance recovery (₹)")}
                        value={advance}
                        onChangeText={setAdvance}
                        keyboardType="decimal-pad"
                      />
                      <Field
                        label={t("Other deduction (₹)")}
                        value={other}
                        onChangeText={setOther}
                        keyboardType="decimal-pad"
                      />
                      <Field
                        label={t("Other deduction is for")}
                        value={otherNote}
                        onChangeText={setOtherNote}
                      />
                      <PrimaryButton
                        icon="save"
                        label={t("Save line")}
                        loading={updateLine.isPending}
                        onPress={() => void saveLine(line.id)}
                      />
                      <SecondaryButton label={t("Cancel")} onPress={() => setEditing(null)} />
                    </View>
                  ) : null}
                </Card>
              ))}
            </>
          )}
        </ScrollView>
      </Screen>
    </AuthGate>
  );
}
