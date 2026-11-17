import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useRouter } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useColors } from "@/hooks/use-colors";
import { useT } from "@/lib/i18n";
import { trpc } from "@/lib/trpc";

/**
 * "Today on site": per site, is attendance marked, is today's DPR sent, how many tasks are late —
 * each with the one tap that fixes it.
 */
export function TodaySites() {
  const { t } = useT();
  const colors = useColors();
  const router = useRouter();
  const today = trpc.jp.today.sites.useQuery(undefined, { retry: false });
  const sites = today.data?.sites ?? [];
  if (!sites.length) return null;
  return (
    <View style={{ gap: 10, marginBottom: 14 }}>
      <Text style={[styles.heading, { color: colors.foreground }]}>{t("Today on site")}</Text>
      {sites.map((site) => {
        const steps: { done: boolean; label: string; action?: string; route?: string }[] = [];
        if (site.attendance !== null)
          steps.push({
            done: site.attendance > 0,
            label:
              site.attendance > 0
                ? t("Attendance: {count} marked", { count: site.attendance })
                : t("Attendance not marked"),
            action: site.attendance > 0 || !site.canMark ? undefined : t("Mark"),
            route: `/attendance?siteId=${site.siteId}`,
          });
        if (site.dpr !== undefined)
          steps.push({
            done: site.dpr !== null && site.dpr !== "Draft",
            label: site.dpr ? t("DPR: {status}", { status: t(site.dpr) }) : t("DPR not sent"),
            action:
              site.dpr && site.dpr !== "Draft" ? undefined : site.canDpr ? t("Write") : undefined,
            route: `/report-editor?siteId=${site.siteId}&kind=DPR`,
          });
        if (site.lateTasks !== null && site.lateTasks > 0)
          steps.push({
            done: false,
            label: t("{count} tasks late", { count: site.lateTasks }),
            action: t("Open"),
            route: `/schedule?siteId=${site.siteId}`,
          });
        if (!steps.length) return null;
        return (
          <View
            key={site.siteId}
            style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}
          >
            <Text style={[styles.site, { color: colors.foreground }]} numberOfLines={1}>
              {site.name}
            </Text>
            <Text style={[styles.project, { color: colors.muted }]} numberOfLines={1}>
              {site.project}
            </Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => router.push(`/site-diary?siteId=${site.siteId}` as never)}
              style={styles.step}
            >
              <MaterialIcons name="menu-book" size={20} color={colors.primary} />
              <Text style={[styles.stepText, { color: colors.primary }]}>
                {t("Open site diary")}
              </Text>
            </Pressable>
            {steps.map((step) => (
              <Pressable
                key={step.label}
                accessibilityRole="button"
                onPress={() => step.route && router.push(step.route as never)}
                style={styles.step}
              >
                <MaterialIcons
                  name={step.done ? "check-circle" : "radio-button-unchecked"}
                  size={20}
                  color={step.done ? colors.success : colors.warning}
                />
                <Text style={[styles.stepText, { color: colors.foreground }]}>{step.label}</Text>
                {step.action ? (
                  <Text
                    style={[styles.action, { color: colors.primary, borderColor: colors.border }]}
                  >
                    {step.action}
                  </Text>
                ) : null}
              </Pressable>
            ))}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  heading: { fontSize: 18, fontWeight: "800" },
  card: { borderWidth: 1, borderRadius: 16, padding: 14, gap: 4 },
  site: { fontSize: 15, fontWeight: "800" },
  project: { fontSize: 12, marginBottom: 4 },
  step: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 40 },
  stepText: { flex: 1, fontSize: 14, fontWeight: "600" },
  action: {
    fontSize: 13,
    fontWeight: "800",
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 5,
    overflow: "hidden",
  },
});
