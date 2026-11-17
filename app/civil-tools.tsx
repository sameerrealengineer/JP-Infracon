import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { AuthGate } from "@/components/jp/auth-gate";
import { AppHeader, ChipGroup, Screen, SectionHeader, type IconName } from "@/components/jp/ui";
import { useColors } from "@/hooks/use-colors";
import { useT } from "@/lib/i18n";
import { CIVIL_TOOLS, TOOL_CATEGORIES, type ToolCategory } from "@/lib/jp/civil-tools";

/** Tools with their own screen (not the generic calculator). */
const SPECIAL: {
  key: string;
  title: string;
  about: string;
  icon: IconName;
  route: string;
  category: ToolCategory;
}[] = [
  {
    key: "bbs",
    title: "Bar bending schedule (BBS)",
    about:
      "Cutting length, bars and weight per diameter for beams, columns, slabs and footings; CSV for Excel.",
    icon: "straighten",
    route: "/bbs",
    category: "Steel",
  },
  {
    key: "rate-analysis",
    title: "Rate analysis & estimate",
    about:
      "Item rates from material, labour and plant with water charges and overhead & profit; abstract with contingency and GST.",
    icon: "request-quote",
    route: "/rate-analysis",
    category: "Estimate & bills",
  },
  {
    key: "gantt",
    title: "Gantt chart & S-curve",
    about: "Your site's tasks on a timeline and planned vs actual progress over time.",
    icon: "stacked-line-chart",
    route: "/gantt",
    category: "Estimate & bills",
  },
];

/** The civil engineering toolbox: search and categories, then one tap to a calculator. */
export default function CivilToolsScreen() {
  const { t } = useT();
  const colors = useColors();
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<"All" | ToolCategory>("All");
  const q = query.trim().toLowerCase();
  const all = [
    ...SPECIAL.map((tool) => ({ ...tool, route: tool.route })),
    ...CIVIL_TOOLS.map((tool) => ({
      key: tool.key,
      title: tool.title,
      about: tool.about,
      icon: tool.icon as IconName,
      category: tool.category,
      route: `/civil-tool?key=${tool.key}`,
    })),
  ].filter(
    (tool) =>
      (category === "All" || tool.category === category) &&
      (!q || `${tool.title} ${t(tool.title)} ${tool.about}`.toLowerCase().includes(q)),
  );
  return (
    <AuthGate>
      <Screen>
        <ScrollView contentContainerStyle={{ paddingBottom: 40, gap: 10 }}>
          <AppHeader
            eyebrow={t("Engineering")}
            title={t("Civil tools")}
            subtitle={t(
              "{count} calculators for site work: quantities, steel, estimates, water and more.",
              {
                count: CIVIL_TOOLS.length + SPECIAL.length,
              },
            )}
          />
          <TextInput
            accessibilityLabel={t("Search tools")}
            value={query}
            onChangeText={setQuery}
            placeholder={t("Search tools (concrete, brick, BBS, tank…)")}
            placeholderTextColor={colors.muted}
            style={[
              styles.search,
              {
                borderColor: colors.border,
                color: colors.foreground,
                backgroundColor: colors.surface,
              },
            ]}
          />
          <ChipGroup
            options={["All", ...TOOL_CATEGORIES] as ("All" | ToolCategory)[]}
            value={category}
            onChange={setCategory}
            format={(value) => t(value)}
          />
          {TOOL_CATEGORIES.filter((cat) => all.some((tool) => tool.category === cat)).map((cat) => (
            <View key={cat} style={{ gap: 8 }}>
              <SectionHeader title={t(cat)} />
              <View style={styles.grid}>
                {all
                  .filter((tool) => tool.category === cat)
                  .map((tool) => (
                    <Pressable
                      key={tool.key}
                      accessibilityRole="button"
                      accessibilityLabel={t(tool.title)}
                      onPress={() => router.push(tool.route as never)}
                      style={({ pressed }) => [
                        styles.tile,
                        {
                          backgroundColor: colors.surface,
                          borderColor: colors.border,
                          opacity: pressed ? 0.8 : 1,
                        },
                      ]}
                    >
                      <View style={[styles.icon, { backgroundColor: colors.background }]}>
                        <MaterialIcons name={tool.icon} size={22} color={colors.primary} />
                      </View>
                      <Text
                        style={[styles.tileTitle, { color: colors.foreground }]}
                        numberOfLines={2}
                      >
                        {t(tool.title)}
                      </Text>
                      <Text style={[styles.tileAbout, { color: colors.muted }]} numberOfLines={3}>
                        {t(tool.about)}
                      </Text>
                    </Pressable>
                  ))}
              </View>
            </View>
          ))}
          {all.length === 0 ? (
            <Text style={{ color: colors.muted }}>{t("No tool matches your search.")}</Text>
          ) : null}
        </ScrollView>
      </Screen>
    </AuthGate>
  );
}

const styles = StyleSheet.create({
  search: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 11,
    fontSize: 15,
  },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  tile: {
    flexGrow: 1,
    flexBasis: "45%",
    minWidth: 150,
    maxWidth: 360,
    borderWidth: 1,
    borderRadius: 16,
    padding: 12,
    gap: 6,
  },
  icon: { width: 38, height: 38, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  tileTitle: { fontSize: 14, fontWeight: "800" },
  tileAbout: { fontSize: 12, lineHeight: 17 },
});
