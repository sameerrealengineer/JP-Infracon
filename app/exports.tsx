import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useMemo, useState } from "react";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import { Platform, ScrollView, StyleSheet, Text, View } from "react-native";
import { AuthGate } from "@/components/jp/auth-gate";
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
  SectionHeader,
  StatusPill,
  formatDateTime,
} from "@/components/jp/ui";
import { useColors } from "@/hooks/use-colors";
import { useConnectivity } from "@/hooks/use-connectivity";
import { resolveChoice } from "@/lib/jp/selection";
import { trpc } from "@/lib/trpc";
import { deliverTextFile } from "@/lib/device-files";
import { buildReportHtml } from "@/lib/jp/pdf-report";

const ranges = ["This month", "Last month", "Last 30 days", "This year", "Custom"] as const;
type Range = (typeof ranges)[number];

function iso(date: Date) {
  return date.toISOString().slice(0, 10);
}
function rangeDates(range: Range, today = new Date()): { from: string; to: string } {
  const y = today.getFullYear();
  const m = today.getMonth();
  if (range === "This month") return { from: iso(new Date(Date.UTC(y, m, 1))), to: iso(today) };
  if (range === "Last month")
    return { from: iso(new Date(Date.UTC(y, m - 1, 1))), to: iso(new Date(Date.UTC(y, m, 0))) };
  if (range === "This year") return { from: `${y}-01-01`, to: iso(today) };
  return { from: iso(new Date(today.getTime() - 29 * 86_400_000)), to: iso(today) };
}

export default function ExportsScreen() {
  const colors = useColors();
  const { online } = useConnectivity();
  const options = trpc.jp.exports.options.useQuery();
  const sites = trpc.jp.workspace.mySites.useQuery();
  const generate = trpc.jp.exports.generate.useMutation();
  const [chosenKind, setKind] = useState<string>("");
  const [siteId, setSiteId] = useState<string>("all");
  const [range, setRange] = useState<Range>("This month");
  const [format, setFormat] = useState<"Excel (CSV)" | "PDF">("Excel (CSV)");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [last, setLast] = useState<{
    fileName: string;
    rows: number;
    truncated: boolean;
    at: string;
  } | null>(null);

  const kinds = useMemo(() => (options.data ?? []).map((row) => row.kind), [options.data]);
  const kind = resolveChoice(kinds, chosenKind || kinds[0] || "");
  const option = options.data?.find((row) => row.kind === kind);
  const siteChoices = ["all", ...(option?.siteIds ?? [])];
  const site = resolveChoice(siteChoices, siteId);
  const dates = range === "Custom" ? { from: customFrom, to: customTo } : rangeDates(range);
  const datesValid =
    /^\d{4}-\d{2}-\d{2}$/.test(dates.from) &&
    /^\d{4}-\d{2}-\d{2}$/.test(dates.to) &&
    dates.from <= dates.to;

  const run = async () => {
    if (!kind) return;
    setError(null);
    try {
      const result = await generate.mutateAsync({
        kind: kind as never,
        siteId: site === "all" ? undefined : site,
        from: dates.from,
        to: dates.to,
      });
      if (format === "PDF") {
        const html = buildReportHtml(result.table);
        if (Platform.OS === "web") await Print.printAsync({ html });
        else {
          const { uri } = await Print.printToFileAsync({ html });
          if (await Sharing.isAvailableAsync())
            await Sharing.shareAsync(uri, {
              mimeType: "application/pdf",
              dialogTitle: result.fileName.replace(/\.csv$/, ".pdf"),
            });
        }
      } else await deliverTextFile(result.fileName, result.csv, "text/csv");
      setLast({
        fileName: result.fileName,
        rows: result.rowCount,
        truncated: result.truncated,
        at: result.generatedAt,
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The export could not be created.");
    }
  };

  return (
    <AuthGate>
      <Screen>
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 40 }}
        >
          <AppHeader
            eyebrow="Reports"
            title="Export data"
            subtitle="Download a CSV for Excel or Google Sheets — only the sites and records you are allowed to see."
          />
          {options.error ? (
            <InlineError message={options.error.message} onRetry={() => void options.refetch()} />
          ) : null}
          {options.isLoading ? (
            <LoadingBlock label="Checking what you can export…" />
          ) : !kinds.length ? (
            <EmptyState
              icon="lock-outline"
              title="Nothing to export"
              detail="Your role does not include any exportable records yet."
            />
          ) : (
            <>
              <SectionHeader title="What" />
              <ChipGroup
                options={kinds}
                value={kind}
                onChange={setKind}
                format={(value) => options.data?.find((row) => row.kind === value)?.label ?? value}
              />
              <SectionHeader title="Where" />
              <ChipGroup
                options={siteChoices}
                value={site}
                onChange={setSiteId}
                format={(value) =>
                  value === "all"
                    ? "All my sites"
                    : (sites.data?.find((row) => row.id === value)?.name ?? "Site")
                }
              />
              <SectionHeader title="Format" />
              <ChipGroup
                options={["Excel (CSV)", "PDF"] as const}
                value={format}
                onChange={setFormat}
              />
              <SectionHeader title="When" />
              <ChipGroup options={ranges} value={range} onChange={setRange} />
              {range === "Custom" ? (
                <View style={{ flexDirection: "row", gap: 10 }}>
                  <View style={{ flex: 1 }}>
                    <Field
                      label="From"
                      value={customFrom}
                      onChangeText={setCustomFrom}
                      placeholder="YYYY-MM-DD"
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Field
                      label="To"
                      value={customTo}
                      onChangeText={setCustomTo}
                      placeholder="YYYY-MM-DD"
                    />
                  </View>
                </View>
              ) : (
                <Text style={[styles.range, { color: colors.muted }]}>
                  {dates.from} → {dates.to}
                </Text>
              )}
              {error ? <InlineError message={error} title="Export failed" /> : null}
              <PrimaryButton
                icon="file-download"
                label={
                  online === false
                    ? "Connect to export"
                    : format === "PDF"
                      ? "Create PDF"
                      : "Create CSV"
                }
                tone="gold"
                disabled={!datesValid || online === false}
                loading={generate.isPending}
                onPress={() => void run()}
              />
              {last ? (
                <Card accent="success" style={{ marginTop: 16 }}>
                  <View style={{ flex: 1, gap: 4 }}>
                    <View style={styles.lastTop}>
                      <MaterialIcons name="task-alt" size={18} color={colors.success} />
                      <Text
                        style={[styles.lastTitle, { color: colors.foreground }]}
                        numberOfLines={1}
                      >
                        {last.fileName}
                      </Text>
                    </View>
                    <Text style={[styles.range, { color: colors.muted }]}>
                      {last.rows} rows · {formatDateTime(last.at)}
                    </Text>
                    {last.truncated ? (
                      <StatusPill
                        label="Limited to 5000 rows — export a shorter period"
                        tone="warning"
                        compact
                      />
                    ) : null}
                  </View>
                </Card>
              ) : null}
              <Text style={[styles.note, { color: colors.muted }]}>
                Each file lists the organisation, sites, period, time generated and row count. Every
                export is recorded in the audit trail.
              </Text>
            </>
          )}
        </ScrollView>
      </Screen>
    </AuthGate>
  );
}

const styles = StyleSheet.create({
  range: { fontSize: 12, marginBottom: 14 },
  lastTop: { flexDirection: "row", alignItems: "center", gap: 8 },
  lastTitle: { fontSize: 13, fontWeight: "800", flex: 1 },
  note: { fontSize: 11, lineHeight: 16, marginTop: 16, textAlign: "center" },
});
