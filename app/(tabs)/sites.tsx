import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import {
  AppHeader,
  Card,
  ChipGroup,
  EmptyState,
  Fab,
  HeroCard,
  HeroStat,
  InlineError,
  LoadingBlock,
  OfflineBanner,
  Screen,
  StatusPill,
  formatDateTime,
} from "@/components/jp/ui";
import { useColors } from "@/hooks/use-colors";
import { useConnectivity, useSyncQueue } from "@/hooks/use-connectivity";
import { useWorkspace } from "@/hooks/use-workspace";
import { getSiteStatusTone, type SiteStatus } from "@/lib/jp/domain";
import { prettyRole } from "@/lib/jp/site-admin-policy";
import { trpc } from "@/lib/trpc";

const filters = ["All", "Active", "On Hold", "Completed", "Inactive"] as const;
type Filter = (typeof filters)[number];

export default function SitesScreen() {
  const colors = useColors();
  const router = useRouter();
  const { canManageSites } = useWorkspace();
  const { online } = useConnectivity();
  const { pending } = useSyncQueue();
  const sitesQuery = trpc.jp.workspace.mySites.useQuery();
  const [filter, setFilter] = useState<Filter>("All");
  const [search, setSearch] = useState("");

  const all = useMemo(() => sitesQuery.data ?? [], [sitesQuery.data]);
  const sites = useMemo(() => {
    const term = search.trim().toLowerCase();
    return all.filter(
      (site) =>
        (filter === "All" || site.status === filter) &&
        (!term ||
          [site.name, site.code, site.project, site.location ?? ""].some((value) =>
            value.toLowerCase().includes(term),
          )),
    );
  }, [all, filter, search]);
  const count = (status: SiteStatus) => all.filter((site) => site.status === status).length;
  const projectCount = new Set(all.map((site) => site.projectId)).size;

  return (
    <Screen>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: canManageSites ? 100 : 30 }}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={sitesQuery.isRefetching}
            onRefresh={() => void sitesQuery.refetch()}
            tintColor={colors.primary}
          />
        }
      >
        <AppHeader
          eyebrow="Portfolio"
          title="Sites"
          subtitle="Every site you can access, with status and your role."
        />
        <OfflineBanner
          pendingCount={pending.length}
          connected={online === false ? false : sitesQuery.isSuccess ? true : online}
          lastSyncedAt={sitesQuery.dataUpdatedAt ? formatDateTime(sitesQuery.dataUpdatedAt) : null}
          onRetry={() => void sitesQuery.refetch()}
          retrying={sitesQuery.isRefetching}
        />
        {sitesQuery.isError && online !== false ? (
          <InlineError
            message={sitesQuery.error.message}
            onRetry={() => void sitesQuery.refetch()}
          />
        ) : null}

        <HeroCard>
          <View style={styles.heroStats}>
            <HeroStat value={sitesQuery.data ? String(count("Active")) : "—"} label="Active" />
            <View style={styles.heroDivider} />
            <HeroStat value={sitesQuery.data ? String(count("On Hold")) : "—"} label="On hold" />
            <View style={styles.heroDivider} />
            <HeroStat value={sitesQuery.data ? String(projectCount) : "—"} label="Projects" />
          </View>
        </HeroCard>

        <View
          style={[styles.search, { backgroundColor: colors.surface, borderColor: colors.border }]}
        >
          <MaterialIcons name="search" size={20} color={colors.muted} />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Search site, code, project or place"
            placeholderTextColor={colors.muted}
            accessibilityLabel="Search sites"
            style={[styles.searchInput, { color: colors.foreground }]}
          />
          {search ? (
            <MaterialIcons
              name="close"
              size={18}
              color={colors.muted}
              onPress={() => setSearch("")}
            />
          ) : null}
        </View>
        <ChipGroup options={filters} value={filter} onChange={setFilter} />

        {sitesQuery.isLoading ? (
          <LoadingBlock label="Loading sites…" />
        ) : sites.length === 0 ? (
          <EmptyState
            icon="location-city"
            title={all.length ? "No sites match" : "No sites yet"}
            detail={
              all.length
                ? "Try another status or search term."
                : canManageSites
                  ? "Create a project and add its first site."
                  : "A site appears here once an administrator assigns you to it."
            }
            action={!all.length && canManageSites ? "Open projects & sites" : undefined}
            onPress={() => router.push("/projects" as never)}
          />
        ) : (
          <View style={{ gap: 10 }}>
            {sites.map((site) => {
              const tone = getSiteStatusTone(site.status as SiteStatus);
              return (
                <Card
                  key={site.id}
                  accent={tone}
                  onPress={() => router.push(`/site/${site.id}` as never)}
                  accessibilityLabel={`Open ${site.name}`}
                >
                  <View style={styles.row}>
                    <View style={[styles.icon, { backgroundColor: `${colors.primary}10` }]}>
                      <MaterialIcons name="apartment" size={20} color={colors.primary} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.name, { color: colors.foreground }]}>{site.name}</Text>
                      <Text style={[styles.meta, { color: colors.muted }]}>
                        {site.project} · {site.code}
                      </Text>
                    </View>
                    <StatusPill label={site.status} tone={tone} compact />
                  </View>
                  <View style={styles.bottom}>
                    <MaterialIcons name="place" size={14} color={colors.muted} />
                    <Text
                      style={[styles.meta, { color: colors.muted, flex: 1, marginTop: 0 }]}
                      numberOfLines={1}
                    >
                      {site.location || "Address not recorded"}
                    </Text>
                    <Text style={[styles.role, { color: colors.accent }]}>
                      {prettyRole(site.businessRole)}
                    </Text>
                    <MaterialIcons name="chevron-right" size={18} color={colors.muted} />
                  </View>
                </Card>
              );
            })}
          </View>
        )}
      </ScrollView>
      {canManageSites ? (
        <Fab icon="add-business" label="Manage" onPress={() => router.push("/projects" as never)} />
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  heroStats: { flexDirection: "row", alignItems: "center", marginTop: 8 },
  heroDivider: {
    width: 1,
    height: 34,
    backgroundColor: "rgba(255,255,255,0.14)",
    marginHorizontal: 12,
  },
  search: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 14,
    minHeight: 50,
    marginBottom: 12,
  },
  searchInput: { flex: 1, fontSize: 14, paddingVertical: 10 },
  row: { flexDirection: "row", alignItems: "center", gap: 12 },
  icon: { width: 42, height: 42, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  name: { fontSize: 16, fontWeight: "800" },
  meta: { fontSize: 12, marginTop: 3 },
  bottom: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 12 },
  role: { fontSize: 11, fontWeight: "800" },
});
