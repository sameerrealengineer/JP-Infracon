import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useRouter } from "expo-router";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { AuthGate } from "@/components/jp/auth-gate";
import { EmptyState, Screen } from "@/components/jp/ui";
import { useColors } from "@/hooks/use-colors";

export default function NotificationsScreen() {
  const colors = useColors();
  const router = useRouter();
  return (
    <AuthGate>
      <Screen>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
          <View style={styles.header}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Go back"
              onPress={() => router.back()}
            >
              <MaterialIcons name="arrow-back" size={23} color={colors.foreground} />
            </Pressable>
            <View style={styles.headerCopy}>
              <Text style={[styles.eyebrow, { color: colors.primary }]}>INBOX</Text>
              <Text style={[styles.title, { color: colors.foreground }]}>Notifications</Text>
            </View>
          </View>
          <View
            style={[styles.notice, { backgroundColor: colors.surface, borderColor: colors.border }]}
          >
            <MaterialIcons name="info-outline" size={19} color={colors.warning} />
            <Text style={[styles.noticeText, { color: colors.muted }]}>
              The server-backed notification inbox, read state, event subscriptions, and push
              delivery are not implemented in this build.
            </Text>
          </View>
          <EmptyState
            icon="notifications-none"
            title="Notifications are not enabled yet"
            detail="Approval updates and operational alerts are not currently delivered to this screen. Check the live report and material request registers for their server-recorded status."
            action="Return to field records"
            onPress={() => router.replace("/(tabs)" as never)}
          />
        </ScrollView>
      </Screen>
    </AuthGate>
  );
}

const styles = StyleSheet.create({
  content: { paddingBottom: 30 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingTop: 12,
    paddingBottom: 15,
  },
  headerCopy: { flex: 1 },
  eyebrow: { fontSize: 10, letterSpacing: 1.4, fontWeight: "800" },
  title: { fontSize: 27, fontWeight: "800", marginTop: 3 },
  notice: {
    borderWidth: 1,
    borderRadius: 15,
    padding: 13,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 9,
    marginBottom: 16,
  },
  noticeText: { fontSize: 12, lineHeight: 18, flex: 1 },
});
