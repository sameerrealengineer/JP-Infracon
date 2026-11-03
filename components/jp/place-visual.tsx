import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { Image } from "expo-image";
import { StyleSheet, Text, View } from "react-native";
import { Card, StatusPill, useToneColor, type Tone } from "@/components/jp/ui";
import { useColors } from "@/hooks/use-colors";
import type { ProgressSummary } from "@/lib/jp/progress-domain";

const HEALTH: Record<NonNullable<ProgressSummary["health"]>, { label: string; tone: Tone }> = {
  ahead: { label: "Ahead of plan", tone: "success" },
  "on track": { label: "On track", tone: "info" },
  behind: { label: "Behind plan", tone: "error" },
};

export function percentText(tenths: number | null | undefined) {
  if (tenths === null || tenths === undefined) return "—";
  return `${Math.round(tenths / 10)}%`;
}

/** A wide cover photo, or a calm placeholder with an icon when there is none. */
export function CoverPhoto({
  uri,
  height = 160,
  icon = "apartment",
  label,
}: {
  uri: string | null | undefined;
  height?: number;
  icon?: "apartment" | "location-city" | "construction";
  label?: string;
}) {
  const colors = useColors();
  if (uri)
    return (
      <Image
        source={{ uri }}
        style={[styles.cover, { height, backgroundColor: colors.border }]}
        contentFit="cover"
        cachePolicy="memory-disk"
        transition={150}
        accessibilityLabel={label ? `Photo of ${label}` : "Cover photo"}
      />
    );
  return (
    <View
      style={[
        styles.cover,
        styles.placeholder,
        { height, backgroundColor: colors.surface, borderColor: colors.border },
      ]}
    >
      <MaterialIcons name={icon} size={40} color={colors.muted} />
    </View>
  );
}

/** A thin bar: the filled part is actual progress, the marker is where the plan says it should be. */
export function ProgressBar({
  actualTenths,
  expectedTenths,
  tone = "success",
  height = 8,
}: {
  actualTenths: number | null;
  expectedTenths?: number | null;
  tone?: Tone;
  height?: number;
}) {
  const colors = useColors();
  const fill = useToneColor(tone);
  const actual = Math.max(0, Math.min(1000, actualTenths ?? 0)) / 10;
  const expected =
    expectedTenths === null || expectedTenths === undefined
      ? null
      : Math.max(0, Math.min(1000, expectedTenths)) / 10;
  return (
    <View
      style={[styles.track, { height, borderRadius: height / 2, backgroundColor: colors.border }]}
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: 100, now: Math.round(actual) }}
    >
      <View
        style={{ width: `${actual}%`, height, borderRadius: height / 2, backgroundColor: fill }}
      />
      {expected !== null ? (
        <View
          style={[
            styles.marker,
            { left: `${expected}%`, height: height + 6, backgroundColor: colors.foreground },
          ]}
        />
      ) : null}
    </View>
  );
}

/** Progress of a site or project: actual vs planned, with task counts. */
export function ProgressCard({
  summary,
  title = "Progress",
}: {
  summary: ProgressSummary;
  title?: string;
}) {
  const colors = useColors();
  if (summary.total === 0)
    return (
      <Card>
        <Text style={[styles.title, { color: colors.foreground }]}>{title}</Text>
        <Text style={[styles.meta, { color: colors.muted }]}>
          Add tasks in Schedule to see progress here.
        </Text>
      </Card>
    );
  const health = summary.health ? HEALTH[summary.health] : null;
  return (
    <Card>
      <View style={styles.row}>
        <Text style={[styles.title, { color: colors.foreground }]}>{title}</Text>
        {health ? <StatusPill label={health.label} tone={health.tone} compact /> : null}
      </View>
      <View style={styles.bigRow}>
        <Text style={[styles.big, { color: colors.foreground }]}>
          {percentText(summary.actualTenths)}
        </Text>
        <Text style={[styles.meta, { color: colors.muted }]}>
          done · plan says {percentText(summary.expectedTenths)} by today
        </Text>
      </View>
      <ProgressBar
        actualTenths={summary.actualTenths}
        expectedTenths={summary.expectedTenths}
        tone={health?.tone === "error" ? "warning" : "success"}
        height={10}
      />
      <View style={styles.stats}>
        <Stat value={summary.completed} label="Done" />
        <Stat value={summary.inProgress} label="Running" />
        <Stat value={summary.overdue} label="Overdue" alert={summary.overdue > 0} />
        <Stat value={summary.blocked} label="Blocked" alert={summary.blocked > 0} />
        <Stat value={summary.total} label="Tasks" />
      </View>
      <Text style={[styles.note, { color: colors.muted }]}>
        Estimated from task status and the latest DPR quantities. Not a basis for payment.
      </Text>
    </Card>
  );
}

function Stat({ value, label, alert }: { value: number; label: string; alert?: boolean }) {
  const colors = useColors();
  return (
    <View style={styles.stat}>
      <Text style={[styles.statValue, { color: alert ? colors.error : colors.foreground }]}>
        {value}
      </Text>
      <Text style={[styles.statLabel, { color: colors.muted }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  cover: { width: "100%", borderRadius: 20 },
  placeholder: { alignItems: "center", justifyContent: "center", borderWidth: 1 },
  track: { width: "100%", overflow: "visible", justifyContent: "center", marginTop: 8 },
  marker: { position: "absolute", width: 2, borderRadius: 1, marginLeft: -1, opacity: 0.6 },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 },
  title: { fontSize: 15, fontWeight: "800" },
  bigRow: { flexDirection: "row", alignItems: "baseline", gap: 8, marginTop: 8, flexWrap: "wrap" },
  big: { fontSize: 30, fontWeight: "900" },
  meta: { fontSize: 12, lineHeight: 17, flexShrink: 1 },
  stats: { flexDirection: "row", justifyContent: "space-between", marginTop: 14 },
  stat: { alignItems: "center", flex: 1 },
  statValue: { fontSize: 17, fontWeight: "900" },
  statLabel: { fontSize: 10, fontWeight: "700", marginTop: 2 },
  note: { fontSize: 10, lineHeight: 14, marginTop: 10 },
});
