import { useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
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
  type Tone,
} from "@/components/jp/ui";
import { useColors } from "@/hooks/use-colors";
import { useT } from "@/lib/i18n";
import { createClientMutationId } from "@/lib/jp/local-repository";
import { resolveSelectedId } from "@/lib/jp/selection";
import { trpc } from "@/lib/trpc";

const TONE: Record<string, Tone> = {
  Planned: "info",
  "In Progress": "warning",
  Completed: "success",
  Blocked: "error",
  "On Hold": "warning",
  Cancelled: "info",
};

/** My tasks (start, finish, report blocked) and, for managers, each person's progress. */
export default function MyTasksScreen() {
  const { t } = useT();
  const colors = useColors();
  const mine = trpc.jp.tasks.mine.useQuery();
  const update = trpc.jp.tasks.updateStatus.useMutation();
  const sites = trpc.jp.workspace.mySites.useQuery();
  const capabilities = trpc.jp.workspace.myCapabilities.useQuery();
  const managerSites = (sites.data ?? []).filter((site) =>
    (capabilities.data ?? []).some(
      (row) => row.siteId === site.id && (row as Record<string, unknown>)["task.manage"] === true,
    ),
  );
  const [chosenSite, setSite] = useState("");
  const siteId = resolveSelectedId(managerSites, chosenSite);
  const team = trpc.jp.tasks.byPerson.useQuery({ siteId }, { enabled: Boolean(siteId) });
  const [error, setError] = useState<string | null>(null);
  const move = async (taskId: string, status: "In Progress" | "Completed" | "Blocked") => {
    setError(null);
    try {
      await update.mutateAsync({
        taskId,
        status,
        reason: status === "Blocked" ? "Reported blocked by the assignee" : undefined,
        clientMutationId: createClientMutationId(),
      });
      await mine.refetch();
      if (siteId) await team.refetch();
    } catch (cause) {
      setError(cause instanceof Error ? t(cause.message) : t("Could not save."));
    }
  };
  const open = (mine.data ?? []).filter(
    (task) => task.status !== "Completed" && task.status !== "Cancelled",
  );
  const done = (mine.data ?? []).filter((task) => task.status === "Completed").length;

  return (
    <AuthGate>
      <Screen>
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 32 }}
        >
          <AppHeader
            eyebrow={t("Plan")}
            title={t("My tasks")}
            subtitle={t("Work given to you on every site; mark it started, done or blocked.")}
          />
          <View style={{ gap: 10 }}>
            {error ? <InlineError message={error} onRetry={() => setError(null)} /> : null}
            {mine.isLoading ? (
              <LoadingBlock label={t("Loading…")} />
            ) : mine.isError ? (
              <InlineError message={t(mine.error.message)} onRetry={() => void mine.refetch()} />
            ) : (
              <>
                <Card>
                  <Text style={[styles.big, { color: colors.foreground }]}>
                    {done} / {mine.data?.length ?? 0}
                  </Text>
                  <Text style={[styles.meta, { color: colors.muted }]}>{t("tasks done")}</Text>
                </Card>
                {open.length === 0 ? (
                  <EmptyState
                    icon="task-alt"
                    title={t("Nothing open for you")}
                    detail={t("Tasks your manager gives you appear here.")}
                  />
                ) : (
                  open.map((task) => (
                    <Card key={task.id} accent={task.overdue ? "error" : TONE[task.status]}>
                      <View style={styles.top}>
                        <Text style={[styles.title, { color: colors.foreground }]}>
                          {task.title}
                        </Text>
                        <StatusPill
                          compact
                          label={t(task.overdue ? "Overdue" : task.status)}
                          tone={task.overdue ? "error" : (TONE[task.status] ?? "info")}
                        />
                      </View>
                      <Text style={[styles.meta, { color: colors.muted }]}>
                        {task.siteName} · {task.plannedStart} → {task.plannedEnd}
                      </Text>
                      <View style={styles.actions}>
                        {task.status === "Planned" || task.status === "Blocked" ? (
                          <PrimaryButton
                            icon="play-arrow"
                            label={t("Start")}
                            onPress={() => void move(task.id, "In Progress")}
                          />
                        ) : null}
                        {task.status === "In Progress" ? (
                          <PrimaryButton
                            icon="check"
                            label={t("Mark done")}
                            onPress={() => void move(task.id, "Completed")}
                          />
                        ) : null}
                        {task.status === "In Progress" ? (
                          <SecondaryButton
                            label={t("Blocked")}
                            onPress={() => void move(task.id, "Blocked")}
                          />
                        ) : null}
                      </View>
                    </Card>
                  ))
                )}
              </>
            )}
            {managerSites.length ? (
              <>
                <SectionHeader title={t("Team progress")} />
                <ChipGroup
                  options={managerSites.map((site) => site.id)}
                  value={siteId || null}
                  onChange={setSite}
                  format={(id) => managerSites.find((site) => site.id === id)?.name ?? id}
                />
                {(team.data ?? []).map((person) => (
                  <Card key={person.name}>
                    <Text style={[styles.title, { color: colors.foreground }]}>
                      {t(person.name)}
                    </Text>
                    <Text style={[styles.meta, { color: colors.muted }]}>
                      {t("{done} of {total} done · {open} in progress · {late} overdue", {
                        done: person.done,
                        total: person.total,
                        open: person.inProgress,
                        late: person.overdue,
                      })}
                    </Text>
                    <View style={[styles.bar, { backgroundColor: colors.border }]}>
                      <View
                        style={[
                          styles.fill,
                          {
                            backgroundColor: colors.success,
                            width: `${person.total ? Math.round((person.done / person.total) * 100) : 0}%`,
                          },
                        ]}
                      />
                    </View>
                  </Card>
                ))}
              </>
            ) : null}
          </View>
        </ScrollView>
      </Screen>
    </AuthGate>
  );
}

const styles = StyleSheet.create({
  big: { fontSize: 28, fontWeight: "900" },
  top: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 },
  title: { fontSize: 15, fontWeight: "800", flexShrink: 1 },
  meta: { fontSize: 12, lineHeight: 18, marginTop: 3 },
  actions: { gap: 6, marginTop: 8 },
  bar: { height: 6, borderRadius: 3, marginTop: 8, overflow: "hidden" },
  fill: { height: 6, borderRadius: 3 },
});
