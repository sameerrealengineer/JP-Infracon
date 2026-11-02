import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import {
  AppHeader,
  EmptyState,
  InlineError,
  OfflineBanner,
  Screen,
  SectionHeader,
  StatusPill,
  styles as uiStyles,
} from "@/components/jp/ui";
import { useColors } from "@/hooks/use-colors";
import { trpc } from "@/lib/trpc";
import { readDraftStore } from "@/lib/jp/local-repository";
import { getSiteStatusTone, type SiteStatus } from "@/lib/jp/domain";

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
function tone(status: string): "success" | "warning" | "error" | "info" {
  return getSiteStatusTone(status as SiteStatus);
}

export default function SitesScreen() {
  const colors = useColors();
  const me = trpc.auth.me.useQuery(undefined, { retry: false });
  const sitesQuery = trpc.jp.workspace.mySites.useQuery();
  const [filter, setFilter] = useState<"All" | "Attention">("All");
  const [pendingCount, setPendingCount] = useState(0);

  useEffect(() => {
    readDraftStore().then((store) =>
      setPendingCount(store.syncQueue.filter((item) => item.status !== "Synced").length),
    );
  }, []);
  const sites = useMemo(() => {
    const all = sitesQuery.data ?? [];
    return filter === "All"
      ? all
      : all.filter((site) => site.status === "On Hold" || site.status === "Inactive");
  }, [filter, sitesQuery.data]);
  const activeCount = sitesQuery.data?.filter((site) => site.status === "Active").length ?? 0;
  const attentionCount =
    sitesQuery.data?.filter((site) => site.status === "On Hold" || site.status === "Inactive")
      .length ?? 0;
  const lastRefresh = sitesQuery.dataUpdatedAt
    ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(
        new Date(sitesQuery.dataUpdatedAt),
      )
    : null;

  return (
    <Screen>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        <AppHeader
          eyebrow="Assigned scope"
          title="Sites"
          subtitle="Only site records allowed by your active organisation role and assignment are returned."
          userInitials={initials(me.data?.name)}
        />
        <OfflineBanner
          pendingCount={pendingCount}
          connected={sitesQuery.isSuccess}
          lastSyncedAt={lastRefresh}
          onRetry={() => {
            void sitesQuery.refetch();
          }}
        />
        {sitesQuery.isError ? (
          <InlineError
            message={sitesQuery.error.message}
            onRetry={() => {
              void sitesQuery.refetch();
            }}
          />
        ) : null}

        <View
          style={[
            styles.summaryStrip,
            { backgroundColor: colors.surface, borderColor: colors.border },
          ]}
        >
          <View>
            <Text style={[styles.summaryValue, { color: colors.foreground }]}>
              {sitesQuery.data ? activeCount : "—"}
            </Text>
            <Text style={[styles.summaryLabel, { color: colors.muted }]}>active sites</Text>
          </View>
          <View style={[styles.summaryDivider, { backgroundColor: colors.border }]} />
          <View>
            <Text style={[styles.summaryValue, { color: colors.foreground }]}>
              {sitesQuery.data ? sitesQuery.data.length : "—"}
            </Text>
            <Text style={[styles.summaryLabel, { color: colors.muted }]}>in your scope</Text>
          </View>
          <View style={[styles.summaryDivider, { backgroundColor: colors.border }]} />
          <View>
            <Text style={[styles.summaryValue, { color: colors.warning }]}>
              {sitesQuery.data ? attentionCount : "—"}
            </Text>
            <Text style={[styles.summaryLabel, { color: colors.muted }]}>on hold / inactive</Text>
          </View>
        </View>

        <SectionHeader title="Your field scope" />
        <View style={styles.filterRow}>
          {(["All", "Attention"] as const).map((item) => (
            <Pressable
              key={item}
              accessibilityRole="button"
              onPress={() => setFilter(item)}
              style={[
                styles.filterChip,
                {
                  backgroundColor: filter === item ? colors.primary : colors.surface,
                  borderColor: filter === item ? colors.primary : colors.border,
                },
              ]}
            >
              <Text
                style={[
                  styles.filterText,
                  { color: filter === item ? colors.background : colors.muted },
                ]}
              >
                {item}
              </Text>
            </Pressable>
          ))}
        </View>

        {sitesQuery.isLoading ? (
          <View style={styles.loading}>
            <ActivityIndicator color={colors.primary} />
            <Text style={[styles.loadingText, { color: colors.muted }]}>
              Loading authorised sites…
            </Text>
          </View>
        ) : sitesQuery.isError ? null : sites.length === 0 ? (
          <EmptyState
            icon="domain"
            title={sitesQuery.data?.length ? "No sites in this filter" : "No assigned sites"}
            detail={
              sitesQuery.data?.length
                ? "There are no sites in the selected status view."
                : "A site will appear here only after an organisation administrator grants an active assignment."
            }
          />
        ) : (
          <View style={styles.siteStack}>
            {sites.map((site) => (
              <View
                key={`${site.id}-card`}
                style={[
                  styles.siteCard,
                  { backgroundColor: colors.surface, borderColor: colors.border },
                ]}
              >
                <View style={styles.siteHeader}>
                  <View style={styles.siteIdentity}>
                    <View style={[styles.siteIcon, { backgroundColor: `${colors.primary}15` }]}>
                      <MaterialIcons name="domain" size={19} color={colors.primary} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.siteName, { color: colors.foreground }]}>
                        {site.name}
                      </Text>
                      <Text style={[styles.siteLocation, { color: colors.muted }]}>
                        {site.location || "No site address recorded"}
                      </Text>
                    </View>
                  </View>
                  <StatusPill label={site.status} tone={tone(site.status)} compact />
                </View>
                <View style={[styles.divider, { backgroundColor: colors.border }]} />
                <View style={styles.siteMetaRow}>
                  <Text style={[styles.metaLabel, { color: colors.muted }]}>Project</Text>
                  <Text style={[styles.metaValue, { color: colors.foreground }]}>
                    {site.project}
                  </Text>
                </View>
                <View style={styles.siteMetaRow}>
                  <Text style={[styles.metaLabel, { color: colors.muted }]}>Site code</Text>
                  <Text style={[styles.metaValue, { color: colors.foreground }]}>{site.code}</Text>
                </View>
                <View style={styles.permissionNote}>
                  <MaterialIcons name="lock-outline" size={15} color={colors.primary} />
                  <Text style={[styles.permissionText, { color: colors.muted }]}>
                    Site access is enforced server-side for every record request.
                  </Text>
                </View>
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { paddingBottom: 30 },
  summaryStrip: {
    borderRadius: 18,
    borderWidth: 1,
    padding: 15,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 23,
  },
  summaryValue: { fontSize: 22, fontWeight: "800", textAlign: "center" },
  summaryLabel: { fontSize: 10, marginTop: 2, textAlign: "center" },
  summaryDivider: { width: 1, height: 34 },
  filterRow: { flexDirection: "row", gap: 8, marginBottom: 14 },
  filterChip: { borderRadius: 999, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 8 },
  filterText: { fontSize: 12, fontWeight: "800" },
  siteStack: { gap: 11 },
  siteCard: { borderWidth: 1, borderRadius: 18, padding: 15 },
  siteHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 8,
  },
  siteIdentity: { flexDirection: "row", alignItems: "flex-start", gap: 10, flex: 1 },
  siteIcon: {
    width: 37,
    height: 37,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  siteName: { fontSize: 15, fontWeight: "800" },
  siteLocation: { fontSize: 11, marginTop: 3, lineHeight: 16 },
  divider: { height: 1, marginVertical: 14 },
  siteMetaRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 15,
    marginBottom: 9,
  },
  metaLabel: { fontSize: 11 },
  metaValue: { fontSize: 12, fontWeight: "700", flex: 1, textAlign: "right" },
  permissionNote: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 7 },
  permissionText: { fontSize: 10, flex: 1, lineHeight: 15 },
  loading: { minHeight: 90, alignItems: "center", justifyContent: "center", gap: 8 },
  loadingText: { fontSize: 12 },
});
