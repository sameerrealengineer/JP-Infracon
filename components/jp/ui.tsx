import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter, useSegments } from "expo-router";
import { useEffect, type ComponentProps, type ReactNode } from "react";
import {
  ActivityIndicator,
  Image,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from "react-native";
import { ScreenContainer } from "@/components/screen-container";
import { useColors } from "@/hooks/use-colors";
import { useColorScheme } from "@/hooks/use-color-scheme";
import {
  getSyncTone,
  getWorkflowTone,
  type SyncStatus,
  type WorkflowStatus,
} from "@/lib/jp/domain";
import { trpc } from "@/lib/trpc";
import { useT } from "@/lib/i18n";
import Animated, {
  FadeIn,
  FadeInDown,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";

/** Classic serif for display headings; falls back to the system font until loaded. */
export const displayFont = "PlayfairDisplay_700Bold";

/** Soft rise-and-fade used for cards and tiles as they appear. */
const enter = FadeInDown.duration(420).springify().damping(18).mass(0.8);

export type IconName = ComponentProps<typeof MaterialIcons>["name"];
export type Tone = "success" | "warning" | "error" | "info" | "accent";

export function useToneColor(tone: Tone) {
  const colors = useColors();
  return {
    success: colors.success,
    warning: colors.warning,
    error: colors.error,
    info: colors.primary,
    accent: colors.accent,
  }[tone];
}

/** Soft card shadow that works on Android (elevation), iOS and web. */
export function useElevation(level: 1 | 2 = 1) {
  const scheme = useColorScheme();
  if (scheme === "dark") return {};
  return Platform.select({
    android: { elevation: level === 1 ? 2 : 5 },
    default: {
      shadowColor: "#0E1A26",
      shadowOpacity: level === 1 ? 0.06 : 0.12,
      shadowRadius: level === 1 ? 10 : 18,
      shadowOffset: { width: 0, height: level === 1 ? 3 : 8 },
    },
  });
}

export function initialsOf(name: string | null | undefined) {
  return (
    name
      ?.trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0])
      .join("")
      .toUpperCase() || "?"
  );
}

export function formatDateTime(value?: string | number | Date | null) {
  if (value === null || value === undefined || value === 0) return "Not available";
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime())
    ? "Not available"
    : new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

export function IconButton({
  icon,
  label,
  onPress,
  badge,
  variant = "surface",
}: {
  icon: IconName;
  label: string;
  onPress?: () => void;
  badge?: number;
  variant?: "surface" | "glass";
}) {
  const colors = useColors();
  const glass = variant === "glass";
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={4}
      style={({ pressed }) => [
        styles.iconButton,
        glass
          ? { backgroundColor: "rgba(255,255,255,0.12)", borderColor: "rgba(255,255,255,0.18)" }
          : { backgroundColor: colors.surface, borderColor: colors.border },
        pressed && styles.pressed,
      ]}
    >
      <MaterialIcons name={icon} size={21} color={glass ? "#F6F1E6" : colors.foreground} />
      {typeof badge === "number" && badge > 0 ? (
        <View style={[styles.badge, { backgroundColor: colors.accent }]}>
          <Text style={[styles.badgeText, { color: "#0E1A26" }]}>{badge > 9 ? "9+" : badge}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

/** Live count of open items in the signed-in user's inbox (derived from server records). */
function useInboxCount() {
  const inbox = trpc.jp.workspace.inbox.useQuery(undefined, { staleTime: 60_000 });
  return inbox.data?.items.length ?? 0;
}

function BackButton({ glass }: { glass?: boolean }) {
  const router = useRouter();
  return (
    <IconButton
      icon="arrow-back"
      label="Go back"
      variant={glass ? "glass" : "surface"}
      onPress={() => (router.canGoBack() ? router.back() : router.replace("/" as never))}
    />
  );
}

/**
 * Screen header. Tab screens get the brand row; stacked screens get a back button automatically.
 */
export function AppHeader({
  eyebrow,
  title,
  subtitle,
  notificationCount,
  userInitials,
  right,
}: {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  notificationCount?: number;
  userInitials?: string;
  right?: ReactNode;
}) {
  const router = useRouter();
  const colors = useColors();
  const { t } = useT();
  const segments = useSegments();
  const inTabs = segments[0] === "(tabs)";
  const inboxCount = useInboxCount();
  const me = trpc.auth.me.useQuery(undefined, { retry: false, staleTime: 5 * 60_000 });
  const initials = userInitials && userInitials !== "?" ? userInitials : initialsOf(me.data?.name);
  return (
    <View style={styles.header}>
      <View style={styles.headerTopRow}>
        {inTabs ? (
          <View style={styles.brandRow}>
            <Image
              source={require("../../assets/images/icon.png")}
              style={styles.brandLogo}
              accessibilityLabel="JP Infracon"
            />
            <View>
              <Text style={[styles.brandName, { color: colors.foreground }]}>JP INFRACON</Text>
              <Text style={[styles.brandTag, { color: colors.accent }]}>
                {t("Build with certainty")}
              </Text>
            </View>
          </View>
        ) : (
          <BackButton />
        )}
        <View style={styles.headerActions}>
          {right}
          <IconButton
            icon="notifications-none"
            label={t("Open notifications")}
            badge={notificationCount ?? inboxCount}
            onPress={() => router.push("/notifications" as never)}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Open account and settings"
            onPress={() => router.push("/(tabs)/more" as never)}
            style={({ pressed }) => [
              styles.avatar,
              { backgroundColor: colors.primary },
              pressed && styles.pressed,
            ]}
          >
            <Text style={[styles.avatarText, { color: colors.background }]}>{initials}</Text>
          </Pressable>
        </View>
      </View>
      <View style={styles.headerCopy}>
        {eyebrow ? (
          <Text style={[styles.eyebrow, { color: colors.accent }]}>{eyebrow.toUpperCase()}</Text>
        ) : null}
        <Text style={[styles.headerTitle, { color: colors.foreground }]} accessibilityRole="header">
          {title}
        </Text>
        {subtitle ? (
          <Text style={[styles.headerSubtitle, { color: colors.muted }]}>{subtitle}</Text>
        ) : null}
      </View>
    </View>
  );
}

/** Navy-to-ink gradient hero with gold accents. */
export function HeroCard({ children }: { children: ReactNode }) {
  const elevation = useElevation(2);
  return (
    <Animated.View entering={FadeIn.duration(500)} style={[styles.heroShell, elevation]}>
      <LinearGradient
        colors={["#1E3E60", "#10243A", "#0A1624"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.hero}
      >
        <View style={styles.heroGlow} />
        <View style={styles.heroLine} />
        {children}
      </LinearGradient>
    </Animated.View>
  );
}

export function HeroStat({ value, label }: { value: string; label: string }) {
  return (
    <View style={styles.heroStat}>
      <Text style={styles.heroStatValue}>{value}</Text>
      <Text style={styles.heroStatLabel}>{label}</Text>
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
  connected?: boolean | null;
  lastSyncedAt?: string | null;
  onRetry?: () => void;
  retrying?: boolean;
}) {
  const colors = useColors();
  const { t } = useT();
  if (connected === true && pendingCount === 0) {
    return (
      <View style={styles.syncChipRow}>
        <View style={[styles.statusDot, { backgroundColor: colors.success }]} />
        <Text style={[styles.syncChipText, { color: colors.muted }]}>
          {t("Live")}
          {lastSyncedAt ? ` · ${t("updated {time}", { time: lastSyncedAt })}` : ""}
        </Text>
        {onRetry ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Refresh"
            onPress={onRetry}
            disabled={retrying}
            hitSlop={10}
          >
            {retrying ? (
              <ActivityIndicator size="small" color={colors.primary} />
            ) : (
              <MaterialIcons name="refresh" size={16} color={colors.primary} />
            )}
          </Pressable>
        ) : null}
      </View>
    );
  }
  const tone = connected === false ? colors.warning : colors.primary;
  const title =
    connected === false
      ? t("You are offline")
      : pendingCount > 0
        ? t("Drafts waiting to sync")
        : t("Connecting to server…");
  const detail =
    connected === false
      ? `Showing records saved on this device${lastSyncedAt ? ` (last updated ${lastSyncedAt})` : ""}. Drafts stay here until you are back online.`
      : pendingCount > 0
        ? `${pendingCount} local draft${pendingCount === 1 ? "" : "s"} not yet confirmed by the server.`
        : "Records refresh as soon as the server responds.";
  return (
    <View
      style={[styles.offlineBanner, { backgroundColor: `${tone}12`, borderColor: `${tone}40` }]}
      accessibilityLiveRegion="polite"
    >
      <MaterialIcons
        name={connected === false ? "cloud-off" : "cloud-sync"}
        size={20}
        color={tone}
      />
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
            {retrying ? t("Checking…") : t("Retry")}
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
  caption,
}: {
  title: string;
  action?: string;
  onPress?: () => void;
  caption?: string;
}) {
  const colors = useColors();
  return (
    <View style={styles.sectionHeader}>
      <View style={{ flex: 1 }}>
        <View style={styles.sectionTitleRow}>
          <View style={[styles.sectionMark, { backgroundColor: colors.accent }]} />
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>{title}</Text>
        </View>
        {caption ? (
          <Text style={[styles.sectionCaption, { color: colors.muted }]}>{caption}</Text>
        ) : null}
      </View>
      {action ? (
        <Pressable
          accessibilityRole="button"
          onPress={onPress}
          hitSlop={10}
          style={styles.sectionActionWrap}
        >
          <Text style={[styles.sectionAction, { color: colors.primary }]}>{action}</Text>
          <MaterialIcons name="chevron-right" size={16} color={colors.primary} />
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
  const color = useToneColor(tone);
  return (
    <View style={[styles.pill, compact && styles.pillCompact, { backgroundColor: `${color}16` }]}>
      <View style={[styles.pillDot, { backgroundColor: color }]} />
      <Text style={[styles.pillText, { color }]}>{label}</Text>
    </View>
  );
}

export function WorkflowPill({ status }: { status: WorkflowStatus }) {
  return <StatusPill label={status} tone={getWorkflowTone(status)} />;
}
export function SyncPill({ status }: { status: SyncStatus }) {
  return <StatusPill label={status} tone={getSyncTone(status)} compact />;
}

export function Card({
  children,
  onPress,
  accent,
  style,
  accessibilityLabel,
}: {
  children: ReactNode;
  onPress?: () => void;
  accent?: Tone;
  style?: object;
  accessibilityLabel?: string;
}) {
  const colors = useColors();
  const elevation = useElevation(1);
  const accentColor = useToneColor(accent ?? "accent");
  const body = (
    <>
      {accent ? <View style={[styles.cardAccent, { backgroundColor: accentColor }]} /> : null}
      <View style={{ flex: 1 }}>{children}</View>
    </>
  );
  const base = [
    styles.card,
    { backgroundColor: colors.surface, borderColor: colors.border },
    elevation,
    style,
  ];
  if (!onPress)
    return (
      <Animated.View entering={enter} style={base}>
        {body}
      </Animated.View>
    );
  return (
    <Animated.View entering={enter}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        onPress={onPress}
        style={({ pressed }) => [...base, pressed && styles.pressed]}
      >
        {body}
      </Pressable>
    </Animated.View>
  );
}

export function MetricCard({
  icon,
  value,
  label,
  tone = "info",
  note,
  onPress,
}: {
  icon: IconName;
  value: string;
  label: string;
  tone?: Tone;
  note?: string;
  onPress?: () => void;
}) {
  const colors = useColors();
  const accent = useToneColor(tone);
  const elevation = useElevation(1);
  return (
    <Animated.View entering={enter} style={{ flex: 1 }}>
      <Pressable
        accessibilityRole={onPress ? "button" : undefined}
        accessibilityLabel={`${label}: ${value}`}
        disabled={!onPress}
        onPress={onPress}
        style={({ pressed }) => [
          styles.metricCard,
          { backgroundColor: colors.surface, borderColor: colors.border },
          elevation,
          pressed && styles.pressed,
        ]}
      >
        <View style={[styles.metricIcon, { backgroundColor: `${accent}16` }]}>
          <MaterialIcons name={icon} size={18} color={accent} />
        </View>
        <Text style={[styles.metricValue, { color: colors.foreground }]}>{value}</Text>
        <Text style={[styles.metricLabel, { color: colors.muted }]} numberOfLines={2}>
          {label}
        </Text>
        {note ? <Text style={[styles.metricNote, { color: accent }]}>{note}</Text> : null}
      </Pressable>
    </Animated.View>
  );
}

/** Square module launcher used on Home and More. */
export function ModuleTile({
  icon,
  title,
  detail,
  onPress,
  tone = "info",
  badge,
}: {
  icon: IconName;
  title: string;
  detail?: string;
  onPress: () => void;
  tone?: Tone;
  badge?: number;
}) {
  const colors = useColors();
  const accent = useToneColor(tone);
  const elevation = useElevation(1);
  return (
    <Animated.View entering={enter} style={styles.tileShell}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={title}
        onPress={onPress}
        style={({ pressed }) => [
          styles.tile,
          { backgroundColor: colors.surface, borderColor: colors.border },
          elevation,
          pressed && styles.pressed,
        ]}
      >
        <View style={styles.tileTop}>
          <View style={[styles.tileIcon, { backgroundColor: `${accent}14` }]}>
            <MaterialIcons name={icon} size={22} color={accent} />
          </View>
          {badge ? (
            <View style={[styles.tileBadge, { backgroundColor: colors.accent }]}>
              <Text style={styles.tileBadgeText}>{badge > 99 ? "99+" : badge}</Text>
            </View>
          ) : null}
        </View>
        <Text style={[styles.tileTitle, { color: colors.foreground }]} numberOfLines={1}>
          {title}
        </Text>
        {detail ? (
          <Text style={[styles.tileDetail, { color: colors.muted }]} numberOfLines={2}>
            {detail}
          </Text>
        ) : null}
      </Pressable>
    </Animated.View>
  );
}

export function ListRow({
  icon,
  title,
  detail,
  onPress,
  trailing,
  tone = "info",
}: {
  icon: IconName;
  title: string;
  detail?: string;
  onPress?: () => void;
  trailing?: ReactNode;
  tone?: Tone;
}) {
  const colors = useColors();
  const accent = useToneColor(tone);
  return (
    <Pressable
      accessibilityRole={onPress ? "button" : undefined}
      disabled={!onPress}
      onPress={onPress}
      style={({ pressed }) => [styles.listRow, pressed && { opacity: 0.7 }]}
    >
      <View style={[styles.listIcon, { backgroundColor: `${accent}12` }]}>
        <MaterialIcons name={icon} size={19} color={accent} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.listTitle, { color: colors.foreground }]}>{title}</Text>
        {detail ? <Text style={[styles.listDetail, { color: colors.muted }]}>{detail}</Text> : null}
      </View>
      {trailing ??
        (onPress ? <MaterialIcons name="chevron-right" size={20} color={colors.muted} /> : null)}
    </Pressable>
  );
}

export function Divider() {
  const colors = useColors();
  return <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: colors.border }} />;
}

export function PrimaryButton({
  icon,
  label,
  onPress,
  disabled = false,
  loading = false,
  tone = "primary",
}: {
  icon?: IconName;
  label: string;
  onPress?: () => void;
  disabled?: boolean;
  loading?: boolean;
  tone?: "primary" | "danger" | "gold";
}) {
  const colors = useColors();
  const bg =
    disabled || loading
      ? colors.border
      : tone === "danger"
        ? colors.error
        : tone === "gold"
          ? colors.accent
          : colors.primary;
  const fg = tone === "gold" ? "#0E1A26" : tone === "danger" ? "#FFFFFF" : colors.background;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: disabled || loading, busy: loading }}
      disabled={disabled || loading}
      onPress={onPress}
      style={({ pressed }) => [
        styles.primaryButton,
        { backgroundColor: bg },
        pressed && !disabled && styles.pressed,
      ]}
    >
      {loading ? (
        <ActivityIndicator size="small" color={fg} />
      ) : icon ? (
        <MaterialIcons name={icon} size={19} color={disabled ? colors.muted : fg} />
      ) : null}
      <Text style={[styles.primaryButtonText, { color: disabled ? colors.muted : fg }]}>
        {label}
      </Text>
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
      {icon ? <MaterialIcons name={icon} size={18} color={colors.primary} /> : null}
      <Text style={[styles.secondaryButtonText, { color: colors.foreground }]}>{label}</Text>
    </Pressable>
  );
}

/** Floating "add" button for screens with a create action the user is allowed to take. */
export function Fab({
  icon = "add",
  label,
  onPress,
}: {
  icon?: IconName;
  label: string;
  onPress: () => void;
}) {
  const colors = useColors();
  const elevation = useElevation(2);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [
        styles.fab,
        { backgroundColor: colors.primary },
        elevation,
        pressed && styles.pressed,
      ]}
    >
      <MaterialIcons name={icon} size={22} color={colors.background} />
      <Text style={[styles.fabText, { color: colors.background }]}>{label}</Text>
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
      <View style={[styles.emptyIcon, { backgroundColor: `${colors.accent}18` }]}>
        <MaterialIcons name={icon} size={26} color={colors.accent} />
      </View>
      <Text style={[styles.emptyTitle, { color: colors.foreground }]}>{title}</Text>
      <Text style={[styles.emptyDetail, { color: colors.muted }]}>{detail}</Text>
      {action ? <SecondaryButton label={action} onPress={onPress} /> : null}
    </View>
  );
}

export function LoadingBlock({ label }: { label?: string }) {
  const colors = useColors();
  const { t } = useT();
  return (
    <View style={styles.loadingBlock} accessibilityLabel={label ?? t("Loading…")}>
      <Shimmer width="92%" />
      <Shimmer width="70%" />
      <Shimmer width="80%" />
      <View style={styles.loadingRow}>
        <ActivityIndicator size="small" color={colors.primary} />
        <Text style={[styles.loadingText, { color: colors.muted }]}>{label ?? t("Loading…")}</Text>
      </View>
    </View>
  );
}

/** Placeholder bar that gently pulses while records load. */
function Shimmer({ width }: { width: `${number}%` }) {
  const colors = useColors();
  const opacity = useSharedValue(0.35);
  useEffect(() => {
    opacity.value = withRepeat(
      withSequence(withTiming(0.8, { duration: 700 }), withTiming(0.35, { duration: 700 })),
      -1,
    );
  }, [opacity]);
  const animated = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return (
    <Animated.View style={[styles.shimmer, { width, backgroundColor: colors.border }, animated]} />
  );
}

function friendlyError(message: string) {
  if (/fetch|network|Failed to fetch|timeout|ECONN/i.test(message))
    return "The server could not be reached. Check your connection and try again.";
  return message;
}

export function InlineError({
  message,
  onRetry,
  title,
}: {
  message: string;
  onRetry?: () => void;
  title?: string;
}) {
  const colors = useColors();
  const { t } = useT();
  return (
    <View
      style={[
        styles.errorCard,
        { backgroundColor: `${colors.error}10`, borderColor: `${colors.error}40` },
      ]}
      accessibilityRole="alert"
    >
      <MaterialIcons name="error-outline" size={19} color={colors.error} />
      <View style={{ flex: 1 }}>
        <Text style={[styles.errorTitle, { color: colors.foreground }]}>
          {title ?? t("Something went wrong")}
        </Text>
        <Text style={[styles.errorDetail, { color: colors.muted }]}>{friendlyError(message)}</Text>
      </View>
      {onRetry ? (
        <Pressable accessibilityRole="button" onPress={onRetry} hitSlop={8}>
          <Text style={[styles.retryText, { color: colors.primary }]}>{t("Retry")}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export function Field({
  label,
  hint,
  error,
  ...input
}: TextInputProps & { label: string; hint?: string; error?: string | null }) {
  const colors = useColors();
  return (
    <View style={styles.field}>
      <Text style={[styles.fieldLabel, { color: colors.foreground }]}>{label}</Text>
      <TextInput
        placeholderTextColor={colors.muted}
        accessibilityLabel={label}
        {...input}
        style={[
          styles.fieldInput,
          input.multiline && styles.fieldMultiline,
          {
            color: colors.foreground,
            backgroundColor: colors.background,
            borderColor: error ? colors.error : colors.border,
          },
        ]}
      />
      {error ? (
        <Text style={[styles.fieldHint, { color: colors.error }]}>{error}</Text>
      ) : hint ? (
        <Text style={[styles.fieldHint, { color: colors.muted }]}>{hint}</Text>
      ) : null}
    </View>
  );
}

export function ChipGroup<T extends string>({
  label,
  options,
  value,
  onChange,
  format = (option) => option,
}: {
  label?: string;
  options: readonly T[];
  value: T | null;
  onChange: (value: T) => void;
  format?: (value: T) => string;
}) {
  const colors = useColors();
  return (
    <View style={styles.field}>
      {label ? (
        <Text style={[styles.fieldLabel, { color: colors.foreground }]}>{label}</Text>
      ) : null}
      <View style={styles.chipWrap}>
        {options.map((option) => {
          const selected = option === value;
          return (
            <Pressable
              key={option}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              onPress={() => onChange(option)}
              style={[
                styles.chip,
                {
                  backgroundColor: selected ? colors.primary : colors.surface,
                  borderColor: selected ? colors.primary : colors.border,
                },
              ]}
            >
              <Text
                style={[
                  styles.chipText,
                  { color: selected ? colors.background : colors.foreground },
                ]}
              >
                {format(option)}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

/** Bottom sheet style modal for create/edit forms. */
export function Sheet({
  visible,
  title,
  subtitle,
  onClose,
  children,
  footer,
}: {
  visible: boolean;
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const colors = useColors();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.sheetBackdrop}>
        <Pressable style={{ flex: 1 }} onPress={onClose} accessibilityLabel="Close" />
        <View style={[styles.sheet, { backgroundColor: colors.surface }]}>
          <View style={[styles.sheetHandle, { backgroundColor: colors.border }]} />
          <View style={styles.sheetHeader}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.sheetTitle, { color: colors.foreground }]}>{title}</Text>
              {subtitle ? (
                <Text style={[styles.sheetSubtitle, { color: colors.muted }]}>{subtitle}</Text>
              ) : null}
            </View>
            <IconButton icon="close" label="Close" onPress={onClose} />
          </View>
          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ paddingBottom: 12 }}
            showsVerticalScrollIndicator={false}
          >
            {children}
          </ScrollView>
          {footer ? <View style={styles.sheetFooter}>{footer}</View> : null}
        </View>
      </View>
    </Modal>
  );
}

export function Screen({
  children,
  scroll = true,
  inTabs = false,
}: {
  children: ReactNode;
  scroll?: boolean;
  /** Tab screens skip the bottom inset because the tab bar already covers it. */
  inTabs?: boolean;
}) {
  return (
    <ScreenContainer
      className="px-5"
      safeAreaClassName="bg-background"
      edges={inTabs ? ["top", "left", "right"] : ["top", "left", "right", "bottom"]}
    >
      {scroll ? children : <View style={{ flex: 1 }}>{children}</View>}
    </ScreenContainer>
  );
}

export const styles = StyleSheet.create({
  header: { paddingTop: 8, paddingBottom: 16 },
  headerTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 14,
  },
  brandRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  brandLogo: { width: 38, height: 38, borderRadius: 11 },
  brandName: { fontSize: 13, fontWeight: "900", letterSpacing: 2.2 },
  brandTag: { fontSize: 10, fontWeight: "700", letterSpacing: 0.6, marginTop: 1 },
  headerCopy: {},
  eyebrow: { fontSize: 11, letterSpacing: 1.8, fontWeight: "800", marginBottom: 6 },
  headerTitle: { fontSize: 30, lineHeight: 37, fontFamily: displayFont, letterSpacing: -0.2 },
  headerSubtitle: { fontSize: 13, lineHeight: 19, marginTop: 6 },
  headerActions: { flexDirection: "row", alignItems: "center", gap: 9 },
  iconButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
  },
  badge: {
    position: "absolute",
    top: -3,
    right: -3,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 4,
  },
  badgeText: { fontSize: 10, fontWeight: "900" },
  avatar: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { fontSize: 14, fontWeight: "800", letterSpacing: 0.4 },
  heroShell: { borderRadius: 24, marginBottom: 20 },
  hero: { borderRadius: 24, padding: 20, overflow: "hidden" },
  heroGlow: {
    position: "absolute",
    right: -60,
    top: -60,
    width: 180,
    height: 180,
    borderRadius: 90,
    backgroundColor: "rgba(217,183,106,0.07)",
  },
  heroLine: {
    position: "absolute",
    left: 20,
    top: 0,
    width: 48,
    height: 3,
    borderBottomLeftRadius: 2,
    borderBottomRightRadius: 2,
    backgroundColor: "#D9B76A",
  },
  heroStat: { flex: 1 },
  heroStatValue: { color: "#FFFFFF", fontSize: 26, fontFamily: displayFont },
  heroStatLabel: { color: "rgba(246,241,230,0.7)", fontSize: 11, marginTop: 2 },
  syncChipRow: { flexDirection: "row", alignItems: "center", gap: 7, marginBottom: 16 },
  syncChipText: { fontSize: 11, fontWeight: "600", flex: 1 },
  offlineBanner: {
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 13,
    paddingVertical: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 18,
  },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  offlineCopy: { flex: 1 },
  offlineTitle: { fontSize: 13, fontWeight: "800" },
  offlineDetail: { fontSize: 11, lineHeight: 16, marginTop: 2 },
  retryText: { fontSize: 12, fontWeight: "800" },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    marginBottom: 12,
    marginTop: 6,
  },
  sectionTitleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  sectionMark: { width: 3, height: 15, borderRadius: 2 },
  sectionTitle: { fontSize: 17, fontWeight: "800", letterSpacing: -0.2 },
  sectionCaption: { fontSize: 11, marginTop: 3, marginLeft: 11 },
  sectionActionWrap: { flexDirection: "row", alignItems: "center" },
  sectionAction: { fontSize: 12, fontWeight: "800" },
  pill: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  pillCompact: { paddingVertical: 4, paddingHorizontal: 8 },
  pillDot: { width: 6, height: 6, borderRadius: 3 },
  pillText: { fontSize: 11, fontWeight: "800" },
  card: {
    borderWidth: 1,
    borderRadius: 20,
    padding: 16,
    flexDirection: "row",
    overflow: "hidden",
  },
  cardAccent: { width: 4, borderRadius: 2, marginRight: 12, alignSelf: "stretch" },
  metricCard: {
    flex: 1,
    minHeight: 118,
    borderWidth: 1,
    borderRadius: 20,
    padding: 14,
  },
  metricIcon: {
    width: 32,
    height: 32,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 10,
  },
  metricValue: { fontSize: 26, fontFamily: displayFont },
  metricLabel: { fontSize: 11, lineHeight: 15, marginTop: 2 },
  metricNote: { fontSize: 10, fontWeight: "800", marginTop: 5 },
  tileShell: { flexBasis: "47%", flexGrow: 1 },
  tile: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 20,
    padding: 14,
    minHeight: 112,
  },
  tileTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  tileIcon: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 12,
  },
  tileBadge: {
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    paddingHorizontal: 6,
    alignItems: "center",
    justifyContent: "center",
  },
  tileBadgeText: { fontSize: 11, fontWeight: "900", color: "#0E1A26" },
  tileTitle: { fontSize: 14, fontWeight: "800" },
  tileDetail: { fontSize: 11, lineHeight: 15, marginTop: 3 },
  listRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 13 },
  listIcon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  listTitle: { fontSize: 14, fontWeight: "700" },
  listDetail: { fontSize: 11, lineHeight: 16, marginTop: 2 },
  primaryButton: {
    minHeight: 50,
    borderRadius: 16,
    paddingHorizontal: 18,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  primaryButtonText: { fontSize: 14, fontWeight: "800", letterSpacing: 0.2 },
  secondaryButton: {
    minHeight: 46,
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 15,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
  },
  secondaryButtonText: { fontSize: 13, fontWeight: "800" },
  fab: {
    position: "absolute",
    right: 4,
    bottom: 18,
    height: 52,
    borderRadius: 26,
    paddingHorizontal: 20,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  fabText: { fontSize: 14, fontWeight: "800" },
  emptyState: { borderWidth: 1, borderRadius: 20, padding: 24, alignItems: "center", marginTop: 3 },
  emptyIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 12,
  },
  emptyTitle: { fontSize: 18, fontFamily: displayFont, textAlign: "center" },
  emptyDetail: {
    fontSize: 13,
    lineHeight: 19,
    textAlign: "center",
    marginTop: 5,
    marginBottom: 16,
    maxWidth: 290,
  },
  loadingBlock: { minHeight: 80, justifyContent: "center", gap: 10, paddingVertical: 8 },
  loadingRow: { flexDirection: "row", alignItems: "center", gap: 8, alignSelf: "center" },
  shimmer: { height: 14, borderRadius: 7 },
  loadingText: { fontSize: 12 },
  errorCard: {
    borderWidth: 1,
    borderRadius: 16,
    padding: 13,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 9,
    marginBottom: 12,
  },
  errorTitle: { fontSize: 13, fontWeight: "800" },
  errorDetail: { fontSize: 12, lineHeight: 17, marginTop: 3 },
  field: { marginBottom: 14 },
  fieldLabel: { fontSize: 12, fontWeight: "800", marginBottom: 6 },
  fieldInput: {
    minHeight: 48,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 14,
    fontSize: 15,
  },
  fieldMultiline: { minHeight: 90, paddingTop: 12, textAlignVertical: "top" },
  fieldHint: { fontSize: 11, marginTop: 5, lineHeight: 15 },
  chipWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 9,
    minHeight: 38,
    justifyContent: "center",
  },
  chipText: { fontSize: 12, fontWeight: "700" },
  sheetBackdrop: { flex: 1, backgroundColor: "rgba(5,10,16,0.55)" },
  sheet: {
    maxHeight: "90%",
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 20,
    paddingBottom: 20,
  },
  sheetHandle: { alignSelf: "center", width: 44, height: 5, borderRadius: 3, marginTop: 10 },
  sheetHeader: { flexDirection: "row", alignItems: "center", paddingVertical: 14, gap: 10 },
  sheetTitle: { fontSize: 22, fontFamily: displayFont },
  sheetSubtitle: { fontSize: 12, marginTop: 3, lineHeight: 17 },
  sheetFooter: { paddingTop: 10, gap: 10 },
  pressed: { opacity: 0.82, transform: [{ scale: 0.985 }] },
});
