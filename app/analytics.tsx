import { useRouter } from "expo-router";
import { useState } from "react";
import { RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { AuthGate } from "@/components/jp/auth-gate";
import {
  ChartCard,
  KpiGrid,
  LineChart,
  PlanVsActual,
  RankBars,
  StackedBars,
} from "@/components/jp/charts";
import {
  AppHeader,
  ChipGroup,
  InlineError,
  LoadingBlock,
  Screen,
  SecondaryButton,
  SectionHeader,
} from "@/components/jp/ui";
import { useColors } from "@/hooks/use-colors";
import { useT } from "@/lib/i18n";
import { rupeesForChart, shortRupees } from "@/lib/jp/analytics";
import { formatMinorAsRupees } from "@/lib/jp/finance-domain";
import { trpc } from "@/lib/trpc";

type Range = "7" | "30" | "90";

/** "purchase.review" → "Purchase review". */
function kindLabel(kind: string) {
  const text = kind.replace(/[._]/g, " ").trim();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * Analytics: money, progress, labour and materials for one site or all of yours, with the
 * same permissions as the screens behind them (sections you may not see are left out).
 */
export default function AnalyticsScreen() {
  const { t } = useT();
  const colors = useColors();
  const router = useRouter();
  const [range, setRange] = useState<Range>("30");
  const [siteId, setSiteId] = useState<string>("all");
  const overview = trpc.jp.analytics.overview.useQuery({
    days: Number(range) as 7 | 30 | 90,
    siteId: siteId === "all" ? null : siteId,
  });
  const data = overview.data;
  const rupee = (n: number) => shortRupees(BigInt(Math.round(n)) * 100n);
  const sites = data?.sites ?? [];

  return (
    <AuthGate>
      <Screen>
        <ScrollView
          contentContainerStyle={{ paddingBottom: 40, gap: 12 }}
          refreshControl={
            <RefreshControl
              refreshing={overview.isRefetching}
              onRefresh={() => void overview.refetch()}
            />
          }
        >
          <AppHeader
            eyebrow={t("Analytics")}
            title={t("Business dashboard")}
            subtitle={t("Money, progress, labour and materials, from your own records.")}
          />
          <ChipGroup
            options={["7", "30", "90"] as const}
            value={range}
            onChange={setRange}
            format={(value) => t("{days} days", { days: value })}
          />
          {sites.length > 1 || siteId !== "all" ? (
            <ChipGroup
              options={["all", ...sites.map((site) => site.id)]}
              value={siteId}
              onChange={setSiteId}
              format={(id) =>
                id === "all" ? t("All sites") : (sites.find((s) => s.id === id)?.name ?? id)
              }
            />
          ) : null}
          {overview.isLoading ? <LoadingBlock label={t("Loading…")} /> : null}
          {overview.isError ? (
            <InlineError
              message={t(overview.error.message)}
              onRetry={() => void overview.refetch()}
            />
          ) : null}
          {data ? (
            <>
              <KpiGrid
                items={[
                  ...(data.moneyOut
                    ? [
                        {
                          label: t("Money out"),
                          value: shortRupees(data.moneyOut.totalMinor),
                          sub: t("{days} days", { days: range }),
                        },
                      ]
                    : []),
                  ...(data.moneyIn
                    ? [
                        {
                          label: t("Money received"),
                          value: shortRupees(data.moneyIn.totalMinor),
                          sub: t("from clients"),
                          tone: "good" as const,
                        },
                      ]
                    : []),
                  ...(data.payables
                    ? [
                        {
                          label: t("Suppliers to pay"),
                          value: shortRupees(data.payables.totalMinor),
                          sub: t("{amount} overdue", {
                            amount: shortRupees(
                              data.payables.ageing
                                .filter((row) => row.bucket !== "Not due")
                                .reduce((sum, row) => sum + BigInt(row.amountMinor), 0n),
                            ),
                          }),
                          tone: data.payables.ageing.some(
                            (row) => row.bucket !== "Not due" && row.amountMinor !== "0",
                          )
                            ? ("bad" as const)
                            : ("good" as const),
                        },
                      ]
                    : []),
                  ...(data.labour
                    ? [
                        {
                          label: t("Workers today"),
                          value: String(data.labour.headcountToday),
                          sub: t("present or half day"),
                        },
                      ]
                    : []),
                  ...(data.labour?.costTotalMinor
                    ? [
                        {
                          label: t("Labour cost"),
                          value: shortRupees(data.labour.costTotalMinor),
                          sub: t("estimated from attendance"),
                        },
                      ]
                    : []),
                  ...(data.advancesOutstanding
                    ? [
                        {
                          label: t("Advances out"),
                          value: shortRupees(data.advancesOutstanding.totalMinor),
                          sub: t("given minus repaid"),
                        },
                      ]
                    : []),
                  ...(data.progress?.length
                    ? [
                        {
                          label: t("Sites behind plan"),
                          value: String(
                            data.progress.filter((row) => row.health === "behind").length,
                          ),
                          sub: t("of {count}", { count: data.progress.length }),
                          tone: data.progress.some((row) => row.health === "behind")
                            ? ("bad" as const)
                            : ("good" as const),
                        },
                      ]
                    : []),
                  ...(data.materials
                    ? [
                        {
                          label: t("Low stock items"),
                          value: String(data.materials.lowStock.length),
                          tone: data.materials.lowStock.length
                            ? ("warn" as const)
                            : ("good" as const),
                          sub: t("at or below reorder level"),
                        },
                      ]
                    : []),
                ]}
              />

              {data.moneyOut ? (
                <>
                  <SectionHeader title={t("Money")} />
                  <ChartCard
                    title={t("Money out over time")}
                    subtitle={t(
                      "Approved or posted supplier payments, petty cash spent and worker advances",
                    )}
                    empty={
                      data.moneyOut.totalMinor === "0"
                        ? t("No money went out in this period.")
                        : null
                    }
                    table={{
                      head: [t("Period"), ...data.moneyOut.seriesShown.map((name) => t(name))],
                      rows: data.labels.map((label, i) => [
                        label,
                        ...data.moneyOut!.seriesShown.map((name) =>
                          formatMinorAsRupees(data.moneyOut!.series[name]?.[i] ?? "0"),
                        ),
                      ]),
                    }}
                  >
                    <StackedBars
                      labels={data.labels}
                      series={data.moneyOut.seriesShown.map((name) => ({
                        name: t(name),
                        values: (data.moneyOut!.series[name] ?? []).map(rupeesForChart),
                      }))}
                      format={rupee}
                    />
                  </ChartCard>
                  <ChartCard
                    title={t("Where the money went")}
                    subtitle={t("By category")}
                    empty={data.moneyOut.byCategory.length ? null : t("Nothing yet.")}
                  >
                    <RankBars
                      rows={data.moneyOut.byCategory.map((row) => ({
                        label: t(row.key),
                        value: rupeesForChart(row.amountMinor),
                        display: shortRupees(row.amountMinor),
                      }))}
                    />
                  </ChartCard>
                  <ChartCard
                    title={t("Who was paid most")}
                    empty={data.moneyOut.topPayees.length ? null : t("Nothing yet.")}
                  >
                    <RankBars
                      colorIndex={1}
                      rows={data.moneyOut.topPayees.map((row) => ({
                        label: row.key,
                        value: rupeesForChart(row.amountMinor),
                        display: shortRupees(row.amountMinor),
                      }))}
                    />
                  </ChartCard>
                  {siteId === "all" && data.moneyOut.bySite.length > 1 ? (
                    <ChartCard title={t("Money out by site")}>
                      <RankBars
                        colorIndex={2}
                        rows={data.moneyOut.bySite.map((row) => ({
                          label: row.key,
                          value: rupeesForChart(row.amountMinor),
                          display: shortRupees(row.amountMinor),
                        }))}
                      />
                    </ChartCard>
                  ) : null}
                </>
              ) : null}

              {data.moneyIn ? (
                <ChartCard
                  title={t("Money received from clients")}
                  empty={data.moneyIn.totalMinor === "0" ? t("No receipts in this period.") : null}
                  table={{
                    head: [t("Period"), t("Received")],
                    rows: data.labels.map((label, i) => [
                      label,
                      formatMinorAsRupees(data.moneyIn!.series[i] ?? "0"),
                    ]),
                  }}
                >
                  <StackedBars
                    labels={data.labels}
                    series={[
                      { name: t("Received"), values: data.moneyIn.series.map(rupeesForChart) },
                    ]}
                    format={rupee}
                  />
                </ChartCard>
              ) : null}

              {data.payables ? (
                <ChartCard
                  title={t("Supplier bills to pay (ageing)")}
                  subtitle={t("Approved bills less payments, by days past due")}
                  empty={
                    data.payables.totalMinor === "0"
                      ? t("All approved supplier bills are paid.")
                      : null
                  }
                  table={{
                    head: [t("Age"), t("Amount")],
                    rows: data.payables.ageing.map((row) => [
                      t(row.bucket),
                      formatMinorAsRupees(row.amountMinor),
                    ]),
                  }}
                >
                  <RankBars
                    colorIndex={1}
                    rows={data.payables.ageing.map((row) => ({
                      label: t(row.bucket),
                      value: rupeesForChart(row.amountMinor),
                      display: shortRupees(row.amountMinor),
                    }))}
                  />
                  {data.payables.topVendors.length ? (
                    <Text style={[styles.note, { color: colors.muted }]}>
                      {t("Most owed")}:{" "}
                      {data.payables.topVendors
                        .map((row) => `${row.key} ${shortRupees(row.amountMinor)}`)
                        .join(" · ")}
                    </Text>
                  ) : null}
                </ChartCard>
              ) : null}

              {data.pettyCash?.length ? (
                <ChartCard title={t("Petty cash in hand")} subtitle={t("Posted balance per fund")}>
                  <RankBars
                    colorIndex={2}
                    rows={data.pettyCash.map((row) => ({
                      label: `${row.fund} · ${row.site}`,
                      value: Math.max(0, rupeesForChart(row.balanceMinor)),
                      display: formatMinorAsRupees(row.balanceMinor),
                    }))}
                  />
                </ChartCard>
              ) : null}

              {data.progress?.length || data.subcontract?.length || data.delayed?.length ? (
                <SectionHeader title={t("Progress")} />
              ) : null}
              {data.progress?.length ? (
                <ChartCard
                  title={t("Planned vs actual")}
                  subtitle={t("The line marks where the plan says each site should be today")}
                >
                  <PlanVsActual
                    rows={data.progress.map((row) => ({
                      label: row.site,
                      actual: row.actual ?? 0,
                      planned: row.planned ?? 0,
                      note:
                        row.overdue || row.blocked
                          ? t("{overdue} overdue · {blocked} blocked", {
                              overdue: row.overdue,
                              blocked: row.blocked,
                            })
                          : undefined,
                    }))}
                  />
                  {data.progress.length === 1 || siteId !== "all" ? (
                    <SecondaryButton
                      icon="stacked-line-chart"
                      label={t("Open Gantt and S-curve")}
                      onPress={() =>
                        router.push(`/gantt?siteId=${data.progress![0]!.siteId}` as never)
                      }
                    />
                  ) : null}
                </ChartCard>
              ) : null}
              {data.delayed?.length ? (
                <ChartCard
                  title={t("Late tasks")}
                  subtitle={t("Past their planned end and not completed")}
                >
                  {data.delayed.map((task) => (
                    <Text
                      key={`${task.siteId}${task.code}`}
                      style={[styles.line, { color: colors.foreground }]}
                    >
                      <Text style={{ color: colors.error }}>! </Text>
                      {task.code} {task.title} · {task.site} ·{" "}
                      {t("due {date}", { date: task.plannedEnd })}
                    </Text>
                  ))}
                </ChartCard>
              ) : null}
              {data.subcontract?.length ? (
                <ChartCard
                  title={t("Subcontractors: work done vs left")}
                  subtitle={t("Measured value against the work order value")}
                >
                  <PlanVsActual
                    rows={data.subcontract.map((row) => ({
                      label: `${row.vendor} · ${row.title}`,
                      actual: row.percent,
                      planned: 100,
                      note: `${shortRupees(row.doneMinor)} ${t("done")} · ${shortRupees((BigInt(row.valueMinor) - BigInt(row.doneMinor)).toString())} ${t("left")} · ${row.site}`,
                    }))}
                  />
                </ChartCard>
              ) : null}
              {data.reportsCompliance?.length ? (
                <ChartCard
                  title={t("Daily reports sent")}
                  subtitle={t("Days with a DPR in this period")}
                >
                  <RankBars
                    colorIndex={3}
                    rows={data.reportsCompliance.map((row) => ({
                      label: row.site,
                      value: row.sent,
                      display: `${row.sent}/${row.days}`,
                    }))}
                  />
                </ChartCard>
              ) : null}

              {data.labour ? (
                <>
                  <SectionHeader title={t("Labour")} />
                  <ChartCard
                    title={t("Attendance per day")}
                    subtitle={t("Present (half day counts ½)")}
                    table={{
                      head: [t("Day"), t("Present"), t("Absent")],
                      rows: data.labels.map((label, i) => [
                        label,
                        String(data.labour!.present[i] ?? 0),
                        String(data.labour!.absent[i] ?? 0),
                      ]),
                    }}
                  >
                    <LineChart
                      labels={data.labels}
                      series={[
                        { name: t("Present"), values: data.labour.present },
                        { name: t("Absent"), values: data.labour.absent },
                      ]}
                      format={(n) => String(n)}
                    />
                  </ChartCard>
                  {data.labour.costMinor ? (
                    <ChartCard
                      title={t("Labour cost")}
                      subtitle={
                        data.labour.missingRate
                          ? t("Estimated from attendance and rates; {count} marks have no rate", {
                              count: data.labour.missingRate,
                            })
                          : t("Estimated from attendance and rates")
                      }
                      table={{
                        head: [t("Period"), t("Cost")],
                        rows: data.labels.map((label, i) => [
                          label,
                          formatMinorAsRupees(data.labour!.costMinor![i] ?? "0"),
                        ]),
                      }}
                    >
                      <StackedBars
                        labels={data.labels}
                        series={[
                          {
                            name: t("Labour cost"),
                            values: data.labour.costMinor.map(rupeesForChart),
                          },
                        ]}
                        format={rupee}
                      />
                    </ChartCard>
                  ) : null}
                  {data.labour.tradeMix.length ? (
                    <ChartCard
                      title={t("Trade mix")}
                      subtitle={t("People who worked in this period")}
                    >
                      <RankBars
                        rows={data.labour.tradeMix.map((row) => ({
                          label: t(row.trade),
                          value: row.people,
                          display: String(row.people),
                        }))}
                      />
                    </ChartCard>
                  ) : null}
                  {data.labour.topAbsent.length ? (
                    <ChartCard title={t("Most days absent")}>
                      <RankBars
                        colorIndex={1}
                        rows={data.labour.topAbsent.map((row) => ({
                          label: row.name,
                          value: row.count,
                          display: String(row.count),
                        }))}
                      />
                    </ChartCard>
                  ) : null}
                </>
              ) : null}
              {data.advancesOutstanding?.top.length ? (
                <ChartCard
                  title={t("Advances outstanding")}
                  subtitle={t("Cash given minus cash repaid; pay-run recoveries show in Khaata")}
                >
                  <RankBars
                    colorIndex={1}
                    rows={data.advancesOutstanding.top.map((row) => ({
                      label: row.key,
                      value: rupeesForChart(row.amountMinor),
                      display: shortRupees(row.amountMinor),
                    }))}
                  />
                </ChartCard>
              ) : null}

              {data.materials || data.materialRequestStatus ? (
                <SectionHeader title={t("Materials")} />
              ) : null}
              {data.materials ? (
                <>
                  <ChartCard
                    title={t("Low stock")}
                    subtitle={t("{count} items in stock", { count: data.materials.itemsInStock })}
                    empty={
                      data.materials.lowStock.length
                        ? null
                        : t("Nothing is at or below its reorder level.")
                    }
                  >
                    {data.materials.lowStock.map((row) => (
                      <Text key={row.name} style={[styles.line, { color: colors.foreground }]}>
                        <Text style={{ color: colors.warning }}>! </Text>
                        {row.name}: {row.onHand} {row.unit} (
                        {t("reorder at {qty}", { qty: row.reorder })})
                      </Text>
                    ))}
                  </ChartCard>
                  <ChartCard
                    title={t("Most used materials")}
                    empty={
                      data.materials.topUsed.length
                        ? null
                        : t("No issues from the store in this period.")
                    }
                  >
                    <RankBars
                      colorIndex={2}
                      rows={data.materials.topUsed.map((row) => ({
                        label: row.name,
                        value: row.qty,
                        display: `${row.qty} ${row.unit}`,
                      }))}
                    />
                  </ChartCard>
                </>
              ) : null}
              {data.materialRequestStatus ? (
                <ChartCard title={t("Material requests")}>
                  <RankBars
                    colorIndex={3}
                    rows={data.materialRequestStatus.map((row) => ({
                      label: t(row.status),
                      value: row.count,
                      display: String(row.count),
                    }))}
                  />
                </ChartCard>
              ) : null}

              {data.issuesBySeverity || data.approvals.length ? (
                <SectionHeader title={t("Attention")} />
              ) : null}
              {data.issuesBySeverity ? (
                <ChartCard title={t("Open safety & quality issues")}>
                  <RankBars
                    colorIndex={1}
                    rows={data.issuesBySeverity.map((row) => ({
                      label: t(row.severity),
                      value: row.open,
                      display: String(row.open),
                    }))}
                  />
                </ChartCard>
              ) : null}
              {data.approvals.length ? (
                <ChartCard title={t("Waiting for you")}>
                  <RankBars
                    rows={data.approvals.map((row) => ({
                      label: t(kindLabel(row.kind)),
                      value: row.count,
                      display: String(row.count),
                    }))}
                  />
                </ChartCard>
              ) : null}
              <Text style={[styles.note, { color: colors.muted }]}>
                {t(
                  "Figures come from approved or posted records. Estimates are marked; they are never a payment basis.",
                )}
              </Text>
            </>
          ) : null}
        </ScrollView>
      </Screen>
    </AuthGate>
  );
}

const styles = StyleSheet.create({
  note: { fontSize: 12, lineHeight: 18 },
  line: { fontSize: 13, lineHeight: 20 },
});
