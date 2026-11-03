import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { AuthGate } from "@/components/jp/auth-gate";
import { IssueFormSheet } from "@/components/jp/issue-form";
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
  SecondaryButton,
  SectionHeader,
  StatusPill,
  formatDateTime,
} from "@/components/jp/ui";
import { useColors } from "@/hooks/use-colors";
import { useConnectivity } from "@/hooks/use-connectivity";
import { useIssueDraftSync } from "@/hooks/use-issue-draft-sync";
import { useWorkspace } from "@/hooks/use-workspace";
import { isIssueOverdue, severityTone, type IssueStatus } from "@/lib/jp/issue-policy";
import { trpc } from "@/lib/trpc";
import { useT } from "@/lib/i18n";

const statusViews = ["Active", "Open", "In Progress", "Resolved", "Closed"] as const;
type StatusView = (typeof statusViews)[number];
const PAGE = 30;

export default function IssuesScreen() {
  const colors = useColors();
  const { t } = useT();
  const router = useRouter();
  const { online } = useConnectivity();
  const { sitesWith } = useWorkspace();
  const sites = trpc.jp.workspace.mySites.useQuery();
  const [status, setStatus] = useState<StatusView>("Active");
  const [search, setSearch] = useState("");
  const [limit, setLimit] = useState(PAGE);
  const params = useLocalSearchParams<{ siteId?: string; aiText?: string; new?: string }>();
  const [formOpen, setFormOpen] = useState(params.new === "1");
  const [notice, setNotice] = useState<string | null>(null);
  const issues = trpc.jp.issues.list.useQuery({
    status,
    search: search.trim() || undefined,
    limit,
  });
  const { drafts, reload, syncNow } = useIssueDraftSync(null);
  const createSites = (sites.data ?? []).filter(
    (site) => sitesWith("issue.create").includes(site.id) && site.status === "Active",
  );
  const counts = issues.data?.counts;
  const rows = issues.data?.rows ?? [];

  return (
    <AuthGate>
      <Screen>
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 110 }}
          keyboardShouldPersistTaps="handled"
          refreshControl={
            <RefreshControl
              refreshing={issues.isRefetching}
              onRefresh={() => {
                void issues.refetch();
                void reload();
              }}
              tintColor={colors.primary}
            />
          }
        >
          <AppHeader
            eyebrow={t("Safety & quality")}
            title={t("Site issues")}
            subtitle="Hazards, incidents, defects and blockers — owned, tracked and closed with evidence."
          />
          <OfflineBanner
            pendingCount={drafts.length}
            connected={online === false ? false : issues.isSuccess ? true : online}
            lastSyncedAt={issues.dataUpdatedAt ? formatDateTime(issues.dataUpdatedAt) : null}
            onRetry={() => {
              void syncNow();
              void issues.refetch();
            }}
          />
          {issues.error && online !== false ? (
            <InlineError message={issues.error.message} onRetry={() => void issues.refetch()} />
          ) : null}
          {notice ? (
            <Card accent="success" style={{ marginBottom: 14 }}>
              <Text style={{ color: colors.foreground, fontSize: 13, fontWeight: "700" }}>
                {notice}
              </Text>
            </Card>
          ) : null}

          <HeroCard>
            <View style={styles.heroStats}>
              <HeroStat value={counts ? String(counts.open) : "—"} label={t("Open now")} />
              <View style={styles.heroDivider} />
              <HeroStat value={counts ? String(counts.critical) : "—"} label={t("Critical")} />
              <View style={styles.heroDivider} />
              <HeroStat value={counts ? String(counts.stopWork) : "—"} label={t("Stop work")} />
            </View>
          </HeroCard>

          {drafts.length > 0 ? (
            <>
              <SectionHeader title="Saved on this phone" caption="Sent automatically when online" />
              <View style={{ gap: 8, marginBottom: 18 }}>
                {drafts.map((draft) => (
                  <Card
                    key={draft.clientMutationId}
                    accent={draft.status === "Sync Failed" ? "error" : "warning"}
                  >
                    <View style={styles.rowTop}>
                      <Text style={[styles.title, { color: colors.foreground }]} numberOfLines={1}>
                        {draft.title}
                      </Text>
                      <StatusPill
                        label={draft.status}
                        tone={draft.status === "Sync Failed" ? "error" : "warning"}
                        compact
                      />
                    </View>
                    <Text style={[styles.meta, { color: colors.muted }]}>
                      {draft.siteName} · {draft.severity} · {draft.category}
                    </Text>
                    {draft.error ? (
                      <Text style={[styles.meta, { color: colors.error }]}>{draft.error}</Text>
                    ) : null}
                  </Card>
                ))}
                {online !== false ? (
                  <SecondaryButton icon="sync" label="Send now" onPress={() => void syncNow()} />
                ) : null}
              </View>
            </>
          ) : null}

          <View
            style={[styles.search, { backgroundColor: colors.surface, borderColor: colors.border }]}
          >
            <MaterialIcons name="search" size={20} color={colors.muted} />
            <TextInput
              value={search}
              onChangeText={(value) => {
                setSearch(value);
                setLimit(PAGE);
              }}
              placeholder="Search title or issue number"
              placeholderTextColor={colors.muted}
              accessibilityLabel="Search issues"
              style={[styles.searchInput, { color: colors.foreground }]}
            />
          </View>
          <ChipGroup
            options={statusViews}
            value={status}
            onChange={(value) => {
              setStatus(value);
              setLimit(PAGE);
            }}
            format={(value) => (value === "Active" ? "All active" : value)}
          />

          {issues.isLoading ? (
            <LoadingBlock label="Loading issues…" />
          ) : rows.length === 0 ? (
            <EmptyState
              icon="health-and-safety"
              title={status === "Active" ? "No open issues" : `No ${status.toLowerCase()} issues`}
              detail="Report hazards, defects, shortages or blockers so the right person owns them until they are closed."
              action={createSites.length ? "Report issue" : undefined}
              onPress={() => setFormOpen(true)}
            />
          ) : (
            <View style={{ gap: 10 }}>
              {rows.map((issue) => {
                const overdue = isIssueOverdue({
                  status: issue.status as IssueStatus,
                  targetDate: issue.targetDate,
                });
                return (
                  <Card
                    key={issue.id}
                    accent={severityTone(issue.severity)}
                    onPress={() => router.push(`/issue/${issue.id}` as never)}
                    accessibilityLabel={`Open issue ${issue.title}`}
                  >
                    <View style={styles.rowTop}>
                      <Text style={[styles.code, { color: colors.accent }]}>{issue.issueCode}</Text>
                      {issue.stopWork === "Yes" && issue.status !== "Closed" ? (
                        <StatusPill label="STOP WORK" tone="error" compact />
                      ) : null}
                      <StatusPill
                        label={issue.status}
                        tone={
                          issue.status === "Closed"
                            ? "success"
                            : issue.status === "Resolved"
                              ? "info"
                              : "warning"
                        }
                        compact
                      />
                    </View>
                    <Text style={[styles.title, { color: colors.foreground }]}>{issue.title}</Text>
                    <Text style={[styles.meta, { color: colors.muted }]}>
                      {issue.severity} · {issue.category} · {issue.siteName}
                    </Text>
                    <View style={styles.bottom}>
                      <MaterialIcons name="person-outline" size={14} color={colors.muted} />
                      <Text
                        style={[
                          styles.meta,
                          {
                            color: issue.ownerName ? colors.muted : colors.warning,
                            flex: 1,
                            marginTop: 0,
                          },
                        ]}
                      >
                        {issue.ownerName ?? "No owner yet"}
                      </Text>
                      {issue.targetDate ? (
                        <Text
                          style={[
                            styles.meta,
                            { color: overdue ? colors.error : colors.muted, marginTop: 0 },
                          ]}
                        >
                          {overdue ? "Overdue · " : "Target "}
                          {issue.targetDate}
                        </Text>
                      ) : null}
                    </View>
                  </Card>
                );
              })}
              {issues.data && issues.data.total > rows.length ? (
                <SecondaryButton
                  icon="expand-more"
                  label={`Show more (${issues.data.total - rows.length} left)`}
                  onPress={() => setLimit((value) => Math.min(100, value + PAGE))}
                  disabled={limit >= 100}
                />
              ) : null}
            </View>
          )}
        </ScrollView>
        {createSites.length ? (
          <Fab icon="report" label={t("Report issue")} onPress={() => setFormOpen(true)} />
        ) : null}
        <IssueFormSheet
          visible={formOpen}
          sites={createSites}
          defaultSiteId={typeof params.siteId === "string" ? params.siteId : undefined}
          aiText={typeof params.aiText === "string" ? params.aiText : undefined}
          online={online}
          onClose={() => setFormOpen(false)}
          onSaved={({ id, offline }) => {
            setFormOpen(false);
            void reload();
            if (offline)
              setNotice("Saved on this phone. It will be sent when you are back online.");
            else if (id) router.push(`/issue/${id}` as never);
          }}
        />
      </Screen>
    </AuthGate>
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
  rowTop: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  code: { fontSize: 11, fontWeight: "800", letterSpacing: 0.6, flex: 1 },
  title: { fontSize: 15, fontWeight: "800", marginTop: 6, flexShrink: 1 },
  meta: { fontSize: 12, marginTop: 4 },
  bottom: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 10 },
});
