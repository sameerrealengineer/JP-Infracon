import { useMemo, useState } from "react";
import {
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { MaterialIcons } from "@expo/vector-icons";
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
import { CompanySetupNeeded, useNeedsCompanySetup } from "@/components/jp/company-setup-needed";
import { useColors } from "@/hooks/use-colors";
import { resolveChoice, resolveSelectedId } from "@/lib/jp/selection";
import { trpc } from "@/lib/trpc";

type BusinessRole =
  | "admin"
  | "director"
  | "project_manager"
  | "supervisor"
  | "accounts"
  | "storekeeper"
  | "auditor";
type RevealedCredential = { username: string; temporaryPassword: string; note: string };
const roleOptions: {
  value: BusinessRole;
  label: string;
  detail: string;
  organizationWide: boolean;
}[] = [
  {
    value: "admin",
    label: "Contractor / Admin",
    detail: "Organization-wide business access",
    organizationWide: true,
  },
  {
    value: "director",
    label: "Director / Partner",
    detail: "Organization-wide business access",
    organizationWide: true,
  },
  {
    value: "project_manager",
    label: "Project Manager",
    detail: "Assigned active sites only",
    organizationWide: false,
  },
  {
    value: "supervisor",
    label: "Site Supervisor / Engineer",
    detail: "Assigned active sites only",
    organizationWide: false,
  },
  {
    value: "accounts",
    label: "Accounts",
    detail: "Assigned active sites only",
    organizationWide: false,
  },
  {
    value: "storekeeper",
    label: "Storekeeper",
    detail: "Assigned active sites only",
    organizationWide: false,
  },
  {
    value: "auditor",
    label: "Auditor",
    detail: "Assigned active sites only",
    organizationWide: false,
  },
];
const labels = Object.fromEntries(roleOptions.map((role) => [role.value, role.label])) as Record<
  BusinessRole,
  string
>;

export default function UserAccountsScreen() {
  const colors = useColors();
  const utils = trpc.useUtils();
  const me = trpc.auth.me.useQuery(undefined, { retry: false });
  const access = trpc.jp.workspace.onboardingState.useQuery();
  const options = trpc.jp.accounts.options.useQuery();
  const needsCompanySetup = useNeedsCompanySetup();
  const [chosenOrganizationId, setOrganizationId] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [username, setUsername] = useState("");
  const [chosenBusinessRole, setBusinessRole] = useState<BusinessRole>("supervisor");
  const [selectedSiteIds, setSelectedSiteIds] = useState<string[]>([]);
  const [revealed, setRevealed] = useState<RevealedCredential | null>(null);
  const [statusNote, setStatusNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const organizationId = resolveSelectedId(options.data ?? [], chosenOrganizationId);
  const accounts = trpc.jp.accounts.list.useQuery(
    { organizationId },
    { enabled: Boolean(organizationId), retry: false },
  );
  const create = trpc.jp.accounts.create.useMutation();
  const reset = trpc.jp.accounts.resetPassword.useMutation();
  const setStatus = trpc.jp.accounts.setStatus.useMutation();
  const selectedOrganization = useMemo(
    () => options.data?.find((item) => item.id === organizationId) ?? null,
    [options.data, organizationId],
  );
  const roleOptionsForOrganization = useMemo(
    () => roleOptions.filter((role) => selectedOrganization?.assignableRoles.includes(role.value)),
    [selectedOrganization],
  );
  const businessRole = resolveChoice(
    roleOptionsForOrganization.map((role) => role.value),
    chosenBusinessRole,
  );
  const roleConfig = roleOptions.find((role) => role.value === businessRole)!;

  const toggleSite = (siteId: string) =>
    setSelectedSiteIds((current) =>
      current.includes(siteId) ? current.filter((id) => id !== siteId) : [...current, siteId],
    );
  const clearForm = () => {
    setDisplayName("");
    setUsername("");
    setSelectedSiteIds([]);
    setBusinessRole(roleOptionsForOrganization[0]?.value ?? "supervisor");
  };
  const refreshAccounts = async () => {
    if (organizationId) await utils.jp.accounts.list.invalidate({ organizationId });
  };

  const createAccount = async () => {
    if (
      !organizationId ||
      !roleConfig ||
      !roleOptionsForOrganization.some((role) => role.value === businessRole)
    )
      return;
    setError(null);
    setStatusNote(null);
    setRevealed(null);
    try {
      const result = await create.mutateAsync({
        organizationId,
        displayName,
        username,
        businessRole,
        siteIds: roleConfig.organizationWide ? [] : selectedSiteIds,
      });
      setRevealed({
        username: result.username,
        temporaryPassword: result.temporaryPassword,
        note: "Show this generated password to the named person using a secure channel. It is shown only once. The account cannot open protected features until they replace it.",
      });
      setStatusNote(
        "Account created. Role, organization and site assignments were saved to the server.",
      );
      clearForm();
      await refreshAccounts();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Account could not be created.");
    }
  };

  const runReset = async (account: {
    id: number;
    username: string | null;
    name: string | null;
  }) => {
    if (!organizationId || !me.data?.platformOwner) return;
    const action = async () => {
      setError(null);
      setStatusNote(null);
      setRevealed(null);
      try {
        const result = await reset.mutateAsync({ organizationId, userId: account.id });
        setRevealed({
          username: account.username ?? "(username unavailable)",
          temporaryPassword: result.temporaryPassword,
          note: `Temporary password for ${account.name || "this account"}. It is shown only once; the user must change it before continuing.`,
        });
        setStatusNote("Password reset. Existing sessions were revoked.");
        await refreshAccounts();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Password reset failed.");
      }
    };
    if (Platform.OS === "web") {
      if (
        window.confirm(
          `Reset password for ${account.name || account.username || "this user"}? Existing sessions will be revoked.`,
        )
      )
        await action();
    } else
      Alert.alert(
        "Reset account password?",
        "The old password will stop working and all existing sessions will be revoked.",
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Reset password",
            style: "destructive",
            onPress: () => {
              void action();
            },
          },
        ],
      );
  };

  const runStatus = async (account: {
    id: number;
    membershipStatus: string;
    name: string | null;
  }) => {
    if (!organizationId) return;
    const nextStatus = account.membershipStatus === "Active" ? "Deactivated" : "Active";
    const action = async () => {
      setError(null);
      setStatusNote(null);
      setRevealed(null);
      try {
        await setStatus.mutateAsync({ organizationId, userId: account.id, status: nextStatus });
        setStatusNote(
          nextStatus === "Active"
            ? "Organization access restored. Other organization access remains unchanged."
            : "Access to this organization was removed. The person's login and other organization access remain unchanged.",
        );
        await refreshAccounts();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Account status could not be changed.");
      }
    };
    if (Platform.OS === "web") {
      if (
        window.confirm(
          `${nextStatus === "Active" ? "Restore" : "Remove"} ${account.name || "this person's"} access to this organization? Their login and other organization memberships will not change.`,
        )
      )
        await action();
    } else
      Alert.alert(
        `${nextStatus === "Active" ? "Restore" : "Remove"} organization access?`,
        "This changes membership in this organization only. The person's global login and other organization memberships remain unchanged.",
        [
          { text: "Cancel", style: "cancel" },
          {
            text: nextStatus === "Active" ? "Restore access" : "Remove access",
            style: nextStatus === "Active" ? "default" : "destructive",
            onPress: () => {
              void action();
            },
          },
        ],
      );
  };

  const initials = (value?: string | null) =>
    (value || "JP")
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("");
  const hasAccess =
    Boolean(me.data?.platformOwner) ||
    ["owner", "director", "admin"].includes(access.data?.businessRole || "");

  return (
    <AuthGate>
      <Screen>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
          <AppHeader
            eyebrow="Administration"
            title="Team accounts"
            subtitle="Create individual logins and control who can work on which site."
            userInitials={initials(me.data?.name)}
          />
          <OfflineBanner
            pendingCount={0}
            connected={me.isSuccess && options.isSuccess}
            lastSyncedAt={
              options.dataUpdatedAt
                ? new Intl.DateTimeFormat(undefined, {
                    dateStyle: "medium",
                    timeStyle: "short",
                  }).format(new Date(options.dataUpdatedAt))
                : null
            }
            onRetry={() => {
              void Promise.all([
                me.refetch(),
                options.refetch(),
                organizationId ? accounts.refetch() : Promise.resolve(),
              ]);
            }}
          />
          {!hasAccess ? (
            <EmptyState
              icon="lock-outline"
              title="Account manager access required"
              detail="Only Super Admin or an authorized organization owner, Director/Partner or Contractor/Admin can manage accounts."
            />
          ) : (
            <>
              {options.isError ? (
                <InlineError
                  message={options.error.message}
                  onRetry={() => {
                    void options.refetch();
                  }}
                />
              ) : null}
              {options.isLoading ? (
                <Text style={[styles.muted, { color: colors.muted }]}>
                  Loading manageable organizations…
                </Text>
              ) : null}
              {!options.isLoading && options.data?.length === 0 && needsCompanySetup ? (
                <CompanySetupNeeded />
              ) : null}
              {!options.isLoading && options.data?.length === 0 && !needsCompanySetup ? (
                <EmptyState
                  icon="domain-disabled"
                  title="No manageable organization"
                  detail="Create an organization first or ask an authorized organization Director/Admin to grant access."
                />
              ) : null}
              {options.data && options.data.length > 1 ? (
                <>
                  <SectionHeader title="Organization" />
                  <View style={styles.choiceWrap}>
                    {options.data.map((item) => (
                      <Pressable
                        key={item.id}
                        accessibilityRole="button"
                        onPress={() => {
                          setOrganizationId(item.id);
                          setRevealed(null);
                          setSelectedSiteIds([]);
                        }}
                        style={[
                          styles.choiceChip,
                          {
                            borderColor:
                              item.id === organizationId ? colors.primary : colors.border,
                            backgroundColor:
                              item.id === organizationId ? `${colors.primary}12` : colors.surface,
                          },
                        ]}
                      >
                        <Text
                          style={[
                            styles.choiceText,
                            {
                              color:
                                item.id === organizationId ? colors.primary : colors.foreground,
                            },
                          ]}
                        >
                          {item.name}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                </>
              ) : null}
              {selectedOrganization ? (
                <>
                  <SectionHeader title="New individual account" />
                  <Text style={[styles.orgCaption, { color: colors.muted }]}>
                    {selectedOrganization.name} · {selectedOrganization.code}
                  </Text>
                  <TextInput
                    accessibilityLabel="Account holder name"
                    value={displayName}
                    onChangeText={setDisplayName}
                    placeholder="Person’s full name"
                    placeholderTextColor={colors.muted}
                    autoCapitalize="words"
                    style={[
                      styles.input,
                      {
                        color: colors.foreground,
                        backgroundColor: colors.surface,
                        borderColor: colors.border,
                      },
                    ]}
                  />
                  <TextInput
                    accessibilityLabel="Unique username"
                    value={username}
                    onChangeText={setUsername}
                    placeholder="Unique username (letters, numbers, . _ -)"
                    placeholderTextColor={colors.muted}
                    autoCapitalize="none"
                    autoCorrect={false}
                    style={[
                      styles.input,
                      {
                        color: colors.foreground,
                        backgroundColor: colors.surface,
                        borderColor: colors.border,
                      },
                    ]}
                  />
                  <Text style={[styles.fieldLabel, { color: colors.foreground }]}>
                    Business role
                  </Text>
                  <View style={styles.roleStack}>
                    {roleOptionsForOrganization.map((role) => (
                      <Pressable
                        key={role.value}
                        accessibilityRole="radio"
                        accessibilityState={{ selected: businessRole === role.value }}
                        onPress={() => {
                          setBusinessRole(role.value);
                          setSelectedSiteIds([]);
                        }}
                        style={[
                          styles.roleChoice,
                          {
                            borderColor:
                              businessRole === role.value ? colors.primary : colors.border,
                            backgroundColor:
                              businessRole === role.value ? `${colors.primary}10` : colors.surface,
                          },
                        ]}
                      >
                        <View style={styles.roleCopy}>
                          <Text style={[styles.roleLabel, { color: colors.foreground }]}>
                            {role.label}
                          </Text>
                          <Text style={[styles.roleDetail, { color: colors.muted }]}>
                            {role.detail}
                          </Text>
                        </View>
                        <MaterialIcons
                          name={
                            businessRole === role.value
                              ? "radio-button-checked"
                              : "radio-button-unchecked"
                          }
                          size={19}
                          color={businessRole === role.value ? colors.primary : colors.muted}
                        />
                      </Pressable>
                    ))}
                  </View>
                  {!roleConfig.organizationWide ? (
                    <>
                      <SectionHeader title="Assigned sites" />
                      {selectedOrganization.sites.length === 0 ? (
                        <Text style={[styles.muted, { color: colors.muted }]}>
                          No active sites in this organization. Create/activate a site before
                          assigning a site-scoped account.
                        </Text>
                      ) : (
                        <View
                          style={[
                            styles.siteCard,
                            { backgroundColor: colors.surface, borderColor: colors.border },
                          ]}
                        >
                          {selectedOrganization.sites.map((site, index) => {
                            const selected = selectedSiteIds.includes(site.id);
                            return (
                              <Pressable
                                key={site.id}
                                accessibilityRole="checkbox"
                                accessibilityState={{ checked: selected }}
                                onPress={() => toggleSite(site.id)}
                                style={[
                                  styles.siteOption,
                                  index > 0 && { borderTopColor: colors.border, borderTopWidth: 1 },
                                ]}
                              >
                                <View style={styles.siteCopy}>
                                  <Text style={[styles.siteName, { color: colors.foreground }]}>
                                    {site.name}
                                  </Text>
                                  <Text style={[styles.roleDetail, { color: colors.muted }]}>
                                    {site.code} · {site.projectName}
                                  </Text>
                                </View>
                                <MaterialIcons
                                  name={selected ? "check-box" : "check-box-outline-blank"}
                                  size={20}
                                  color={selected ? colors.primary : colors.muted}
                                />
                              </Pressable>
                            );
                          })}
                        </View>
                      )}
                    </>
                  ) : (
                    <View
                      style={[
                        styles.scopeNote,
                        {
                          backgroundColor: `${colors.primary}10`,
                          borderColor: `${colors.primary}30`,
                        },
                      ]}
                    >
                      <MaterialIcons name="public" size={17} color={colors.primary} />
                      <Text style={[styles.scopeNoteText, { color: colors.foreground }]}>
                        This organization role can access this organization’s business data
                        according to its server-defined role permissions.
                      </Text>
                    </View>
                  )}
                  {error ? <InlineError message={error} onRetry={() => setError(null)} /> : null}
                  {statusNote ? (
                    <Text
                      accessibilityRole="alert"
                      style={[styles.success, { color: colors.success }]}
                    >
                      {statusNote}
                    </Text>
                  ) : null}
                  {revealed ? (
                    <View
                      accessibilityLiveRegion="polite"
                      style={[
                        styles.credentialCard,
                        { backgroundColor: colors.surface, borderColor: colors.warning },
                      ]}
                    >
                      <Text style={[styles.credentialTitle, { color: colors.foreground }]}>
                        One-time credential handoff
                      </Text>
                      <Text style={[styles.credentialDetail, { color: colors.muted }]}>
                        {revealed.note}
                      </Text>
                      <Text
                        selectable
                        style={[styles.credentialValue, { color: colors.foreground }]}
                      >
                        Username: {revealed.username}
                      </Text>
                      <Text
                        selectable
                        style={[styles.credentialValue, { color: colors.foreground }]}
                      >
                        Temporary password: {revealed.temporaryPassword}
                      </Text>
                    </View>
                  ) : null}
                  <PrimaryButton
                    icon="person-add-alt-1"
                    label={
                      create.isPending
                        ? "Creating account…"
                        : "Create account and generate temporary password"
                    }
                    disabled={
                      create.isPending ||
                      !roleOptionsForOrganization.some((role) => role.value === businessRole) ||
                      !displayName.trim() ||
                      !username.trim() ||
                      (!roleConfig.organizationWide && selectedSiteIds.length === 0)
                    }
                    onPress={() => {
                      void createAccount();
                    }}
                  />
                </>
              ) : null}
              {selectedOrganization ? (
                <>
                  <SectionHeader
                    title="Current organization accounts"
                    action="Refresh"
                    onPress={() => {
                      void accounts.refetch();
                    }}
                  />
                  {accounts.isError ? (
                    <InlineError
                      message={accounts.error.message}
                      onRetry={() => {
                        void accounts.refetch();
                      }}
                    />
                  ) : accounts.isLoading ? (
                    <Text style={[styles.muted, { color: colors.muted }]}>Loading accounts…</Text>
                  ) : accounts.data?.length ? (
                    <View
                      style={[
                        styles.listCard,
                        { backgroundColor: colors.surface, borderColor: colors.border },
                      ]}
                    >
                      {accounts.data.map((account, index) => (
                        <View
                          key={`${account.id}-${account.businessRole}`}
                          style={[
                            styles.accountRow,
                            index > 0 && { borderTopColor: colors.border, borderTopWidth: 1 },
                          ]}
                        >
                          <View style={styles.accountCopy}>
                            <Text style={[styles.accountName, { color: colors.foreground }]}>
                              {account.name || "Unnamed account"}
                            </Text>
                            <Text style={[styles.accountInfo, { color: colors.primary }]}>
                              {labels[account.businessRole as BusinessRole] || account.businessRole}{" "}
                              · {account.username ? `@${account.username}` : "no local username"}
                            </Text>
                            <Text style={[styles.accountInfo, { color: colors.muted }]}>
                              {account.membershipStatus} organization access
                              {account.assignedSites.length
                                ? ` · ${account.assignedSites.map((site) => site.siteName).join(", ")}`
                                : " · organization scope"}
                              {account.accountStatus !== "Active"
                                ? ` · login ${account.accountStatus.toLowerCase()}`
                                : ""}
                            </Text>
                          </View>
                          {account.username ? (
                            <View style={styles.actions}>
                              {me.data?.platformOwner ? (
                                <Pressable
                                  accessibilityRole="button"
                                  accessibilityLabel={`Reset password for ${account.name || account.username}`}
                                  onPress={() => {
                                    void runReset(account);
                                  }}
                                  style={[styles.iconAction, { borderColor: colors.border }]}
                                >
                                  <MaterialIcons name="key" size={17} color={colors.primary} />
                                </Pressable>
                              ) : null}
                              <Pressable
                                accessibilityRole="button"
                                accessibilityLabel={`${account.membershipStatus === "Active" ? "Remove organization access for" : "Restore organization access for"} ${account.name || "account"}`}
                                onPress={() => {
                                  void runStatus(account);
                                }}
                                style={[styles.iconAction, { borderColor: colors.border }]}
                              >
                                <MaterialIcons
                                  name={
                                    account.membershipStatus === "Active"
                                      ? "person-off"
                                      : "person-add-alt-1"
                                  }
                                  size={17}
                                  color={
                                    account.membershipStatus === "Active"
                                      ? colors.error
                                      : colors.success
                                  }
                                />
                              </Pressable>
                            </View>
                          ) : (
                            <Text style={[styles.accountInfo, { color: colors.muted }]}>
                              Provision a new credentialed account instead
                            </Text>
                          )}
                        </View>
                      ))}
                    </View>
                  ) : (
                    <EmptyState
                      icon="people-outline"
                      title="No organization memberships"
                      detail="Account administration will show persisted people after they are created and assigned."
                    />
                  )}
                </>
              ) : null}
              <View
                style={[
                  styles.boundary,
                  { backgroundColor: colors.surface, borderColor: colors.border },
                ]}
              >
                <MaterialIcons name="security" size={17} color={colors.primary} />
                <Text style={[styles.boundaryText, { color: colors.muted }]}>
                  Usernames are unique across the application. Passwords are never displayed except
                  for a newly generated one-time temporary password; only salted hashes are stored.
                  Account changes are audited. No shared or universal credentials are provisioned.
                </Text>
              </View>
            </>
          )}
        </ScrollView>
      </Screen>
    </AuthGate>
  );
}

const styles = StyleSheet.create({
  content: { paddingBottom: 34 },
  orgCaption: { fontSize: 11, marginTop: -7, marginBottom: 9 },
  input: {
    minHeight: 48,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 13,
    marginBottom: 9,
    fontSize: 14,
  },
  fieldLabel: { fontSize: 12, fontWeight: "800", marginTop: 7, marginBottom: 8 },
  roleStack: { gap: 7, marginBottom: 11 },
  roleChoice: {
    minHeight: 54,
    borderWidth: 1,
    borderRadius: 13,
    paddingHorizontal: 12,
    paddingVertical: 9,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  roleCopy: { flex: 1 },
  roleLabel: { fontSize: 12, fontWeight: "800" },
  roleDetail: { fontSize: 10, lineHeight: 15, marginTop: 2 },
  scopeNote: {
    flexDirection: "row",
    gap: 8,
    padding: 11,
    borderWidth: 1,
    borderRadius: 12,
    marginBottom: 12,
  },
  scopeNoteText: { flex: 1, fontSize: 11, lineHeight: 16 },
  siteCard: { borderWidth: 1, borderRadius: 13, paddingHorizontal: 12, marginBottom: 12 },
  siteOption: { minHeight: 53, flexDirection: "row", alignItems: "center", gap: 9 },
  siteCopy: { flex: 1, paddingVertical: 8 },
  siteName: { fontSize: 12, fontWeight: "800" },
  choiceWrap: { flexDirection: "row", flexWrap: "wrap", gap: 7, marginBottom: 14 },
  choiceChip: {
    minHeight: 36,
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 12,
    justifyContent: "center",
  },
  choiceText: { fontSize: 11, fontWeight: "800" },
  listCard: { borderWidth: 1, borderRadius: 15, paddingHorizontal: 12, marginBottom: 15 },
  accountRow: {
    minHeight: 72,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 10,
  },
  accountCopy: { flex: 1 },
  accountName: { fontSize: 13, fontWeight: "800" },
  accountInfo: { fontSize: 10, lineHeight: 15, marginTop: 2 },
  actions: { flexDirection: "row", gap: 6 },
  iconAction: {
    width: 36,
    height: 36,
    borderWidth: 1,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
  },
  credentialCard: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
    marginTop: 13,
    marginBottom: 13,
  },
  credentialTitle: { fontSize: 13, fontWeight: "900" },
  credentialDetail: { fontSize: 11, lineHeight: 16, marginTop: 4, marginBottom: 8 },
  credentialValue: { fontFamily: "monospace", fontSize: 12, fontWeight: "800", lineHeight: 20 },
  success: { fontSize: 11, fontWeight: "700", marginTop: 8 },
  muted: { fontSize: 12, lineHeight: 18, marginVertical: 6 },
  boundary: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    padding: 11,
    borderWidth: 1,
    borderRadius: 12,
    marginTop: 20,
  },
  boundaryText: { flex: 1, fontSize: 10, lineHeight: 15 },
});
