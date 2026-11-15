import { useState } from "react";
import { Platform, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { AuthGate } from "@/components/jp/auth-gate";
import {
  AppHeader,
  Card,
  ChipGroup,
  EmptyState,
  InlineError,
  LoadingBlock,
  PrimaryButton,
  Screen,
  SecondaryButton,
  SectionHeader,
  StatusPill,
} from "@/components/jp/ui";
import { useColors } from "@/hooks/use-colors";
import { useT } from "@/lib/i18n";
import { ROLE_LABELS } from "@/lib/jp/account-role-policy";
import { resolveSelectedId } from "@/lib/jp/selection";
import { trpc } from "@/lib/trpc";

type Tab = "mine" | "matrix" | "limits" | "teams" | "review";

/**
 * Access and permissions: my access and why, the role matrix (from the server's own rules),
 * approval limits, project teams, and the access review for leaders.
 */
export default function AccessScreen() {
  const { t } = useT();
  const options = trpc.jp.accounts.options.useQuery(undefined, { retry: false });
  const leader = (options.data ?? []).find((item) => item.wholeCompany) ?? null;
  const tabs: Tab[] = leader
    ? ["mine", "matrix", "limits", "teams", "review"]
    : ["mine", "matrix", "limits", "teams"];
  const [tab, setTab] = useState<Tab>("mine");
  const labels: Record<Tab, string> = {
    mine: "My access",
    matrix: "Roles",
    limits: "Approval limits",
    teams: "Project teams",
    review: "Access review",
  };
  return (
    <AuthGate>
      <Screen>
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 32 }}
        >
          <AppHeader
            eyebrow={t("Administration")}
            title={t("Access and permissions")}
            subtitle={t("Who can do what, where, up to how much, and why.")}
          />
          <ChipGroup
            options={tabs}
            value={tab}
            onChange={setTab}
            format={(value) => t(labels[value])}
          />
          <View style={{ height: 8 }} />
          {tab === "mine" ? <MyAccess /> : null}
          {tab === "matrix" ? <Matrix /> : null}
          {tab === "limits" ? <Limits /> : null}
          {tab === "teams" ? <ProjectTeams /> : null}
          {tab === "review" && leader ? <Review organizationId={leader.id} /> : null}
        </ScrollView>
      </Screen>
    </AuthGate>
  );
}

function MyAccess() {
  const { t } = useT();
  const colors = useColors();
  const mine = trpc.jp.accessReview.mine.useQuery();
  const endSessions = trpc.jp.accessReview.endSessions.useMutation();
  if (mine.isLoading) return <LoadingBlock label={t("Loading…")} />;
  if (mine.isError)
    return <InlineError message={t(mine.error.message)} onRetry={() => void mine.refetch()} />;
  const data = mine.data!;
  return (
    <View style={{ gap: 10 }}>
      <Card>
        <Text style={[styles.title, { color: colors.foreground }]}>{t("Company role")}</Text>
        <Text style={[styles.meta, { color: colors.muted }]}>
          {data.platformRole === "super_admin" ? `${t("Super Admin")} · ` : ""}
          {data.companyRoles.map((row) => t(row.label)).join(", ") || t("None")}
        </Text>
      </Card>
      {data.projects.length ? (
        <Card>
          <Text style={[styles.title, { color: colors.foreground }]}>{t("Projects")}</Text>
          {data.projects.map((row) => (
            <Text key={row.projectName} style={[styles.meta, { color: colors.muted }]}>
              {row.projectName} · {t(row.label)}
            </Text>
          ))}
        </Card>
      ) : null}
      <SectionHeader
        title={t("My sites")}
        caption={t("{count} sites", { count: data.sites.length })}
      />
      {data.sites.map((site) => (
        <Card key={site.siteId}>
          <Text style={[styles.title, { color: colors.foreground }]}>{site.siteName}</Text>
          <Text style={[styles.meta, { color: colors.muted }]}>
            {t(site.label)} · {t("{count} actions allowed", { count: site.actions })}
          </Text>
        </Card>
      ))}
      {data.exceptions.length ? (
        <Card>
          <Text style={[styles.title, { color: colors.foreground }]}>
            {t("Changed just for you")}
          </Text>
          {data.exceptions.map((row, index) => (
            <Text key={index} style={[styles.meta, { color: colors.muted }]}>
              {row.effect === "allow" ? "✓" : "✗"} {row.permissionKey} · {t(row.scopeType)}
            </Text>
          ))}
        </Card>
      ) : null}
      {data.delegations.length ? (
        <Card>
          <Text style={[styles.title, { color: colors.foreground }]}>
            {t("Authority given to you")}
          </Text>
          {data.delegations.map((row, index) => (
            <Text key={index} style={[styles.meta, { color: colors.muted }]}>
              {String(row.bundles)} ·{" "}
              {t("until {date}", { date: String(row.effectiveTo).slice(0, 16).replace("T", " ") })}
            </Text>
          ))}
        </Card>
      ) : null}
      <SecondaryButton
        label={endSessions.isPending ? t("Signing out…") : t("Sign out on every device")}
        onPress={() => void endSessions.mutateAsync({}).then(() => mine.refetch())}
      />
    </View>
  );
}

function Matrix() {
  const { t } = useT();
  const colors = useColors();
  const matrix = trpc.jp.accessReview.matrix.useQuery();
  const [role, setRole] = useState("project_manager");
  if (matrix.isLoading) return <LoadingBlock label={t("Loading…")} />;
  if (matrix.isError)
    return <InlineError message={t(matrix.error.message)} onRetry={() => void matrix.refetch()} />;
  return (
    <View style={{ gap: 10 }}>
      <ChipGroup
        label={t("Role")}
        options={matrix.data!.roles.map((row) => row.role)}
        value={role}
        onChange={setRole}
        format={(value) => t(ROLE_LABELS[value as keyof typeof ROLE_LABELS] ?? value)}
      />
      {matrix.data!.modules.map((module) => {
        const allowed = module.actions.filter((action) => action.allowed[role]);
        return (
          <Card key={module.key}>
            <View style={styles.top}>
              <Text style={[styles.title, { color: colors.foreground }]}>{t(module.title)}</Text>
              <StatusPill
                compact
                label={`${allowed.length}/${module.actions.length}`}
                tone={
                  allowed.length === 0
                    ? "info"
                    : allowed.length === module.actions.length
                      ? "success"
                      : "warning"
                }
              />
            </View>
            {module.actions.map((action) => (
              <Text
                key={action.key}
                style={[
                  styles.meta,
                  { color: action.allowed[role] ? colors.foreground : colors.muted },
                ]}
              >
                {action.allowed[role] ? "✓" : "✗"} {action.label}
              </Text>
            ))}
          </Card>
        );
      })}
      <Text style={[styles.meta, { color: colors.muted }]}>
        {t(
          "This is the default for each role. Leaders can switch single actions on or off for one person in Team accounts → Access.",
        )}
      </Text>
    </View>
  );
}

function Limits() {
  const { t } = useT();
  const colors = useColors();
  const options = trpc.jp.accounts.options.useQuery(undefined, { retry: false });
  const sites = trpc.jp.workspace.mySites.useQuery();
  const organizationId = options.data?.[0]?.id ?? sites.data?.[0]?.organizationId ?? "";
  const limits = trpc.jp.approvalLimits.list.useQuery(
    { organizationId },
    { enabled: Boolean(organizationId) },
  );
  const set = trpc.jp.approvalLimits.set.useMutation();
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  if (!organizationId || limits.isLoading) return <LoadingBlock label={t("Loading…")} />;
  if (limits.isError)
    return <InlineError message={t(limits.error.message)} onRetry={() => void limits.refetch()} />;
  const save = async (role: string, area: string) => {
    setError(null);
    const text = draft[`${role}:${area}`]?.trim() ?? "";
    try {
      await set.mutateAsync({
        organizationId,
        role: role as never,
        area: area as never,
        limitRupees: text === "" ? null : Number(text.replace(/[^\d]/g, "")),
      });
      await limits.refetch();
    } catch (cause) {
      setError(cause instanceof Error ? t(cause.message) : t("Could not save."));
    }
  };
  return (
    <View style={{ gap: 10 }}>
      <Text style={[styles.meta, { color: colors.muted }]}>
        {t(
          "The largest amount each role may approve. Empty means no limit. The Owner is never limited.",
        )}
      </Text>
      {error ? <InlineError message={error} onRetry={() => setError(null)} /> : null}
      {limits.data!.roles.map((row) => (
        <Card key={row.role}>
          <Text style={[styles.title, { color: colors.foreground }]}>
            {t(ROLE_LABELS[row.role as keyof typeof ROLE_LABELS])}
          </Text>
          {limits.data!.areas.map(({ area, label }) => {
            const current = row.limits[area];
            const key = `${row.role}:${area}`;
            return (
              <View key={area} style={styles.limitRow}>
                <Text style={[styles.meta, { color: colors.foreground, flex: 1 }]}>{t(label)}</Text>
                {row.editable ? (
                  <TextInput
                    accessibilityLabel={`${t(label)} ${t(ROLE_LABELS[row.role as keyof typeof ROLE_LABELS])}`}
                    value={draft[key] ?? (current ? String(BigInt(current) / 100n) : "")}
                    onChangeText={(value) => setDraft((all) => ({ ...all, [key]: value }))}
                    onBlur={() => void save(row.role, area)}
                    placeholder={t("No limit")}
                    placeholderTextColor={colors.muted}
                    keyboardType="number-pad"
                    style={[
                      styles.limitInput,
                      { borderColor: colors.border, color: colors.foreground },
                    ]}
                  />
                ) : (
                  <Text style={[styles.meta, { color: colors.muted }]}>
                    {current
                      ? `₹${(BigInt(current) / 100n).toLocaleString("en-IN")}`
                      : t("No limit")}
                  </Text>
                )}
              </View>
            );
          })}
        </Card>
      ))}
    </View>
  );
}

function ProjectTeams() {
  const { t } = useT();
  const colors = useColors();
  const sites = trpc.jp.workspace.mySites.useQuery();
  const projects = [
    ...new Map(
      (sites.data ?? []).map((site) => [
        site.projectId,
        { id: site.projectId, name: site.project },
      ]),
    ).values(),
  ];
  const [chosen, setChosen] = useState("");
  const projectId = resolveSelectedId(projects, chosen);
  const team = trpc.jp.projectTeam.list.useQuery(
    { projectId },
    { enabled: Boolean(projectId), retry: false },
  );
  const assign = trpc.jp.projectTeam.assign.useMutation();
  const remove = trpc.jp.projectTeam.remove.useMutation();
  const [person, setPerson] = useState<number | null>(null);
  const [role, setRole] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = async (work: () => Promise<unknown>) => {
    setError(null);
    try {
      await work();
      await team.refetch();
    } catch (cause) {
      setError(cause instanceof Error ? t(cause.message) : t("Could not save."));
    }
  };
  return (
    <View style={{ gap: 10 }}>
      <Text style={[styles.meta, { color: colors.muted }]}>
        {t("People on a project see every site of it, also sites added later.")}
      </Text>
      <ChipGroup
        label={t("Project")}
        options={projects.map((row) => row.id)}
        value={projectId || null}
        onChange={setChosen}
        format={(id) => projects.find((row) => row.id === id)?.name ?? id}
      />
      {error ? <InlineError message={error} onRetry={() => setError(null)} /> : null}
      {team.isLoading ? <LoadingBlock label={t("Loading…")} /> : null}
      {team.data?.members.length === 0 ? (
        <EmptyState
          icon="groups"
          title={t("No one on the whole project yet")}
          detail={t("People may still be on single sites.")}
        />
      ) : null}
      {team.data?.members.map((member) => (
        <Card key={member.id}>
          <View style={styles.top}>
            <Text style={[styles.title, { color: colors.foreground }]}>{member.name}</Text>
            <StatusPill
              compact
              label={t(ROLE_LABELS[member.role as keyof typeof ROLE_LABELS] ?? member.role)}
              tone="info"
            />
          </View>
          {team.data?.canManage ? (
            <SecondaryButton
              label={t("Remove from project")}
              onPress={() =>
                void run(() =>
                  remove.mutateAsync({
                    projectId,
                    userId: member.userId,
                    reason: "Removed from the project team",
                  }),
                )
              }
            />
          ) : null}
        </Card>
      ))}
      {team.data?.canManage && team.data.candidates.length ? (
        <Card>
          <Text style={[styles.title, { color: colors.foreground }]}>{t("Add to project")}</Text>
          <ChipGroup
            label={t("Person")}
            options={team.data.candidates.map((row) => String(row.userId))}
            value={person ? String(person) : null}
            onChange={(id) => setPerson(Number(id))}
            format={(id) =>
              team.data!.candidates.find((row) => String(row.userId) === id)?.name ?? id
            }
          />
          <ChipGroup
            label={t("Role")}
            options={[...team.data.assignableRoles]}
            value={role}
            onChange={setRole}
            format={(value) => t(ROLE_LABELS[value as keyof typeof ROLE_LABELS] ?? value)}
          />
          <PrimaryButton
            icon="group-add"
            label={t("Add to project")}
            disabled={!person || !role || assign.isPending}
            onPress={() =>
              void run(() =>
                assign.mutateAsync({ projectId, userId: person!, role: role as never }),
              )
            }
          />
        </Card>
      ) : null}
    </View>
  );
}

function Review({ organizationId }: { organizationId: string }) {
  const { t } = useT();
  const colors = useColors();
  const review = trpc.jp.accessReview.review.useQuery({ organizationId, format: "rows" });
  const utils = trpc.useUtils();
  const endSessions = trpc.jp.accessReview.endSessions.useMutation();
  const [note, setNote] = useState<string | null>(null);
  const download = async () => {
    const result = await utils.jp.accessReview.review.fetch({ organizationId, format: "csv" });
    if (Platform.OS === "web" && result.csv) {
      const blob = new Blob([result.csv], { type: "text/csv;charset=utf-8" });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = `access-review-${new Date().toISOString().slice(0, 10)}.csv`;
      link.click();
    } else setNote(t("Open the web app on a computer to download the file."));
  };
  if (review.isLoading) return <LoadingBlock label={t("Loading…")} />;
  if (review.isError)
    return <InlineError message={t(review.error.message)} onRetry={() => void review.refetch()} />;
  return (
    <View style={{ gap: 10 }}>
      <PrimaryButton
        icon="download"
        label={t("Download access review (CSV)")}
        onPress={() => void download()}
      />
      {note ? <Text style={[styles.meta, { color: colors.muted }]}>{note}</Text> : null}
      {review.data!.rows.map((row) => (
        <Card key={row.userId}>
          <View style={styles.top}>
            <Text style={[styles.title, { color: colors.foreground }]}>{row.name}</Text>
            <StatusPill
              compact
              label={t(row.membershipStatus)}
              tone={row.membershipStatus === "Active" ? "success" : "warning"}
            />
          </View>
          <Text style={[styles.meta, { color: colors.primary }]}>
            {t(row.roleLabel)} {row.username ? `· @${row.username}` : ""}
          </Text>
          {row.sites.length ? (
            <Text style={[styles.meta, { color: colors.muted }]}>
              {t("Sites")}: {row.sites.join(", ")}
            </Text>
          ) : null}
          {row.projects.length ? (
            <Text style={[styles.meta, { color: colors.muted }]}>
              {t("Projects")}: {row.projects.join(", ")}
            </Text>
          ) : null}
          {row.exceptions.length ? (
            <Text style={[styles.meta, { color: colors.muted }]}>
              {t("Exceptions")}: {row.exceptions.join(", ")}
            </Text>
          ) : null}
          <Text style={[styles.meta, { color: colors.muted }]}>
            {t("{count} active sign-ins", { count: row.activeSessions })}
          </Text>
          {row.activeSessions > 0 ? (
            <SecondaryButton
              label={t("Sign this person out everywhere")}
              onPress={() =>
                void endSessions
                  .mutateAsync({ organizationId, userId: row.userId })
                  .then(() => review.refetch())
                  .catch((cause: unknown) =>
                    setNote(cause instanceof Error ? t(cause.message) : t("Could not save.")),
                  )
              }
            />
          ) : null}
        </Card>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  top: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 },
  title: { fontSize: 15, fontWeight: "800", flexShrink: 1 },
  meta: { fontSize: 12, lineHeight: 18, marginTop: 3 },
  limitRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 6 },
  limitInput: {
    minWidth: 110,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 6,
    fontSize: 13,
    textAlign: "right",
  },
});
