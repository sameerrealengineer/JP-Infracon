import { MaterialIcons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { Pressable, StyleSheet } from "react-native";
import { useColors } from "@/hooks/use-colors";
import { manualFormById } from "@/lib/jp/manual-content";
import { useT } from "@/lib/i18n";

/**
 * The book icon on screens and forms. With `form` it opens that form's manual page; with
 * `module` it opens the manual contents at that module.
 */
export function ManualButton({
  form,
  module,
  size = 40,
}: {
  form?: string;
  module?: string | null;
  size?: number;
}) {
  const { t } = useT();
  const colors = useColors();
  const router = useRouter();
  const page = form ? manualFormById(form) : null;
  if (!page && !module) return null;
  const href = page ? `/manual?form=${page.id}` : `/manual?module=${module}`;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={page ? t("Open the manual page") : t("Open the user manual")}
      onPress={() => router.push(href as never)}
      hitSlop={8}
      style={({ pressed }) => [
        styles.button,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          borderColor: colors.border,
          backgroundColor: colors.surface,
        },
        pressed && { opacity: 0.7 },
      ]}
    >
      <MaterialIcons name="menu-book" size={size * 0.48} color={colors.accent} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: { borderWidth: 1, alignItems: "center", justifyContent: "center" },
});
