import { useState } from "react";
import { RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { AuthGate } from "@/components/jp/auth-gate";
import { ChartCard, DataTable, KpiGrid, StackedBars } from "@/components/jp/charts";
import {
  AppHeader,
  Card,
  ChipGroup,
  InlineError,
  LoadingBlock,
  NoAccess,
  Screen,
  SectionHeader,
  isAccessDenied,
} from "@/components/jp/ui";
import { useColors } from "@/hooks/use-colors";
import { useT } from "@/lib/i18n";
import { bucketLabel, rupeesForChart, shortRupees } from "@/lib/jp/analytics";
import { formatMinorAsRupees } from "@/lib/jp/finance-domain";
import { trpc } from "@/lib/trpc";

/** Cash-flow forecast: what comes in and goes out in the next weeks, and where cash runs short. */
export default function CashflowScreen() {
  const { t } = useT();
  const colors = useColors();
  const [days, setDays] = useState<"30" | "60" | "90">("60");
  const [opening, setOpening] = useState("0");
  const [committed, setCommitted] = useState("0");
  const fc = trpc.jp.cashflow.forecast.useQuery(
    { days: Number(days) as 30 | 60 | 90, openingRupees: committed.replace(/[^\d-]/g, "") || "0" },
    { retry: false },
  );
  const data = fc.data;
  if (isAccessDenied(fc.error))
    return (
      <AuthGate>
        <Screen>
          <AppHeader title={t("Cash-flow forecast")} />
          <NoAccess area={t("Cash-flow forecast")} message={fc.error?.message} />
        </Screen>
      </AuthGate>
    );
  return (
    <AuthGate>
      <Screen>
        <ScrollView
          contentContainerStyle={{ paddingBottom: 40, gap: 12 }}
          keyboardShouldPersistTaps="handled"
          refreshControl={
            <RefreshControl refreshing={fc.isRefetching} onRefresh={() => void fc.refetch()} />
          }
        >
          <AppHeader
            eyebrow={t("Money")}
            title={t("Cash-flow forecast")}
            subtitle={t(
              "Approved bills to receive and to pay, and approved wages, by week. An estimate from the app's records, not your bank.",
            )}
          />
          <ChipGroup
            options={["30", "60", "90"] as const}
            value={days}
            onChange={setDays}
            format={(v) => t("{days} days", { days: v })}
          />
          <Card>
            <Text style={[styles.label, { color: colors.muted }]}>
              {t("Cash in hand and bank today (₹)")}
            </Text>
            <TextInput
              accessibilityLabel={t("Cash in hand and bank today (₹)")}
              value={opening}
              onChangeText={setOpening}
              onBlur={() => setCommitted(opening)}
              onSubmitEditing={() => setCommitted(opening)}
              keyboardType="numbers-and-punctuation"
              style={[styles.input, { borderColor: colors.border, color: colors.foreground }]}
            />
          </Card>
          {fc.isLoading ? <LoadingBlock label={t("Loading…")} /> : null}
          {fc.isError && !isAccessDenied(fc.error) ? (
            <InlineError message={t(fc.error.message)} onRetry={() => void fc.refetch()} />
          ) : null}
          {data ? (
            <>
              <KpiGrid
                items={[
                  { label: t("Expected in"), value: shortRupees(data.totalInMinor), tone: "good" },
                  { label: t("Expected out"), value: shortRupees(data.totalOutMinor) },
                  {
                    label: t("Lowest balance"),
                    value: shortRupees(data.lowestBalance.balanceMinor),
                    sub:
                      data.lowestBalance.label === "Overdue"
                        ? t("now (overdue items)")
                        : t("week of {date}", { date: data.lowestBalance.label }),
                    tone: data.shortfall ? "bad" : "good",
                  },
                ]}
              />
              {data.shortfall ? (
                <Text style={{ color: colors.error, fontWeight: "700" }}>
                  ⚠{" "}
                  {t("Cash runs short in the week shown. Follow up client bills or plan payments.")}
                </Text>
              ) : null}
              <ChartCard
                title={t("In and out by week")}
                table={{
                  head: [t("Week"), t("In"), t("Out"), t("Balance")],
                  rows: data.rows.map((r) => [
                    r.label === "Overdue" ? t("Overdue") : r.label,
                    formatMinorAsRupees(r.inMinor),
                    formatMinorAsRupees(r.outMinor),
                    formatMinorAsRupees(r.balanceMinor),
                  ]),
                }}
              >
                <StackedBars
                  labels={data.rows.map((r) =>
                    r.label === "Overdue" ? t("Overdue") : bucketLabel(r.label),
                  )}
                  series={[
                    { name: t("In"), values: data.rows.map((r) => rupeesForChart(r.inMinor)) },
                    { name: t("Out"), values: data.rows.map((r) => rupeesForChart(r.outMinor)) },
                  ]}
                  format={(n) => shortRupees(BigInt(Math.round(n)) * 100n)}
                />
              </ChartCard>
              <SectionHeader
                title={t("Items")}
                caption={t("{count} entries", { count: data.entries.length })}
              />
              <Card>
                <DataTable
                  head={[t("Date"), t("What"), t("Amount")]}
                  rows={data.entries.map((e) => [
                    e.date,
                    `${e.direction === "in" ? "⬇" : "⬆"} ${t(e.kind)} · ${e.who} ${e.reference}`,
                    formatMinorAsRupees(e.amountMinor),
                  ])}
                />
              </Card>
              {data.laterInMinor !== "0" || data.laterOutMinor !== "0" ? (
                <Text style={[styles.label, { color: colors.muted }]}>
                  {t("After this period")}: {t("in")} {shortRupees(data.laterInMinor)} · {t("out")}{" "}
                  {shortRupees(data.laterOutMinor)}
                </Text>
              ) : null}
              <View />
            </>
          ) : null}
        </ScrollView>
      </Screen>
    </AuthGate>
  );
}

const styles = StyleSheet.create({
  label: { fontSize: 12, lineHeight: 18 },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    marginTop: 6,
  },
});
