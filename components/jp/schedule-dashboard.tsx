import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { ProgressBar, ProgressCard, percentText } from "@/components/jp/place-visual";
import {
  ChipGroup,
  InlineError,
  LoadingBlock,
  StatusPill,
  useToneColor,
  type Tone,
} from "@/components/jp/ui";
import { useColors } from "@/hooks/use-colors";
import { trpc } from "@/lib/trpc";

const DAY = 86_400_000;
const toTime = (value: string) => Date.parse(`${value}T00:00:00Z`);

type View_ = "Timeline" | "Progress";

function toneFor(task: {
  status: string;
  overdue: boolean;
  progressTenths: number;
  expectedTenths: number;
}): Tone {
  if (task.status === "Completed") return "success";
  if (task.status === "Blocked" || task.status === "On Hold" || task.overdue) return "error";
  if (task.progressTenths + 50 < task.expectedTenths) return "warning";
  return "info";
}

/**
 * The schedule as a dashboard: overall progress against plan, then each task either on a
 * timeline (Gantt style, with today marked) or as progress bars.
 */
export function ScheduleDashboard({
  siteId,
  onOpenTask,
}: {
  siteId: string;
  onOpenTask?: (taskId: string) => void;
}) {
  const colors = useColors();
  const query = trpc.jp.places.schedule.useQuery({ siteId }, { enabled: Boolean(siteId) });
  const [mode, setMode] = useState<View_>("Timeline");
  const data = query.data;
  if (query.isLoading) return <LoadingBlock label="Loading schedule dashboard…" />;
  if (query.error)
    return <InlineError message={query.error.message} onRetry={() => void query.refetch()} />;
  if (!data) return null;
  const tasks = data.tasks.filter((task) => task.status !== "Cancelled");
  const start = data.range ? toTime(data.range.start) : 0;
  const end = data.range ? toTime(data.range.end) + DAY : 1;
  const span = Math.max(DAY, end - start);
  const todayLeft = Math.max(0, Math.min(100, ((toTime(data.today) - start) / span) * 100));

  return (
    <View style={styles.wrap}>
      <ProgressCard summary={data.summary} title="Schedule progress" />
      {tasks.length ? (
        <>
          <ChipGroup
            label="Show"
            options={["Timeline", "Progress"] as const}
            value={mode}
            onChange={setMode}
          />
          {mode === "Timeline" && data.range ? (
            <View
              style={[
                styles.panel,
                { backgroundColor: colors.surface, borderColor: colors.border },
              ]}
            >
              <View style={styles.axis}>
                <Text style={[styles.axisText, { color: colors.muted }]}>{data.range.start}</Text>
                <Text style={[styles.axisText, { color: colors.error }]}>Today</Text>
                <Text style={[styles.axisText, { color: colors.muted }]}>{data.range.end}</Text>
              </View>
              {tasks.map((task) => (
                <TimelineRow
                  key={task.id}
                  task={task}
                  left={((toTime(task.plannedStart) - start) / span) * 100}
                  width={((toTime(task.plannedEnd) + DAY - toTime(task.plannedStart)) / span) * 100}
                  todayLeft={todayLeft}
                  onPress={onOpenTask ? () => onOpenTask(task.id) : undefined}
                />
              ))}
              <View style={styles.legend}>
                <Legend tone="success" label="Done" />
                <Legend tone="info" label="On plan" />
                <Legend tone="warning" label="Slipping" />
                <Legend tone="error" label="Late or blocked" />
              </View>
            </View>
          ) : (
            <View
              style={[
                styles.panel,
                { backgroundColor: colors.surface, borderColor: colors.border },
              ]}
            >
              {tasks.map((task) => (
                <Pressable
                  key={task.id}
                  disabled={!onOpenTask}
                  onPress={() => onOpenTask?.(task.id)}
                  accessibilityRole={onOpenTask ? "button" : undefined}
                  style={styles.progressRow}
                >
                  <View style={styles.rowTop}>
                    <Text
                      style={[styles.taskTitle, { color: colors.foreground }]}
                      numberOfLines={1}
                    >
                      {task.taskCode} · {task.title}
                    </Text>
                    <Text style={[styles.pct, { color: colors.foreground }]}>
                      {percentText(task.progressTenths)}
                    </Text>
                  </View>
                  <ProgressBar
                    actualTenths={task.progressTenths}
                    expectedTenths={task.status === "Completed" ? null : task.expectedTenths}
                    tone={toneFor(task)}
                    height={8}
                  />
                  <View style={styles.rowTop}>
                    <Text style={[styles.meta, { color: colors.muted }]}>
                      {task.plannedStart} → {task.plannedEnd}
                    </Text>
                    <StatusPill
                      label={task.overdue ? "Overdue" : task.status}
                      tone={toneFor(task)}
                      compact
                    />
                  </View>
                </Pressable>
              ))}
            </View>
          )}
        </>
      ) : null}
    </View>
  );
}

function TimelineRow({
  task,
  left,
  width,
  todayLeft,
  onPress,
}: {
  task: {
    taskCode: string;
    title: string;
    status: string;
    overdue: boolean;
    progressTenths: number;
    expectedTenths: number;
  };
  left: number;
  width: number;
  todayLeft: number;
  onPress?: () => void;
}) {
  const colors = useColors();
  const color = useToneColor(toneFor(task));
  return (
    <Pressable
      disabled={!onPress}
      onPress={onPress}
      accessibilityRole={onPress ? "button" : undefined}
      accessibilityLabel={`${task.taskCode} ${task.title}, ${percentText(task.progressTenths)} done`}
      style={styles.timelineRow}
    >
      <Text style={[styles.timelineLabel, { color: colors.foreground }]} numberOfLines={1}>
        {task.taskCode} · {task.title}
      </Text>
      <View style={[styles.lane, { backgroundColor: `${colors.border}66` }]}>
        <View
          style={[
            styles.bar,
            {
              left: `${Math.max(0, left)}%`,
              width: `${Math.max(2, Math.min(100 - left, width))}%`,
              backgroundColor: `${color}33`,
              borderColor: color,
            },
          ]}
        >
          <View
            style={{
              width: `${task.progressTenths / 10}%`,
              height: "100%",
              backgroundColor: color,
            }}
          />
        </View>
        <View style={[styles.today, { left: `${todayLeft}%`, backgroundColor: colors.error }]} />
      </View>
    </Pressable>
  );
}

function Legend({ tone, label }: { tone: Tone; label: string }) {
  const colors = useColors();
  const color = useToneColor(tone);
  return (
    <View style={styles.legendItem}>
      <View style={[styles.dot, { backgroundColor: color }]} />
      <Text style={[styles.meta, { color: colors.muted }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 12, marginBottom: 16 },
  panel: { borderWidth: 1, borderRadius: 18, padding: 12, gap: 10 },
  axis: { flexDirection: "row", justifyContent: "space-between" },
  axisText: { fontSize: 10, fontWeight: "700" },
  timelineRow: { gap: 4 },
  timelineLabel: { fontSize: 12, fontWeight: "700" },
  lane: { height: 16, borderRadius: 8, overflow: "hidden" },
  bar: {
    position: "absolute",
    top: 2,
    bottom: 2,
    borderRadius: 6,
    borderWidth: 1,
    overflow: "hidden",
  },
  today: { position: "absolute", top: 0, bottom: 0, width: 2 },
  legend: { flexDirection: "row", flexWrap: "wrap", gap: 12, marginTop: 4 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 5 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  progressRow: { gap: 6, paddingVertical: 4 },
  rowTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 },
  taskTitle: { fontSize: 13, fontWeight: "700", flex: 1 },
  pct: { fontSize: 13, fontWeight: "900" },
  meta: { fontSize: 11 },
});
