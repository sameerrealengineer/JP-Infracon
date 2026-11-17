import { useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { ScrollView, StyleSheet, Text } from "react-native";
import { AuthGate } from "@/components/jp/auth-gate";
import { ChartCard, Gantt, LineChart } from "@/components/jp/charts";
import {
  AppHeader,
  ChipGroup,
  EmptyState,
  InlineError,
  LoadingBlock,
  Screen,
} from "@/components/jp/ui";
import { useColors } from "@/hooks/use-colors";
import { useT } from "@/lib/i18n";
import { bucketLabel } from "@/lib/jp/analytics";
import { ganttRows, sCurve } from "@/lib/jp/s-curve";
import { resolveSelectedId } from "@/lib/jp/selection";
import { trpc } from "@/lib/trpc";

/** Gantt chart and planned-vs-actual S-curve for one site, from its tasks and DPRs. */
export default function GanttScreen() {
  const { t } = useT();
  const colors = useColors();
  const params = useLocalSearchParams<{ siteId?: string }>();
  const sites = trpc.jp.workspace.mySites.useQuery();
  const [chosen, setChosen] = useState(typeof params.siteId === "string" ? params.siteId : "");
  const siteId = resolveSelectedId(sites.data ?? [], chosen);
  const schedule = trpc.jp.analytics.schedule.useQuery(
    { siteId },
    { enabled: Boolean(siteId), retry: false },
  );
  const data = schedule.data;
  const curve = data ? sCurve(data.tasks, data.reports, data.today) : null;
  const gantt = data ? ganttRows(data.tasks, data.today) : null;
  return (
    <AuthGate>
      <Screen>
        <ScrollView contentContainerStyle={{ paddingBottom: 40, gap: 12 }}>
          <AppHeader
            eyebrow={t("Schedule")}
            title={t("Gantt chart & S-curve")}
            subtitle={t("Planned dates from tasks; actual from the progress in daily reports.")}
          />
          {(sites.data?.length ?? 0) > 1 ? (
            <ChipGroup
              options={(sites.data ?? []).map((site) => site.id)}
              value={siteId || null}
              onChange={setChosen}
              format={(id) => sites.data?.find((site) => site.id === id)?.name ?? id}
            />
          ) : null}
          {schedule.isLoading ? <LoadingBlock label={t("Loading…")} /> : null}
          {schedule.isError ? (
            <InlineError
              message={t(schedule.error.message)}
              onRetry={() => void schedule.refetch()}
            />
          ) : null}
          {data && !data.tasks.length ? (
            <EmptyState
              icon="event-note"
              title={t("No tasks on this site yet")}
              detail={t("Add tasks in Schedule to see the Gantt and S-curve.")}
            />
          ) : null}
          {curve && curve.points.length ? (
            <ChartCard
              title={t("S-curve: planned vs actual")}
              subtitle={t("Cumulative % of work, weighted by task duration")}
              table={{
                head: [t("Date"), t("Planned %"), t("Actual %")],
                rows: curve.points.map((p) => [
                  p.date,
                  p.planned.toFixed(1),
                  p.actual === null ? "—" : p.actual.toFixed(1),
                ]),
              }}
            >
              <LineChart
                labels={curve.points.map((p) => bucketLabel(p.date))}
                series={[
                  { name: t("Planned"), values: curve.points.map((p) => p.planned), dashed: true },
                  { name: t("Actual"), values: curve.points.map((p) => p.actual) },
                ]}
                max={100}
                format={(n) => `${n.toFixed(1)}%`}
              />
            </ChartCard>
          ) : null}
          {gantt && gantt.rows.length ? (
            <ChartCard
              title={t("Gantt chart")}
              subtitle={t("{count} tasks from {date}; the line is today", {
                count: gantt.rows.length,
                date: gantt.start ?? "",
              })}
            >
              <Gantt days={gantt.days} todayOffset={gantt.todayOffset ?? -1} rows={gantt.rows} />
            </ChartCard>
          ) : null}
          <Text style={[styles.note, { color: colors.muted }]}>
            {t("An estimate for monitoring, never a payment basis.")}
          </Text>
        </ScrollView>
      </Screen>
    </AuthGate>
  );
}

const styles = StyleSheet.create({ note: { fontSize: 12, lineHeight: 18 } });
