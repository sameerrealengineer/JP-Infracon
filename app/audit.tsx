import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useRouter } from "expo-router";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { AuthGate } from "@/components/jp/auth-gate";
import { EmptyState, InlineError, Screen, StatusPill } from "@/components/jp/ui";
import { useColors } from "@/hooks/use-colors";
import { trpc } from "@/lib/trpc";

function formatTime(value: string | Date) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? "Time unavailable" : new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}
function actionLabel(action: string) {
  return action.replaceAll(".", " · ").replaceAll("_", " ").replace(/\b\w/g, (part) => part.toUpperCase());
}
function safeChangeSummary(value: string | null) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    const allowed = ["status", "reportKind", "reportDate", "item", "quantity", "unitCode"];
    const parts = allowed.filter((key) => typeof parsed[key] === "string" || typeof parsed[key] === "number").map((key) => `${key.replace(/([A-Z])/g, " $1").toLowerCase()}: ${parsed[key]}`);
    return parts.length ? parts.join(" · ") : null;
  } catch { return null; }
}
function tone(action: string): "success" | "warning" | "error" | "info" {
  if (action.endsWith("approved") || action.endsWith("initialized")) return "success";
  if (action.endsWith("returned")) return "warning";
  if (action.endsWith("rejected")) return "error";
  return "info";
}

export default function AuditScreen() {
  const colors = useColors();
  const router = useRouter();
  const events = trpc.jp.workspace.auditEvents.useQuery();
  return <AuthGate><Screen><ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
    <View style={styles.header}><Pressable accessibilityRole="button" accessibilityLabel="Go back" onPress={() => router.back()}><MaterialIcons name="arrow-back" size={23} color={colors.foreground} /></Pressable><View style={styles.headerCopy}><Text style={[styles.eyebrow, { color: colors.primary }]}>TRACEABILITY</Text><Text style={[styles.title, { color: colors.foreground }]}>Audit activity</Text></View><StatusPill label="Read only" tone="info" /></View>
    <Text style={[styles.detail, { color: colors.muted }]}>Append-only events for sites in your authorised scope. Records include the actor, action, and server timestamp; raw IDs and unrelated organisation events are not exposed.</Text>
    {events.isError ? <InlineError message={events.error.message} onRetry={() => { void events.refetch(); }} /> : null}
    {events.isLoading ? <View style={styles.loading}><ActivityIndicator color={colors.primary} /><Text style={[styles.loadingText, { color: colors.muted }]}>Loading permitted audit events…</Text></View> : events.data?.length ? <View style={styles.timeline}>{events.data.map((event, index) => {
      const detail = safeChangeSummary(event.afterSummary) || event.reason || `Record type · ${event.entityType.replaceAll("_", " ")}`;
      const eventTone = tone(event.action);
      return <View key={event.id} style={styles.event}><View style={styles.timelineRail}><View style={[styles.timelineDot, { backgroundColor: eventTone === "warning" ? colors.warning : eventTone === "success" ? colors.success : eventTone === "error" ? colors.error : colors.primary }]} />{index < events.data.length - 1 ? <View style={[styles.rail, { backgroundColor: colors.border }]} /> : null}</View><View style={[styles.eventCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <View style={styles.eventTop}><Text style={[styles.eventTitle, { color: colors.foreground }]}>{actionLabel(event.action)}</Text><Text style={[styles.eventTime, { color: colors.muted }]}>{formatTime(event.occurredAt)}</Text></View>
        <Text style={[styles.eventDetail, { color: colors.muted }]}>{detail}</Text>
        <Text style={[styles.eventActor, { color: colors.primary }]}>Performed by {event.actorName || "Active account"}</Text>
      </View></View>;
    })}</View> : <EmptyState icon="history" title="No audit events in this scope" detail="Authorised workflow changes appear here after the server records them." />}
  </ScrollView></Screen></AuthGate>;
}

const styles = StyleSheet.create({
  content: { paddingBottom: 30 },
  header: { flexDirection: "row", alignItems: "center", gap: 12, paddingTop: 12, paddingBottom: 15 },
  headerCopy: { flex: 1 },
  eyebrow: { fontSize: 10, letterSpacing: 1.4, fontWeight: "800" },
  title: { fontSize: 27, fontWeight: "800", marginTop: 3 },
  detail: { fontSize: 13, lineHeight: 19, marginBottom: 24 },
  loading: { minHeight: 90, alignItems: "center", justifyContent: "center", gap: 8 },
  loadingText: { fontSize: 12 },
  timeline: { gap: 0 },
  event: { flexDirection: "row", alignItems: "stretch", gap: 11 },
  timelineRail: { width: 16, alignItems: "center" },
  timelineDot: { width: 10, height: 10, borderRadius: 5, marginTop: 19 },
  rail: { width: 1, flex: 1, marginTop: 5, marginBottom: -2 },
  eventCard: { flex: 1, borderWidth: 1, borderRadius: 17, padding: 14, marginBottom: 11 },
  eventTop: { gap: 4 },
  eventTitle: { fontSize: 13, fontWeight: "800" },
  eventTime: { fontSize: 10 },
  eventDetail: { fontSize: 11, lineHeight: 17, marginTop: 9 },
  eventActor: { fontSize: 10, fontWeight: "800", marginTop: 10 },
});
