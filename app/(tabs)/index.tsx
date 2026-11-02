import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useState } from "react";
import { RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import {
  AppHeader,
  Card,
  EmptyState,
  HeroCard,
  HeroStat,
  InlineError,
  ListRow,
  LoadingBlock,
  MetricCard,
  ModuleTile,
  OfflineBanner,
  Screen,
  SectionHeader,
  StatusPill,
  formatDateTime,
  type IconName,
  type Tone,
} from "@/components/jp/ui";
import { FirstWorkspaceSetup } from "@/components/jp/first-workspace-setup";
import { useColors } from "@/hooks/use-colors";
import { useConnectivity, useSyncQueue } from "@/hooks/use-connectivity";
import { useWorkspace } from "@/hooks/use-workspace";
import { getSiteStatusTone, type SiteStatus } from "@/lib/jp/domain";
import { prettyRole } from "@/lib/jp/site-admin-policy";
import { inboxIcon } from "@/components/jp/inbox-meta";
import { trpc } from "@/lib/trpc";

function greeting(date = new Date()) {
  const hour = date.getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

export default function HomeScreen() {
  const colors = useColors();
  const router = useRouter();
  const queryClient = useQueryClient();
  const workspace = useWorkspace();
  const { online } = useConnectivity();
  const { pending, refresh: refreshQueue } = useSyncQueue();
  const sites = trpc.jp.workspace.mySites.useQuery();
  const dashboard = trpc.jp.workspace.dashboard.useQuery();
  const inbox = trpc.jp.workspace.inbox.useQuery();
  const [refreshing, setRefreshing] = useState(false);
  const [setupOpen, setSetupOpen] = useState(false);

  const refresh = async () => {
    setRefreshing(true);
    try {
      await Promise.all([queryClient.invalidateQueries(), refreshQueue()]);
    } finally {
      setRefreshing(false);
    }
  };

  const { can } = workspace;
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

  const actions: {
    icon: IconName;
    title: string;
    detail: string;
    tone: Tone;
    route: string;
    show: boolean;
  }[] = [
    {
      icon: "post-add",
      title: "Daily report",
      detail: "DPR / DLR for today",
      tone: "info",
      route: "/(tabs)/reports",
      show: can("dpr.create", "dlr.create"),
    },
    {
      icon: "local-shipping",
      title: "Request material",
      detail: "Raise a site request",
      tone: "accent",
      route: "/(tabs)/requests",
      show: can("material.request"),
    },
    {
      icon: "report",
      title: "Report issue",
      detail: "Safety, quality, blockers",
      tone: "error",
      route: "/issues",
      show: can("issue.view"),
    },
    {
      icon: "event-note",
      title: "Schedule",
      detail: "Tasks & revisions",
      tone: "info",
      route: "/schedule",
      show: can("task.view"),
    },
    {
      icon: "inventory",
      title: "Stock entry",
      detail: "Inward, issue, return",
      tone: "success",
      route: "/inventory",
      show: can("inventory.transact", "inventory.view"),
    },
    {
      icon: "groups",
      title: "Workforce",
      detail: "People & rates",
      tone: "info",
      route: "/workforce",
      show: can("workforce.view"),
    },
    {
      icon: "receipt-long",
      title: "Finance",
      detail: "Invoices, payments, cash",
      tone: "accent",
      route: "/finance",
      show: can("finance.invoice.view", "finance.cash.view"),
    },
    {
      icon: "add-business",
      title: "Projects & sites",
      detail: "Create and manage",
      tone: "success",
      route: "/projects",
      show: workspace.canManageSites,
    },
    {
      icon: "person-add-alt",
      title: "Team accounts",
      detail: "Logins & roles",
      tone: "info",
      route: "/users",
      show: workspace.canManageAccounts,
    },
  ];
  const visibleActions = actions.filter((action) => action.show);

  return (
    <Screen>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.primary} />
        }
      >
        <AppHeader
          eyebrow={greeting()}
          title={`Hello, ${firstName}`}
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

        <HeroCard>
          <Text style={styles.heroKicker}>TODAY&apos;S BRIEF</Text>
          <Text style={styles.heroTitle}>
            {items.length > 0
              ? `${items.length} item${items.length === 1 ? "" : "s"} need${items.length === 1 ? "s" : ""} your attention`
              : inbox.isSuccess
                ? "You are all caught up"
                : "Gathering your site brief…"}
          </Text>
          <View style={styles.heroStats}>
            <HeroStat value={sites.data ? String(activeSites) : "—"} label="Active sites" />
            <View style={styles.heroDivider} />
            <HeroStat value={inbox.data ? String(items.length) : "—"} label="Waiting on you" />
            <View style={styles.heroDivider} />
            <HeroStat value={inbox.data ? String(overdue) : "—"} label="Overdue tasks" />
          </View>
        </HeroCard>

        {dashboard.data && (can("dpr.view", "dlr.view") || can("material.request.view")) ? (
          <View style={styles.metricsRow}>
            {can("dpr.view", "dlr.view") ? (
              <MetricCard
                icon="fact-check"
                value={String(dashboard.data.reportsNeedingReview)}
                label="Reports in review"
                tone="info"
                onPress={() => router.push("/(tabs)/reports" as never)}
              />
            ) : null}
            {can("dpr.view", "dlr.view") ? (
              <MetricCard
                icon="assignment-return"
                value={String(dashboard.data.reportsReturned)}
                label="Returned reports"
                tone={dashboard.data.reportsReturned > 0 ? "error" : "success"}
                onPress={() => router.push("/(tabs)/reports" as never)}
              />
            ) : null}
            {can("material.request.view") ? (
              <MetricCard
                icon="local-shipping"
                value={String(dashboard.data.pendingMaterialRequests)}
                label="Material pending"
                tone="accent"
                onPress={() => router.push("/(tabs)/requests" as never)}
              />
            ) : null}
          </View>
        ) : null}

        {visibleActions.length > 0 ? (
          <>
            <SectionHeader title="Quick actions" />
            <View style={styles.grid}>
              {visibleActions.map((action) => (
                <ModuleTile
                  key={action.title}
                  icon={action.icon}
                  title={action.title}
                  detail={action.detail}
                  tone={action.tone}
                  onPress={() => router.push(action.route as never)}
                />
              ))}
            </View>
          </>
        ) : null}

        <SectionHeader
          title="Waiting on you"
          action={items.length > 0 ? "View all" : undefined}
          onPress={() => router.push("/notifications" as never)}
        />
        {inbox.isLoading ? (
          <LoadingBlock label="Checking your queue…" />
        ) : items.length === 0 ? (
          <EmptyState
            icon="task-alt"
            title="Nothing pending"
            detail="Reviews, approvals, returned reports and overdue tasks for your sites will appear here."
          />
        ) : (
          <Card style={styles.listCard}>
            {items.slice(0, 4).map((item, index) => (
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

        <SectionHeader
          title="Your sites"
          caption={sites.data ? `${siteList.length} in your access` : undefined}
          action={siteList.length > 0 ? "All sites" : undefined}
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
          <View style={styles.siteStack}>
            {siteList.slice(0, 4).map((site) => (
              <Card
                key={site.id}
                accent={getSiteStatusTone(site.status as SiteStatus)}
                onPress={() => router.push(`/site/${site.id}` as never)}
                accessibilityLabel={`Open ${site.name}`}
              >
                <View style={styles.siteTop}>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.siteName, { color: colors.foreground }]}>{site.name}</Text>
                    <Text style={[styles.siteMeta, { color: colors.muted }]}>
                      {site.project} · {site.code}
                    </Text>
                  </View>
                  <StatusPill
                    label={site.status}
                    tone={getSiteStatusTone(site.status as SiteStatus)}
                    compact
                  />
                </View>
                <View style={styles.siteBottom}>
                  <MaterialIcons name="place" size={14} color={colors.muted} />
                  <Text
                    style={[styles.siteMeta, { color: colors.muted, flex: 1 }]}
                    numberOfLines={1}
                  >
                    {site.location || "Address not recorded"}
                  </Text>
                  <Text style={[styles.siteRole, { color: colors.accent }]}>
                    {prettyRole(site.businessRole)}
                  </Text>
                </View>
              </Card>
            ))}
          </View>
        )}

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

const styles = StyleSheet.create({
  content: { paddingBottom: 32 },
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
  heroDivider: {
    width: 1,
    height: 34,
    backgroundColor: "rgba(255,255,255,0.14)",
    marginHorizontal: 12,
  },
  metricsRow: { flexDirection: "row", gap: 10, marginBottom: 22 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginBottom: 22 },
  listCard: { paddingVertical: 2, marginBottom: 22 },
  rowDivider: { borderTopWidth: StyleSheet.hairlineWidth },
  siteStack: { gap: 10, marginBottom: 20 },
  siteTop: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  siteName: { fontSize: 16, fontWeight: "800" },
  siteMeta: { fontSize: 12, marginTop: 3 },
  siteBottom: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 12 },
  siteRole: { fontSize: 11, fontWeight: "800" },
  footer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    marginTop: 10,
  },
  footerText: { fontSize: 11 },
});
