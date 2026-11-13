import { useRouter } from "expo-router";
import { HelpButton } from "@/components/jp/help";
import { useMemo, useState, type ComponentProps } from "react";
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
  ChipGroup,
  EmptyState,
  Field,
  InlineError,
  OfflineBanner,
  PrimaryButton,
  Screen,
  SecondaryButton,
  SectionHeader,
  Sheet,
  StatusPill,
} from "@/components/jp/ui";
import { Avatar } from "@/components/jp/avatar";
import { AuthGate } from "@/components/jp/auth-gate";
import { CompanySetupNeeded, useNeedsCompanySetup } from "@/components/jp/company-setup-needed";
import { useColors } from "@/hooks/use-colors";
import { useT } from "@/lib/i18n";
import { ROLE_LABELS, companyWideRoles } from "@/lib/jp/account-role-policy";
import { resolveChoice, resolveSelectedId } from "@/lib/jp/selection";
import { trpc } from "@/lib/trpc";

type BusinessRole =
  | "admin"
  | "director"
  | "project_manager"
  | "site_engineer"
  | "supervisor"
  | "accounts"
  | "storekeeper"
  | "auditor";
type RevealedCredential = { username: string; temporaryPassword: string; note: string };
type Account = {
  id: number;
  name: string | null;
  username: string | null;
  businessRole: string;
  membershipStatus: string;
  accountStatus: string;
  manageable: boolean;
  assignedSites: { siteId: string; siteName: string }[];
};

const ROLE_DETAIL: Record<BusinessRole, string> = {
  director: "Whole company: every site, money and approvals",
  admin: "Whole company: users, sites, purchase, payroll",
  project_manager: "Their projects' sites: plans, approvals, team",
  site_engineer: "Their sites: work, reports, measurements, team",
  supervisor: "Their site: daily work, attendance, materials",
  accounts: "Their sites: bills, payments, payroll",
  storekeeper: "Their sites: stock in and out",
  auditor: "Their sites: read only, audit history",
};
const ROLE_ORDER: BusinessRole[] = [
  "director",
  "admin",
  "project_manager",
  "site_engineer",
  "supervisor",
  "accounts",
  "storekeeper",
  "auditor",
];
const isCompanyWide = (role: string) => companyWideRoles.includes(role as BusinessRole);

/** Asks yes/no on phone and web. */
function confirm(title: string, message: string, yes: string, run: () => void) {
  if (Platform.OS === "web") {
    if (window.confirm(`${title}\n\n${message}`)) run();
    return;
  }
  Alert.alert(title, message, [
    { text: "Cancel", style: "cancel" },
    { text: yes, style: "destructive", onPress: run },
  ]);
}

export default function UserAccountsScreen() {
  const { t } = useT();
  const teamPhotos = trpc.jp.profile.team.useQuery(undefined, { staleTime: 5 * 60_000 });
  const photoOf = (userId: number) =>
    teamPhotos.data?.find((row) => row.userId === userId)?.photoUrl ?? null;
  const colors = useColors();
  const utils = trpc.useUtils();
  const me = trpc.auth.me.useQuery(undefined, { retry: false });
  const router = useRouter();
  const options = trpc.jp.accounts.options.useQuery(undefined, { retry: false });
  const needsCompanySetup = useNeedsCompanySetup();
  const [chosenOrganizationId, setOrganizationId] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [username, setUsername] = useState("");
  const [chosenBusinessRole, setBusinessRole] = useState<BusinessRole>("supervisor");
  const [selectedSiteIds, setSelectedSiteIds] = useState<string[]>([]);
  const [revealed, setRevealed] = useState<RevealedCredential | null>(null);
  const [statusNote, setStatusNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Account | null>(null);
  const [removing, setRemoving] = useState<Account | null>(null);
  const [search, setSearch] = useState("");
  const organizationId = resolveSelectedId(options.data ?? [], chosenOrganizationId);
  const accounts = trpc.jp.accounts.list.useQuery(
    { organizationId },
    { enabled: Boolean(organizationId), retry: false },
  );
  const create = trpc.jp.accounts.create.useMutation();
  const reset = trpc.jp.accounts.resetPassword.useMutation();
  const setStatus = trpc.jp.accounts.setStatus.useMutation();
  const restore = trpc.jp.accounts.restore.useMutation();
  const selectedOrganization = useMemo(
    () => options.data?.find((item) => item.id === organizationId) ?? null,
    [options.data, organizationId],
  );
  const assignable = useMemo(
    () => ROLE_ORDER.filter((role) => selectedOrganization?.assignableRoles.includes(role)),
    [selectedOrganization],
  );
  const businessRole = resolveChoice(assignable, chosenBusinessRole);
  const wholeCompany = Boolean(selectedOrganization?.wholeCompany);

  const toggleSite = (siteId: string) =>
    setSelectedSiteIds((current) =>
      current.includes(siteId) ? current.filter((id) => id !== siteId) : [...current, siteId],
    );
  const refreshAccounts = async () => {
    if (organizationId) await utils.jp.accounts.list.invalidate({ organizationId });
  };
  const begin = () => {
    setError(null);
    setStatusNote(null);
    setRevealed(null);
  };

  const createAccount = async () => {
    if (!organizationId || !businessRole) return;
    begin();
    try {
      const result = await create.mutateAsync({
        organizationId,
        displayName,
        username,
        businessRole,
        siteIds: isCompanyWide(businessRole) ? [] : selectedSiteIds,
      });
      setRevealed({
        username: result.username,
        temporaryPassword: result.temporaryPassword,
        note: t(
          "Give this password to the person yourself. It is shown only once; they must change it at first sign-in.",
        ),
      });
      setStatusNote(t("Account created."));
      setDisplayName("");
      setUsername("");
      setSelectedSiteIds([]);
      await refreshAccounts();
    } catch (cause) {
      setError(cause instanceof Error ? t(cause.message) : t("Account could not be created."));
    }
  };

  const runReset = (account: Account) =>
    confirm(
      t("Reset password?"),
      t("{name} gets a new temporary password and is signed out everywhere.", {
        name: account.name || account.username || "",
      }),
      t("Reset password"),
      () => {
        void (async () => {
          if (!organizationId) return;
          begin();
          try {
            const result = await reset.mutateAsync({ organizationId, userId: account.id });
            setRevealed({
              username: result.username,
              temporaryPassword: result.temporaryPassword,
              note: t("New temporary password for {name}. Shown only once.", {
                name: account.name || "",
              }),
            });
            setStatusNote(t("Password reset. Old sign-ins were closed."));
            await refreshAccounts();
          } catch (cause) {
            setError(cause instanceof Error ? t(cause.message) : t("Password reset failed."));
          }
        })();
      },
    );

  const runSuspend = (account: Account) => {
    const next = account.membershipStatus === "Active" ? "Suspended" : "Active";
    confirm(
      next === "Active" ? t("Activate account?") : t("Suspend account?"),
      next === "Active"
        ? t("{name} can sign in and work again.", { name: account.name || "" })
        : t("{name} is signed out and cannot sign in until activated again.", {
            name: account.name || "",
          }),
      next === "Active" ? t("Activate") : t("Suspend"),
      () => {
        void (async () => {
          if (!organizationId) return;
          begin();
          try {
            await setStatus.mutateAsync({ organizationId, userId: account.id, status: next });
            setStatusNote(next === "Active" ? t("Account active.") : t("Account suspended."));
            await refreshAccounts();
          } catch (cause) {
            setError(cause instanceof Error ? t(cause.message) : t("Could not change it."));
          }
        })();
      },
    );
  };

  const runRestore = async (account: Account) => {
    if (!organizationId) return;
    begin();
    try {
      await restore.mutateAsync({ organizationId, userId: account.id });
      setStatusNote(t("Account brought back. Give it sites with Edit."));
      await refreshAccounts();
    } catch (cause) {
      setError(cause instanceof Error ? t(cause.message) : t("Could not change it."));
    }
  };

  const hasAccess = Boolean(me.data?.platformOwner) || (options.data?.length ?? 0) > 0;
  const query = search.trim().toLowerCase();
  const visible = (accounts.data ?? []).filter(
    (account) =>
      !query ||
      (account.name ?? "").toLowerCase().includes(query) ||
      (account.username ?? "").toLowerCase().includes(query) ||
      t(ROLE_LABELS[account.businessRole as BusinessRole] ?? account.businessRole)
        .toLowerCase()
        .includes(query),
  );
  const active = visible.filter((account) => account.membershipStatus !== "Deactivated");
  const removed = visible.filter((account) => account.membershipStatus === "Deactivated");

  const renderAccount = (account: Account, index: number) => {
    const roleLabel = t(ROLE_LABELS[account.businessRole as BusinessRole] ?? account.businessRole);
    const isRemoved = account.membershipStatus === "Deactivated";
    return (
      <View
        key={`${account.id}-${account.businessRole}`}
        style={[
          styles.accountRow,
          index > 0 && { borderTopColor: colors.border, borderTopWidth: 1 },
        ]}
      >
        <View style={styles.accountTop}>
          <Avatar uri={photoOf(account.id)} name={account.name} size={40} />
          <View style={styles.accountCopy}>
            <Text style={[styles.accountName, { color: colors.foreground }]} numberOfLines={1}>
              {account.name || t("Unnamed account")}
            </Text>
            <Text style={[styles.accountInfo, { color: colors.primary }]} numberOfLines={1}>
              {roleLabel} · {account.username ? `@${account.username}` : t("no username")}
            </Text>
            <Text style={[styles.accountInfo, { color: colors.muted }]}>
              {account.assignedSites.length
                ? account.assignedSites.map((site) => site.siteName).join(", ")
                : isCompanyWide(account.businessRole)
                  ? t("Whole company")
                  : t("No site")}
            </Text>
          </View>
          {account.membershipStatus !== "Active" ? (
            <StatusPill
              compact
              label={isRemoved ? t("Removed") : t("Suspended")}
              tone={isRemoved ? "error" : "warning"}
            />
          ) : null}
        </View>
        {account.manageable && account.username ? (
          <View style={styles.actions}>
            {isRemoved ? (
              wholeCompany ? (
                <ActionChip
                  icon="restore"
                  label={t("Bring back")}
                  onPress={() => void runRestore(account)}
                />
              ) : null
            ) : (
              <>
                <ActionChip icon="edit" label={t("Edit")} onPress={() => setEditing(account)} />
                <ActionChip icon="key" label={t("Password")} onPress={() => runReset(account)} />
                {wholeCompany ? (
                  <ActionChip
                    icon="tune"
                    label={t("Access")}
                    onPress={() =>
                      router.push(
                        `/user-access?organizationId=${organizationId}&userId=${account.id}` as never,
                      )
                    }
                  />
                ) : null}
                <ActionChip
                  icon={
                    account.membershipStatus === "Active" ? "pause-circle-outline" : "play-arrow"
                  }
                  label={account.membershipStatus === "Active" ? t("Suspend") : t("Activate")}
                  onPress={() => runSuspend(account)}
                />
                <ActionChip
                  icon="delete-outline"
                  label={t("Delete")}
                  danger
                  onPress={() => setRemoving(account)}
                />
              </>
            )}
          </View>
        ) : null}
      </View>
    );
  };

  return (
    <AuthGate>
      <Screen>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
          <AppHeader
            manual="account"
            right={<HelpButton topicKey="users" />}
            eyebrow={t("Administration")}
            title={t("Team accounts")}
            subtitle={t("Create logins, change roles and sites, reset passwords, remove people.")}
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
          {options.isLoading ? (
            <Text style={[styles.muted, { color: colors.muted }]}>{t("Loading…")}</Text>
          ) : !hasAccess ? (
            needsCompanySetup ? (
              <CompanySetupNeeded />
            ) : (
              <EmptyState
                icon="lock-outline"
                title={t("No account management")}
                detail={t(
                  "Owners, Directors and Admins manage the whole company. Project Managers, Site Engineers and Site Supervisors manage people on their own sites.",
                )}
              />
            )
          ) : (
            <>
              {options.isError ? (
                <InlineError
                  message={t(options.error.message)}
                  onRetry={() => {
                    void options.refetch();
                  }}
                />
              ) : null}
              {options.data && options.data.length > 1 ? (
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
                          borderColor: item.id === organizationId ? colors.primary : colors.border,
                          backgroundColor:
                            item.id === organizationId ? `${colors.primary}12` : colors.surface,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.choiceText,
                          {
                            color: item.id === organizationId ? colors.primary : colors.foreground,
                          },
                        ]}
                      >
                        {item.name}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              ) : null}
              {selectedOrganization ? (
                <>
                  {!wholeCompany ? (
                    <View
                      style={[
                        styles.scopeNote,
                        {
                          backgroundColor: `${colors.primary}10`,
                          borderColor: `${colors.primary}30`,
                        },
                      ]}
                    >
                      <MaterialIcons name="location-city" size={17} color={colors.primary} />
                      <Text style={[styles.scopeNoteText, { color: colors.foreground }]}>
                        {t("You manage people on your own sites only, and only roles below yours.")}
                      </Text>
                    </View>
                  ) : null}
                  <SectionHeader title={t("New account")} />
                  <TextInput
                    accessibilityLabel={t("Full name")}
                    value={displayName}
                    onChangeText={setDisplayName}
                    placeholder={t("Person’s full name")}
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
                    accessibilityLabel={t("Username")}
                    value={username}
                    onChangeText={setUsername}
                    placeholder={t("Username (letters, numbers, . _ -)")}
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
                  <Text style={[styles.fieldLabel, { color: colors.foreground }]}>{t("Role")}</Text>
                  <View style={styles.roleStack}>
                    {assignable.map((role) => (
                      <Pressable
                        key={role}
                        accessibilityRole="radio"
                        accessibilityState={{ selected: businessRole === role }}
                        onPress={() => {
                          setBusinessRole(role);
                          setSelectedSiteIds([]);
                        }}
                        style={[
                          styles.roleChoice,
                          {
                            borderColor: businessRole === role ? colors.primary : colors.border,
                            backgroundColor:
                              businessRole === role ? `${colors.primary}10` : colors.surface,
                          },
                        ]}
                      >
                        <View style={styles.roleCopy}>
                          <Text style={[styles.roleLabel, { color: colors.foreground }]}>
                            {t(ROLE_LABELS[role])}
                          </Text>
                          <Text style={[styles.roleDetail, { color: colors.muted }]}>
                            {t(ROLE_DETAIL[role])}
                          </Text>
                        </View>
                        <MaterialIcons
                          name={
                            businessRole === role
                              ? "radio-button-checked"
                              : "radio-button-unchecked"
                          }
                          size={19}
                          color={businessRole === role ? colors.primary : colors.muted}
                        />
                      </Pressable>
                    ))}
                  </View>
                  {businessRole && !isCompanyWide(businessRole) ? (
                    <SitePicker
                      sites={selectedOrganization.sites}
                      selected={selectedSiteIds}
                      onToggle={toggleSite}
                    />
                  ) : null}
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
                        {t("Login details")}
                      </Text>
                      <Text style={[styles.credentialDetail, { color: colors.muted }]}>
                        {revealed.note}
                      </Text>
                      <Text
                        selectable
                        style={[styles.credentialValue, { color: colors.foreground }]}
                      >
                        {t("Username")}: {revealed.username}
                      </Text>
                      <Text
                        selectable
                        style={[styles.credentialValue, { color: colors.foreground }]}
                      >
                        {t("Temporary password")}: {revealed.temporaryPassword}
                      </Text>
                    </View>
                  ) : null}
                  <PrimaryButton
                    icon="person-add-alt-1"
                    label={create.isPending ? t("Creating…") : t("Create account")}
                    disabled={
                      create.isPending ||
                      !businessRole ||
                      !displayName.trim() ||
                      !username.trim() ||
                      (!isCompanyWide(businessRole) && selectedSiteIds.length === 0)
                    }
                    onPress={() => {
                      void createAccount();
                    }}
                  />

                  <SectionHeader
                    title={t("People")}
                    caption={
                      accounts.data
                        ? t("{count} accounts", { count: accounts.data.length })
                        : undefined
                    }
                    action={t("Refresh")}
                    onPress={() => {
                      void accounts.refetch();
                    }}
                  />
                  <TextInput
                    accessibilityLabel={t("Search people")}
                    value={search}
                    onChangeText={setSearch}
                    placeholder={t("Search by name, username or role")}
                    placeholderTextColor={colors.muted}
                    style={[
                      styles.input,
                      {
                        color: colors.foreground,
                        backgroundColor: colors.surface,
                        borderColor: colors.border,
                      },
                    ]}
                  />
                  {accounts.isError ? (
                    <InlineError
                      message={t(accounts.error.message)}
                      onRetry={() => {
                        void accounts.refetch();
                      }}
                    />
                  ) : accounts.isLoading ? (
                    <Text style={[styles.muted, { color: colors.muted }]}>{t("Loading…")}</Text>
                  ) : active.length ? (
                    <View
                      style={[
                        styles.listCard,
                        { backgroundColor: colors.surface, borderColor: colors.border },
                      ]}
                    >
                      {active.map(renderAccount)}
                    </View>
                  ) : (
                    <EmptyState
                      icon="people-outline"
                      title={t("No accounts yet")}
                      detail={t("People you create appear here with their role and sites.")}
                    />
                  )}
                  {removed.length ? (
                    <>
                      <SectionHeader title={t("Removed")} />
                      <View
                        style={[
                          styles.listCard,
                          { backgroundColor: colors.surface, borderColor: colors.border },
                        ]}
                      >
                        {removed.map(renderAccount)}
                      </View>
                    </>
                  ) : null}
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
                  {t(
                    "Each person has their own login. Passwords are shown only once when made and are stored only as a secure hash. Every change is written to the audit history.",
                  )}
                </Text>
              </View>
            </>
          )}
        </ScrollView>
        {editing && selectedOrganization && organizationId ? (
          <EditAccountSheet
            account={editing}
            organizationId={organizationId}
            sites={selectedOrganization.sites}
            assignable={assignable}
            onClose={() => setEditing(null)}
            onSaved={async () => {
              setEditing(null);
              setStatusNote(t("Changes saved."));
              await refreshAccounts();
            }}
          />
        ) : null}
        {removing && organizationId ? (
          <RemoveAccountSheet
            account={removing}
            organizationId={organizationId}
            wholeCompany={wholeCompany}
            onClose={() => setRemoving(null)}
            onRemoved={async (leftCompany) => {
              setRemoving(null);
              setStatusNote(
                leftCompany
                  ? t("Account removed. The person is signed out.")
                  : t("Removed from your sites."),
              );
              await refreshAccounts();
            }}
          />
        ) : null}
      </Screen>
    </AuthGate>
  );
}

function ActionChip({
  icon,
  label,
  onPress,
  danger,
}: {
  icon: ComponentProps<typeof MaterialIcons>["name"];
  label: string;
  onPress: () => void;
  danger?: boolean;
}) {
  const colors = useColors();
  const color = danger ? colors.error : colors.primary;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [
        styles.chip,
        { borderColor: danger ? `${colors.error}55` : colors.border },
        pressed && { opacity: 0.7 },
      ]}
    >
      <MaterialIcons name={icon} size={15} color={color} />
      <Text style={[styles.chipText, { color }]}>{label}</Text>
    </Pressable>
  );
}

function SitePicker({
  sites,
  selected,
  onToggle,
}: {
  sites: { id: string; name: string; code: string; projectName: string }[];
  selected: string[];
  onToggle: (siteId: string) => void;
}) {
  const colors = useColors();
  const { t } = useT();
  return (
    <>
      <Text style={[styles.fieldLabel, { color: colors.foreground }]}>{t("Sites")}</Text>
      {sites.length === 0 ? (
        <Text style={[styles.muted, { color: colors.muted }]}>
          {t("No active site yet. Create a site first, then give people access to it.")}
        </Text>
      ) : (
        <View
          style={[styles.siteCard, { backgroundColor: colors.surface, borderColor: colors.border }]}
        >
          {sites.map((site, index) => {
            const on = selected.includes(site.id);
            return (
              <Pressable
                key={site.id}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: on }}
                onPress={() => onToggle(site.id)}
                style={[
                  styles.siteOption,
                  index > 0 && { borderTopColor: colors.border, borderTopWidth: 1 },
                ]}
              >
                <View style={styles.siteCopy}>
                  <Text style={[styles.siteName, { color: colors.foreground }]}>{site.name}</Text>
                  <Text style={[styles.roleDetail, { color: colors.muted }]}>
                    {site.code} · {site.projectName}
                  </Text>
                </View>
                <MaterialIcons
                  name={on ? "check-box" : "check-box-outline-blank"}
                  size={20}
                  color={on ? colors.primary : colors.muted}
                />
              </Pressable>
            );
          })}
        </View>
      )}
    </>
  );
}

function EditAccountSheet({
  account,
  organizationId,
  sites,
  assignable,
  onClose,
  onSaved,
}: {
  account: Account;
  organizationId: string;
  sites: { id: string; name: string; code: string; projectName: string }[];
  assignable: BusinessRole[];
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const { t } = useT();
  const update = trpc.jp.accounts.update.useMutation();
  const current = account.businessRole as BusinessRole;
  const roles = assignable.includes(current) ? assignable : [current, ...assignable];
  const [name, setName] = useState(account.name ?? "");
  const [role, setRole] = useState<BusinessRole>(current);
  // Only sites this manager can give are shown; other sites of the person stay unchanged.
  const offered = new Set(sites.map((site) => site.id));
  const [siteIds, setSiteIds] = useState(
    account.assignedSites.map((site) => site.siteId).filter((id) => offered.has(id)),
  );
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    setError(null);
    try {
      await update.mutateAsync({
        organizationId,
        userId: account.id,
        displayName: name,
        businessRole: role,
        siteIds: isCompanyWide(role) ? [] : siteIds,
      });
      await onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? t(cause.message) : t("Could not save."));
    }
  };
  return (
    <Sheet
      visible
      title={t("Edit account")}
      subtitle={account.username ? `@${account.username}` : undefined}
      onClose={onClose}
      footer={
        <PrimaryButton
          icon="save"
          label={update.isPending ? t("Saving…") : t("Save changes")}
          disabled={
            update.isPending ||
            name.trim().length < 2 ||
            (!isCompanyWide(role) && siteIds.length === 0)
          }
          onPress={() => void save()}
        />
      }
    >
      <Field label={t("Full name")} value={name} onChangeText={setName} autoCapitalize="words" />
      <ChipGroup
        label={t("Role")}
        options={roles}
        value={role}
        onChange={setRole}
        format={(value) => t(ROLE_LABELS[value])}
      />
      {!isCompanyWide(role) ? (
        <SitePicker
          sites={sites}
          selected={siteIds}
          onToggle={(siteId) =>
            setSiteIds((list) =>
              list.includes(siteId) ? list.filter((id) => id !== siteId) : [...list, siteId],
            )
          }
        />
      ) : null}
      {error ? <InlineError message={error} onRetry={() => setError(null)} /> : null}
    </Sheet>
  );
}

function RemoveAccountSheet({
  account,
  organizationId,
  wholeCompany,
  onClose,
  onRemoved,
}: {
  account: Account;
  organizationId: string;
  wholeCompany: boolean;
  onClose: () => void;
  onRemoved: (leftCompany: boolean) => Promise<void>;
}) {
  const { t } = useT();
  const colors = useColors();
  const remove = trpc.jp.accounts.remove.useMutation();
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const run = async () => {
    setError(null);
    try {
      const result = await remove.mutateAsync({ organizationId, userId: account.id, reason });
      await onRemoved(result.leftCompany);
    } catch (cause) {
      setError(cause instanceof Error ? t(cause.message) : t("Could not remove."));
    }
  };
  return (
    <Sheet
      visible
      title={t("Delete account")}
      subtitle={account.name ?? undefined}
      onClose={onClose}
      footer={
        <>
          <PrimaryButton
            icon="delete-outline"
            label={remove.isPending ? t("Removing…") : t("Delete account")}
            disabled={remove.isPending || reason.trim().length < 3}
            onPress={() => void run()}
          />
          <SecondaryButton label={t("Cancel")} onPress={onClose} />
        </>
      }
    >
      <Text style={[styles.credentialDetail, { color: colors.foreground }]}>
        {wholeCompany
          ? t(
              "The person is removed from the company and all sites, signed out, and cannot sign in. Reports, bills and attendance they made stay in the history. A leader can bring the account back later.",
            )
          : t(
              "The person is removed from your sites. If they have no other site left, they are removed from the company and cannot sign in.",
            )}
      </Text>
      <Field
        label={t("Reason")}
        value={reason}
        onChangeText={setReason}
        placeholder={t("For example: left the job")}
      />
      {error ? <InlineError message={error} onRetry={() => setError(null)} /> : null}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  content: { paddingBottom: 34 },
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
  roleLabel: { fontSize: 13, fontWeight: "800" },
  roleDetail: { fontSize: 11, lineHeight: 15, marginTop: 2 },
  scopeNote: {
    flexDirection: "row",
    gap: 8,
    padding: 11,
    borderWidth: 1,
    borderRadius: 12,
    marginBottom: 12,
  },
  scopeNoteText: { flex: 1, fontSize: 12, lineHeight: 17 },
  siteCard: { borderWidth: 1, borderRadius: 13, paddingHorizontal: 12, marginBottom: 12 },
  siteOption: { minHeight: 53, flexDirection: "row", alignItems: "center", gap: 9 },
  siteCopy: { flex: 1, paddingVertical: 8 },
  siteName: { fontSize: 13, fontWeight: "800" },
  choiceWrap: { flexDirection: "row", flexWrap: "wrap", gap: 7, marginBottom: 14 },
  choiceChip: {
    minHeight: 36,
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 12,
    justifyContent: "center",
  },
  choiceText: { fontSize: 12, fontWeight: "800" },
  listCard: { borderWidth: 1, borderRadius: 15, paddingHorizontal: 12, marginBottom: 15 },
  accountRow: { paddingVertical: 11, gap: 9 },
  accountTop: { flexDirection: "row", alignItems: "center", gap: 10 },
  accountCopy: { flex: 1, minWidth: 0 },
  accountName: { fontSize: 14, fontWeight: "800" },
  accountInfo: { fontSize: 11, lineHeight: 16, marginTop: 2 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 6, paddingLeft: 50 },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    minHeight: 34,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderRadius: 17,
  },
  chipText: { fontSize: 12, fontWeight: "700" },
  credentialCard: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
    marginTop: 13,
    marginBottom: 13,
  },
  credentialTitle: { fontSize: 14, fontWeight: "900" },
  credentialDetail: { fontSize: 12, lineHeight: 18, marginTop: 4, marginBottom: 8 },
  credentialValue: { fontFamily: "monospace", fontSize: 13, fontWeight: "800", lineHeight: 21 },
  success: { fontSize: 12, fontWeight: "700", marginTop: 8 },
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
  boundaryText: { flex: 1, fontSize: 11, lineHeight: 16 },
});
