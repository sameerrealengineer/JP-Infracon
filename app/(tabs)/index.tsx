import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import {
  AppHeader,
  EmptyState,
  InlineError,
  MetricCard,
  OfflineBanner,
  Screen,
  SectionHeader,
  StatusPill,
  styles as uiStyles,
} from "@/components/jp/ui";
import { FirstWorkspaceSetup } from "@/components/jp/first-workspace-setup";
import { useColors } from "@/hooks/use-colors";
import { trpc } from "@/lib/trpc";
import { readDraftStore } from "@/lib/jp/local-repository";
import { useEffect } from "react";

function initials(name: string | null | undefined) {
  return (
    name
      ?.trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0])
      .join("") || "?"
  );
}

function displayTime(value?: string | Date | null) {
  if (!value) return "Not available";
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime())
    ? "Not available"
    : new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function statusTone(status: string): "success" | "warning" | "error" | "info" {
  if (status === "Active" || status === "Completed") return "success";
  if (status === "On Hold") return "warning";
  if (status === "Inactive") return "error";
  return "info";
}

export default function HomeScreen() {
  const colors = useColors();
  const utils = trpc.useUtils();
  const me = trpc.auth.me.useQuery(undefined, { retry: false });
  const sites = trpc.jp.workspace.mySites.useQuery();
  const dashboard = trpc.jp.workspace.dashboard.useQuery();
  const onboarding = trpc.jp.workspace.onboardingState.useQuery();
  const reports = trpc.jp.reports.list.useQuery(undefined);
  const requests = trpc.jp.materialRequests.list.useQuery(undefined);
  const [refreshing, setRefreshing] = useState(false);
  const [setupOpen, setSetupOpen] = useState(false);
  const [localDraftCount, setLocalDraftCount] = useState(0);

  useEffect(() => {
    readDraftStore().then((store) =>
      setLocalDraftCount(store.syncQueue.filter((item) => item.status !== "Synced").length),
    );
  }, []);

  const refresh = async () => {
    setRefreshing(true);
    try {
      await Promise.all([
        me.refetch(),
        sites.refetch(),
        dashboard.refetch(),
        onboarding.refetch(),
        reports.refetch(),
        requests.refetch(),
      ]);
    } finally {
      setRefreshing(false);
    }
  };

  const displaySites = useMemo(() => sites.data ?? [], [sites.data]);
  const dataError = sites.error || dashboard.error || reports.error || requests.error;
  const available = !dataError && (sites.isSuccess || dashboard.isSuccess);
  const today = new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date());
  const pendingDprs = dashboard.data?.reportsNeedingReview ?? 0;
  const pendingRequests = dashboard.data?.pendingMaterialRequests ?? 0;

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
          eyebrow="JP Infracon · Field operations"
          title="Keep today's work moving."
          subtitle="A live brief from the records you are allowed to access."
          userInitials={initials(me.data?.name)}
        />
        <OfflineBanner
          pendingCount={localDraftCount}
          connected={available}
          lastSyncedAt={dashboard.data?.asOf ? displayTime(dashboard.data.asOf) : null}
          onRetry={refresh}
          retrying={refreshing}
        />

        {dataError ? <InlineError message={dataError.message} onRetry={refresh} /> : null}
        <View style={styles.briefRow}>
          <View style={styles.briefCopy}>
            <Text style={[styles.briefKicker, { color: colors.muted }]}>{today.toUpperCase()}</Text>
            <Text style={[styles.briefTitle, { color: colors.foreground }]}>Operational brief</Text>
            <Text style={[styles.briefDetail, { color: colors.muted }]}>
              As of {displayTime(dashboard.data?.asOf)}
            </Text>
          </View>
          <View
            style={[
              styles.signalMark,
              { backgroundColor: `${colors.primary}15`, borderColor: `${colors.primary}35` },
            ]}
          >
            <MaterialIcons name="north-east" size={23} color={colors.primary} />
          </View>
        </View>

        <View style={styles.metricsRow}>
          <MetricCard
            icon="domain"
            value={dashboard.data ? String(dashboard.data.siteCount) : "—"}
            label="Assigned sites"
            tone="info"
          />
          <MetricCard
            icon="assignment-late"
            value={dashboard.data ? String(dashboard.data.reportsNeedingReview) : "—"}
            label="Reports to review"
            tone="warning"
          />
          <MetricCard
            icon="inventory-2"
            value={dashboard.data ? String(dashboard.data.pendingMaterialRequests) : "—"}
            label="Material requests"
            tone="success"
          />
        </View>

        <SectionHeader title="Needs attention" />
        {dashboard.isLoading ? (
          <View style={styles.loading}>
            <ActivityIndicator color={colors.primary} />
            <Text style={[styles.loadingText, { color: colors.muted }]}>
              Loading authorised records…
            </Text>
          </View>
        ) : dashboard.data && pendingDprs + pendingRequests > 0 ? (
          <View
            style={[
              styles.attentionCard,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
            <View style={[styles.attentionBar, { backgroundColor: colors.warning }]} />
            <View style={styles.attentionBody}>
              <StatusPill
                label={`${pendingDprs + pendingRequests} open workflow item${pendingDprs + pendingRequests === 1 ? "" : "s"}`}
                tone="warning"
              />
              <Text style={[styles.attentionTitle, { color: colors.foreground }]}>
                Review the current queue
              </Text>
              <Text style={[styles.attentionDetail, { color: colors.muted }]}>
                {pendingDprs} report(s) need review · {pendingRequests} material request(s) are
                awaiting a decision.
              </Text>
              <View style={styles.attentionLinks}>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => utils.jp.reports.list.invalidate()}
                  style={styles.actionLink}
                >
                  <Text style={[styles.actionLinkText, { color: colors.primary }]}>
                    Refresh reports
                  </Text>
                  <MaterialIcons name="arrow-forward" size={16} color={colors.primary} />
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => utils.jp.materialRequests.list.invalidate()}
                  style={styles.actionLink}
                >
                  <Text style={[styles.actionLinkText, { color: colors.primary }]}>
                    Refresh requests
                  </Text>
                  <MaterialIcons name="arrow-forward" size={16} color={colors.primary} />
                </Pressable>
              </View>
            </View>
          </View>
        ) : dashboard.data ? (
          <EmptyState
            icon="task-alt"
            title="No pending approvals in this view"
            detail="This summary is computed from the site records currently in your authorised scope."
          />
        ) : null}

        <SectionHeader
          title="Assigned sites"
          action="All sites"
          onPress={() => utils.jp.workspace.mySites.invalidate()}
        />
        {sites.isLoading ? (
          <View style={styles.loading}>
            <ActivityIndicator color={colors.primary} />
            <Text style={[styles.loadingText, { color: colors.muted }]}>
              Loading assigned sites…
            </Text>
          </View>
        ) : displaySites.length === 0 ? (
          <EmptyState
            icon="domain"
            title="No assigned sites"
            detail={
              onboarding.data?.canInitializeOrganization
                ? "Create the first organisation, project, and site using real company values."
                : "Ask your organisation administrator to add an active site assignment for your account."
            }
            action={
              onboarding.data?.canInitializeOrganization ? "Set up first workspace" : undefined
            }
            onPress={() => setSetupOpen(true)}
          />
        ) : (
          <View style={styles.siteStack}>
            {displaySites.slice(0, 5).map((site) => (
              <View
                key={site.id}
                style={[
                  styles.siteCard,
                  { backgroundColor: colors.surface, borderColor: colors.border },
                ]}
              >
                <View style={styles.siteCardTop}>
                  <View style={styles.siteCardHeading}>
                    <View
                      style={[
                        styles.siteMarker,
                        {
                          backgroundColor:
                            statusTone(site.status) === "success"
                              ? colors.success
                              : statusTone(site.status) === "warning"
                                ? colors.warning
                                : colors.muted,
                        },
                      ]}
                    />
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.siteName, { color: colors.foreground }]}>
                        {site.name}
                      </Text>
                      <Text style={[styles.siteProject, { color: colors.muted }]}>
                        {site.project} · {site.code}
                      </Text>
                    </View>
                  </View>
                  <StatusPill label={site.status} tone={statusTone(site.status)} compact />
                </View>
                <View style={styles.siteDetails}>
                  <View style={styles.siteDetailItem}>
                    <MaterialIcons name="place" size={15} color={colors.muted} />
                    <Text style={[styles.siteDetailText, { color: colors.muted }]}>
                      {site.location || "No site address recorded"}
                    </Text>
                  </View>
                </View>
              </View>
            ))}
          </View>
        )}

        {onboarding.data?.canInitializeOrganization && displaySites.length > 0 ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => setSetupOpen(true)}
            style={styles.secondaryAction}
          >
            <MaterialIcons name="add-business" size={17} color={colors.primary} />
            <Text style={[styles.secondaryActionText, { color: colors.primary }]}>
              Create workspace
            </Text>
          </Pressable>
        ) : null}
        <View style={styles.footerNote}>
          <MaterialIcons name="verified-user" size={16} color={colors.primary} />
          <Text style={[styles.footerText, { color: colors.muted }]}>
            Site access is enforced by the server. This first build does not yet show task, stock,
            safety, or finance ledgers.
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
  content: { paddingBottom: 30 },
  briefRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 16,
  },
  briefCopy: { flex: 1 },
  briefKicker: { fontSize: 10, letterSpacing: 1.3, fontWeight: "800" },
  briefTitle: { fontSize: 20, fontWeight: "800", marginTop: 4 },
  briefDetail: { fontSize: 11, marginTop: 3 },
  signalMark: {
    width: 48,
    height: 48,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  metricsRow: { flexDirection: "row", marginBottom: 24 },
  loading: { minHeight: 75, alignItems: "center", justifyContent: "center", gap: 8 },
  loadingText: { fontSize: 12 },
  attentionCard: {
    borderWidth: 1,
    borderRadius: 18,
    flexDirection: "row",
    overflow: "hidden",
    marginBottom: 24,
  },
  attentionBar: { width: 5 },
  attentionBody: { flex: 1, padding: 15 },
  attentionTitle: { fontSize: 17, fontWeight: "800", marginTop: 12 },
  attentionDetail: { fontSize: 12, lineHeight: 18, marginTop: 4 },
  attentionLinks: { flexDirection: "row", gap: 18, marginTop: 15, flexWrap: "wrap" },
  actionLink: { flexDirection: "row", alignItems: "center", gap: 4 },
  actionLinkText: { fontSize: 12, fontWeight: "800" },
  siteStack: { gap: 11, marginBottom: 19 },
  siteCard: { borderWidth: 1, borderRadius: 18, padding: 15 },
  siteCardTop: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 10,
  },
  siteCardHeading: { flexDirection: "row", alignItems: "flex-start", flex: 1, gap: 9 },
  siteMarker: { width: 9, height: 9, borderRadius: 5, marginTop: 5 },
  siteName: { fontSize: 15, fontWeight: "800" },
  siteProject: { fontSize: 11, marginTop: 3 },
  siteDetails: { flexDirection: "row", gap: 14, marginTop: 12, flexWrap: "wrap" },
  siteDetailItem: { flexDirection: "row", alignItems: "center", gap: 5 },
  siteDetailText: { fontSize: 11, flex: 1 },
  secondaryAction: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 5,
    padding: 12,
  },
  secondaryActionText: { fontSize: 12, fontWeight: "800" },
  footerNote: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingHorizontal: 8,
    marginTop: 12,
  },
  footerText: { fontSize: 11, lineHeight: 16, textAlign: "center", flex: 1 },
});
