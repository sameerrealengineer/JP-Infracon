import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useState } from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { AuthGate } from "@/components/jp/auth-gate";
import {
  AppHeader,
  Card,
  ChipGroup,
  EmptyState,
  Fab,
  Field,
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
import {
  delegationBundleIds,
  delegationBundles,
  delegationDurations,
  timeLeft,
  type DelegationBundle,
  type DelegationDuration,
} from "@/lib/jp/delegation-policy";
import { createClientMutationId } from "@/lib/jp/local-repository";
import { resolveSelectedId } from "@/lib/jp/selection";
import { trpc } from "@/lib/trpc";

const durationIds = Object.keys(delegationDurations) as DelegationDuration[];

export default function DelegationScreen() {
  const colors = useColors();
  const overview = trpc.jp.sitesAdmin.overview.useQuery();
  const orgs = overview.data ?? [];
  const [chosenOrg, setChosenOrg] = useState<string | null>(null);
  const organizationId = resolveSelectedId(orgs, chosenOrg);
  const list = trpc.jp.delegation.list.useQuery(
    { organizationId },
    { enabled: Boolean(organizationId) },
  );
  const [formOpen, setFormOpen] = useState(false);
  const [revoking, setRevoking] = useState<string | null>(null);

  return (
    <AuthGate>
      <Screen>
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 110 }}
          refreshControl={
            <RefreshControl
              refreshing={list.isRefetching}
              onRefresh={() => void list.refetch()}
              tintColor={colors.primary}
            />
          }
        >
          <AppHeader
            eyebrow="Administration"
            title="Delegate authority"
            subtitle="Busy? Hand a site engineer or supervisor your approval powers for an hour, a week or a whole project — it ends on its own."
          />
          {overview.isLoading ? <LoadingBlock /> : null}
          {overview.isSuccess && !orgs.length ? (
            <EmptyState
              icon="lock-outline"
              title="Directors and administrators only"
              detail="Only the Owner, Director/Partner, Contractor/Admin or Super Admin can delegate authority."
            />
          ) : null}
          {orgs.length > 1 ? (
            <ChipGroup
              options={orgs.map((org) => org.id)}
              value={organizationId}
              onChange={setChosenOrg}
              format={(id) => orgs.find((org) => org.id === id)?.name ?? id}
            />
          ) : null}
          {list.error ? (
            <InlineError message={list.error.message} onRetry={() => void list.refetch()} />
          ) : null}
          {organizationId && list.data?.length === 0 ? (
            <EmptyState
              icon="key"
              title="No delegations yet"
              detail="Give someone temporary authority so work does not wait for your approval."
              action="Delegate authority"
              onPress={() => setFormOpen(true)}
            />
          ) : null}
          <View style={{ gap: 10 }}>
            {(list.data ?? []).map((row) => (
              <Card
                key={row.id}
                accent={
                  row.state === "Active" ? "success" : row.state === "Revoked" ? "error" : "info"
                }
              >
                <View style={styles.top}>
                  <Text style={[styles.name, { color: colors.foreground }]}>
                    {row.userName ?? "User"}
                  </Text>
                  <StatusPill
                    label={row.state}
                    tone={
                      row.state === "Active"
                        ? "success"
                        : row.state === "Scheduled"
                          ? "info"
                          : "error"
                    }
                    compact
                  />
                </View>
                <Text style={[styles.meta, { color: colors.muted }]}>
                  {row.scopeType === "site" ? "Site" : "Project"} · {row.scopeName}
                </Text>
                <View style={styles.bundleRow}>
                  {row.bundles.map((bundle) => (
                    <StatusPill
                      key={bundle}
                      label={delegationBundles[bundle]?.label ?? bundle}
                      tone="accent"
                      compact
                    />
                  ))}
                </View>
                <Text style={[styles.meta, { color: colors.foreground }]}>
                  {row.state === "Active"
                    ? timeLeft(row.effectiveTo)
                    : `Until ${row.effectiveTo ? formatDateTime(row.effectiveTo) : "revoked"}`}
                </Text>
                <Text style={[styles.meta, { color: colors.muted }]}>Reason · {row.reason}</Text>
                {row.state === "Active" || row.state === "Scheduled" ? (
                  <View style={{ marginTop: 10 }}>
                    <SecondaryButton
                      icon="block"
                      label="Revoke now"
                      onPress={() => setRevoking(row.id)}
                    />
                  </View>
                ) : null}
              </Card>
            ))}
          </View>
          <Text style={[styles.note, { color: colors.muted }]}>
            Every delegation and revocation is recorded in the audit trail. Delegated people still
            work only on the chosen site or project.
          </Text>
        </ScrollView>
        {organizationId ? (
          <Fab icon="key" label="Delegate" onPress={() => setFormOpen(true)} />
        ) : null}
        {formOpen && organizationId ? (
          <DelegateSheet organizationId={organizationId} onClose={() => setFormOpen(false)} />
        ) : null}
        {revoking ? (
          <RevokeSheet delegationId={revoking} onClose={() => setRevoking(null)} />
        ) : null}
      </Screen>
    </AuthGate>
  );
}

function DelegateSheet({
  organizationId,
  onClose,
}: {
  organizationId: string;
  onClose: () => void;
}) {
  const colors = useColors();
  const utils = trpc.useUtils();
  const candidates = trpc.jp.delegation.candidates.useQuery({ organizationId });
  const create = trpc.jp.delegation.create.useMutation();
  const [mutationId] = useState(createClientMutationId);
  const [person, setPerson] = useState<string | null>(null);
  const [scopeType, setScopeType] = useState<"site" | "project">("site");
  const [scopeId, setScopeId] = useState<string | null>(null);
  const [bundles, setBundles] = useState<DelegationBundle[]>(["site_operations", "self_approval"]);
  const [duration, setDuration] = useState<DelegationDuration>("1d");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const people = candidates.data ?? [];
  const selected = people.find((row) => String(row.userId) === person);
  const scopes = selected ? (scopeType === "site" ? selected.sites : selected.projects) : [];
  const scope = scopes.find((row) => row.id === scopeId) ? scopeId : (scopes[0]?.id ?? null);

  const toggle = (bundle: DelegationBundle) =>
    setBundles((current) =>
      current.includes(bundle) ? current.filter((row) => row !== bundle) : [...current, bundle],
    );

  const save = async () => {
    if (!selected || !scope) return;
    setError(null);
    try {
      await create.mutateAsync({
        organizationId,
        userId: selected.userId,
        scopeType,
        scopeId: scope,
        bundles,
        duration,
        reason: reason.trim(),
        clientMutationId: mutationId,
      });
      await utils.jp.delegation.invalidate();
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Not delegated.");
    }
  };

  return (
    <Sheet
      visible
      title="Delegate authority"
      subtitle="The person can act — and approve — without waiting for you, only where and while you allow."
      onClose={onClose}
      footer={
        <PrimaryButton
          icon="key"
          tone="gold"
          label={`Delegate for ${delegationDurations[duration].label.toLowerCase()}`}
          disabled={!selected || !scope || !bundles.length || reason.trim().length < 3}
          loading={create.isPending}
          onPress={() => void save()}
        />
      }
    >
      {error ? <InlineError message={error} title="Not delegated" /> : null}
      {candidates.isLoading ? <LoadingBlock label="Loading team…" /> : null}
      <ChipGroup
        label="Person"
        options={people.map((row) => String(row.userId))}
        value={person}
        onChange={setPerson}
        format={(value) => people.find((row) => String(row.userId) === value)?.name ?? value}
      />
      {selected ? (
        <>
          <ChipGroup
            label="Where"
            options={["site", "project"] as const}
            value={scopeType}
            onChange={setScopeType}
            format={(value) => (value === "site" ? "One site" : "Whole project")}
          />
          {scopes.length ? (
            <ChipGroup
              options={scopes.map((row) => row.id)}
              value={scope}
              onChange={setScopeId}
              format={(id) => scopes.find((row) => row.id === id)?.name ?? id}
            />
          ) : (
            <Text style={[styles.meta, { color: colors.warning, marginBottom: 12 }]}>
              Assign this person to a site first (Projects & sites → site → Assign).
            </Text>
          )}
        </>
      ) : null}
      <Text style={[styles.label, { color: colors.foreground }]}>What they can do</Text>
      {delegationBundleIds.map((bundle) => {
        const on = bundles.includes(bundle);
        return (
          <Pressable
            key={bundle}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: on }}
            onPress={() => toggle(bundle)}
            style={[styles.bundle, { borderColor: on ? colors.primary : colors.border }]}
          >
            <MaterialIcons
              name={on ? "check-box" : "check-box-outline-blank"}
              size={22}
              color={on ? colors.primary : colors.muted}
            />
            <View style={{ flex: 1 }}>
              <Text style={[styles.bundleTitle, { color: colors.foreground }]}>
                {delegationBundles[bundle].label}
              </Text>
              <Text style={[styles.meta, { color: colors.muted }]}>
                {delegationBundles[bundle].detail}
              </Text>
            </View>
          </Pressable>
        );
      })}
      <ChipGroup
        label="For how long"
        options={durationIds}
        value={duration}
        onChange={setDuration}
        format={(value) => delegationDurations[value].label}
      />
      <Field
        label="Reason (recorded)"
        value={reason}
        onChangeText={setReason}
        placeholder="e.g. I am travelling to Delhi this week"
        multiline
      />
    </Sheet>
  );
}

function RevokeSheet({ delegationId, onClose }: { delegationId: string; onClose: () => void }) {
  const utils = trpc.useUtils();
  const revoke = trpc.jp.delegation.revoke.useMutation();
  const [mutationId] = useState(createClientMutationId);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  return (
    <Sheet
      visible
      title="Revoke authority"
      subtitle="Takes effect immediately on the server."
      onClose={onClose}
      footer={
        <PrimaryButton
          icon="block"
          tone="danger"
          label="Revoke now"
          disabled={reason.trim().length < 3}
          loading={revoke.isPending}
          onPress={() => {
            setError(null);
            revoke
              .mutateAsync({ delegationId, reason: reason.trim(), clientMutationId: mutationId })
              .then(async () => {
                await utils.jp.delegation.invalidate();
                onClose();
              })
              .catch((cause: unknown) =>
                setError(cause instanceof Error ? cause.message : "Not revoked."),
              );
          }}
        />
      }
    >
      {error ? <InlineError message={error} title="Not revoked" /> : null}
      <Field
        label="Reason"
        value={reason}
        onChangeText={setReason}
        placeholder="e.g. Back on site"
      />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  top: { flexDirection: "row", alignItems: "center", gap: 8, justifyContent: "space-between" },
  name: { fontSize: 16, fontWeight: "800", flex: 1 },
  meta: { fontSize: 12, marginTop: 4, lineHeight: 17 },
  bundleRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 8 },
  label: { fontSize: 12, fontWeight: "800", marginBottom: 8 },
  bundle: {
    flexDirection: "row",
    gap: 10,
    borderWidth: 1.5,
    borderRadius: 14,
    padding: 12,
    marginBottom: 8,
  },
  bundleTitle: { fontSize: 14, fontWeight: "800" },
  note: { fontSize: 11, lineHeight: 16, marginTop: 16, textAlign: "center" },
});
