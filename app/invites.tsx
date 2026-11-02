import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useState } from "react";
import { RefreshControl, ScrollView, Share, StyleSheet, Text, View } from "react-native";
import { AuthGate } from "@/components/jp/auth-gate";
import {
  AppHeader,
  Card,
  ChipGroup,
  EmptyState,
  Fab,
  Field,
  HeroCard,
  InlineError,
  LoadingBlock,
  PrimaryButton,
  Screen,
  SecondaryButton,
  Sheet,
  StatusPill,
  formatDateTime,
} from "@/components/jp/ui";
import { useColors } from "@/hooks/use-colors";
import { prettyRole } from "@/lib/jp/site-admin-policy";
import { resolveSelectedId } from "@/lib/jp/selection";
import { trpc } from "@/lib/trpc";

const validity = ["1", "3", "7", "30"] as const;

export default function InvitesScreen() {
  const colors = useColors();
  const options = trpc.jp.accounts.options.useQuery();
  const orgs = options.data ?? [];
  const [chosenOrg, setChosenOrg] = useState<string | null>(null);
  const organizationId = resolveSelectedId(orgs, chosenOrg);
  const org = orgs.find((row) => row.id === organizationId);
  const invites = trpc.jp.accounts.listInvites.useQuery(
    { organizationId },
    { enabled: Boolean(organizationId) },
  );
  const revoke = trpc.jp.accounts.revokeInvite.useMutation();
  const utils = trpc.useUtils();
  const [formOpen, setFormOpen] = useState(false);
  const [issued, setIssued] = useState<{ code: string; name: string; expiresAt: Date } | null>(
    null,
  );

  const share = (code: string, name: string) =>
    Share.share({
      message: `Hello ${name}, your JP Infracon invite code is ${code}. Open the JP Infracon app → "Have an invite code? Create account", enter this code and choose your own username and password. The code works once and expires soon. Do not share it.`,
    });

  return (
    <AuthGate>
      <Screen>
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 110 }}
          refreshControl={
            <RefreshControl
              refreshing={invites.isRefetching}
              onRefresh={() => void invites.refetch()}
              tintColor={colors.primary}
            />
          }
        >
          <AppHeader
            eyebrow="Team accounts"
            title="Invite codes"
            subtitle="Give a person a secret one-time code. They create their own login with it — the role and site are fixed by you."
          />
          {options.isLoading ? <LoadingBlock /> : null}
          {options.isSuccess && !orgs.length ? (
            <EmptyState
              icon="lock-outline"
              title="Administrators only"
              detail="Only roles that manage accounts can issue invite codes."
            />
          ) : null}
          {orgs.length > 1 ? (
            <ChipGroup
              options={orgs.map((row) => row.id)}
              value={organizationId}
              onChange={setChosenOrg}
              format={(id) => orgs.find((row) => row.id === id)?.name ?? id}
            />
          ) : null}
          {issued ? (
            <HeroCard>
              <Text style={styles.heroKicker}>NEW CODE · SHOWN ONLY ONCE</Text>
              <Text
                style={styles.code}
                selectable
                accessibilityLabel={`Invite code ${issued.code}`}
              >
                {issued.code}
              </Text>
              <Text style={styles.heroMeta}>
                For {issued.name} · valid until {formatDateTime(issued.expiresAt)}
              </Text>
              <View style={{ marginTop: 14 }}>
                <PrimaryButton
                  icon="share"
                  tone="gold"
                  label="Share code"
                  onPress={() => void share(issued.code, issued.name)}
                />
              </View>
            </HeroCard>
          ) : null}
          {invites.error ? <InlineError message={invites.error.message} /> : null}
          {invites.data && invites.data.length === 0 ? (
            <EmptyState
              icon="vpn-key"
              title="No invite codes yet"
              detail="Create a code for a new director, engineer, supervisor or storekeeper."
              action="Create invite"
              onPress={() => setFormOpen(true)}
            />
          ) : null}
          <View style={{ gap: 10 }}>
            {(invites.data ?? []).map((invite) => {
              const expired = invite.status === "Active" && new Date(invite.expiresAt) < new Date();
              const label = expired ? "Expired" : invite.status;
              return (
                <Card
                  key={invite.id}
                  accent={label === "Active" ? "accent" : label === "Used" ? "success" : "error"}
                >
                  <View style={styles.top}>
                    <Text style={[styles.name, { color: colors.foreground }]}>
                      {invite.inviteeName}
                    </Text>
                    <StatusPill
                      label={label}
                      tone={label === "Active" ? "accent" : label === "Used" ? "success" : "error"}
                      compact
                    />
                  </View>
                  <Text style={[styles.meta, { color: colors.muted }]}>
                    {prettyRole(invite.businessRole)}
                    {invite.siteName ? ` · ${invite.siteName}` : " · all sites"} · code …
                    {invite.codeHint}
                  </Text>
                  <Text style={[styles.meta, { color: colors.muted }]}>
                    {invite.status === "Used" && invite.usedAt
                      ? `Used ${formatDateTime(invite.usedAt)}`
                      : `Expires ${formatDateTime(invite.expiresAt)}`}
                  </Text>
                  {label === "Active" ? (
                    <View style={{ marginTop: 10 }}>
                      <SecondaryButton
                        icon="block"
                        label="Revoke code"
                        onPress={() =>
                          void revoke
                            .mutateAsync({ inviteId: invite.id })
                            .then(() => utils.jp.accounts.listInvites.invalidate())
                        }
                      />
                    </View>
                  ) : null}
                </Card>
              );
            })}
          </View>
          <View style={styles.noteRow}>
            <MaterialIcons name="shield" size={14} color={colors.accent} />
            <Text style={[styles.note, { color: colors.muted }]}>
              Codes are stored only as a fingerprint, work once, expire, and repeated wrong codes
              are blocked.
            </Text>
          </View>
        </ScrollView>
        {org ? (
          <Fab icon="vpn-key" label="Create invite" onPress={() => setFormOpen(true)} />
        ) : null}
        {formOpen && org ? (
          <InviteSheet
            organizationId={org.id}
            roles={org.assignableRoles}
            sites={org.sites}
            onClose={() => setFormOpen(false)}
            onIssued={(result) => {
              setFormOpen(false);
              setIssued(result);
              void utils.jp.accounts.listInvites.invalidate();
            }}
          />
        ) : null}
      </Screen>
    </AuthGate>
  );
}

function InviteSheet({
  organizationId,
  roles,
  sites,
  onClose,
  onIssued,
}: {
  organizationId: string;
  roles: readonly string[];
  sites: { id: string; name: string; projectName: string }[];
  onClose: () => void;
  onIssued: (result: { code: string; name: string; expiresAt: Date }) => void;
}) {
  const create = trpc.jp.accounts.createInvite.useMutation();
  const [name, setName] = useState("");
  const [role, setRole] = useState<string | null>(null);
  const [siteId, setSiteId] = useState<string | null>(null);
  const [days, setDays] = useState<(typeof validity)[number]>("7");
  const [error, setError] = useState<string | null>(null);
  const broad = role === "director" || role === "admin";

  const save = async () => {
    if (!role) return;
    setError(null);
    try {
      const result = await create.mutateAsync({
        organizationId,
        inviteeName: name.trim(),
        businessRole: role as never,
        siteId: broad ? undefined : (siteId ?? undefined),
        validDays: Number(days),
      });
      onIssued({ code: result.code, name: name.trim(), expiresAt: new Date(result.expiresAt) });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The code was not created.");
    }
  };

  return (
    <Sheet
      visible
      title="Create invite code"
      subtitle="The person chooses their own password; you never see it."
      onClose={onClose}
      footer={
        <PrimaryButton
          icon="vpn-key"
          tone="gold"
          label="Create code"
          disabled={name.trim().length < 2 || !role || (!broad && !siteId)}
          loading={create.isPending}
          onPress={() => void save()}
        />
      }
    >
      {error ? <InlineError message={error} title="Not created" /> : null}
      <Field
        label="Person's full name"
        value={name}
        onChangeText={setName}
        placeholder="e.g. Sipun Behera"
      />
      <ChipGroup label="Role" options={roles} value={role} onChange={setRole} format={prettyRole} />
      {role && !broad ? (
        <ChipGroup
          label="Site"
          options={sites.map((site) => site.id)}
          value={siteId}
          onChange={setSiteId}
          format={(id) => sites.find((site) => site.id === id)?.name ?? id}
        />
      ) : null}
      <ChipGroup
        label="Code valid for"
        options={validity}
        value={days}
        onChange={setDays}
        format={(value) => `${value} day${value === "1" ? "" : "s"}`}
      />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  heroKicker: {
    color: "#D9B76A",
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1.4,
    marginTop: 6,
  },
  code: { color: "#FFFFFF", fontSize: 32, fontWeight: "900", letterSpacing: 4, marginTop: 10 },
  heroMeta: { color: "rgba(246,241,230,0.78)", fontSize: 12, marginTop: 6 },
  top: { flexDirection: "row", alignItems: "center", gap: 8, justifyContent: "space-between" },
  name: { fontSize: 16, fontWeight: "800", flex: 1 },
  meta: { fontSize: 12, marginTop: 4 },
  noteRow: {
    flexDirection: "row",
    gap: 6,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 16,
  },
  note: { fontSize: 11, lineHeight: 16, flexShrink: 1 },
});
