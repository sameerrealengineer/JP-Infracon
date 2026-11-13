import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect, useState, type ReactNode } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { PermissionsSetup } from "@/components/jp/permissions-setup";
import { centeredColumn } from "@/constants/layout";
import { useColors } from "@/hooks/use-colors";
import { useT } from "@/lib/i18n";
import { PERMISSIONS_ASKED_KEY } from "@/lib/jp/permission-plan";

/**
 * Right after the first sign-in on a phone or browser, shows the permission screen once, so every
 * permission is asked up front instead of in the middle of a form. Later it opens from
 * More → App permissions.
 */
export function PermissionsGate({ children }: { children: ReactNode }) {
  const colors = useColors();
  const { t } = useT();
  const [asked, setAsked] = useState<boolean | null>(null);

  useEffect(() => {
    let active = true;
    AsyncStorage.getItem(PERMISSIONS_ASKED_KEY)
      .then((value) => {
        if (active) setAsked(Boolean(value));
      })
      .catch(() => {
        if (active) setAsked(true);
      });
    return () => {
      active = false;
    };
  }, []);

  if (asked === null)
    return (
      <View style={[styles.state, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  if (asked) return <>{children}</>;
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView contentContainerStyle={[styles.content, centeredColumn]}>
        <Text style={[styles.eyebrow, { color: colors.accent }]}>{t("ONE-TIME SETUP")}</Text>
        <Text style={[styles.title, { color: colors.foreground }]}>{t("App permissions")}</Text>
        <PermissionsSetup onContinue={() => setAsked(true)} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  state: { flex: 1, alignItems: "center", justifyContent: "center" },
  content: { padding: 20, paddingBottom: 40, gap: 6 },
  eyebrow: { fontSize: 11, letterSpacing: 1.8, fontWeight: "800" },
  title: { fontSize: 28, fontWeight: "800", marginBottom: 6 },
});
