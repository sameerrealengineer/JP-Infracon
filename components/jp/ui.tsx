import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useRouter } from "expo-router";
import type { ComponentProps, ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { ScreenContainer } from "@/components/screen-container";
import { useColors } from "@/hooks/use-colors";
import {
  getSyncTone,
  getWorkflowTone,
  type SyncStatus,
  type WorkflowStatus,
} from "@/lib/jp/domain";

type IconName = ComponentProps<typeof MaterialIcons>["name"];
type Tone = "success" | "warning" | "error" | "info";

export function IconButton({
  icon,
  label,
  onPress,
  badge,
}: {
  icon: IconName;
  label: string;
  onPress?: () => void;
  badge?: number;
}) {
  const colors = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [
        styles.iconButton,
        { backgroundColor: colors.surface, borderColor: colors.border },
        pressed && styles.pressed,
      ]}
    >
      <MaterialIcons name={icon} size={21} color={colors.foreground} />
      {typeof badge === "number" && badge > 0 ? (
        <View style={[styles.badge, { backgroundColor: colors.warning }]}>
          <Text style={[styles.badgeText, { color: colors.background }]}>
            {badge > 9 ? "9+" : badge}
          </Text>
        </View>
      ) : null}
    </Pressable>
  );
}

export function AppHeader({
  eyebrow,
  title,
  subtitle,
  notificationCount = 0,
  userInitials = "?",
}: {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  notificationCount?: number;
  userInitials?: string;
}) {
  const router = useRouter();
  const colors = useColors();
  return (
    <View style={[styles.header, { backgroundColor: colors.background }]}>
      <View style={styles.headerCopy}>
        {eyebrow ? (
          <Text style={[styles.eyebrow, { color: colors.primary }]}>{eyebrow.toUpperCase()}</Text>
        ) : null}
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>{title}</Text>
        {subtitle ? (
          <Text style={[styles.headerSubtitle, { color: colors.muted }]}>{subtitle}</Text>
        ) : null}
      </View>
      <View style={styles.headerActions}>
        <IconButton
          icon="notifications-none"
          label="Open notifications"
          badge={notificationCount}
          onPress={() => router.push("/notifications" as never)}
        />
        <View style={[styles.avatar, { backgroundColor: colors.primary }]}>
          <Text style={[styles.avatarText, { color: colors.background }]}>
            {userInitials.slice(0, 2).toUpperCase() || "?"}
          </Text>
        </View>
      </View>
    </View>
  );
}

export function OfflineBanner({
  pendingCount,
  connected,
  lastSyncedAt,
  onRetry,
  retrying = false,
}: {
  pendingCount: number;
  connected?: boolean;
  lastSyncedAt?: string | null;
  onRetry?: () => void;
  retrying?: boolean;
}) {
  const colors = useColors();
  const tone =
    connected === false ? colors.warning : connected === true ? colors.success : colors.muted;
  const title =
    connected === false
      ? "Offline · drafts stay on this device"
      : connected === true
        ? "Server connection available"
        : "Sync status not yet confirmed";
  const detail =
    pendingCount > 0
      ? `${pendingCount} local draft${pendingCount === 1 ? "" : "s"} not yet confirmed by the server.`
      : lastSyncedAt
        ? `Last server response · ${lastSyncedAt}`
        : "Server records refresh when a connection is available.";
  return (
    <View
      style={[styles.offlineBanner, { backgroundColor: `${tone}15`, borderColor: `${tone}45` }]}
    >
      <View style={[styles.statusDot, { backgroundColor: tone }]} />
      <View style={styles.offlineCopy}>
        <Text style={[styles.offlineTitle, { color: colors.foreground }]}>{title}</Text>
        <Text style={[styles.offlineDetail, { color: colors.muted }]}>{detail}</Text>
      </View>
      {onRetry ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Retry sync"
          disabled={retrying}
          onPress={onRetry}
          hitSlop={8}
        >
          <Text style={[styles.retryText, { color: colors.primary }]}>
            {retrying ? "Checking…" : "Retry"}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export function SectionHeader({
  title,
  action,
  onPress,
}: {
  title: string;
  action?: string;
  onPress?: () => void;
}) {
  const colors = useColors();
  return (
    <View style={styles.sectionHeader}>
      <Text style={[styles.sectionTitle, { color: colors.foreground }]}>{title}</Text>
      {action ? (
        <Pressable accessibilityRole="button" onPress={onPress} hitSlop={8}>
          <Text style={[styles.sectionAction, { color: colors.primary }]}>{action}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export function StatusPill({
  label,
  tone,
  compact = false,
}: {
  label: string;
  tone: Tone;
  compact?: boolean;
}) {
  const colors = useColors();
  const palette = {
    success: { bg: `${colors.success}18`, text: colors.success, dot: colors.success },
    warning: { bg: `${colors.warning}18`, text: colors.warning, dot: colors.warning },
    error: { bg: `${colors.error}18`, text: colors.error, dot: colors.error },
    info: { bg: `${colors.primary}18`, text: colors.primary, dot: colors.primary },
  }[tone];
  return (
    <View style={[styles.pill, compact && styles.pillCompact, { backgroundColor: palette.bg }]}>
      <View style={[styles.pillDot, { backgroundColor: palette.dot }]} />
      <Text style={[styles.pillText, { color: palette.text }]}>{label}</Text>
    </View>
  );
}

export function WorkflowPill({ status }: { status: WorkflowStatus }) {
  return <StatusPill label={status} tone={getWorkflowTone(status)} />;
}
export function SyncPill({ status }: { status: SyncStatus }) {
  return <StatusPill label={status} tone={getSyncTone(status)} compact />;
}

export function MetricCard({
  icon,
  value,
  label,
  tone = "info",
  note,
}: {
  icon: IconName;
  value: string;
  label: string;
  tone?: Tone;
  note?: string;
}) {
  const colors = useColors();
  const accent =
    tone === "warning"
      ? colors.warning
      : tone === "error"
        ? colors.error
        : tone === "success"
          ? colors.success
          : colors.primary;
  return (
    <View
      style={[styles.metricCard, { backgroundColor: colors.surface, borderColor: colors.border }]}
    >
      <View style={[styles.metricIcon, { backgroundColor: `${accent}16` }]}>
        <MaterialIcons name={icon} size={18} color={accent} />
      </View>
      <Text style={[styles.metricValue, { color: colors.foreground }]}>{value}</Text>
      <Text style={[styles.metricLabel, { color: colors.muted }]}>{label}</Text>
      {note ? <Text style={[styles.metricNote, { color: accent }]}>{note}</Text> : null}
    </View>
  );
}

export function PrimaryButton({
  icon,
  label,
  onPress,
  disabled = false,
}: {
  icon?: IconName;
  label: string;
  onPress?: () => void;
  disabled?: boolean;
}) {
  const colors = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.primaryButton,
        { backgroundColor: disabled ? colors.border : colors.primary },
        pressed && !disabled && styles.pressed,
      ]}
    >
      {icon ? <MaterialIcons name={icon} size={19} color={colors.background} /> : null}
      <Text style={[styles.primaryButtonText, { color: colors.background }]}>{label}</Text>
    </Pressable>
  );
}

export function SecondaryButton({
  icon,
  label,
  onPress,
  disabled = false,
}: {
  icon?: IconName;
  label: string;
  onPress?: () => void;
  disabled?: boolean;
}) {
  const colors = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.secondaryButton,
        {
          backgroundColor: colors.surface,
          borderColor: colors.border,
          opacity: disabled ? 0.55 : 1,
        },
        pressed && !disabled && styles.pressed,
      ]}
    >
      {icon ? <MaterialIcons name={icon} size={18} color={colors.foreground} /> : null}
      <Text style={[styles.secondaryButtonText, { color: colors.foreground }]}>{label}</Text>
    </Pressable>
  );
}

export function EmptyState({
  icon,
  title,
  detail,
  action,
  onPress,
}: {
  icon: IconName;
  title: string;
  detail: string;
  action?: string;
  onPress?: () => void;
}) {
  const colors = useColors();
  return (
    <View
      style={[styles.emptyState, { backgroundColor: colors.surface, borderColor: colors.border }]}
    >
      <View style={[styles.emptyIcon, { backgroundColor: `${colors.primary}14` }]}>
        <MaterialIcons name={icon} size={25} color={colors.primary} />
      </View>
      <Text style={[styles.emptyTitle, { color: colors.foreground }]}>{title}</Text>
      <Text style={[styles.emptyDetail, { color: colors.muted }]}>{detail}</Text>
      {action ? <SecondaryButton label={action} onPress={onPress} /> : null}
    </View>
  );
}

export function InlineError({ message, onRetry }: { message: string; onRetry?: () => void }) {
  const colors = useColors();
  return (
    <View
      style={[
        styles.errorCard,
        { backgroundColor: `${colors.error}10`, borderColor: `${colors.error}45` },
      ]}
    >
      <MaterialIcons name="error-outline" size={19} color={colors.error} />
      <View style={{ flex: 1 }}>
        <Text style={[styles.errorTitle, { color: colors.foreground }]}>
          Could not load server data
        </Text>
        <Text style={[styles.errorDetail, { color: colors.muted }]}>{message}</Text>
      </View>
      {onRetry ? (
        <Pressable accessibilityRole="button" onPress={onRetry}>
          <Text style={[styles.retryText, { color: colors.primary }]}>Retry</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export function Screen({ children, scroll = true }: { children: ReactNode; scroll?: boolean }) {
  return (
    <ScreenContainer className="px-5" safeAreaClassName="bg-background">
      {scroll ? children : <View style={{ flex: 1 }}>{children}</View>}
    </ScreenContainer>
  );
}

export const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    paddingTop: 11,
    paddingBottom: 17,
  },
  headerCopy: { flex: 1, paddingRight: 14 },
  eyebrow: { fontSize: 11, letterSpacing: 1.6, fontWeight: "800", marginBottom: 5 },
  headerTitle: { fontSize: 28, lineHeight: 33, fontWeight: "800", letterSpacing: -0.5 },
  headerSubtitle: { fontSize: 13, lineHeight: 19, marginTop: 5 },
  headerActions: { flexDirection: "row", alignItems: "center", gap: 9 },
  iconButton: {
    width: 42,
    height: 42,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
  },
  badge: {
    position: "absolute",
    top: -4,
    right: -4,
    minWidth: 17,
    height: 17,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 4,
  },
  badgeText: { fontSize: 10, fontWeight: "800" },
  avatar: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { fontSize: 13, fontWeight: "800", letterSpacing: 0.3 },
  offlineBanner: {
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 13,
    paddingVertical: 11,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 21,
  },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  offlineCopy: { flex: 1 },
  offlineTitle: { fontSize: 12, fontWeight: "800" },
  offlineDetail: { fontSize: 11, marginTop: 2 },
  retryText: { fontSize: 12, fontWeight: "800" },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 11,
    marginTop: 4,
  },
  sectionTitle: { fontSize: 16, fontWeight: "800", letterSpacing: -0.15 },
  sectionAction: { fontSize: 12, fontWeight: "800" },
  pill: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 5,
  },
  pillCompact: { paddingVertical: 4, paddingHorizontal: 8 },
  pillDot: { width: 6, height: 6, borderRadius: 3 },
  pillText: { fontSize: 11, fontWeight: "800" },
  metricCard: {
    flex: 1,
    minHeight: 116,
    borderWidth: 1,
    borderRadius: 18,
    padding: 13,
    marginRight: 9,
  },
  metricIcon: {
    width: 30,
    height: 30,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 9,
  },
  metricValue: { fontSize: 24, fontWeight: "800", letterSpacing: -0.7 },
  metricLabel: { fontSize: 11, lineHeight: 15, marginTop: 2 },
  metricNote: { fontSize: 10, fontWeight: "800", marginTop: 5 },
  primaryButton: {
    minHeight: 48,
    borderRadius: 14,
    paddingHorizontal: 17,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  primaryButtonText: { fontSize: 13, fontWeight: "800" },
  secondaryButton: {
    minHeight: 44,
    borderRadius: 13,
    borderWidth: 1,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
  },
  secondaryButtonText: { fontSize: 13, fontWeight: "800" },
  emptyState: { borderWidth: 1, borderRadius: 18, padding: 22, alignItems: "center", marginTop: 3 },
  emptyIcon: {
    width: 52,
    height: 52,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 12,
  },
  emptyTitle: { fontSize: 16, fontWeight: "800", textAlign: "center" },
  emptyDetail: {
    fontSize: 13,
    lineHeight: 19,
    textAlign: "center",
    marginTop: 5,
    marginBottom: 16,
    maxWidth: 280,
  },
  errorCard: {
    borderWidth: 1,
    borderRadius: 16,
    padding: 13,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 9,
    marginBottom: 12,
  },
  errorTitle: { fontSize: 12, fontWeight: "800" },
  errorDetail: { fontSize: 11, lineHeight: 16, marginTop: 3 },
  pressed: { opacity: 0.78, transform: [{ scale: 0.99 }] },
});
