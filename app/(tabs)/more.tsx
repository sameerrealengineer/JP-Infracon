import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Image, Linking, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import {
  AppHeader,
  EmptyState,
  InlineError,
  OfflineBanner,
  PrimaryButton,
  Screen,
  SectionHeader,
} from "@/components/jp/ui";
import { AuthGate } from "@/components/jp/auth-gate";
import { useColors } from "@/hooks/use-colors";
import { useAuth } from "@/hooks/use-auth";
import { trpc } from "@/lib/trpc";
import { readDraftStore } from "@/lib/jp/local-repository";

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
function prettyRole(role?: string | null) {
  return role
    ? role.replaceAll("_", " ").replace(/\b\w/g, (part) => part.toUpperCase())
    : "No active organisation role";
}

export default function MoreScreen() {
  const colors = useColors();
  const router = useRouter();
  const auth = useAuth({ autoFetch: false });
  const utils = trpc.useUtils();
  const me = trpc.auth.me.useQuery(undefined, { retry: false });
  const sites = trpc.jp.workspace.mySites.useQuery();
  const access = trpc.jp.workspace.onboardingState.useQuery();
  const capabilities = trpc.jp.workspace.myCapabilities.useQuery();
  const capabilityRows = capabilities.data ?? [];
  const canOpenAudit = capabilityRows.some((item) => item["audit.view"]);
  const canOpenReports = capabilityRows.some(
    (item) => item["dpr.view"] || item["dpr.create"] || item["dlr.view"] || item["dlr.create"],
  );
  const canOpenRequests = capabilityRows.some(
    (item) => item["material.request.view"] || item["material.request"],
  );
  const canOpenSchedule = capabilityRows.some((item) => item["task.view"]);
  const canOpenWorkforce = capabilityRows.some((item) => item["workforce.view"]);
  const canOpenInventory = capabilityRows.some((item) => item["inventory.view"]);
  const canOpenFinance = capabilityRows.some((item) => item["finance.invoice.view"]);
  const canManageAccounts =
    Boolean(me.data?.platformOwner) ||
    ["owner", "director", "admin"].includes(access.data?.businessRole || "");
  const [queue, setQueue] = useState<
    { id: string; label: string; status: string; updatedAt: string }[]
  >([]);
  const [signingOut, setSigningOut] = useState(false);

  const refreshQueue = async () => {
    const store = await readDraftStore();
    setQueue(store.syncQueue);
  };
  useEffect(() => {
    let mounted = true;
    void readDraftStore().then((store) => {
      if (mounted) setQueue(store.syncQueue);
    });
    return () => {
      mounted = false;
    };
  }, []);

  const signOut = async () => {
    setSigningOut(true);
    try {
      await auth.logout();
      await utils.auth.me.invalidate();
      router.replace("/" as never);
    } finally {
      setSigningOut(false);
    }
  };
  const pendingQueue = queue.filter((item) => item.status !== "Synced");

  return (
    <AuthGate>
      <Screen>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
          <AppHeader
            eyebrow="Workspace"
            title="More"
            subtitle="Account, current access scope, local sync queue, and traceable records."
            userInitials={initials(me.data?.name)}
          />
          <OfflineBanner
            pendingCount={pendingQueue.length}
            connected={me.isSuccess && sites.isSuccess}
            lastSyncedAt={
              sites.dataUpdatedAt
                ? new Intl.DateTimeFormat(undefined, {
                    dateStyle: "medium",
                    timeStyle: "short",
                  }).format(new Date(sites.dataUpdatedAt))
                : null
            }
            onRetry={() => {
              void Promise.all([
                me.refetch(),
                sites.refetch(),
                access.refetch(),
                capabilities.refetch(),
                refreshQueue(),
              ]);
            }}
          />
          {me.isError ? (
            <InlineError
              message={me.error.message}
              onRetry={() => {
                void me.refetch();
              }}
            />
          ) : null}

          <View
            style={[
              styles.profileCard,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
            <View style={[styles.profileAvatar, { backgroundColor: colors.primary }]}>
              <Text style={[styles.profileAvatarText, { color: colors.background }]}>
                {initials(me.data?.name)}
              </Text>
            </View>
            <View style={styles.profileCopy}>
              <Text style={[styles.profileName, { color: colors.foreground }]}>
                {me.data?.name || "Signed-in user"}
              </Text>
              <Text style={[styles.profileRole, { color: colors.muted }]}>
                {me.data?.email || "Individual username/password account"}
              </Text>
              <Text style={[styles.profileScope, { color: colors.primary }]}>
                {me.data?.platformOwner ? "Super Admin" : prettyRole(access.data?.businessRole)} ·{" "}
                {sites.data
                  ? `${sites.data.length} visible site${sites.data.length === 1 ? "" : "s"}`
                  : "Site scope loading"}
              </Text>
            </View>
            <MaterialIcons name="verified-user" size={20} color={colors.primary} />
          </View>

          <SectionHeader title="Company" />
          <View
            style={[
              styles.companyCard,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
            <Image
              source={require("../../assets/images/icon.png")}
              resizeMode="contain"
              accessibilityLabel="JP Infracon logo"
              style={styles.companyLogo}
            />
            <View style={styles.companyCopy}>
              <Text style={[styles.companyName, { color: colors.foreground }]}>JP Infracon</Text>
              <Text style={[styles.companyDetail, { color: colors.muted }]}>
                Jeetendra Kumar Panda · Managing Partner
              </Text>
              <Text style={[styles.companyDetail, { color: colors.muted }]}>
                Rambabu Kumar Singh · Partner
              </Text>
              <Pressable
                accessibilityRole="link"
                onPress={() => {
                  void Linking.openURL("https://www.jpinfracon.com/");
                }}
              >
                <Text style={[styles.companyLink, { color: colors.primary }]}>
                  Official website · jpinfracon.com
                </Text>
              </Pressable>
            </View>
          </View>

          <SectionHeader title="Current access boundary" />
          <View
            style={[
              styles.permissionCard,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
            <View style={styles.permissionRow}>
              <View style={[styles.permissionIcon, { backgroundColor: `${colors.primary}15` }]}>
                <MaterialIcons name="lock-outline" size={18} color={colors.primary} />
              </View>
              <View style={styles.permissionCopy}>
                <Text style={[styles.permissionTitle, { color: colors.foreground }]}>
                  Server checks each record request
                </Text>
                <Text style={[styles.permissionDetail, { color: colors.muted }]}>
                  Business role, active account, organisation membership, site assignment, and
                  action permission are resolved by the API.
                </Text>
              </View>
            </View>
            <View style={[styles.permissionDivider, { backgroundColor: colors.border }]} />
            <View style={styles.permissionRow}>
              <View style={[styles.permissionIcon, { backgroundColor: `${colors.warning}15` }]}>
                <MaterialIcons name="info-outline" size={18} color={colors.warning} />
              </View>
              <View style={styles.permissionCopy}>
                <Text style={[styles.permissionTitle, { color: colors.foreground }]}>
                  Incomplete feature boundary
                </Text>
                <Text style={[styles.permissionDetail, { color: colors.muted }]}>
                  Inventory covers a base-unit catalogue and reviewed movements; transfers, counts,
                  procurement and full ledger export remain open. Finance includes supplier/invoice
                  review and internal supplier-payment allocations; it records user-entered payment
                  details but does not execute or verify a bank transfer. Petty cash,
                  reimbursements, full payable balances, secure evidence download and configured
                  amount limits remain open.
                </Text>
              </View>
            </View>
          </View>

          <SectionHeader
            title="Local sync queue"
            action="Refresh"
            onPress={() => {
              void refreshQueue();
            }}
          />
          {queue.length === 0 ? (
            <EmptyState
              icon="cloud-done"
              title="No locally queued records"
              detail="A locally saved draft will remain on this device until the server confirms sync. Sync retries are available from its report/request screen."
            />
          ) : (
            <View
              style={[
                styles.queueCard,
                { backgroundColor: colors.surface, borderColor: colors.border },
              ]}
            >
              {queue.map((item, index) => (
                <View
                  key={item.id}
                  style={[
                    styles.queueRow,
                    index > 0 && { borderTopWidth: 1, borderTopColor: colors.border },
                  ]}
                >
                  <View
                    style={[
                      styles.queueDot,
                      {
                        backgroundColor: item.status === "Synced" ? colors.success : colors.warning,
                      },
                    ]}
                  />
                  <View style={styles.queueCopy}>
                    <Text style={[styles.queueLabel, { color: colors.foreground }]}>
                      {item.label}
                    </Text>
                    <Text style={[styles.queueTime, { color: colors.muted }]}>
                      {item.updatedAt}
                    </Text>
                  </View>
                  <Text
                    style={[
                      styles.queueStatus,
                      { color: item.status === "Synced" ? colors.success : colors.warning },
                    ]}
                  >
                    {item.status}
                  </Text>
                </View>
              ))}
            </View>
          )}

          <SectionHeader title="Record and help" />
          <View style={[styles.linkStack, { borderTopColor: colors.border }]}>
            {canOpenAudit ? (
              <LinkRow
                icon="history"
                title="Audit activity"
                detail="Site-scoped events with actor and time"
                onPress={() => router.push("/audit" as never)}
              />
            ) : null}
            {canOpenSchedule ? (
              <LinkRow
                icon="event-note"
                title="Schedule & tasks"
                detail="Assigned-site task plans and reviewed revisions"
                onPress={() => router.push("/schedule" as never)}
              />
            ) : null}
            {canOpenWorkforce ? (
              <LinkRow
                icon="groups"
                title="Workforce"
                detail="Site people, authorised review, and restricted rate history"
                onPress={() => router.push("/workforce" as never)}
              />
            ) : null}
            {canOpenInventory ? (
              <LinkRow
                icon="inventory"
                title="Inventory & stock"
                detail="Site ledger, server-derived balances, and movement review"
                onPress={() => router.push("/inventory" as never)}
              />
            ) : null}
            {canOpenFinance ? (
              <LinkRow
                icon="receipt-long"
                title="Suppliers & invoices"
                detail="Supplier directory, invoice review and internal payment-allocation records; no bank transfer"
                onPress={() => router.push("/finance" as never)}
              />
            ) : null}
            {canManageAccounts ? (
              <LinkRow
                icon="manage-accounts"
                title="User accounts"
                detail="Create individual logins and assign organization/site roles"
                onPress={() => router.push("/users" as never)}
              />
            ) : null}
            {canOpenReports ? (
              <LinkRow
                icon="description"
                title="DPR / DLR reports"
                detail="Drafts and review workflow"
                onPress={() => router.push("/(tabs)/reports" as never)}
              />
            ) : null}
            {canOpenRequests ? (
              <LinkRow
                icon="inventory-2"
                title="Material requests"
                detail="Submission and review status"
                onPress={() => router.push("/(tabs)/requests" as never)}
              />
            ) : null}
            <LinkRow
              icon="notifications-none"
              title="Notifications"
              detail="Inbox delivery is not enabled in this build"
              onPress={() => router.push("/notifications" as never)}
            />
          </View>
          <PrimaryButton
            icon="logout"
            label={signingOut ? "Signing out…" : "Sign out"}
            disabled={signingOut}
            onPress={() => {
              void signOut();
            }}
          />
          <Text style={[styles.version, { color: colors.muted }]}>
            JP Infracon · individual account sign-in · production readiness not claimed
          </Text>
        </ScrollView>
      </Screen>
    </AuthGate>
  );
}

function LinkRow({
  icon,
  title,
  detail,
  onPress,
}: {
  icon: keyof typeof MaterialIcons.glyphMap;
  title: string;
  detail: string;
  onPress: () => void;
}) {
  const colors = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.linkRow,
        { borderBottomColor: colors.border },
        pressed && { opacity: 0.72 },
      ]}
    >
      <View style={[styles.linkIcon, { backgroundColor: `${colors.primary}13` }]}>
        <MaterialIcons name={icon} size={18} color={colors.primary} />
      </View>
      <View style={styles.linkCopy}>
        <Text style={[styles.linkTitle, { color: colors.foreground }]}>{title}</Text>
        <Text style={[styles.linkDetail, { color: colors.muted }]}>{detail}</Text>
      </View>
      <MaterialIcons name="chevron-right" size={19} color={colors.muted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  content: { paddingBottom: 30 },
  profileCard: {
    borderWidth: 1,
    borderRadius: 18,
    padding: 15,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 24,
  },
  profileAvatar: {
    width: 48,
    height: 48,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  profileAvatarText: { fontSize: 15, fontWeight: "800" },
  profileCopy: { flex: 1 },
  profileName: { fontSize: 16, fontWeight: "800" },
  profileRole: { fontSize: 11, marginTop: 3 },
  profileScope: { fontSize: 10, fontWeight: "800", marginTop: 5 },
  companyCard: {
    borderWidth: 1,
    borderRadius: 18,
    padding: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 22,
  },
  companyLogo: { width: 58, height: 58 },
  companyCopy: { flex: 1 },
  companyName: { fontSize: 15, fontWeight: "900" },
  companyDetail: { fontSize: 10, lineHeight: 15, marginTop: 2 },
  companyLink: { fontSize: 10, fontWeight: "800", marginTop: 5 },
  permissionCard: { borderWidth: 1, borderRadius: 18, padding: 14, marginBottom: 22 },
  permissionRow: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  permissionIcon: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  permissionCopy: { flex: 1 },
  permissionTitle: { fontSize: 13, fontWeight: "800" },
  permissionDetail: { fontSize: 11, lineHeight: 17, marginTop: 3 },
  permissionDivider: { height: 1, marginVertical: 14 },
  queueCard: { borderWidth: 1, borderRadius: 18, paddingHorizontal: 14, marginBottom: 23 },
  queueRow: { flexDirection: "row", alignItems: "center", paddingVertical: 13, gap: 10 },
  queueDot: { width: 8, height: 8, borderRadius: 4 },
  queueCopy: { flex: 1 },
  queueLabel: { fontSize: 12, fontWeight: "700" },
  queueTime: { fontSize: 10, marginTop: 3 },
  queueStatus: { fontSize: 10, fontWeight: "800" },
  linkStack: { borderTopWidth: 1, marginBottom: 15 },
  linkRow: {
    minHeight: 67,
    borderBottomWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  linkIcon: {
    width: 34,
    height: 34,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
  },
  linkCopy: { flex: 1 },
  linkTitle: { fontSize: 13, fontWeight: "800" },
  linkDetail: { fontSize: 11, marginTop: 3 },
  notice: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
    flexDirection: "row",
    gap: 8,
    alignItems: "flex-start",
    marginBottom: 18,
  },
  noticeText: { fontSize: 11, lineHeight: 16, flex: 1 },
  version: { fontSize: 10, textAlign: "center", marginTop: 15 },
});
