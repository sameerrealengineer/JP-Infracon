import { MaterialIcons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { AuthGate } from "@/components/jp/auth-gate";
import { HelpDetail } from "@/components/jp/help";
import {
  AppHeader,
  Card,
  LoadingBlock,
  Screen,
  SecondaryButton,
  SectionHeader,
} from "@/components/jp/ui";
import { useColors } from "@/hooks/use-colors";
import { useWorkspace } from "@/hooks/use-workspace";
import {
  GLOSSARY,
  START_PATHS,
  TROUBLESHOOTING,
  startPathFor,
  visibleTopics,
} from "@/lib/jp/help-content";
import { useT } from "@/lib/i18n";

/** Help & guide: where to start for your role, every module you can use, problems and words. */
export default function HelpScreen() {
  const { t } = useT();
  const colors = useColors();
  const router = useRouter();
  const { can, role, access, capabilities } = useWorkspace();
  // Wait for the role and permissions so a leader never sees the supervisor path first.
  const ready = !access.isLoading && !capabilities.isLoading;
  const [openKey, setOpenKey] = useState<string | null>(null);
  const steps = START_PATHS[startPathFor(role)].filter(
    (step) => step.anyOf.length === 0 || can(...step.anyOf),
  );
  const topics = visibleTopics(can);

  return (
    <AuthGate>
      <Screen>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
          <AppHeader
            eyebrow={t("Help")}
            title={t("Help & guide")}
            subtitle={t(
              "What to do first, how each part works, and what to do when something fails.",
            )}
          />

          {!ready ? <LoadingBlock label={t("Loading…")} /> : null}
          {ready ? (
            <>
              <SectionHeader title={t("Start here")} caption={t("The usual order for your work")} />
              <View style={{ gap: 8, marginBottom: 18 }}>
                {steps.map((step, index) => (
                  <Card
                    key={step.title}
                    onPress={() => router.push(step.route as never)}
                    accessibilityLabel={t(step.title)}
                  >
                    <View style={styles.step}>
                      <View style={[styles.number, { backgroundColor: colors.primary }]}>
                        <Text style={styles.numberText}>{index + 1}</Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.title, { color: colors.foreground }]}>
                          {t(step.title)}
                        </Text>
                        <Text style={[styles.meta, { color: colors.muted }]}>{t(step.detail)}</Text>
                      </View>
                      <MaterialIcons name="chevron-right" size={22} color={colors.muted} />
                    </View>
                  </Card>
                ))}
              </View>

              <SectionHeader
                title={t("Every part of the app")}
                caption={t("Tap one to read how it works")}
              />
              <View style={{ gap: 8, marginBottom: 18 }}>
                {topics.map((topic) => {
                  const open = openKey === topic.key;
                  return (
                    <Card key={topic.key}>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityState={{ expanded: open }}
                        onPress={() => setOpenKey(open ? null : topic.key)}
                        style={styles.topicHead}
                      >
                        <Text style={[styles.title, { color: colors.foreground, flex: 1 }]}>
                          {t(topic.title)}
                        </Text>
                        <MaterialIcons
                          name={open ? "expand-less" : "expand-more"}
                          size={22}
                          color={colors.muted}
                        />
                      </Pressable>
                      {open ? (
                        <View style={{ marginTop: 10, gap: 12 }}>
                          <HelpDetail topic={topic} />
                          <SecondaryButton
                            icon="open-in-new"
                            label={t("Open {title}", { title: t(topic.title) })}
                            onPress={() => router.push(topic.route as never)}
                          />
                        </View>
                      ) : null}
                    </Card>
                  );
                })}
              </View>
            </>
          ) : null}

          <SectionHeader title={t("When something goes wrong")} />
          <Card style={{ marginBottom: 18 }}>
            <View style={{ gap: 12 }}>
              {TROUBLESHOOTING.map((item) => (
                <View key={item.problem}>
                  <Text style={[styles.title, { color: colors.foreground }]}>
                    {t(item.problem)}
                  </Text>
                  <Text style={[styles.meta, { color: colors.muted }]}>{t(item.fix)}</Text>
                </View>
              ))}
            </View>
            <View style={{ marginTop: 14 }}>
              <SecondaryButton
                icon="report-problem"
                label={t("Report a problem")}
                onPress={() => router.push("/report-problem" as never)}
              />
            </View>
          </Card>

          <SectionHeader title={t("Words used in the app")} />
          <Card>
            <View style={{ gap: 10 }}>
              {GLOSSARY.map((item) => (
                <View key={item.term}>
                  <Text style={[styles.title, { color: colors.foreground }]}>{item.term}</Text>
                  <Text style={[styles.meta, { color: colors.muted }]}>{t(item.meaning)}</Text>
                </View>
              ))}
            </View>
          </Card>
        </ScrollView>
      </Screen>
    </AuthGate>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 16, paddingBottom: 40 },
  step: { flexDirection: "row", alignItems: "center", gap: 12 },
  number: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  numberText: { color: "#FFFFFF", fontWeight: "800", fontSize: 13 },
  title: { fontSize: 14, fontWeight: "800" },
  meta: { fontSize: 13, lineHeight: 19, marginTop: 2 },
  topicHead: { flexDirection: "row", alignItems: "center" },
});
