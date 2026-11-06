import { MaterialIcons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { SecondaryButton, Sheet } from "@/components/jp/ui";
import { useColors } from "@/hooks/use-colors";
import { topicByKey, type HelpTopic } from "@/lib/jp/help-content";
import { useT } from "@/lib/i18n";

/** The guide for one module: what it is, who uses it, first step, what next, who approves. */
export function HelpDetail({ topic }: { topic: HelpTopic }) {
  const { t } = useT();
  const colors = useColors();
  const rows: [string, string | null][] = [
    [t("What is this?"), topic.what],
    [t("Who uses it?"), topic.who],
    [t("What to do first"), topic.first],
    [t("What happens next"), topic.next],
    [t("Who approves?"), topic.approval],
  ];
  return (
    <View style={{ gap: 10 }}>
      {rows
        .filter((row): row is [string, string] => Boolean(row[1]))
        .map(([label, text]) => (
          <View key={label}>
            <Text style={[styles.label, { color: colors.accent }]}>{label}</Text>
            <Text style={[styles.text, { color: colors.foreground }]}>{t(text)}</Text>
          </View>
        ))}
    </View>
  );
}

/** A small "?" in a screen header that opens that module's guide. */
export function HelpButton({ topicKey }: { topicKey: string }) {
  const { t } = useT();
  const colors = useColors();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const topic = topicByKey(topicKey);
  if (!topic) return null;
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("Help: {title}", { title: t(topic.title) })}
        onPress={() => setOpen(true)}
        hitSlop={8}
        style={[styles.button, { borderColor: colors.border, backgroundColor: colors.surface }]}
      >
        <MaterialIcons name="help-outline" size={20} color={colors.primary} />
      </Pressable>
      <Sheet visible={open} title={t(topic.title)} onClose={() => setOpen(false)}>
        <HelpDetail topic={topic} />
        <View style={{ marginTop: 14 }}>
          <SecondaryButton
            icon="menu-book"
            label={t("Open the full guide")}
            onPress={() => {
              setOpen(false);
              router.push("/help" as never);
            }}
          />
        </View>
      </Sheet>
    </>
  );
}

const styles = StyleSheet.create({
  button: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  label: { fontSize: 11, fontWeight: "800", letterSpacing: 0.6, textTransform: "uppercase" },
  text: { fontSize: 14, lineHeight: 20, marginTop: 2 },
});
