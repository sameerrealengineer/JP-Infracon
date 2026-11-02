import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import {
  Linking,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import {
  AppHeader,
  Card,
  ChipGroup,
  Divider,
  EmptyState,
  HeroCard,
  InlineError,
  ListRow,
  LoadingBlock,
  ModuleTile,
  Screen,
  SecondaryButton,
  SectionHeader,
  StatusPill,
  formatDateTime,
  initialsOf,
  type IconName,
  type Tone,
} from "@/components/jp/ui";
import {
  AssignMemberSheet,
  RemoveMemberSheet,
  SiteFormSheet,
  StatusSheet,
  type SiteDraft,
  type StatusTarget,
} from "@/components/jp/site-admin-forms";
import { AuthGate } from "@/components/jp/auth-gate";
import { useColors } from "@/hooks/use-colors";
import { useWorkspace } from "@/hooks/use-workspace";
import { getSiteStatusTone, type SiteStatus } from "@/lib/jp/domain";
import { prettyRole } from "@/lib/jp/site-admin-policy";
import { siteScopedRoute } from "@/lib/jp/site-route";
import { trpc } from "@/lib/trpc";
import { currentPosition } from "@/lib/geofence-task";
import { mapsLink } from "@/lib/jp/geo";

export default function SiteDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const siteId = typeof id === "string" ? id : "";
  const colors = useColors();
  const router = useRouter();
  const { sitesWith } = useWorkspace();
  const detail = trpc.jp.sitesAdmin.siteDetail.useQuery({ siteId }, { enabled: Boolean(siteId) });
  const [editDraft, setEditDraft] = useState<SiteDraft | null>(null);
  const [statusTarget, setStatusTarget] = useState<StatusTarget | null>(null);
  const [assignOpen, setAssignOpen] = useState(false);
  const [removing, setRemoving] = useState<{ assignmentId: string; name: string | null } | null>(
    null,
  );

  const has = (key: string) => sitesWith(key).includes(siteId);
  const modules: { icon: IconName; title: string; tone: Tone; route: string; show: boolean }[] = [
    {
      icon: "assignment",
      title: "Daily reports",
      tone: "info",
      route: "/(tabs)/reports",
      show: has("dpr.view") || has("dlr.view"),
    },
    {
      icon: "local-shipping",
      title: "Material requests",
      tone: "accent",
      route: "/(tabs)/requests",
      show: has("material.request.view"),
    },
    {
      icon: "health-and-safety",
      title: "Issues",
      tone: "error",
      route: "/issues",
      show: has("issue.view"),
    },
    {
      icon: "how-to-reg",
      title: "Attendance",
      tone: "success",
      route: "/attendance",
      show: has("attendance.view"),
    },
    {
      icon: "event-note",
      title: "Schedule",
      tone: "info",
      route: "/schedule",
      show: has("task.view"),
    },
    {
      icon: "inventory",
      title: "Stock",
      tone: "success",
      route: "/inventory",
      show: has("inventory.view"),
    },
    {
      icon: "groups",
      title: "Workforce",
      tone: "info",
      route: "/workforce",
      show: has("workforce.view"),
    },
    {
      icon: "receipt-long",
      title: "Finance",
      tone: "accent",
      route: "/finance",
      show: has("finance.invoice.view") || has("finance.cash.view"),
    },
    {
      icon: "history",
      title: "Audit trail",
      tone: "info",
      route: "/audit",
      show: has("audit.view"),
    },
  ];

  const data = detail.data;
  const site = data?.site;
  const location = site ? [site.village, site.district, site.state].filter(Boolean).join(", ") : "";

  return (
    <AuthGate>
      <Screen>
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 40 }}
          refreshControl={
            <RefreshControl
              refreshing={detail.isRefetching}
              onRefresh={() => void detail.refetch()}
              tintColor={colors.primary}
            />
          }
        >
          <AppHeader
            eyebrow={data ? `${data.project.code} · ${site?.code}` : "Site"}
            title={site?.name ?? "Site"}
          />
          {detail.error ? (
            <InlineError message={detail.error.message} onRetry={() => void detail.refetch()} />
          ) : null}
          {detail.isLoading ? <LoadingBlock label="Loading site…" /> : null}
          {data && site ? (
            <>
              <HeroCard>
                <View style={styles.heroTop}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.heroKicker}>PROJECT</Text>
                    <Text style={styles.heroTitle}>{data.project.name}</Text>
                    {data.project.clientDepartment ? (
                      <Text style={styles.heroMeta}>{data.project.clientDepartment}</Text>
                    ) : null}
                  </View>
                  <View style={styles.heroStatus}>
                    <Text style={styles.heroStatusText}>{site.status}</Text>
                  </View>
                </View>
                <View style={styles.heroRow}>
                  <MaterialIcons name="place" size={16} color="#D9B76A" />
                  <Text style={styles.heroMeta}>
                    {site.address || location || "Address not recorded"}
                    {site.address && location ? `\n${location}` : ""}
                  </Text>
                </View>
                <View style={styles.heroRow}>
                  <MaterialIcons name="badge" size={16} color="#D9B76A" />
                  <Text style={styles.heroMeta}>Your role here · {prettyRole(data.myRole)}</Text>
                </View>
              </HeroCard>

              {data.canManage ? (
                <View style={styles.manageRow}>
                  <View style={{ flex: 1 }}>
                    <SecondaryButton
                      icon="edit"
                      label="Edit details"
                      onPress={() =>
                        setEditDraft({
                          id: site.id,
                          projectId: data.project.id,
                          projectName: data.project.name,
                          code: site.code,
                          name: site.name,
                          address: site.address,
                          village: site.village,
                          district: site.district,
                          state: site.state,
                        })
                      }
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <SecondaryButton
                      icon="published-with-changes"
                      label="Change status"
                      onPress={() =>
                        setStatusTarget({
                          kind: "site",
                          id: site.id,
                          name: site.name,
                          status: site.status,
                        })
                      }
                    />
                  </View>
                </View>
              ) : null}

              <GeofenceCard siteId={site.id} geofence={data.geofence} canManage={data.canManage} />
              {site.status !== "Active" ? (
                <Card
                  accent={getSiteStatusTone(site.status as SiteStatus)}
                  style={{ marginBottom: 18 }}
                >
                  <Text style={[styles.noticeTitle, { color: colors.foreground }]}>
                    This site is {site.status}
                  </Text>
                  <Text style={[styles.noticeText, { color: colors.muted }]}>
                    Records stay visible, but new reports, requests and entries are paused until an
                    administrator reactivates it.
                  </Text>
                </Card>
              ) : null}

              {modules.some((module) => module.show) ? (
                <>
                  <SectionHeader title="Work on this site" />
                  <View style={styles.grid}>
                    {modules
                      .filter((module) => module.show)
                      .map((module) => (
                        <ModuleTile
                          key={module.title}
                          icon={module.icon}
                          title={module.title}
                          tone={module.tone}
                          onPress={() =>
                            router.push(siteScopedRoute(module.route, siteId) as never)
                          }
                        />
                      ))}
                  </View>
                </>
              ) : null}

              <SectionHeader
                title="Site team"
                caption={`${data.team.length} assigned · ${data.leaders.length} with organisation-wide access`}
                action={data.canManage && site.status === "Active" ? "Assign" : undefined}
                onPress={() => setAssignOpen(true)}
              />
              {data.team.length === 0 ? (
                <EmptyState
                  icon="group-add"
                  title="No one is assigned yet"
                  detail={
                    data.canManage
                      ? "Assign a supervisor, storekeeper or project manager so they can work on this site."
                      : "Your administrator assigns people to this site."
                  }
                  action={data.canManage && site.status === "Active" ? "Assign person" : undefined}
                  onPress={() => setAssignOpen(true)}
                />
              ) : (
                <Card style={styles.listCard}>
                  {data.team.map((member, index) => (
                    <View key={member.assignmentId}>
                      {index > 0 ? <Divider /> : null}
                      <ListRow
                        icon="person"
                        title={member.name ?? "Unnamed account"}
                        detail={`${prettyRole(member.role)} · since ${formatDateTime(member.since)}`}
                        trailing={
                          data.canManage ? (
                            <Pressable
                              accessibilityRole="button"
                              accessibilityLabel={`Remove ${member.name ?? "member"} from site`}
                              hitSlop={10}
                              onPress={() =>
                                setRemoving({
                                  assignmentId: member.assignmentId,
                                  name: member.name,
                                })
                              }
                            >
                              <MaterialIcons name="person-remove" size={20} color={colors.error} />
                            </Pressable>
                          ) : undefined
                        }
                      />
                    </View>
                  ))}
                </Card>
              )}

              {data.leaders.length > 0 ? (
                <>
                  <SectionHeader
                    title="Leadership"
                    caption="Can see every site in the organisation"
                  />
                  <View style={styles.leaderRow}>
                    {data.leaders.map((leader) => (
                      <View
                        key={`${leader.userId}-${leader.role}`}
                        style={[
                          styles.leaderChip,
                          { backgroundColor: colors.surface, borderColor: colors.border },
                        ]}
                      >
                        <View style={[styles.leaderAvatar, { backgroundColor: colors.primary }]}>
                          <Text style={[styles.leaderInitials, { color: colors.background }]}>
                            {initialsOf(leader.name)}
                          </Text>
                        </View>
                        <View>
                          <Text style={[styles.leaderName, { color: colors.foreground }]}>
                            {leader.name ?? "Unnamed"}
                          </Text>
                          <Text style={[styles.leaderRole, { color: colors.muted }]}>
                            {prettyRole(leader.role)}
                          </Text>
                        </View>
                      </View>
                    ))}
                  </View>
                </>
              ) : null}

              <Text style={[styles.footnote, { color: colors.muted }]}>
                Created {formatDateTime(site.createdAt)} · last updated{" "}
                {formatDateTime(site.updatedAt)}
              </Text>
              <StatusPill label="Access checked by server" tone="success" compact />
            </>
          ) : null}
        </ScrollView>
        <SiteFormSheet draft={editDraft} onClose={() => setEditDraft(null)} />
        <StatusSheet target={statusTarget} onClose={() => setStatusTarget(null)} />
        <AssignMemberSheet
          siteId={assignOpen ? siteId : null}
          onClose={() => setAssignOpen(false)}
        />
        <RemoveMemberSheet member={removing} onClose={() => setRemoving(null)} />
      </Screen>
    </AuthGate>
  );
}

const styles = StyleSheet.create({
  heroTop: { flexDirection: "row", alignItems: "flex-start", gap: 10, marginTop: 6 },
  heroKicker: { color: "#D9B76A", fontSize: 11, fontWeight: "800", letterSpacing: 1.6 },
  heroTitle: { color: "#FFFFFF", fontSize: 19, fontWeight: "800", marginTop: 4 },
  heroMeta: { color: "rgba(246,241,230,0.78)", fontSize: 12, lineHeight: 18, flex: 1 },
  heroStatus: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
    backgroundColor: "rgba(217,183,106,0.18)",
  },
  heroStatusText: { color: "#E6C987", fontSize: 11, fontWeight: "800" },
  heroRow: { flexDirection: "row", alignItems: "flex-start", gap: 8, marginTop: 12 },
  manageRow: { flexDirection: "row", gap: 10, marginBottom: 20 },
  noticeTitle: { fontSize: 14, fontWeight: "800" },
  noticeText: { fontSize: 12, lineHeight: 17, marginTop: 4 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginBottom: 22 },
  listCard: { paddingVertical: 2, marginBottom: 22 },
  leaderRow: { gap: 8, marginBottom: 20 },
  leaderChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: 1,
    borderRadius: 16,
    padding: 10,
  },
  leaderAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  leaderInitials: { fontSize: 12, fontWeight: "800" },
  leaderName: { fontSize: 13, fontWeight: "800" },
  leaderRole: { fontSize: 11, marginTop: 2 },
  footnote: { fontSize: 11, marginBottom: 8 },
});

function GeofenceCard({
  siteId,
  geofence,
  canManage,
}: {
  siteId: string;
  geofence: { latitude: number; longitude: number; radiusM: number } | null;
  canManage: boolean;
}) {
  const colors = useColors();
  const utils = trpc.useUtils();
  const setFence = trpc.jp.sitesAdmin.setGeofence.useMutation();
  const [radius, setRadius] = useState<"100" | "200" | "500" | "1000">(
    geofence ? (String(geofence.radiusM) as "200") : "200",
  );
  const [error, setError] = useState<string | null>(null);
  if (!geofence && !canManage) return null;
  const save = async () => {
    setError(null);
    try {
      const position = await currentPosition();
      if (!position) throw new Error("Allow location and stand at the centre of the site.");
      await setFence.mutateAsync({ siteId, ...position, radiusM: Number(radius) });
      await utils.jp.sitesAdmin.siteDetail.invalidate({ siteId });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Location not saved.");
    }
  };
  return (
    <Card style={{ marginBottom: 18 }} accent={geofence ? "success" : "warning"}>
      <View style={{ flex: 1, gap: 6 }}>
        <Text style={[styles.noticeTitle, { color: colors.foreground }]}>
          Site location & boundary
        </Text>
        {geofence ? (
          <Pressable
            accessibilityRole="link"
            onPress={() => void Linking.openURL(mapsLink(geofence))}
          >
            <Text style={[styles.noticeText, { color: colors.primary }]}>
              📍 {geofence.latitude.toFixed(5)}, {geofence.longitude.toFixed(5)} ·{" "}
              {geofence.radiusM} m radius
            </Text>
          </Pressable>
        ) : (
          <Text style={[styles.noticeText, { color: colors.muted }]}>
            Not set. Setting it lets photos show whether they were taken on site and powers arrival
            alerts.
          </Text>
        )}
        {canManage ? (
          <>
            <ChipGroup
              options={["100", "200", "500", "1000"] as const}
              value={radius}
              onChange={setRadius}
              format={(value) => `${value} m`}
            />
            {error ? <InlineError message={error} title="Not saved" /> : null}
            <SecondaryButton
              icon="my-location"
              label={
                setFence.isPending
                  ? "Saving…"
                  : geofence
                    ? "Reset to my current location"
                    : "Set to my current location"
              }
              onPress={() => void save()}
            />
          </>
        ) : null}
      </View>
    </Card>
  );
}
