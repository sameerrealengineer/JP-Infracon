import { useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { ScrollView, Share, StyleSheet, Text, View } from "react-native";
import { AuthGate } from "@/components/jp/auth-gate";
import {
  AppHeader,
  Card,
  ChipGroup,
  EmptyState,
  Field,
  Screen,
  SecondaryButton,
} from "@/components/jp/ui";
import { useColors } from "@/hooks/use-colors";
import { useT } from "@/lib/i18n";
import { defaultValues, toolByKey } from "@/lib/jp/civil-tools";

/** One calculator from the civil toolbox; results update as you type. */
export default function CivilToolScreen() {
  const { t } = useT();
  const colors = useColors();
  const params = useLocalSearchParams<{ key?: string }>();
  const tool = toolByKey(typeof params.key === "string" ? params.key : "");
  const [values, setValues] = useState<Record<string, string>>(() =>
    tool ? defaultValues(tool) : {},
  );
  if (!tool)
    return (
      <AuthGate>
        <Screen>
          <AppHeader title={t("Civil tools")} />
          <EmptyState
            icon="construction"
            title={t("Tool not found")}
            detail={t("Go back and choose a tool.")}
          />
        </Screen>
      </AuthGate>
    );
  const result = tool.compute(values);
  const set = (key: string, value: string) => setValues((all) => ({ ...all, [key]: value }));
  const share = () => {
    if (!result.ok) return;
    const lines = [
      `${t(tool.title)} — JP Infracon`,
      ...tool.inputs.map(
        (input) =>
          `${t(input.label)}: ${values[input.key]}${"unit" in input && input.unit ? ` ${input.unit}` : ""}`,
      ),
      "",
      ...result.outputs.map(
        (row) => `${t(row.label)}: ${row.value}${row.unit ? ` ${row.unit}` : ""}`,
      ),
    ];
    void Share.share({ message: lines.join("\n") });
  };
  return (
    <AuthGate>
      <Screen>
        <ScrollView
          contentContainerStyle={{ paddingBottom: 40, gap: 12 }}
          keyboardShouldPersistTaps="handled"
        >
          <AppHeader eyebrow={t(tool.category)} title={t(tool.title)} subtitle={t(tool.about)} />
          {tool.inputs.length ? (
            <Card>
              {tool.inputs.map((input) =>
                input.kind === "choice" ? (
                  <ChipGroup
                    key={input.key}
                    label={t(input.label)}
                    options={input.options}
                    value={values[input.key] ?? input.default}
                    onChange={(value) => set(input.key, value)}
                    format={(value) => t(value)}
                  />
                ) : (
                  <Field
                    key={input.key}
                    label={`${input.label}${input.kind === "money" ? " (₹)" : input.unit ? ` (${input.unit})` : ""}`}
                    value={values[input.key] ?? ""}
                    onChangeText={(value) => set(input.key, value)}
                    keyboardType="decimal-pad"
                    hint={input.hint}
                  />
                ),
              )}
            </Card>
          ) : null}
          <Card accent="info">
            <Text style={[styles.resultTitle, { color: colors.foreground }]}>{t("Result")}</Text>
            {result.ok ? (
              result.outputs.map((row) => (
                <View key={row.label} style={[styles.row, { borderBottomColor: colors.border }]}>
                  <Text style={[styles.label, { color: colors.muted }]}>{t(row.label)}</Text>
                  <Text
                    style={[
                      styles.value,
                      {
                        color: colors.foreground,
                        fontWeight: row.strong ? "800" : "600",
                        fontSize: row.strong ? 16 : 14,
                      },
                    ]}
                  >
                    {row.value}
                    {row.unit ? ` ${t(row.unit)}` : ""}
                  </Text>
                </View>
              ))
            ) : (
              <Text style={{ color: colors.error }}>{t(result.error)}</Text>
            )}
            {result.ok
              ? result.notes.map((note) => (
                  <Text key={note} style={[styles.note, { color: colors.muted }]}>
                    • {t(note)}
                  </Text>
                ))
              : null}
          </Card>
          {result.ok ? (
            <SecondaryButton icon="share" label={t("Share result")} onPress={share} />
          ) : null}
          <Text style={[styles.note, { color: colors.muted }]}>
            {t(
              "Planning quantities from standard thumb rules. The site engineer checks them against drawings and specifications.",
            )}
          </Text>
        </ScrollView>
      </Screen>
    </AuthGate>
  );
}

const styles = StyleSheet.create({
  resultTitle: { fontSize: 15, fontWeight: "800", marginBottom: 6 },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 10,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  label: { flex: 1, fontSize: 13 },
  value: { flexShrink: 1, textAlign: "right" },
  note: { fontSize: 12, lineHeight: 18, marginTop: 6 },
});
