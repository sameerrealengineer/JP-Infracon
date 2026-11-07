import type { inferRouterOutputs } from "@trpc/server";
import { useState } from "react";
import { RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { AuthGate } from "@/components/jp/auth-gate";
import { HelpButton } from "@/components/jp/help";
import {
  AppHeader,
  Card,
  ChipGroup,
  EmptyState,
  Field,
  InlineError,
  isAccessDenied,
  ListRow,
  LoadingBlock,
  NoAccess,
  PrimaryButton,
  Screen,
  SecondaryButton,
  SectionHeader,
  Sheet,
  StatusPill,
} from "@/components/jp/ui";
import { useColors } from "@/hooks/use-colors";
import { useWorkspace } from "@/hooks/use-workspace";
import { CREW_TRADES } from "@/lib/jp/crew-domain";
import { formatMinorAsRupees } from "@/lib/jp/finance-domain";
import { createClientMutationId } from "@/lib/jp/local-repository";
import { resolveSelectedId } from "@/lib/jp/selection";
import { istDate } from "@/lib/jp/tracking-domain";
import { useT } from "@/lib/i18n";
import { trpc } from "@/lib/trpc";
import type { AppRouter } from "@/server/routers";

type CrewList = inferRouterOutputs<AppRouter>["jp"]["crews"]["list"];
type Crew = CrewList["crews"][number];

/** Crews: trade-wise teams on a site, who is in them, where they worked and what they cost. */
export default function CrewsScreen() {
  const { t } = useT();
  const colors = useColors();
  const { sitesWith } = useWorkspace();
  const sites = trpc.jp.workspace.mySites.useQuery();
  const siteOptions = (sites.data ?? []).filter((site) =>
    sitesWith("workforce.view").includes(site.id),
  );
  const [chosenSite, setChosenSite] = useState<string | null>(null);
  const siteId = resolveSelectedId(siteOptions, chosenSite);
  const month = istDate(new Date()).slice(0, 7);
  const list = trpc.jp.crews.list.useQuery({ siteId, month }, { enabled: Boolean(siteId) });
  const [creating, setCreating] = useState(false);
  const [openCrewId, setOpenCrewId] = useState<string | null>(null);
  const data = list.data;
  const openCrew = data?.crews.find((crew) => crew.id === openCrewId) ?? null;

  if (isAccessDenied(list.error))
    return (
      <AuthGate>
        <Screen>
          <ScrollView contentContainerStyle={styles.content}>
            <AppHeader eyebrow={t("People")} title={t("Crews")} />
            <NoAccess area={t("Crews")} message={list.error?.message} />
          </ScrollView>
        </Screen>
      </AuthGate>
    );

  const open = data?.crews.filter((crew) => crew.status === "Active") ?? [];
  const closed = data?.crews.filter((crew) => crew.status === "Closed") ?? [];
  return (
    <AuthGate>
      <Screen>
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.content}
          refreshControl={
            <RefreshControl
              refreshing={list.isRefetching}
              onRefresh={() => void list.refetch()}
              tintColor={colors.primary}
            />
          }
        >
          <AppHeader
            eyebrow={t("People")}
            title={t("Crews")}
            subtitle={t("Trade-wise teams on a site: members, daily work and labour cost.")}
            right={<HelpButton topicKey="crews" />}
          />
          {siteOptions.length > 1 ? (
            <ChipGroup
              label={t("Site")}
              options={siteOptions.map((site) => site.id)}
              value={siteId}
              onChange={setChosenSite}
              format={(id) => siteOptions.find((site) => site.id === id)?.name ?? id}
            />
          ) : null}
          {sites.data && siteOptions.length === 0 ? <NoAccess area={t("Crews")} /> : null}
          {list.error ? (
            <InlineError message={list.error.message} onRetry={() => void list.refetch()} />
          ) : null}
          {list.isLoading && siteId ? <LoadingBlock label={t("Loading crews…")} /> : null}

          {data ? (
            <>
              <View style={styles.pills}>
                <StatusPill
                  label={t("{count} crews working", { count: open.length })}
                  tone="info"
                />
                <StatusPill
                  label={t("{count} deployed today", {
                    count: open.filter((crew) => crew.deployedToday).length,
                  })}
                  tone={open.some((crew) => !crew.deployedToday) ? "warning" : "success"}
                />
                <StatusPill
                  label={t("{count} workers not in a crew", { count: data.freePeople.length })}
                  tone="accent"
                />
              </View>
              {data.canManage ? (
                <View style={{ marginBottom: 14 }}>
                  <PrimaryButton
                    icon="group-add"
                    label={t("New crew")}
                    onPress={() => setCreating(true)}
                  />
                </View>
              ) : null}

              {open.length === 0 ? (
                <EmptyState
                  icon="groups"
                  title={t("No crews on this site yet")}
                  detail={t(
                    "Make a crew for each trade (for example Shuttering or Masonry) and add its workers.",
                  )}
                />
              ) : (
                <View style={{ gap: 10 }}>
                  {open.map((crew) => (
                    <CrewCard
                      key={crew.id}
                      crew={crew}
                      money={data.canSeeMoney}
                      onPress={() => setOpenCrewId(crew.id)}
                    />
                  ))}
                </View>
              )}
              {data.canSeeMoney && data.unassignedCostMinor && data.unassignedCostMinor !== "0" ? (
                <Text style={[styles.meta, { color: colors.muted, marginTop: 10 }]}>
                  {t("Approved labour this month not in any crew: {amount}", {
                    amount: formatMinorAsRupees(data.unassignedCostMinor),
                  })}
                </Text>
              ) : null}
              {closed.length ? (
                <>
                  <SectionHeader title={t("Closed crews")} />
                  <View style={{ gap: 8 }}>
                    {closed.map((crew) => (
                      <CrewCard
                        key={crew.id}
                        crew={crew}
                        money={data.canSeeMoney}
                        onPress={() => setOpenCrewId(crew.id)}
                      />
                    ))}
                  </View>
                </>
              ) : null}
            </>
          ) : null}
        </ScrollView>
        {creating && siteId ? (
          <NewCrewSheet siteId={siteId} onClose={() => setCreating(false)} />
        ) : null}
        {openCrew && data ? (
          <CrewSheet crew={openCrew} data={data} onClose={() => setOpenCrewId(null)} />
        ) : null}
      </Screen>
    </AuthGate>
  );
}

function CrewCard({ crew, money, onPress }: { crew: Crew; money: boolean; onPress: () => void }) {
  const { t } = useT();
  const colors = useColors();
  return (
    <Card
      onPress={onPress}
      accent={crew.status === "Closed" ? undefined : crew.deployedToday ? "success" : "warning"}
      accessibilityLabel={t("Open {name}", { name: crew.name })}
    >
      <View style={styles.row}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.name, { color: colors.foreground }]}>{crew.name}</Text>
          <Text style={[styles.meta, { color: colors.muted }]}>
            {t(crew.trade)} · {t("{count} members", { count: crew.members.length })}
          </Text>
        </View>
        {crew.status === "Closed" ? (
          <StatusPill label={t("Closed")} tone="error" compact />
        ) : crew.deployedToday ? (
          <StatusPill label={t("Working today")} tone="success" compact />
        ) : (
          <StatusPill label={t("Not recorded today")} tone="warning" compact />
        )}
      </View>
      <Text style={[styles.meta, { color: colors.foreground, marginTop: 8 }]}>
        {t("{days} days worked this month", { days: crew.daysDeployed })}
        {money && crew.costMinor !== null
          ? ` · ${t("Labour {amount}", { amount: formatMinorAsRupees(crew.costMinor) })}`
          : ""}
      </Text>
    </Card>
  );
}

function NewCrewSheet({ siteId, onClose }: { siteId: string; onClose: () => void }) {
  const { t } = useT();
  const utils = trpc.useUtils();
  const create = trpc.jp.crews.create.useMutation();
  const [name, setName] = useState("");
  const [trade, setTrade] = useState<string | null>(null);
  const [key] = useState(createClientMutationId);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    setError(null);
    try {
      await create.mutateAsync({ siteId, name, trade: trade ?? "", clientMutationId: key });
      await utils.jp.crews.list.invalidate();
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("The crew could not be saved."));
    }
  };
  return (
    <Sheet visible title={t("New crew")} onClose={onClose}>
      <Field
        label={t("Crew name")}
        placeholder={t("For example: Shuttering team 1")}
        value={name}
        onChangeText={setName}
      />
      <ChipGroup
        label={t("Trade")}
        options={CREW_TRADES}
        value={trade as never}
        onChange={setTrade}
        format={(v) => t(v)}
      />
      {error ? <InlineError message={error} /> : null}
      <PrimaryButton
        icon="check"
        label={t("Save crew")}
        loading={create.isPending}
        disabled={!name.trim() || !trade}
        onPress={() => void save()}
      />
    </Sheet>
  );
}

function CrewSheet({ crew, data, onClose }: { crew: Crew; data: CrewList; onClose: () => void }) {
  const { t } = useT();
  const colors = useColors();
  const utils = trpc.useUtils();
  const addMember = trpc.jp.crews.addMember.useMutation();
  const removeMember = trpc.jp.crews.removeMember.useMutation();
  const deploy = trpc.jp.crews.deploy.useMutation();
  const close = trpc.jp.crews.close.useMutation();
  const [taskId, setTaskId] = useState<string>("none");
  const [headcount, setHeadcount] = useState(String(Math.max(crew.members.length, 1)));
  const [note, setNote] = useState("");
  const [deployKey, setDeployKey] = useState(createClientMutationId);
  const [closing, setClosing] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const editable = data.canManage && crew.status === "Active";

  const run = async (label: string, task: () => Promise<unknown>) => {
    setError(null);
    setBusy(label);
    try {
      await task();
      await utils.jp.crews.list.invalidate();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("Something went wrong"));
    } finally {
      setBusy(null);
    }
  };

  const taskOptions = ["none", ...data.tasks.map((task) => task.id)];
  return (
    <Sheet visible title={crew.name} subtitle={t(crew.trade)} onClose={onClose}>
      <ScrollView style={{ maxHeight: 560 }} keyboardShouldPersistTaps="handled">
        {error ? <InlineError message={error} /> : null}

        <SectionHeader
          title={t("Members")}
          caption={t("{count} now", { count: crew.members.length })}
        />
        {crew.members.length === 0 ? (
          <Text style={[styles.meta, { color: colors.muted }]}>{t("No members yet.")}</Text>
        ) : null}
        {crew.members.map((member) => (
          <ListRow
            key={member.personId}
            icon="engineering"
            title={member.name}
            detail={[member.trade, t("since {date}", { date: member.joinedOn })]
              .filter(Boolean)
              .join(" · ")}
            trailing={
              editable ? (
                <SecondaryButton
                  label={busy === `remove-${member.personId}` ? t("Removing…") : t("Remove")}
                  disabled={Boolean(busy)}
                  onPress={() =>
                    void run(`remove-${member.personId}`, () =>
                      removeMember.mutateAsync({
                        crewId: crew.id,
                        personId: member.personId,
                        clientMutationId: createClientMutationId(),
                      }),
                    )
                  }
                />
              ) : undefined
            }
          />
        ))}
        {crew.formerCount ? (
          <Text style={[styles.meta, { color: colors.muted }]}>
            {t("{count} people worked in this crew before", { count: crew.formerCount })}
          </Text>
        ) : null}
        {editable && data.freePeople.length ? (
          <View style={{ marginTop: 8 }}>
            <Text style={[styles.label, { color: colors.foreground }]}>{t("Add a worker")}</Text>
            <View style={styles.pills}>
              {data.freePeople.slice(0, 30).map((person) => (
                <SecondaryButton
                  key={person.id}
                  icon="person-add"
                  label={person.name}
                  disabled={Boolean(busy)}
                  onPress={() =>
                    void run(`add-${person.id}`, () =>
                      addMember.mutateAsync({
                        crewId: crew.id,
                        personId: person.id,
                        clientMutationId: createClientMutationId(),
                      }),
                    )
                  }
                />
              ))}
            </View>
          </View>
        ) : null}

        {editable && data.freePeople.length === 0 ? (
          <Text style={[styles.meta, { color: colors.muted, marginTop: 8 }]}>
            {t(
              "Every worker on this site is already in a crew. Add workers to the site in Workforce.",
            )}
          </Text>
        ) : null}
        {editable ? (
          <>
            <SectionHeader title={t("Record today's work")} />
            <ChipGroup
              label={t("Task")}
              options={taskOptions}
              value={taskOptions.includes(taskId) ? taskId : "none"}
              onChange={setTaskId}
              format={(id) =>
                id === "none"
                  ? t("No task")
                  : (() => {
                      const task = data.tasks.find((row) => row.id === id);
                      return task ? `${task.code} · ${task.title}` : id;
                    })()
              }
            />
            <Field
              label={t("People who worked")}
              keyboardType="number-pad"
              value={headcount}
              onChangeText={setHeadcount}
            />
            <Field label={t("Note (optional)")} value={note} onChangeText={setNote} />
            <PrimaryButton
              icon="event-available"
              label={crew.deployedToday ? t("Add another entry for today") : t("Save today's work")}
              loading={busy === "deploy"}
              disabled={Boolean(busy) || crew.members.length === 0}
              onPress={() =>
                void run("deploy", async () => {
                  await deploy.mutateAsync({
                    crewId: crew.id,
                    workDate: data.today,
                    taskId: taskId === "none" ? null : taskId,
                    headcount: Number(headcount),
                    note: note.trim() || undefined,
                    clientMutationId: deployKey,
                  });
                  setDeployKey(createClientMutationId());
                  setNote("");
                })
              }
            />
          </>
        ) : null}

        <SectionHeader title={t("This month")} />
        {crew.deployments.length === 0 ? (
          <Text style={[styles.meta, { color: colors.muted }]}>
            {t("No work recorded this month.")}
          </Text>
        ) : (
          crew.deployments.map((row) => (
            <ListRow
              key={row.id}
              icon="event-note"
              title={`${row.workDate} · ${t("{count} people", { count: row.headcount })}`}
              detail={[row.task ?? t("No task"), row.note].filter(Boolean).join(" · ")}
            />
          ))
        )}

        {editable ? (
          <View style={{ marginTop: 16, gap: 8 }}>
            {closing ? (
              <>
                <Field label={t("Why close this crew?")} value={reason} onChangeText={setReason} />
                <PrimaryButton
                  tone="danger"
                  icon="block"
                  label={t("Close crew")}
                  loading={busy === "close"}
                  disabled={reason.trim().length < 3}
                  onPress={() =>
                    void run("close", () =>
                      close.mutateAsync({
                        crewId: crew.id,
                        reason: reason.trim(),
                        clientMutationId: createClientMutationId(),
                      }),
                    )
                  }
                />
              </>
            ) : (
              <SecondaryButton
                icon="block"
                label={t("Close crew")}
                onPress={() => setClosing(true)}
              />
            )}
          </View>
        ) : null}
      </ScrollView>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 16, paddingBottom: 40 },
  pills: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 12 },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  name: { fontSize: 15, fontWeight: "800" },
  meta: { fontSize: 12, lineHeight: 17 },
  label: { fontSize: 13, fontWeight: "800", marginBottom: 6 },
});
