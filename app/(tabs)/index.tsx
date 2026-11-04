import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useQueryClient } from "@tanstack/react-query";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { useState } from "react";
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import {
  AppHeader,
  Card,
  EmptyState,
  HeroCard,
  InlineError,
  ListRow,
  LoadingBlock,
  OfflineBanner,
  Screen,
  SectionHeader,
  StatusPill,
  formatDateTime,
  useToneColor,
  type IconName,
} from "@/components/jp/ui";
import { FirstWorkspaceSetup } from "@/components/jp/first-workspace-setup";
import { ProgressBar, percentText } from "@/components/jp/place-visual";
import { useColors } from "@/hooks/use-colors";
import { useConnectivity, useSyncQueue } from "@/hooks/use-connectivity";
import { useWorkspace } from "@/hooks/use-workspace";
import { getSiteStatusTone, type SiteStatus } from "@/lib/jp/domain";
import { prettyRole } from "@/lib/jp/site-admin-policy";
import { inboxIcon } from "@/components/jp/inbox-meta";
import { delegationBundles, timeLeft } from "@/lib/jp/delegation-policy";
import { badgeCounts, quickActions, visibleGroups, type HomeModule } from "@/lib/jp/home-layout";
import { trpc } from "@/lib/trpc";
import { useT } from "@/lib/i18n";

function greeting(date = new Date()) {
  const hour = date.getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

export default function HomeScreen() {
  const colors = useColors();
  const { t } = useT();
  const router = useRouter();
  const queryClient = useQueryClient();
  const workspace = useWorkspace();
  const { width } = useWindowDimensions();
  const { online } = useConnectivity();
  const { pending, refresh: refreshQueue } = useSyncQueue();
  const sites = trpc.jp.workspace.mySites.useQuery();
  const dashboard = trpc.jp.workspace.dashboard.useQuery();
  const inbox = trpc.jp.workspace.inbox.useQuery();
  const cards = trpc.jp.places.cards.useQuery(undefined, { staleTime: 60_000 });
  const delegated = trpc.jp.delegation.mine.useQuery();
  const assistant = trpc.jp.assistant.status.useQuery(undefined, {
    retry: false,
    staleTime: 10 * 60_000,
  });
  const [refreshing, setRefreshing] = useState(false);
  const [setupOpen, setSetupOpen] = useState(false);
  const [showAll, setShowAll] = useState(false);

  const refresh = async () => {
    setRefreshing(true);
    try {
      await Promise.all([queryClient.invalidateQueries(), refreshQueue()]);
    } finally {
      setRefreshing(false);
    }
  };

  const access = {
    can: workspace.can,
    canManageSites: workspace.canManageSites,
    canManageAccounts: workspace.canManageAccounts,
  };
  const firstName = workspace.me.data?.name?.trim().split(/\s+/)[0] ?? "there";
  const today = new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date());
  const items = inbox.data?.items ?? [];
  const overdue = items.filter((item) => item.kind === "task.overdue").length;
  const siteList = sites.data ?? [];
  const activeSites = siteList.filter((site) => site.status === "Active").length;
  const dataError = sites.error || dashboard.error;
  const hasCache = Boolean(sites.data || dashboard.data);
  const groups = visibleGroups(access);
  const quick = quickActions(access);
  const badges = badgeCounts(items.map((item) => item.kind));
  const moduleCount = groups.reduce((sum, group) => sum + group.modules.length, 0);
  const cardWidth = Math.min(340, Math.round(width * 0.78));
  const cardFor = (siteId: string) => cards.data?.sites.find((row) => row.siteId === siteId);
  const open = (module: HomeModule) => router.push(module.route as never);

  return (
    <Screen inTabs>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.primary} />
        }
      >
        <AppHeader
          eyebrow={t(greeting())}
          title={t("Hello, {name}", { name: firstName })}
          subtitle={`${prettyRole(workspace.role)} · ${today}`}
        />
        <OfflineBanner
          pendingCount={pending.length}
          connected={online === false ? false : hasCache && !dataError ? true : online}
          lastSyncedAt={dashboard.dataUpdatedAt ? formatDateTime(dashboard.dataUpdatedAt) : null}
          onRetry={refresh}
          retrying={refreshing}
        />
        {dataError && online !== false ? (
          <InlineError message={dataError.message} onRetry={refresh} />
        ) : null}

        {(delegated.data ?? []).map((row) => (
          <Card key={row.id} accent="accent" style={{ marginBottom: 14 }}>
            <Text style={[styles.delegatedTitle, { color: colors.foreground }]}>
              {t("Temporary authority from {name}", { name: row.grantedByName ?? "admin" })}
            </Text>
            <Text style={[styles.delegatedText, { color: colors.muted }]}>
              {row.bundles.map((bundle) => delegationBundles[bundle]?.label ?? bundle).join(" · ")}{" "}
              · {timeLeft(row.effectiveTo)}
            </Text>
          </Card>
        ))}

        <HeroCard>
          <Text style={styles.heroKicker}>{t("TODAY'S BRIEF")}</Text>
          <Text style={styles.heroTitle}>
            {items.length > 0
              ? items.length === 1
                ? t("1 item needs your attention")
                : t("{count} items need your attention", { count: items.length })
              : inbox.isSuccess
                ? t("You are all caught up")
                : t("Gathering your site brief…")}
          </Text>
          <View style={styles.heroStats}>
            <HeroTap
              value={sites.data ? String(activeSites) : "—"}
              label={t("Active sites")}
              onPress={() => router.push("/(tabs)/sites" as never)}
            />
            <View style={styles.heroDivider} />
            <HeroTap
              value={inbox.data ? String(items.length) : "—"}
              label={t("Waiting on you")}
              onPress={() => router.push("/notifications" as never)}
            />
            <View style={styles.heroDivider} />
            <HeroTap
              value={inbox.data ? String(overdue) : "—"}
              label={t("Overdue tasks")}
              alert={overdue > 0}
              onPress={() =>
                router.push((workspace.can("task.view") ? "/schedule" : "/notifications") as never)
              }
            />
          </View>
        </HeroCard>

        {assistant.data?.available ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("Ask the AI assistant")}
            onPress={() => router.push("/assistant" as never)}
            style={({ pressed }) => [
              styles.askBar,
              { backgroundColor: colors.surface, borderColor: colors.border },
              pressed && styles.pressed,
            ]}
          >
            <MaterialIcons name="auto-awesome" size={20} color={colors.accent} />
            <Text style={[styles.askText, { color: colors.muted }]} numberOfLines={1}>
              {t("Ask, speak or share a file…")}
            </Text>
            <View style={[styles.askMic, { backgroundColor: colors.primary }]}>
              <MaterialIcons name="mic" size={18} color={colors.background} />
            </View>
          </Pressable>
        ) : null}

        {quick.length > 0 ? (
          <View style={styles.quickRow}>
            {quick.map((module) => (
              <QuickButton
                key={module.key}
                module={module}
                label={t(module.title)}
                badge={badges[module.key]}
                onPress={() => open(module)}
              />
            ))}
            {/* Keep the four-column rhythm when fewer actions are offered. */}
            {Array.from({ length: 4 - quick.length }, (_, index) => (
              <View key={`gap-${index}`} style={styles.quick} />
            ))}
          </View>
        ) : null}

        <SectionHeader
          title={t("Your sites")}
          caption={sites.data ? t("{count} in your access", { count: siteList.length }) : undefined}
          action={siteList.length > 0 ? t("All sites") : undefined}
          onPress={() => router.push("/(tabs)/sites" as never)}
        />
        {sites.isLoading ? (
          <LoadingBlock label="Loading your sites…" />
        ) : siteList.length === 0 ? (
          <EmptyState
            icon="location-city"
            title="No sites yet"
            detail={
              workspace.access.data?.canInitializeOrganization
                ? "Set up your company, first project and first site to get started."
                : workspace.canManageSites
                  ? "Create a project and add its first site."
                  : "Ask your administrator to assign you to a site."
            }
            action={
              workspace.access.data?.canInitializeOrganization
                ? "Set up company"
                : workspace.canManageSites
                  ? "Open projects & sites"
                  : undefined
            }
            onPress={() =>
              workspace.access.data?.canInitializeOrganization
                ? setSetupOpen(true)
                : router.push("/projects" as never)
            }
          />
        ) : (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            snapToInterval={cardWidth + 12}
            decelerationRate="fast"
            contentContainerStyle={styles.siteRail}
            style={styles.siteRailOuter}
          >
            {siteList.slice(0, 8).map((site) => {
              const card = cardFor(site.id);
              return (
                <SitePhotoCard
                  key={site.id}
                  width={cardWidth}
                  name={site.name}
                  project={site.project}
                  code={site.code}
                  location={site.location}
                  status={site.status as SiteStatus}
                  role={prettyRole(site.businessRole)}
                  coverUrl={card?.coverUrl ?? null}
                  progress={card?.progress ?? null}
                  canAddPhoto={workspace.canManageSites}
                  onPress={() => router.push(`/site/${site.id}` as never)}
                />
              );
            })}
          </ScrollView>
        )}

        <SectionHeader
          title={t("Waiting on you")}
          caption={items.length > 0 ? t("{count} open", { count: items.length }) : undefined}
          action={items.length > 0 ? t("View all") : undefined}
          onPress={() => router.push("/notifications" as never)}
        />
        {inbox.isLoading ? (
          <LoadingBlock label="Checking your queue…" />
        ) : items.length === 0 ? (
          <EmptyState
            icon="task-alt"
            title={t("Nothing pending")}
            detail="Reviews, approvals, returned reports and overdue tasks for your sites will appear here."
          />
        ) : (
          <Card style={styles.listCard}>
            {items.slice(0, 3).map((item, index) => (
              <View
                key={item.id}
                style={index > 0 ? [styles.rowDivider, { borderTopColor: colors.border }] : null}
              >
                <ListRow
                  icon={inboxIcon[item.kind].icon}
                  tone={inboxIcon[item.kind].tone}
                  title={item.title}
                  detail={`${item.siteName} · ${item.detail}`}
                  onPress={() => router.push(item.route as never)}
                />
              </View>
            ))}
          </Card>
        )}

        {groups.length > 0 ? (
          <>
            <SectionHeader
              title={t("All modules")}
              caption={t("{count} available to you", { count: moduleCount })}
              action={moduleCount > 8 ? (showAll ? t("Show less") : t("Show all")) : undefined}
              onPress={() => setShowAll((value) => !value)}
            />
            {(showAll || moduleCount <= 8 ? groups : groups.slice(0, 2)).map((group) => (
              <View key={group.key} style={styles.group}>
                <Text style={[styles.groupTitle, { color: colors.muted }]}>
                  {t(group.title).toUpperCase()}
                </Text>
                <View
                  style={[
                    styles.groupCard,
                    { backgroundColor: colors.surface, borderColor: colors.border },
                  ]}
                >
                  {group.modules.map((module) => (
                    <LauncherIcon
                      key={module.key}
                      module={module}
                      label={t(module.title)}
                      badge={badges[module.key]}
                      onPress={() => open(module)}
                    />
                  ))}
                </View>
              </View>
            ))}
            {!showAll && moduleCount > 8 ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => setShowAll(true)}
                style={({ pressed }) => [
                  styles.moreButton,
                  { borderColor: colors.border },
                  pressed && styles.pressed,
                ]}
              >
                <Text style={[styles.moreText, { color: colors.primary }]}>
                  {t("Show all modules")}
                </Text>
                <MaterialIcons name="expand-more" size={18} color={colors.primary} />
              </Pressable>
            ) : null}
          </>
        ) : null}

        <View style={styles.footer}>
          <MaterialIcons name="verified-user" size={14} color={colors.accent} />
          <Text style={[styles.footerText, { color: colors.muted }]}>
            JP Infracon · access checked on every request
          </Text>
        </View>
      </ScrollView>
      <FirstWorkspaceSetup
        visible={setupOpen}
        onClose={() => setSetupOpen(false)}
        onComplete={() => {
          void refresh();
        }}
      />
    </Screen>
  );
}

function HeroTap({
  value,
  label,
  onPress,
  alert,
}: {
  value: string;
  label: string;
  onPress: () => void;
  alert?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${value}`}
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => [styles.heroStat, pressed && styles.pressed]}
    >
      <Text style={[styles.heroStatValue, alert && { color: "#FF9B8A" }]}>{value}</Text>
      <Text style={styles.heroStatLabel}>{label}</Text>
    </Pressable>
  );
}

function Badge({ count }: { count?: number }) {
  const colors = useColors();
  if (!count) return null;
  return (
    <View style={[styles.badge, { backgroundColor: colors.error, borderColor: colors.surface }]}>
      <Text style={styles.badgeText}>{count > 99 ? "99+" : count}</Text>
    </View>
  );
}

function QuickButton({
  module,
  label,
  badge,
  onPress,
}: {
  module: HomeModule;
  label: string;
  badge?: number;
  onPress: () => void;
}) {
  const colors = useColors();
  const tone = useToneColor(module.tone);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [styles.quick, pressed && styles.pressed]}
    >
      <View style={[styles.quickIcon, { backgroundColor: tone }]}>
        <MaterialIcons name={module.icon as IconName} size={24} color="#FFFFFF" />
        <Badge count={badge} />
      </View>
      <Text style={[styles.quickLabel, { color: colors.foreground }]} numberOfLines={2}>
        {label}
      </Text>
    </Pressable>
  );
}

function LauncherIcon({
  module,
  label,
  badge,
  onPress,
}: {
  module: HomeModule;
  label: string;
  badge?: number;
  onPress: () => void;
}) {
  const colors = useColors();
  const tone = useToneColor(module.tone);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [styles.launcher, pressed && styles.pressed]}
    >
      <View style={[styles.launcherIcon, { backgroundColor: `${tone}18` }]}>
        <MaterialIcons name={module.icon as IconName} size={22} color={tone} />
        <Badge count={badge} />
      </View>
      <Text style={[styles.launcherLabel, { color: colors.foreground }]} numberOfLines={2}>
        {label}
      </Text>
    </Pressable>
  );
}

function SitePhotoCard({
  width,
  name,
  project,
  code,
  location,
  status,
  role,
  coverUrl,
  progress,
  canAddPhoto,
  onPress,
}: {
  width: number;
  name: string;
  project: string;
  code: string;
  location: string | null;
  status: SiteStatus;
  role: string;
  coverUrl: string | null;
  progress: {
    actualTenths: number | null;
    expectedTenths: number | null;
    total: number;
    overdue: number;
    health: "ahead" | "on track" | "behind" | null;
  } | null;
  canAddPhoto: boolean;
  onPress: () => void;
}) {
  const { t } = useT();
  const colors = useColors();
  const tone = getSiteStatusTone(status);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t("Open {name}", { name })}
      onPress={onPress}
      style={({ pressed }) => [
        styles.siteCard,
        { width, backgroundColor: colors.surface, borderColor: colors.border },
        pressed && styles.pressed,
      ]}
    >
      <View style={styles.sitePhoto}>
        {coverUrl ? (
          <Image
            source={{ uri: coverUrl }}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            cachePolicy="memory-disk"
            transition={200}
            accessibilityLabel={t("Photo of {name}", { name })}
          />
        ) : (
          <LinearGradient
            colors={["#24496F", "#132B44"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={[StyleSheet.absoluteFill, styles.sitePlaceholder]}
          >
            <MaterialIcons name="apartment" size={46} color="rgba(255,255,255,0.28)" />
          </LinearGradient>
        )}
        <LinearGradient colors={["rgba(0,0,0,0)", "rgba(6,14,24,0.86)"]} style={styles.siteShade} />
        <View style={styles.siteTopRow}>
          <StatusPill label={t(status)} tone={tone} compact />
          {!coverUrl && canAddPhoto ? (
            <View style={styles.addPhoto}>
              <MaterialIcons name="add-a-photo" size={13} color="#FFFFFF" />
              <Text style={styles.addPhotoText}>{t("Add photo")}</Text>
            </View>
          ) : null}
        </View>
        <View style={styles.siteText}>
          <Text style={styles.siteName} numberOfLines={1}>
            {name}
          </Text>
          <Text style={styles.siteMeta} numberOfLines={1}>
            {project} · {code}
          </Text>
        </View>
      </View>
      <View style={styles.siteBody}>
        {progress && progress.total > 0 ? (
          <>
            <View style={styles.siteProgressRow}>
              <Text style={[styles.sitePercent, { color: colors.foreground }]}>
                {percentText(progress.actualTenths)}
              </Text>
              <Text
                style={[
                  styles.siteSmall,
                  {
                    color:
                      progress.overdue > 0 || progress.health === "behind"
                        ? colors.error
                        : colors.muted,
                  },
                ]}
              >
                {progress.overdue > 0
                  ? t("{count} overdue", { count: progress.overdue })
                  : progress.health === "behind"
                    ? t("Behind plan")
                    : t("Plan {percent}", { percent: percentText(progress.expectedTenths) })}
              </Text>
            </View>
            <ProgressBar
              actualTenths={progress.actualTenths}
              expectedTenths={progress.expectedTenths}
              tone={progress.health === "behind" ? "warning" : "success"}
              height={6}
            />
          </>
        ) : (
          <Text style={[styles.siteSmall, { color: colors.muted }]}>
            {t("No schedule progress yet")}
          </Text>
        )}
        <View style={styles.siteFoot}>
          <MaterialIcons name="place" size={13} color={colors.muted} />
          <Text style={[styles.siteSmall, { color: colors.muted, flex: 1 }]} numberOfLines={1}>
            {location || t("Address not recorded")}
          </Text>
          <Text style={[styles.siteRole, { color: colors.accent }]}>{role}</Text>
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  content: { paddingBottom: 32 },
  pressed: { opacity: 0.82, transform: [{ scale: 0.985 }] },
  heroKicker: {
    color: "#D9B76A",
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1.8,
    marginTop: 6,
  },
  heroTitle: {
    color: "#FFFFFF",
    fontSize: 21,
    fontWeight: "800",
    lineHeight: 27,
    marginTop: 8,
    marginBottom: 18,
    letterSpacing: -0.3,
  },
  heroStats: { flexDirection: "row", alignItems: "center" },
  heroStat: { flex: 1 },
  heroStatValue: { color: "#FFFFFF", fontSize: 24, fontWeight: "800" },
  heroStatLabel: { color: "rgba(255,255,255,0.7)", fontSize: 11, fontWeight: "600", marginTop: 2 },
  heroDivider: {
    width: 1,
    height: 34,
    backgroundColor: "rgba(255,255,255,0.14)",
    marginHorizontal: 12,
  },
  askBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 26,
    paddingLeft: 16,
    paddingRight: 6,
    height: 52,
    marginBottom: 18,
  },
  askText: { flex: 1, fontSize: 14 },
  askMic: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  quickRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 22 },
  quick: { width: "23%", alignItems: "center" },
  quickIcon: {
    width: 58,
    height: 58,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  quickLabel: { fontSize: 12, fontWeight: "700", textAlign: "center", marginTop: 7 },
  badge: {
    position: "absolute",
    top: -5,
    right: -5,
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    paddingHorizontal: 4,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeText: { color: "#FFFFFF", fontSize: 10, fontWeight: "800" },
  siteRailOuter: { marginHorizontal: -20, marginBottom: 22 },
  siteRail: { paddingHorizontal: 20, gap: 12 },
  siteCard: { borderRadius: 20, borderWidth: StyleSheet.hairlineWidth, overflow: "hidden" },
  sitePhoto: { height: 150, justifyContent: "space-between" },
  sitePlaceholder: { alignItems: "center", justifyContent: "center" },
  siteShade: { position: "absolute", left: 0, right: 0, bottom: 0, height: 96 },
  siteTopRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 10,
  },
  addPhoto: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "rgba(0,0,0,0.4)",
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  addPhotoText: { color: "#FFFFFF", fontSize: 11, fontWeight: "700" },
  siteText: { padding: 12 },
  siteName: { color: "#FFFFFF", fontSize: 18, fontWeight: "800" },
  siteMeta: { color: "rgba(255,255,255,0.82)", fontSize: 12, marginTop: 2 },
  siteBody: { padding: 12, gap: 8 },
  siteProgressRow: { flexDirection: "row", alignItems: "baseline", gap: 8 },
  sitePercent: { fontSize: 18, fontWeight: "800" },
  siteSmall: { fontSize: 12 },
  siteFoot: { flexDirection: "row", alignItems: "center", gap: 4 },
  siteRole: { fontSize: 11, fontWeight: "800" },
  listCard: { paddingVertical: 2, marginBottom: 22 },
  rowDivider: { borderTopWidth: StyleSheet.hairlineWidth },
  group: { marginBottom: 14 },
  groupTitle: { fontSize: 11, fontWeight: "800", letterSpacing: 1.2, marginBottom: 8 },
  groupCard: {
    flexDirection: "row",
    flexWrap: "wrap",
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: 12,
    paddingHorizontal: 4,
    rowGap: 12,
  },
  launcher: { width: "25%", alignItems: "center", paddingHorizontal: 2 },
  launcherIcon: {
    width: 48,
    height: 48,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  launcherLabel: { fontSize: 11, fontWeight: "600", textAlign: "center", marginTop: 6 },
  moreButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 14,
    paddingVertical: 12,
    marginBottom: 12,
  },
  moreText: { fontSize: 13, fontWeight: "700" },
  footer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    marginTop: 10,
  },
  delegatedTitle: { fontSize: 14, fontWeight: "800" },
  delegatedText: { fontSize: 12, marginTop: 3 },
  footerText: { fontSize: 11 },
});
