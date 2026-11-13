import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { AuthGate } from "@/components/jp/auth-gate";
import { AppHeader, Card, EmptyState, InlineError, LoadingBlock, Screen } from "@/components/jp/ui";
import { useColors } from "@/hooks/use-colors";
import { useT } from "@/lib/i18n";
import { trpc } from "@/lib/trpc";

const KIND: Record<
  string,
  {
    label: string;
    color: string;
    icon: "event" | "flag" | "receipt-long" | "verified" | "handyman";
  }
> = {
  task_start: { label: "Task starts", color: "#2F6FB0", icon: "event" },
  task_due: { label: "Task due", color: "#C0392B", icon: "flag" },
  bill_due: { label: "Bill due", color: "#B08A3E", icon: "receipt-long" },
  warranty_end: { label: "Warranty ends", color: "#7D3C98", icon: "verified" },
  work_order_end: { label: "Work order ends", color: "#1E8449", icon: "handyman" },
};
const WEEK = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function iso(date: Date) {
  return date.toISOString().slice(0, 10);
}

/** Month calendar of tasks, bills due, warranties and work orders across the person's sites. */
export default function CalendarScreen() {
  const { t, language } = useT();
  const colors = useColors();
  const router = useRouter();
  const now = new Date();
  const [month, setMonth] = useState(
    () => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)),
  );
  const [selected, setSelected] = useState(iso(now));
  const from = iso(month);
  const last = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 0));
  const to = iso(last);
  const events = trpc.jp.calendar.range.useQuery({ from, to });
  const byDay = useMemo(() => {
    const map = new Map<string, NonNullable<typeof events.data>>();
    for (const event of events.data ?? [])
      map.set(event.date, [...(map.get(event.date) ?? []), event]);
    return map;
  }, [events.data]);
  // Monday-first grid.
  const lead = (month.getUTCDay() + 6) % 7;
  const cells: (string | null)[] = [
    ...Array.from({ length: lead }, () => null),
    ...Array.from({ length: last.getUTCDate() }, (_, index) =>
      iso(new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth(), index + 1))),
    ),
  ];
  while (cells.length % 7) cells.push(null);
  const title = new Intl.DateTimeFormat(language === "en" ? "en-IN" : `${language}-IN`, {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(month);
  const shift = (by: number) =>
    setMonth(new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + by, 1)));
  const dayEvents = byDay.get(selected) ?? [];

  return (
    <AuthGate>
      <Screen>
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 32 }}
        >
          <AppHeader
            eyebrow={t("Plan")}
            title={t("Calendar")}
            subtitle={t("Tasks, bills due, warranties and work orders on every site you can see.")}
          />
          <View style={styles.monthRow}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("Previous month")}
              onPress={() => shift(-1)}
              hitSlop={8}
            >
              <MaterialIcons name="chevron-left" size={30} color={colors.primary} />
            </Pressable>
            <Text style={[styles.month, { color: colors.foreground }]}>{title}</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("Next month")}
              onPress={() => shift(1)}
              hitSlop={8}
            >
              <MaterialIcons name="chevron-right" size={30} color={colors.primary} />
            </Pressable>
          </View>
          <View style={styles.grid}>
            {WEEK.map((name) => (
              <Text key={name} style={[styles.weekday, { color: colors.muted }]}>
                {t(name)}
              </Text>
            ))}
            {cells.map((day, index) => {
              const list = day ? (byDay.get(day) ?? []) : [];
              const isSelected = day === selected;
              const isToday = day === iso(now);
              return (
                <Pressable
                  key={day ?? `blank-${index}`}
                  disabled={!day}
                  accessibilityRole="button"
                  accessibilityLabel={day ? `${day}, ${list.length}` : undefined}
                  onPress={() => day && setSelected(day)}
                  style={[
                    styles.cell,
                    { borderColor: colors.border },
                    isSelected && {
                      backgroundColor: `${colors.primary}18`,
                      borderColor: colors.primary,
                    },
                  ]}
                >
                  {day ? (
                    <>
                      <Text
                        style={[
                          styles.dayNumber,
                          { color: isToday ? colors.primary : colors.foreground },
                          isToday && { fontWeight: "900" },
                        ]}
                      >
                        {Number(day.slice(8))}
                      </Text>
                      <View style={styles.dots}>
                        {[...new Set(list.map((event) => event.kind))].slice(0, 4).map((kind) => (
                          <View
                            key={kind}
                            style={[styles.dot, { backgroundColor: KIND[kind]?.color }]}
                          />
                        ))}
                      </View>
                    </>
                  ) : null}
                </Pressable>
              );
            })}
          </View>
          <View style={styles.legend}>
            {Object.entries(KIND).map(([key, kind]) => (
              <View key={key} style={styles.legendItem}>
                <View style={[styles.dot, { backgroundColor: kind.color }]} />
                <Text style={[styles.legendText, { color: colors.muted }]}>{t(kind.label)}</Text>
              </View>
            ))}
          </View>
          <Text style={[styles.dayTitle, { color: colors.foreground }]}>{selected}</Text>
          {events.isLoading ? (
            <LoadingBlock label={t("Loading…")} />
          ) : events.isError ? (
            <InlineError message={t(events.error.message)} onRetry={() => void events.refetch()} />
          ) : dayEvents.length === 0 ? (
            <EmptyState
              icon="event-available"
              title={t("Nothing on this day")}
              detail={t("Pick another day, or another month.")}
            />
          ) : (
            <View style={{ gap: 8 }}>
              {dayEvents.map((event, index) => {
                const kind = KIND[event.kind]!;
                return (
                  <Card
                    key={`${event.kind}-${index}`}
                    onPress={() => router.push(event.route as never)}
                  >
                    <View style={styles.eventRow}>
                      <MaterialIcons name={kind.icon} size={20} color={kind.color} />
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.eventTitle, { color: colors.foreground }]}>
                          {event.title}
                          {event.done ? ` · ${t("done")}` : ""}
                        </Text>
                        <Text style={[styles.legendText, { color: colors.muted }]}>
                          {t(kind.label)} · {event.siteName}
                        </Text>
                      </View>
                    </View>
                  </Card>
                );
              })}
            </View>
          )}
        </ScrollView>
      </Screen>
    </AuthGate>
  );
}

const styles = StyleSheet.create({
  monthRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  month: { fontSize: 18, fontWeight: "800" },
  grid: { flexDirection: "row", flexWrap: "wrap" },
  weekday: {
    width: "14.2857%",
    textAlign: "center",
    fontSize: 11,
    fontWeight: "700",
    marginBottom: 4,
  },
  cell: {
    width: "14.2857%",
    aspectRatio: 1,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
    gap: 3,
  },
  dayNumber: { fontSize: 14, fontWeight: "600" },
  dots: { flexDirection: "row", gap: 2, minHeight: 6 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  legend: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginVertical: 10 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 4 },
  legendText: { fontSize: 11 },
  dayTitle: { fontSize: 15, fontWeight: "800", marginVertical: 8 },
  eventRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  eventTitle: { fontSize: 13, fontWeight: "700" },
});
