import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { AuthGate } from "@/components/jp/auth-gate";
import { ChipGroup, EmptyState, LoadingBlock, Screen, type IconName } from "@/components/jp/ui";
import { useColors } from "@/hooks/use-colors";
import { useT } from "@/lib/i18n";
import { captureActionsFor } from "@/lib/jp/capture";
import { resolveSelectedId } from "@/lib/jp/selection";
import { trpc } from "@/lib/trpc";

/** "+ Capture": the everyday site actions for the chosen site, big and two taps away. */
export default function CaptureScreen() {
  const { t } = useT();
  const colors = useColors();
  const router = useRouter();
  const sites = trpc.jp.workspace.mySites.useQuery();
  const caps = trpc.jp.workspace.myCapabilities.useQuery();
  const active = (sites.data ?? []).filter((site) => site.status === "Active");
  const [chosen, setChosen] = useState("");
  const siteId = resolveSelectedId(active, chosen);
  const held = new Set(
    Object.entries((caps.data ?? []).find((row) => row.siteId === siteId) ?? {})
      .filter(([key, value]) => key !== "siteId" && value === true)
      .map(([key]) => key),
  );
  const actions = siteId ? captureActionsFor(held) : [];

  return (
    <AuthGate>
      <Screen>
        <ScrollView contentContainerStyle={{ paddingBottom: 40, gap: 14 }}>
          <View style={styles.top}>
            <Text style={[styles.title, { color: colors.foreground }]}>{t("Capture")}</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("Close")}
              onPress={() =>
                router.canGoBack() ? router.back() : router.replace("/(tabs)" as never)
              }
              hitSlop={12}
              style={[
                styles.close,
                { backgroundColor: colors.surface, borderColor: colors.border },
              ]}
            >
              <MaterialIcons name="close" size={22} color={colors.foreground} />
            </Pressable>
          </View>
          {sites.isLoading || caps.isLoading ? <LoadingBlock label={t("Loading…")} /> : null}
          {active.length > 1 ? (
            <ChipGroup
              label={t("Site")}
              options={active.map((site) => site.id)}
              value={siteId || null}
              onChange={setChosen}
              format={(id) => active.find((site) => site.id === id)?.name ?? id}
            />
          ) : active.length === 1 ? (
            <Text style={[styles.site, { color: colors.muted }]}>
              {t("Site")}: {active[0]!.name}
            </Text>
          ) : null}
          {sites.data && !active.length ? (
            <EmptyState
              icon="location-city"
              title={t("No active site")}
              detail={t("Ask your administrator to add you to a site.")}
            />
          ) : null}
          <View style={styles.grid}>
            {actions.map((action) => (
              <Pressable
                key={action.key}
                accessibilityRole="button"
                accessibilityLabel={t(action.title)}
                onPress={() => router.push(action.route(siteId) as never)}
                style={({ pressed }) => [
                  styles.tile,
                  {
                    backgroundColor: colors.surface,
                    borderColor: colors.border,
                    opacity: pressed ? 0.8 : 1,
                  },
                ]}
              >
                <View style={[styles.icon, { backgroundColor: colors.primary }]}>
                  <MaterialIcons
                    name={action.icon as IconName}
                    size={26}
                    color={colors.background}
                  />
                </View>
                <Text style={[styles.tileTitle, { color: colors.foreground }]}>
                  {t(action.title)}
                </Text>
                <Text style={[styles.tileHint, { color: colors.muted }]} numberOfLines={2}>
                  {t(action.hint)}
                </Text>
              </Pressable>
            ))}
          </View>
          {siteId && caps.data && !actions.length ? (
            <EmptyState
              icon="lock"
              title={t("Nothing to record here")}
              detail={t("Your role on this site can view, but not add records.")}
            />
          ) : null}
        </ScrollView>
      </Screen>
    </AuthGate>
  );
}

const styles = StyleSheet.create({
  top: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 8,
  },
  title: { fontSize: 28, fontWeight: "800" },
  close: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  site: { fontSize: 14, fontWeight: "600" },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  tile: {
    flexGrow: 1,
    flexBasis: "44%",
    minWidth: 140,
    maxWidth: 360,
    minHeight: 132,
    borderWidth: 1,
    borderRadius: 18,
    padding: 14,
    gap: 8,
  },
  icon: { width: 48, height: 48, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  tileTitle: { fontSize: 16, fontWeight: "800" },
  tileHint: { fontSize: 12, lineHeight: 17 },
});
