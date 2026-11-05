import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@/server/routers";
import { useState } from "react";
import { RefreshControl, ScrollView, Text, View } from "react-native";
import { AuthGate } from "@/components/jp/auth-gate";
import { RUN_TONE, TotalRow, commercialStyles as styles } from "@/components/jp/commercial-ui";
import {
  AppHeader,
  Card,
  ChipGroup,
  EmptyState,
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
import { DUE_KINDS, type DueKind } from "@/lib/jp/accounts-domain";
import { formatPercent } from "@/lib/jp/billing-domain";
import { formatMinorAsRupees } from "@/lib/jp/finance-domain";
import { createClientMutationId } from "@/lib/jp/local-repository";
import { useT } from "@/lib/i18n";
import { trpc } from "@/lib/trpc";

const todayText = () => new Date().toISOString().slice(0, 10);
const TABS = ["dues", "gst", "profit"] as const;
type Tab = (typeof TABS)[number];

function rupeeText(minor: string) {
  const value = BigInt(minor);
  if (value <= 0n) return "";
  const paise = value % 100n;
  return paise === 0n ? `${value / 100n}` : `${value / 100n}.${String(paise).padStart(2, "0")}`;
}

/** Company accounts: statutory dues and deposits, GST by month, and profit per project. */
export default function AccountsScreen() {
  const { t } = useT();
  const colors = useColors();
  const [tab, setTab] = useState<Tab>("dues");
  const overview = trpc.jp.books.overview.useQuery();

  return (
    <AuthGate>
      <Screen>
        <ScrollView
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.content}
          refreshControl={
            <RefreshControl
              refreshing={overview.isRefetching}
              onRefresh={() => void overview.refetch()}
              tintColor={colors.primary}
            />
          }
        >
          <AppHeader
            eyebrow={t("Accounts")}
            title={t("Dues, GST and profit")}
            subtitle={t(
              "From approved records only. Returns (GSTR, ECR, TDS) are still filed by your accountant.",
            )}
          />
          {overview.isLoading ? (
            <LoadingBlock label="Loading accounts…" />
          ) : overview.error ? (
            <InlineError message={overview.error.message} onRetry={() => void overview.refetch()} />
          ) : overview.data ? (
            <>
              <Card>
                <TotalRow
                  label={t("Clients owe us")}
                  value={formatMinorAsRupees(overview.data.receivableMinor)}
                  strong
                />
                <TotalRow
                  label={t("We owe suppliers")}
                  value={formatMinorAsRupees(overview.data.payableMinor)}
                  strong
                />
                <TotalRow
                  label={t("TDS deducted by clients (claim in 26AS)")}
                  value={formatMinorAsRupees(overview.data.clientTdsMinor)}
                />
                {overview.data.overdueCount > 0 ? (
                  <Text style={[styles.meta, { color: colors.error }]}>
                    {t("{count} statutory dues are overdue.", {
                      count: overview.data.overdueCount,
                    })}
                  </Text>
                ) : null}
              </Card>
              <ChipGroup
                options={TABS}
                value={tab}
                onChange={setTab}
                format={(value) =>
                  value === "dues"
                    ? t("PF, ESI, TDS")
                    : value === "gst"
                      ? t("GST")
                      : t("Project profit")
                }
              />
              {tab === "dues" ? (
                <Dues data={overview.data} colors={colors} />
              ) : tab === "gst" ? (
                <Gst rows={overview.data.gst} colors={colors} />
              ) : (
                <Profit colors={colors} />
              )}
            </>
          ) : null}
        </ScrollView>
      </Screen>
    </AuthGate>
  );
}

type Colors = ReturnType<typeof useColors>;
type Overview = inferRouterOutputs<AppRouter>["jp"]["books"]["overview"];

function Dues({ data, colors }: { data: Overview; colors: Colors }) {
  const { t } = useT();
  const utils = trpc.useUtils();
  const record = trpc.jp.books.recordDeposit.useMutation();
  const reverse = trpc.jp.books.reverseDeposit.useMutation();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<DueKind>("PF");
  const [period, setPeriod] = useState(todayText().slice(0, 7));
  const [amount, setAmount] = useState("");
  const [paidOn, setPaidOn] = useState(todayText);
  const [challan, setChallan] = useState("");
  const [note, setNote] = useState("");
  const [reason, setReason] = useState("");
  const [key, setKey] = useState(createClientMutationId);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const start = (line?: Overview["dues"][number]) => {
    if (line) {
      setKind(line.kind);
      setPeriod(line.period);
      setAmount(rupeeText(line.outstandingMinor));
    }
    setOpen(true);
    setError(null);
  };
  const save = async () => {
    setError(null);
    try {
      await record.mutateAsync({
        kind,
        period,
        amountRupees: amount,
        paidOn,
        challan,
        note: note.trim() || null,
        clientMutationId: key,
      });
      setKey(createClientMutationId());
      setOpen(false);
      setAmount("");
      setChallan("");
      setNote("");
      setMessage(t("Deposit recorded."));
      await utils.jp.books.invalidate();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Not saved.");
    }
  };
  const undo = async (depositId: string) => {
    setError(null);
    try {
      await reverse.mutateAsync({ depositId, reason, clientMutationId: createClientMutationId() });
      setReason("");
      await utils.jp.books.invalidate();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Not saved.");
    }
  };

  return (
    <>
      {message ? <Text style={[styles.meta, { color: colors.success }]}>{message}</Text> : null}
      {error ? <InlineError message={error} /> : null}
      {data.can.manage && !open ? (
        <PrimaryButton icon="add" label={t("Record a deposit")} onPress={() => start()} />
      ) : null}
      {open ? (
        <Card>
          <ChipGroup
            label={t("What was paid")}
            options={DUE_KINDS}
            value={kind}
            onChange={setKind}
            format={(v) => t(v)}
          />
          <Field label={t("For month")} value={period} onChangeText={setPeriod} hint="2026-10" />
          <Field
            label={t("Amount (₹)")}
            value={amount}
            onChangeText={setAmount}
            keyboardType="decimal-pad"
          />
          <Field label={t("Paid on")} value={paidOn} onChangeText={setPaidOn} />
          <Field label={t("Challan / TRRN number")} value={challan} onChangeText={setChallan} />
          <Field label={t("Note")} value={note} onChangeText={setNote} />
          <PrimaryButton
            icon="save"
            label={t("Save deposit")}
            loading={record.isPending}
            onPress={() => void save()}
          />
          <SecondaryButton label={t("Cancel")} onPress={() => setOpen(false)} />
        </Card>
      ) : null}
      <SectionHeader
        title={t("Dues")}
        caption={t("PF and ESI by the 15th, TDS by the 7th of next month (March: 30 April).")}
      />
      {data.dues.length === 0 ? (
        <EmptyState
          icon="account-balance"
          title="Nothing due"
          detail="Dues appear when pay runs or subcontractor bills with TDS are approved."
        />
      ) : (
        data.dues.map((line) => (
          <Card key={`${line.kind}-${line.period}`} accent={RUN_TONE[line.state] ?? "info"}>
            <View style={styles.row}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.title, { color: colors.foreground }]}>
                  {t(line.kind)} · {line.period}
                </Text>
                <Text style={[styles.meta, { color: colors.muted }]}>
                  {t("Due {date}", { date: line.dueDate })} ·{" "}
                  {t("deposited {amount}", { amount: formatMinorAsRupees(line.depositedMinor) })}
                </Text>
              </View>
              <StatusPill label={t(line.state)} tone={RUN_TONE[line.state] ?? "info"} compact />
            </View>
            <TotalRow label={t("Due")} value={formatMinorAsRupees(line.dueMinor)} />
            <TotalRow
              label={t("Still to deposit")}
              value={formatMinorAsRupees(line.outstandingMinor)}
              strong
            />
            {data.can.manage && (line.state === "Due" || line.state === "Overdue") ? (
              <Text
                style={[styles.link, { color: colors.primary }]}
                onPress={() => start(line)}
                accessibilityLabel={`Record deposit for ${line.kind} ${line.period}`}
                accessibilityRole="button"
              >
                {t("Record deposit")}
              </Text>
            ) : null}
          </Card>
        ))
      )}
      {data.deposits.length ? (
        <>
          <SectionHeader title={t("Deposits")} />
          {data.can.manage ? (
            <Field
              label={t("Reason (to reverse a deposit)")}
              value={reason}
              onChangeText={setReason}
            />
          ) : null}
          {data.deposits.map((deposit) => (
            <Card key={deposit.id}>
              <View style={styles.row}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.title, { color: colors.foreground }]}>
                    {t(deposit.kind)} · {deposit.period} ·{" "}
                    {formatMinorAsRupees(deposit.amountMinor)}
                  </Text>
                  <Text style={[styles.meta, { color: colors.muted }]}>
                    {String(deposit.paidOn)} · {deposit.challanReference}
                    {deposit.reverseReason ? ` · ${deposit.reverseReason}` : ""}
                  </Text>
                </View>
                <StatusPill
                  label={t(deposit.status)}
                  tone={RUN_TONE[deposit.status] ?? "info"}
                  compact
                />
              </View>
              {data.can.manage && deposit.status === "Recorded" ? (
                <Text
                  style={[
                    styles.link,
                    { color: reason.trim().length >= 3 ? colors.error : colors.muted },
                  ]}
                  onPress={reason.trim().length >= 3 ? () => void undo(deposit.id) : undefined}
                  accessibilityRole="button"
                >
                  {t("Reverse (entered by mistake)")}
                </Text>
              ) : null}
            </Card>
          ))}
        </>
      ) : null}
    </>
  );
}

function Gst({ rows, colors }: { rows: Overview["gst"]; colors: Colors }) {
  const { t } = useT();
  if (!rows.length)
    return (
      <EmptyState
        icon="receipt-long"
        title="No GST yet"
        detail="GST appears when client or supplier bills are approved."
      />
    );
  return (
    <>
      <Text style={[styles.meta, { color: colors.muted }]}>
        {t(
          "Output GST on approved client bills, less input GST on approved supplier bills. Input credit actually allowed depends on GSTR-2B.",
        )}
      </Text>
      {rows.map((row) => (
        <Card key={row.month}>
          <Text style={[styles.title, { color: colors.foreground }]}>{row.month}</Text>
          <TotalRow label={t("Output GST (sales)")} value={formatMinorAsRupees(row.outputMinor)} />
          <TotalRow
            label={t("Input GST (purchases)")}
            value={formatMinorAsRupees(row.inputMinor)}
          />
          <TotalRow
            label={
              BigInt(row.netMinor) >= 0n ? t("GST to pay (estimate)") : t("Credit carried forward")
            }
            value={formatMinorAsRupees(
              BigInt(row.netMinor) >= 0n ? row.netMinor : (-BigInt(row.netMinor)).toString(),
            )}
            strong
          />
        </Card>
      ))}
    </>
  );
}

function Profit({ colors }: { colors: Colors }) {
  const { t } = useT();
  const profit = trpc.jp.books.profit.useQuery();
  if (profit.isLoading) return <LoadingBlock label="Working out profit…" />;
  if (profit.error)
    return <InlineError message={profit.error.message} onRetry={() => void profit.refetch()} />;
  if (!profit.data?.length)
    return (
      <EmptyState icon="insights" title="No projects" detail="Projects you can see appear here." />
    );
  return (
    <>
      <Text style={[styles.meta, { color: colors.muted }]}>
        {t(
          "Billed work value less costs before GST: supplier and subcontractor bills, approved payroll, petty cash.",
        )}
      </Text>
      {profit.data.map((row) => (
        <Card key={row.projectId} accent={BigInt(row.profitMinor) >= 0n ? "success" : "error"}>
          <Text style={[styles.title, { color: colors.foreground }]}>{row.name}</Text>
          <TotalRow
            label={t("Billed (approved)")}
            value={formatMinorAsRupees(row.revenueMinor)}
            strong
          />
          {Object.entries(row.costs)
            .filter(([, value]) => value !== "0")
            .map(([head, value]) => (
              <TotalRow key={head} label={t(head)} value={`− ${formatMinorAsRupees(value)}`} />
            ))}
          <TotalRow label={t("Total cost")} value={formatMinorAsRupees(row.totalCostMinor)} />
          <TotalRow
            label={
              row.marginBps === null
                ? t("Profit")
                : t("Profit ({pct})", { pct: formatPercent(row.marginBps) })
            }
            value={formatMinorAsRupees(row.profitMinor)}
            strong
          />
          {row.labourNotInPayrollMinor !== "0" ? (
            <Text style={[styles.meta, { color: colors.warning }]}>
              {t(
                "Approved attendance worth about {amount} is not in a pay run yet and is not counted.",
                {
                  amount: formatMinorAsRupees(row.labourNotInPayrollMinor),
                },
              )}
            </Text>
          ) : null}
        </Card>
      ))}
    </>
  );
}
