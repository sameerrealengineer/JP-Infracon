import { useState, type ReactNode } from "react";
import { Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from "react-native";
import Svg, { Circle, Line, Path, Rect } from "react-native-svg";
import { useColors } from "@/hooks/use-colors";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { useT } from "@/lib/i18n";

/**
 * Small chart set for dashboards (react-native-svg): KPI tiles, bars, stacked bars, lines
 * (S-curve), ranked bars, planned-vs-actual bars and a Gantt. Validated categorical palette
 * (fixed order, light and dark steps), thin marks with 4 px rounded ends, recessive grid, tap a
 * mark for its value, and every chart card can switch to a table.
 */

const SERIES = {
  light: ["#2a78d6", "#eb6834", "#1baf7a", "#eda100"],
  dark: ["#3987e5", "#d95926", "#199e70", "#c98500"],
};

export function useSeriesColors() {
  const scheme = useColorScheme();
  return SERIES[scheme === "dark" ? "dark" : "light"];
}

function useWidth(initial = 300) {
  const [width, setWidth] = useState(initial);
  const onLayout = (event: LayoutChangeEvent) => {
    const next = Math.round(event.nativeEvent.layout.width);
    if (next > 0 && Math.abs(next - width) > 1) setWidth(next);
  };
  return { width, onLayout };
}

/** A card holding one chart, with a Chart / Table switch when a table is given. */
export function ChartCard({
  title,
  subtitle,
  table,
  children,
  empty,
}: {
  title: string;
  subtitle?: string;
  table?: { head: string[]; rows: string[][] };
  children: ReactNode;
  empty?: string | null;
}) {
  const colors = useColors();
  const { t } = useT();
  const [asTable, setAsTable] = useState(false);
  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <View style={styles.cardTop}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.cardTitle, { color: colors.foreground }]}>{title}</Text>
          {subtitle ? (
            <Text style={[styles.cardSub, { color: colors.muted }]}>{subtitle}</Text>
          ) : null}
        </View>
        {table && !empty ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={asTable ? t("Show chart") : t("Show table")}
            onPress={() => setAsTable((value) => !value)}
            hitSlop={8}
            style={[styles.toggle, { borderColor: colors.border }]}
          >
            <Text style={[styles.toggleText, { color: colors.primary }]}>
              {asTable ? t("Chart") : t("Table")}
            </Text>
          </Pressable>
        ) : null}
      </View>
      {empty ? (
        <Text style={[styles.empty, { color: colors.muted }]}>{empty}</Text>
      ) : asTable && table ? (
        <DataTable head={table.head} rows={table.rows} />
      ) : (
        children
      )}
    </View>
  );
}

export function DataTable({ head, rows }: { head: string[]; rows: string[][] }) {
  const colors = useColors();
  return (
    <View>
      <View style={[styles.tr, { borderBottomColor: colors.border }]}>
        {head.map((cell, index) => (
          <Text key={index} style={[styles.th, index > 0 && styles.num, { color: colors.muted }]}>
            {cell}
          </Text>
        ))}
      </View>
      {rows.map((row, r) => (
        <View key={r} style={[styles.tr, { borderBottomColor: colors.border }]}>
          {row.map((cell, index) => (
            <Text
              key={index}
              style={[styles.td, index > 0 && styles.num, { color: colors.foreground }]}
            >
              {cell}
            </Text>
          ))}
        </View>
      ))}
    </View>
  );
}

/** Headline numbers in a grid of 2 (phone) or more. */
export function KpiGrid({
  items,
}: {
  items: { label: string; value: string; sub?: string; tone?: "good" | "warn" | "bad" }[];
}) {
  const colors = useColors();
  const tone = { good: colors.success, warn: colors.warning, bad: colors.error };
  return (
    <View style={styles.kpis}>
      {items.map((item) => (
        <View
          key={item.label}
          style={[styles.kpi, { backgroundColor: colors.surface, borderColor: colors.border }]}
        >
          <Text style={[styles.kpiLabel, { color: colors.muted }]} numberOfLines={2}>
            {item.label}
          </Text>
          <Text
            style={[styles.kpiValue, { color: colors.foreground }]}
            numberOfLines={1}
            adjustsFontSizeToFit
          >
            {item.value}
          </Text>
          {item.sub ? (
            <Text
              style={[styles.kpiSub, { color: item.tone ? tone[item.tone] : colors.muted }]}
              numberOfLines={2}
            >
              {item.tone === "bad"
                ? "▲ "
                : item.tone === "good"
                  ? "✓ "
                  : item.tone === "warn"
                    ? "! "
                    : ""}
              {item.sub}
            </Text>
          ) : null}
        </View>
      ))}
    </View>
  );
}

function Legend({ names, colorsList }: { names: string[]; colorsList: string[] }) {
  const colors = useColors();
  if (names.length < 2) return null;
  return (
    <View style={styles.legend}>
      {names.map((name, index) => (
        <View key={name} style={styles.legendItem}>
          <View
            style={[styles.swatch, { backgroundColor: colorsList[index % colorsList.length] }]}
          />
          <Text style={[styles.legendText, { color: colors.muted }]}>{name}</Text>
        </View>
      ))}
    </View>
  );
}

/** Rounded-top bar path anchored to the baseline (4 px radius, or less for short bars). */
function barPath(x: number, y: number, w: number, h: number, r = 4) {
  if (h <= 0) return "";
  const rr = Math.min(r, w / 2, h);
  return `M${x},${y + h} L${x},${y + rr} Q${x},${y} ${x + rr},${y} L${x + w - rr},${y} Q${x + w},${y} ${x + w},${y + rr} L${x + w},${y + h} Z`;
}

/** Stacked (or single) vertical bars over time; tap a column for its values. */
export function StackedBars({
  labels,
  series,
  format,
  height = 160,
}: {
  labels: string[];
  series: { name: string; values: number[] }[];
  format: (value: number) => string;
  height?: number;
}) {
  const colors = useColors();
  const palette = useSeriesColors();
  const { width, onLayout } = useWidth();
  const [picked, setPicked] = useState<number | null>(null);
  const totals = labels.map((_, i) => series.reduce((sum, s) => sum + (s.values[i] ?? 0), 0));
  const max = Math.max(1, ...totals);
  const n = Math.max(1, labels.length);
  const slot = width / n;
  const barW = Math.max(3, Math.min(28, slot * 0.6));
  const top = 4;
  const plot = height - top;
  const shown = picked ?? totals.length - 1;
  return (
    <View onLayout={onLayout}>
      <Text style={[styles.readout, { color: colors.foreground }]}>
        {labels[shown] ?? ""}: {format(totals[shown] ?? 0)}
        {series.length > 1
          ? `  (${series.map((s) => `${s.name} ${format(s.values[shown] ?? 0)}`).join(", ")})`
          : ""}
      </Text>
      <Svg width={width} height={height}>
        {[0.5, 1].map((f) => (
          <Line
            key={f}
            x1={0}
            x2={width}
            y1={top + plot * (1 - f)}
            y2={top + plot * (1 - f)}
            stroke={colors.border}
            strokeWidth={1}
          />
        ))}
        {labels.flatMap((_, i) => {
          let y = top + plot;
          const x = i * slot + (slot - barW) / 2;
          const lastSeries = series.reduce(
            (last, s, si) => ((s.values[i] ?? 0) > 0 ? si : last),
            -1,
          );
          return series.map((s, si) => {
            const h = ((s.values[i] ?? 0) / max) * plot;
            y -= h;
            if (h <= 0) return null;
            // The top segment gets the rounded end; lower ones keep a 1 px gap above them.
            const d =
              si === lastSeries
                ? barPath(x, y, barW, h)
                : `M${x},${y + h} L${x},${y + 1} L${x + barW},${y + 1} L${x + barW},${y + h} Z`;
            return (
              <Path
                key={`${i}-${si}`}
                d={d}
                fill={palette[si % palette.length]}
                opacity={picked === null || picked === i ? 1 : 0.45}
              />
            );
          });
        })}
        {labels.map((_, i) => (
          <Rect
            key={`t${i}`}
            x={i * slot}
            y={0}
            width={slot}
            height={height}
            fill="transparent"
            onPress={() => setPicked(i)}
          />
        ))}
        <Line
          x1={0}
          x2={width}
          y1={top + plot}
          y2={top + plot}
          stroke={colors.muted}
          strokeWidth={1}
        />
      </Svg>
      <View style={styles.axis}>
        <Text style={[styles.axisText, { color: colors.muted }]}>{labels[0]}</Text>
        <Text style={[styles.axisText, { color: colors.muted }]}>{labels[labels.length - 1]}</Text>
      </View>
      <Legend names={series.map((s) => s.name)} colorsList={palette} />
    </View>
  );
}

/** One or two lines (e.g. planned vs actual %), tap to read a point. */
export function LineChart({
  labels,
  series,
  max,
  format,
  height = 170,
}: {
  labels: string[];
  series: { name: string; values: (number | null)[]; dashed?: boolean }[];
  max?: number;
  format: (value: number) => string;
  height?: number;
}) {
  const colors = useColors();
  const palette = useSeriesColors();
  const { width, onLayout } = useWidth();
  const [picked, setPicked] = useState<number | null>(null);
  const all = series.flatMap((s) => s.values.filter((v): v is number => v !== null));
  const top = Math.max(1, max ?? Math.max(...all, 1));
  const n = Math.max(2, labels.length);
  const pad = 6;
  const x = (i: number) => pad + (i / (n - 1)) * (width - pad * 2);
  const y = (v: number) => 6 + (1 - v / top) * (height - 12);
  const lastWith = (s: { values: (number | null)[] }) => {
    for (let i = s.values.length - 1; i >= 0; i--) if (s.values[i] !== null) return i;
    return 0;
  };
  const shown = picked ?? lastWith(series[series.length - 1] ?? { values: [] });
  return (
    <View onLayout={onLayout}>
      <Text style={[styles.readout, { color: colors.foreground }]}>
        {labels[shown] ?? ""}:{" "}
        {series
          .map(
            (s) =>
              `${s.name} ${s.values[shown] === null || s.values[shown] === undefined ? "—" : format(s.values[shown]!)}`,
          )
          .join(" · ")}
      </Text>
      <Svg width={width} height={height}>
        {[0.25, 0.5, 0.75, 1].map((f) => (
          <Line
            key={f}
            x1={0}
            x2={width}
            y1={y(top * f)}
            y2={y(top * f)}
            stroke={colors.border}
            strokeWidth={1}
          />
        ))}
        <Line x1={0} x2={width} y1={y(0)} y2={y(0)} stroke={colors.muted} strokeWidth={1} />
        {series.map((s, si) => {
          let d = "";
          s.values.forEach((v, i) => {
            if (v === null) return;
            d += `${d ? "L" : "M"}${x(i)},${y(v)} `;
          });
          return (
            <Path
              key={s.name}
              d={d}
              stroke={palette[si % palette.length]}
              strokeWidth={2}
              strokeDasharray={s.dashed ? "6,4" : undefined}
              fill="none"
            />
          );
        })}
        <Line
          x1={x(shown)}
          x2={x(shown)}
          y1={0}
          y2={height}
          stroke={colors.muted}
          strokeWidth={1}
          strokeDasharray="2,3"
        />
        {series.map((s, si) =>
          s.values[shown] === null || s.values[shown] === undefined ? null : (
            <Circle
              key={`p${si}`}
              cx={x(shown)}
              cy={y(s.values[shown]!)}
              r={4.5}
              fill={palette[si % palette.length]}
              stroke={colors.surface}
              strokeWidth={2}
            />
          ),
        )}
        {labels.map((_, i) => (
          <Rect
            key={`h${i}`}
            x={x(i) - width / n / 2}
            y={0}
            width={width / n}
            height={height}
            fill="transparent"
            onPress={() => setPicked(i)}
          />
        ))}
      </Svg>
      <View style={styles.axis}>
        <Text style={[styles.axisText, { color: colors.muted }]}>{labels[0]}</Text>
        <Text style={[styles.axisText, { color: colors.muted }]}>{labels[labels.length - 1]}</Text>
      </View>
      <Legend names={series.map((s) => s.name)} colorsList={palette} />
    </View>
  );
}

/** Ranked horizontal bars: label, value text and a thin bar (top-N lists). */
export function RankBars({
  rows,
  colorIndex = 0,
}: {
  rows: { label: string; value: number; display: string; sub?: string }[];
  colorIndex?: number;
}) {
  const colors = useColors();
  const palette = useSeriesColors();
  const max = Math.max(1, ...rows.map((row) => row.value));
  return (
    <View style={{ gap: 10 }}>
      {rows.map((row) => (
        <View key={row.label}>
          <View style={styles.rankTop}>
            <Text style={[styles.rankLabel, { color: colors.foreground }]} numberOfLines={1}>
              {row.label}
            </Text>
            <Text style={[styles.rankValue, { color: colors.foreground }]}>{row.display}</Text>
          </View>
          <View style={[styles.track, { backgroundColor: colors.border }]}>
            <View
              style={[
                styles.fill,
                {
                  width: `${Math.max(2, (row.value / max) * 100)}%`,
                  backgroundColor: palette[colorIndex % palette.length],
                },
              ]}
            />
          </View>
          {row.sub ? (
            <Text style={[styles.rankSub, { color: colors.muted }]}>{row.sub}</Text>
          ) : null}
        </View>
      ))}
    </View>
  );
}

/** Actual progress bar with a marker where the plan says it should be. */
export function PlanVsActual({
  rows,
}: {
  rows: { label: string; actual: number; planned: number; note?: string }[];
}) {
  const colors = useColors();
  const palette = useSeriesColors();
  const { t } = useT();
  return (
    <View style={{ gap: 12 }}>
      {rows.map((row) => {
        const behind = row.actual + 5 < row.planned;
        return (
          <View key={row.label}>
            <View style={styles.rankTop}>
              <Text style={[styles.rankLabel, { color: colors.foreground }]} numberOfLines={1}>
                {row.label}
              </Text>
              <Text
                style={[styles.rankValue, { color: behind ? colors.error : colors.foreground }]}
              >
                {behind ? "▼ " : ""}
                {row.actual.toFixed(1)}% / {t("plan")} {row.planned.toFixed(1)}%
              </Text>
            </View>
            <View style={[styles.track, { backgroundColor: colors.border, height: 10 }]}>
              <View
                style={[
                  styles.fill,
                  {
                    width: `${Math.min(100, row.actual)}%`,
                    backgroundColor: palette[0],
                    height: 10,
                  },
                ]}
              />
              <View
                style={[
                  styles.marker,
                  { left: `${Math.min(100, row.planned)}%`, backgroundColor: colors.foreground },
                ]}
              />
            </View>
            {row.note ? (
              <Text style={[styles.rankSub, { color: colors.muted }]}>{row.note}</Text>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

/** Task bars on a day timeline with a "today" line; late tasks are marked. */
export function Gantt({
  days,
  todayOffset,
  rows,
}: {
  days: number;
  todayOffset: number;
  rows: {
    id: string;
    code: string;
    title: string;
    status: string;
    offset: number;
    length: number;
    late: boolean;
  }[];
}) {
  const colors = useColors();
  const palette = useSeriesColors();
  const { width, onLayout } = useWidth();
  const labelW = Math.min(130, width * 0.38);
  const plotW = Math.max(40, width - labelW);
  const scale = plotW / Math.max(1, days);
  return (
    <View onLayout={onLayout}>
      {rows.map((row) => (
        <View key={row.id} style={styles.ganttRow}>
          <Text
            style={[
              styles.ganttLabel,
              { width: labelW, color: row.late ? colors.error : colors.foreground },
            ]}
            numberOfLines={1}
          >
            {row.late ? "! " : ""}
            {row.code} {row.title}
          </Text>
          <Svg width={plotW} height={18}>
            <Rect x={0} y={8} width={plotW} height={1} fill={colors.border} />
            <Rect
              x={row.offset * scale}
              y={3}
              width={Math.max(3, row.length * scale)}
              height={12}
              rx={4}
              fill={row.status === "Completed" ? palette[2] : row.late ? palette[1] : palette[0]}
            />
            {todayOffset >= 0 && todayOffset <= days ? (
              <Line
                x1={todayOffset * scale}
                x2={todayOffset * scale}
                y1={0}
                y2={18}
                stroke={colors.foreground}
                strokeWidth={1}
              />
            ) : null}
          </Svg>
        </View>
      ))}
      <Legend
        names={["Planned", "Late", "Completed"]}
        colorsList={[palette[0]!, palette[1]!, palette[2]!]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 16, padding: 14, gap: 10 },
  cardTop: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  cardTitle: { fontSize: 15, fontWeight: "800" },
  cardSub: { fontSize: 12, marginTop: 2, lineHeight: 17 },
  toggle: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  toggleText: { fontSize: 12, fontWeight: "700" },
  empty: { fontSize: 13, paddingVertical: 12 },
  tr: {
    flexDirection: "row",
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingVertical: 6,
    gap: 8,
  },
  th: { flex: 1, fontSize: 11, fontWeight: "700" },
  td: { flex: 1, fontSize: 12 },
  num: { textAlign: "right" },
  kpis: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  kpi: {
    flexGrow: 1,
    flexBasis: "45%",
    minWidth: 140,
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
    gap: 2,
  },
  kpiLabel: { fontSize: 12, fontWeight: "600" },
  kpiValue: { fontSize: 22, fontWeight: "800" },
  kpiSub: { fontSize: 11, fontWeight: "600" },
  readout: { fontSize: 12, fontWeight: "600", marginBottom: 6 },
  axis: { flexDirection: "row", justifyContent: "space-between", marginTop: 4 },
  axisText: { fontSize: 11 },
  legend: { flexDirection: "row", flexWrap: "wrap", gap: 12, marginTop: 8 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 6 },
  swatch: { width: 10, height: 10, borderRadius: 3 },
  legendText: { fontSize: 12 },
  rankTop: { flexDirection: "row", justifyContent: "space-between", gap: 8, marginBottom: 4 },
  rankLabel: { flex: 1, fontSize: 13, fontWeight: "600" },
  rankValue: { fontSize: 13, fontWeight: "700" },
  rankSub: { fontSize: 11, marginTop: 3 },
  track: { height: 8, borderRadius: 4, overflow: "hidden", position: "relative" },
  fill: { height: 8, borderRadius: 4 },
  marker: { position: "absolute", top: -2, width: 2, height: 14, marginLeft: -1 },
  ganttRow: { flexDirection: "row", alignItems: "center", marginBottom: 6 },
  ganttLabel: { fontSize: 11, paddingRight: 6 },
});
