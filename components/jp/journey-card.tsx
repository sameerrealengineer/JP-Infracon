import AsyncStorage from "@react-native-async-storage/async-storage";
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useColors } from "@/hooks/use-colors";
import { useT } from "@/lib/i18n";
import { trpc } from "@/lib/trpc";

const SEEN_KEY = "jp-infracon.journey-seen-level.v1";

/**
 * "Your journey": the company's step in step-by-step mode, what opens the next step and how far
 * along it is, with a short celebration when a new step has opened since this phone last saw it.
 */
export function JourneyCard() {
  const { t } = useT();
  const colors = useColors();
  const router = useRouter();
  const utils = trpc.useUtils();
  const status = trpc.jp.journey.status.useQuery(undefined, { retry: false });
  const openNext = trpc.jp.journey.openNext.useMutation();
  const [seen, setSeen] = useState<number | null>(null);
  const [expanded, setExpanded] = useState(false);

  // Reading device storage once is an external sync, not derived state.
  useEffect(() => {
    let alive = true;
    AsyncStorage.getItem(SEEN_KEY)
      .then((value) => alive && setSeen(value ? Number(value) : 0))
      .catch(() => alive && setSeen(0));
    return () => {
      alive = false;
    };
  }, []);

  // First time on this phone: remember the current step without a celebration.
  const level = status.data?.level ?? 0;
  useEffect(() => {
    if (seen === 0 && level > 0)
      void AsyncStorage.setItem(SEEN_KEY, String(level)).catch(() => undefined);
  }, [seen, level]);

  const data = status.data;
  if (!data || data.mode !== "guided") return null;
  const current = data.steps[data.level - 1]!;
  const fresh = seen !== null && seen > 0 && data.level > seen;
  const acknowledge = () => {
    setSeen(data.level);
    void AsyncStorage.setItem(SEEN_KEY, String(data.level)).catch(() => undefined);
  };
  const percent = data.next ? Math.round((data.next.done / data.next.target) * 100) : 100;

  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.accent }]}>
      {fresh ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            acknowledge();
            router.push("/(tabs)" as never);
          }}
          style={[styles.fresh, { backgroundColor: colors.background }]}
        >
          <Text style={[styles.freshText, { color: colors.foreground }]}>
            🎉 {t("New step opened: {title}", { title: t(current.title) })} —{" "}
            {current.moduleTitles.map((title) => t(title)).join(", ")}
          </Text>
          <Text style={[styles.small, { color: colors.primary }]}>{t("Got it")}</Text>
        </Pressable>
      ) : null}
      <View style={styles.top}>
        <Text style={[styles.kicker, { color: colors.accent }]}>
          {t("YOUR JOURNEY · STEP {level} OF {total}", { level: data.level, total: data.total })}
        </Text>
        <Pressable accessibilityRole="button" onPress={() => setExpanded((v) => !v)} hitSlop={8}>
          <Text style={[styles.small, { color: colors.primary }]}>
            {expanded ? t("Hide steps") : t("All steps")}
          </Text>
        </Pressable>
      </View>
      <Text style={[styles.title, { color: colors.foreground }]}>{t(current.title)}</Text>
      <Text style={[styles.about, { color: colors.muted }]}>{t(current.about)}</Text>
      {data.next ? (
        <>
          <View style={[styles.track, { backgroundColor: colors.border }]}>
            <View
              style={[styles.fill, { width: `${percent}%`, backgroundColor: colors.success }]}
            />
          </View>
          <Text style={[styles.goal, { color: colors.foreground }]}>
            {t("Next")}: {t(data.next.label)} ({data.next.done}/{data.next.target})
            {data.next.opens ? ` → ${t("opens")} ${t(data.next.opens)}` : ""}
          </Text>
        </>
      ) : (
        <Text style={[styles.goal, { color: colors.success }]}>
          ✓ {t("All main steps are open. Extras open when a leader asks.")}
        </Text>
      )}
      {expanded ? (
        <View style={{ gap: 6, marginTop: 8 }}>
          {data.steps.map((step) => (
            <Text
              key={step.level}
              style={[
                styles.step,
                { color: step.state === "locked" ? colors.muted : colors.foreground },
              ]}
            >
              {step.state === "done"
                ? "✓"
                : step.state === "current"
                  ? "▶"
                  : step.state === "opened early"
                    ? "◆"
                    : "🔒"}{" "}
              {step.level}. {t(step.title)} —{" "}
              {step.moduleTitles.map((title) => t(title)).join(", ")}
            </Text>
          ))}
          {data.extraTitles.length ? (
            <Text style={[styles.step, { color: colors.muted }]}>
              ➕ {t("Extras (on request)")}: {data.extraTitles.map((title) => t(title)).join(", ")}
            </Text>
          ) : null}
        </View>
      ) : null}
      {data.canManage ? (
        <View style={styles.actions}>
          {data.next ? (
            <Pressable
              accessibilityRole="button"
              disabled={openNext.isPending}
              onPress={() =>
                void openNext.mutateAsync().then(() => {
                  void utils.invalidate();
                })
              }
              style={[styles.button, { borderColor: colors.border }]}
            >
              <Text style={[styles.buttonText, { color: colors.primary }]}>
                {t("Open next step now")}
              </Text>
            </Pressable>
          ) : null}
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push("/modules" as never)}
            style={[styles.button, { borderColor: colors.border }]}
          >
            <Text style={[styles.buttonText, { color: colors.primary }]}>{t("Modules")}</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1.5, borderRadius: 18, padding: 16, gap: 6, marginBottom: 14 },
  fresh: { borderRadius: 12, padding: 10, gap: 4, marginBottom: 6 },
  freshText: { fontSize: 14, fontWeight: "700", lineHeight: 20 },
  top: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  kicker: { fontSize: 11, fontWeight: "800", letterSpacing: 1 },
  title: { fontSize: 18, fontWeight: "800" },
  about: { fontSize: 13, lineHeight: 19 },
  track: { height: 8, borderRadius: 4, overflow: "hidden", marginTop: 6 },
  fill: { height: 8, borderRadius: 4 },
  goal: { fontSize: 13, fontWeight: "600", marginTop: 4, lineHeight: 19 },
  step: { fontSize: 13, lineHeight: 19 },
  small: { fontSize: 12, fontWeight: "700" },
  actions: { flexDirection: "row", gap: 8, marginTop: 8, flexWrap: "wrap" },
  button: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7 },
  buttonText: { fontSize: 12, fontWeight: "700" },
});
