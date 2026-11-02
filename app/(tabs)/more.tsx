import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useQueryClient } from "@tanstack/react-query";
import Constants from "expo-constants";
import { useRouter } from "expo-router";
import { useState } from "react";
import { Image, Linking, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { AuthGate } from "@/components/jp/auth-gate";
import {
  AppHeader,
  Card,
  ChipGroup,
  Divider,
  HeroCard,
  ListRow,
  ModuleTile,
  OfflineBanner,
  PrimaryButton,
  Screen,
  SectionHeader,
  StatusPill,
  formatDateTime,
  initialsOf,
  type IconName,
  type Tone,
} from "@/components/jp/ui";
import { useAuth } from "@/hooks/use-auth";
import { useColors } from "@/hooks/use-colors";
import { useConnectivity, useSyncQueue } from "@/hooks/use-connectivity";
import { useWorkspace } from "@/hooks/use-workspace";
import { prettyRole } from "@/lib/jp/site-admin-policy";
import { useThemeContext } from "@/lib/theme-provider";
import { trpc } from "@/lib/trpc";
import { languageNames, useT } from "@/lib/i18n";

export default function MoreScreen() {
  const colors = useColors();
  const { t, language, setLanguage } = useT();
  const router = useRouter();
  const queryClient = useQueryClient();
  const auth = useAuth({ autoFetch: false });
  const workspace = useWorkspace();
  const { colorScheme, setColorScheme } = useThemeContext();
  const { online } = useConnectivity();
  const { queue, pending, refresh } = useSyncQueue();
  const sites = trpc.jp.workspace.mySites.useQuery();
  const [signingOut, setSigningOut] = useState(false);
  const { can, me } = workspace;

  const modules: {
    icon: IconName;
    title: string;
    detail: string;
    tone: Tone;
    route: string;
    show: boolean;
  }[] = [
    {
      icon: "health-and-safety",
      title: "Safety & quality",
      detail: "Hazards, defects, blockers",
      tone: "error",
      route: "/issues",
      show: can("issue.view"),
    },
    {
      icon: "how-to-reg",
      title: "Attendance",
      detail: "Daily roll call & labour cost",
      tone: "success",
      route: "/attendance",
      show: can("attendance.view"),
    },
    {
      icon: "event-note",
      title: "Schedule",
      detail: "Tasks, dependencies, revisions",
      tone: "info",
      route: "/schedule",
      show: can("task.view"),
    },
    {
      icon: "groups",
      title: "Workforce",
      detail: "Workers, KYC, rates",
      tone: "info",
      route: "/workforce",
      show: can("workforce.view"),
    },
    {
      icon: "inventory",
      title: "Inventory",
      detail: "Catalogue & stock ledger",
      tone: "success",
      route: "/inventory",
      show: can("inventory.view"),
    },
    {
      icon: "receipt-long",
      title: "Finance",
      detail: "Invoices, payments, petty cash",
      tone: "accent",
      route: "/finance",
      show: can("finance.invoice.view", "finance.cash.view"),
    },
    {
      icon: "add-business",
      title: "Projects & sites",
      detail: "Create, edit, status, team",
      tone: "success",
      route: "/projects",
      show: workspace.canManageSites,
    },
    {
      icon: "manage-accounts",
      title: "Team accounts",
      detail: "Logins, roles, site access",
      tone: "info",
      route: "/users",
      show: workspace.canManageAccounts,
    },
    {
      icon: "file-download",
      title: "Export data",
      detail: "CSV for Excel / Sheets",
      tone: "accent",
      route: "/exports",
      show: can(
        "dpr.view",
        "material.request.view",
        "inventory.view",
        "task.view",
        "issue.view",
        "finance.invoice.view",
        "finance.cash.view",
        "audit.view",
      ),
    },
    {
      icon: "history",
      title: "Audit trail",
      detail: "Who changed what, and why",
      tone: "info",
      route: "/audit",
      show: can("audit.view"),
    },
    {
      icon: "notifications-none",
      title: "Notifications",
      detail: "Work waiting on you",
      tone: "accent",
      route: "/notifications",
      show: true,
    },
  ];

  const signOut = async () => {
    setSigningOut(true);
    try {
      await auth.logout();
      // Remove every cached record so the next person on this phone sees nothing of yours.
      queryClient.clear();
      router.replace("/" as never);
    } finally {
      setSigningOut(false);
    }
  };

  const version = Constants.expoConfig?.version ?? "1.0";

  return (
    <AuthGate>
      <Screen>
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 36 }}
        >
          <AppHeader eyebrow="Workspace" title={t("More")} />
          <OfflineBanner
            pendingCount={pending.length}
            connected={online === false ? false : sites.isSuccess ? true : online}
            lastSyncedAt={sites.dataUpdatedAt ? formatDateTime(sites.dataUpdatedAt) : null}
          />

          <HeroCard>
            <View style={styles.profile}>
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>{initialsOf(me.data?.name)}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.name}>{me.data?.name ?? "Signed-in user"}</Text>
                <Text style={styles.role}>{prettyRole(workspace.role)}</Text>
                <Text style={styles.scope}>
                  {sites.data
                    ? `${sites.data.length} site${sites.data.length === 1 ? "" : "s"} in your access`
                    : "Loading access…"}
                  {me.data?.lastSignedIn
                    ? ` · signed in ${formatDateTime(me.data.lastSignedIn)}`
                    : ""}
                </Text>
              </View>
            </View>
          </HeroCard>

          <SectionHeader title={t("Modules")} caption={t("Only what your role allows")} />
          <View style={styles.grid}>
            {modules
              .filter((module) => module.show)
              .map((module) => (
                <ModuleTile
                  key={module.title}
                  icon={module.icon}
                  title={t(module.title)}
                  detail={t(module.detail)}
                  tone={module.tone}
                  onPress={() => router.push(module.route as never)}
                />
              ))}
          </View>

          <SectionHeader title={t("Appearance")} />
          <Card style={{ marginBottom: 22 }}>
            <View style={{ flex: 1 }}>
              <ChipGroup
                options={["light", "dark"] as const}
                value={colorScheme}
                onChange={setColorScheme}
                format={(value) => (value === "light" ? "Ivory (light)" : "Midnight (dark)")}
              />
              <ChipGroup
                label={t("Language")}
                options={["en", "hi", "or"] as const}
                value={language}
                onChange={setLanguage}
                format={(value) => languageNames[value]}
              />
            </View>
          </Card>

          <SectionHeader
            title={t("Offline drafts")}
            caption="Saved on this phone until the server confirms them"
            action="Refresh"
            onPress={() => void refresh()}
          />
          <Card style={{ paddingVertical: 4, marginBottom: 22 }}>
            {queue.length === 0 ? (
              <ListRow
                icon="cloud-done"
                tone="success"
                title={t("Everything is synced")}
                detail="No drafts are waiting on this device."
              />
            ) : (
              queue.map((item, index) => (
                <View key={item.id}>
                  {index > 0 ? <Divider /> : null}
                  <ListRow
                    icon={item.status === "Synced" ? "cloud-done" : "cloud-upload"}
                    tone={item.status === "Synced" ? "success" : "warning"}
                    title={item.label}
                    detail={item.updatedAt}
                    trailing={
                      <StatusPill
                        label={item.status}
                        tone={item.status === "Synced" ? "success" : "warning"}
                        compact
                      />
                    }
                  />
                </View>
              ))
            )}
          </Card>

          <SectionHeader title={t("Company")} />
          <Card style={{ marginBottom: 22 }}>
            <View style={styles.company}>
              <Image
                source={require("../../assets/images/icon.png")}
                style={styles.logo}
                accessibilityLabel="JP Infracon logo"
              />
              <View style={{ flex: 1 }}>
                <Text style={[styles.companyName, { color: colors.foreground }]}>JP Infracon</Text>
                <Text style={[styles.companyDetail, { color: colors.muted }]}>
                  Jeetendra Kumar Panda · Managing Partner
                </Text>
                <Text style={[styles.companyDetail, { color: colors.muted }]}>
                  Rambabu Kumar Singh · Partner
                </Text>
                <Pressable
                  accessibilityRole="link"
                  onPress={() => void Linking.openURL("https://www.jpinfracon.com/")}
                >
                  <Text style={[styles.link, { color: colors.primary }]}>jpinfracon.com</Text>
                </Pressable>
              </View>
            </View>
          </Card>

          <Card style={{ marginBottom: 20 }}>
            <View style={styles.security}>
              <MaterialIcons name="verified-user" size={20} color={colors.success} />
              <Text style={[styles.securityText, { color: colors.muted }]}>
                Your role and site assignments are checked by the server on every request. Payments
                recorded here are internal ledger entries, not bank transfers.
              </Text>
            </View>
          </Card>

          <PrimaryButton
            icon="logout"
            label={signingOut ? t("Signing out…") : t("Sign out")}
            tone="danger"
            loading={signingOut}
            onPress={() => void signOut()}
          />
          <Text style={[styles.version, { color: colors.muted }]}>
            JP Infracon · version {version}
          </Text>
        </ScrollView>
      </Screen>
    </AuthGate>
  );
}

const styles = StyleSheet.create({
  profile: { flexDirection: "row", alignItems: "center", gap: 14, marginTop: 6 },
  avatar: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: "#D9B76A",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { color: "#0E1A26", fontSize: 19, fontWeight: "900" },
  name: { color: "#FFFFFF", fontSize: 19, fontWeight: "800" },
  role: { color: "#E6C987", fontSize: 12, fontWeight: "800", marginTop: 3 },
  scope: { color: "rgba(246,241,230,0.72)", fontSize: 11, marginTop: 4, lineHeight: 16 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginBottom: 22 },
  company: { flexDirection: "row", alignItems: "center", gap: 12 },
  logo: { width: 56, height: 56, borderRadius: 14 },
  companyName: { fontSize: 16, fontWeight: "900" },
  companyDetail: { fontSize: 12, marginTop: 2 },
  link: { fontSize: 12, fontWeight: "800", marginTop: 5 },
  security: { flexDirection: "row", gap: 10, alignItems: "flex-start" },
  securityText: { flex: 1, fontSize: 12, lineHeight: 18 },
  version: { fontSize: 11, textAlign: "center", marginTop: 14 },
});
