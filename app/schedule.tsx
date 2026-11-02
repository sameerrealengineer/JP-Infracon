import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import {
  AppHeader,
  EmptyState,
  InlineError,
  PrimaryButton,
  Screen,
  SectionHeader,
  SecondaryButton,
  StatusPill,
} from "@/components/jp/ui";
import { AuthGate } from "@/components/jp/auth-gate";
import { useColors } from "@/hooks/use-colors";
import { resolveSelectedId } from "@/lib/jp/selection";
import { trpc } from "@/lib/trpc";
import { createClientMutationId } from "@/lib/jp/local-repository";
import type { RescheduleStrategy, TaskStatus } from "@/lib/jp/scheduling";

const EMPTY_ID = "00000000-0000-4000-8000-000000000000";
const REASONS = [
  ["weather_rain", "Weather / rain"],
  ["material_shortage", "Material shortage"],
  ["labour_shortage", "Labour shortage"],
  ["equipment_breakdown", "Equipment breakdown"],
  ["drawing_approval_pending", "Drawing / approval pending"],
  ["inspection_pending", "Inspection pending"],
  ["access_issue", "Access issue"],
  ["safety_issue", "Safety issue"],
  ["client_instruction", "Client instruction"],
  ["other", "Other"],
] as const;

function todayString() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}
function friendlyDate(value: string | Date) {
  const date = value instanceof Date ? value : new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime())
    ? String(value)
    : new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(date);
}
function taskTone(status: TaskStatus): "success" | "warning" | "error" | "info" {
  if (status === "Completed") return "success";
  if (status === "On Hold" || status === "Awaiting Inspection") return "warning";
  if (status === "Blocked" || status === "Cancelled") return "error";
  return "info";
}
function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "The server did not confirm this action.";
}

export default function ScheduleScreen() {
  const colors = useColors();
  const utils = trpc.useUtils();
  const sitesQuery = trpc.jp.workspace.mySites.useQuery();
  const capabilitiesQuery = trpc.jp.workspace.myCapabilities.useQuery();
  const [chosenSiteId, setSiteId] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [taskCreateMutationId, setTaskCreateMutationId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [workCategory, setWorkCategory] = useState("");
  const [locationLabel, setLocationLabel] = useState("");
  const [plannedStart, setPlannedStart] = useState(todayString());
  const [plannedEnd, setPlannedEnd] = useState(todayString());
  const [priority, setPriority] = useState<"Low" | "Normal" | "High" | "Critical">("Normal");
  const [dependencyTaskId, setDependencyTaskId] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [rescheduleTaskId, setRescheduleTaskId] = useState<string | null>(null);
  const [rescheduleMutationId, setRescheduleMutationId] = useState<string | null>(null);
  const [newStartDate, setNewStartDate] = useState("");
  const [strategy, setStrategy] = useState<RescheduleStrategy>("selected_only");
  const [reasonCode, setReasonCode] = useState<(typeof REASONS)[number][0]>("weather_rain");
  const [reasonText, setReasonText] = useState("");
  const [previewRequest, setPreviewRequest] = useState<{
    taskId: string;
    newStartDate: string;
    strategy: RescheduleStrategy;
  } | null>(null);
  const [statusTaskId, setStatusTaskId] = useState<string | null>(null);
  const [statusTarget, setStatusTarget] = useState<TaskStatus | null>(null);
  const [statusReason, setStatusReason] = useState("");
  const [statusMutationId, setStatusMutationId] = useState<string | null>(null);
  const [historyTaskId, setHistoryTaskId] = useState<string | null>(null);

  const siteOptions = useMemo(
    () =>
      (sitesQuery.data ?? []).filter((site) =>
        capabilitiesQuery.data?.some(
          (capability) => capability.siteId === site.id && capability["task.view"],
        ),
      ),
    [sitesQuery.data, capabilitiesQuery.data],
  );
  const siteId = resolveSelectedId(siteOptions, chosenSiteId);

  const activeSite = siteOptions.find((site) => site.id === siteId);
  const capabilities = capabilitiesQuery.data?.find((item) => item.siteId === siteId);
  const canManage = Boolean(capabilities?.["task.manage"]);
  const canUpdateStatus = Boolean(capabilities?.["task.status.update"]);
  const tasksQuery = trpc.jp.tasks.list.useQuery(
    { siteId: siteId || EMPTY_ID },
    { enabled: Boolean(siteId) },
  );
  const createMutation = trpc.jp.tasks.create.useMutation();
  const rescheduleMutation = trpc.jp.tasks.reschedule.useMutation();
  const statusMutation = trpc.jp.tasks.updateStatus.useMutation();
  const historyQuery = trpc.jp.tasks.history.useQuery(
    { taskId: historyTaskId ?? EMPTY_ID },
    { enabled: Boolean(historyTaskId) },
  );
  const previewQuery = trpc.jp.tasks.previewReschedule.useQuery(
    previewRequest ?? { taskId: EMPTY_ID, newStartDate: todayString(), strategy: "selected_only" },
    { enabled: Boolean(previewRequest) },
  );
  const currentPreview =
    previewRequest &&
    previewRequest.taskId === rescheduleTaskId &&
    previewRequest.newStartDate === newStartDate &&
    previewRequest.strategy === strategy
      ? previewQuery.data
      : undefined;

  const clearReschedule = () => {
    setRescheduleTaskId(null);
    setRescheduleMutationId(null);
    setPreviewRequest(null);
    setReasonText("");
  };

  const createTask = async () => {
    if (!siteId || !title.trim()) {
      setMessage("Choose a site and enter a task title.");
      return;
    }
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(plannedStart) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(plannedEnd) ||
      plannedStart > plannedEnd
    ) {
      setMessage("Enter valid dates; the planned end cannot precede the start.");
      return;
    }
    const clientMutationId = taskCreateMutationId ?? createClientMutationId();
    setTaskCreateMutationId(clientMutationId);
    try {
      await createMutation.mutateAsync({
        siteId,
        title: title.trim(),
        description: description.trim() || undefined,
        workCategory: workCategory.trim() || undefined,
        locationLabel: locationLabel.trim() || undefined,
        plannedStart,
        plannedEnd,
        priority,
        dependencies: dependencyTaskId ? [{ taskId: dependencyTaskId, lagDays: 0 }] : [],
        clientMutationId,
      });
      setTitle("");
      setDescription("");
      setWorkCategory("");
      setLocationLabel("");
      setDependencyTaskId("");
      setTaskCreateMutationId(null);
      setShowCreate(false);
      setMessage(
        "Task saved to the server schedule. Its initial planned dates are retained in revision history.",
      );
      await tasksQuery.refetch();
    } catch (error) {
      setMessage(`Task was not saved: ${errorMessage(error)}`);
    }
  };

  const previewSchedule = () => {
    if (!rescheduleTaskId) return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(newStartDate)) {
      setMessage("Enter a valid proposed start date before previewing.");
      return;
    }
    setPreviewRequest({ taskId: rescheduleTaskId, newStartDate, strategy });
    setMessage(null);
  };

  const applyReschedule = async () => {
    const selected = tasksQuery.data?.find((task) => task.id === rescheduleTaskId);
    if (!selected || !currentPreview?.canApply) return;
    if (reasonCode === "other" && !reasonText.trim()) {
      setMessage("Add a short note when the reason is Other.");
      return;
    }
    const clientMutationId = rescheduleMutationId ?? createClientMutationId();
    setRescheduleMutationId(clientMutationId);
    try {
      await rescheduleMutation.mutateAsync({
        taskId: selected.id,
        newStartDate,
        strategy,
        reasonCode,
        reasonText: reasonText.trim() || undefined,
        expectedScheduleSnapshot: currentPreview.scheduleSnapshot,
        clientMutationId,
      });
      setMessage(
        "Reschedule applied after impact review. Original and revised dates remain in schedule history.",
      );
      clearReschedule();
      await tasksQuery.refetch();
    } catch (error) {
      setMessage(`Reschedule was not applied: ${errorMessage(error)}`);
    }
  };

  const applyStatus = async (taskId: string) => {
    if (!statusTarget) return;
    if (["On Hold", "Blocked", "Cancelled"].includes(statusTarget) && !statusReason.trim()) {
      setMessage("Add a reason before placing a task on hold, blocking, or cancelling it.");
      return;
    }
    const clientMutationId = statusMutationId ?? createClientMutationId();
    setStatusMutationId(clientMutationId);
    try {
      await statusMutation.mutateAsync({
        taskId,
        status: statusTarget,
        reason: statusReason.trim() || undefined,
        clientMutationId,
      });
      setMessage(
        `Task status changed to ${statusTarget}. The change is recorded in audit history.`,
      );
      setStatusTaskId(null);
      setStatusTarget(null);
      setStatusReason("");
      setStatusMutationId(null);
      await tasksQuery.refetch();
    } catch (error) {
      setMessage(`Status was not changed: ${errorMessage(error)}`);
    }
  };

  const refresh = () => {
    void Promise.all([sitesQuery.refetch(), capabilitiesQuery.refetch(), tasksQuery.refetch()]);
  };
  const activeTasks = tasksQuery.data ?? [];

  return (
    <AuthGate>
      <Screen>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
          <AppHeader
            eyebrow="Site operations"
            title="Schedule"
            subtitle="Task dates, dependencies, and reviewed schedule changes."
          />
          {sitesQuery.isError ? (
            <InlineError message={sitesQuery.error.message} onRetry={refresh} />
          ) : null}
          {capabilitiesQuery.isError ? (
            <InlineError message={capabilitiesQuery.error.message} onRetry={refresh} />
          ) : null}

          <SectionHeader title="Assigned sites" />
          {siteOptions.length > 0 ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.siteRow}
            >
              {siteOptions.map((site) => (
                <Pressable
                  key={site.id}
                  accessibilityRole="button"
                  accessibilityState={{ selected: site.id === siteId }}
                  onPress={() => {
                    setSiteId(site.id);
                    setTaskCreateMutationId(null);
                    clearReschedule();
                    setHistoryTaskId(null);
                  }}
                  style={[
                    styles.siteChip,
                    {
                      backgroundColor: site.id === siteId ? `${colors.primary}17` : colors.surface,
                      borderColor: site.id === siteId ? colors.primary : colors.border,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.siteName,
                      { color: site.id === siteId ? colors.primary : colors.foreground },
                    ]}
                  >
                    {site.name}
                  </Text>
                  <Text style={[styles.siteProject, { color: colors.muted }]}>{site.project}</Text>
                </Pressable>
              ))}
            </ScrollView>
          ) : sitesQuery.isLoading || capabilitiesQuery.isLoading ? (
            <LoadingLine label="Loading authorised sites…" />
          ) : (
            <EmptyState
              icon="location-off"
              title="No schedule access"
              detail="No active site with task-view permission is available to this account."
            />
          )}

          {activeSite ? (
            <>
              <View style={styles.scopeNote}>
                <MaterialIcons name="event-note" size={18} color={colors.primary} />
                <Text style={[styles.scopeNoteText, { color: colors.muted }]}>
                  {activeSite.project} · {activeSite.name}. Dates use calendar days; configurable
                  site work calendars, resource clashes, and schedule approvals are not yet modeled.
                </Text>
              </View>
              {message ? (
                <View
                  style={[
                    styles.messageCard,
                    { backgroundColor: `${colors.primary}12`, borderColor: `${colors.primary}45` },
                  ]}
                >
                  <Text style={[styles.messageText, { color: colors.foreground }]}>{message}</Text>
                </View>
              ) : null}
              <View style={styles.taskHeader}>
                <View>
                  <Text style={[styles.kicker, { color: colors.muted }]}>SITE TASK REGISTER</Text>
                  <Text style={[styles.taskHeading, { color: colors.foreground }]}>
                    {tasksQuery.isSuccess
                      ? `${activeTasks.length} persisted task${activeTasks.length === 1 ? "" : "s"}`
                      : tasksQuery.isError
                        ? "Task register unavailable"
                        : "Loading site tasks…"}
                  </Text>
                </View>
                {canManage ? (
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => setShowCreate((value) => !value)}
                    style={[styles.addButton, { backgroundColor: colors.primary }]}
                  >
                    <MaterialIcons
                      name={showCreate ? "close" : "add"}
                      size={18}
                      color={colors.background}
                    />
                    <Text style={[styles.addText, { color: colors.background }]}>
                      {showCreate ? "Close" : "New task"}
                    </Text>
                  </Pressable>
                ) : null}
              </View>

              {showCreate && canManage ? (
                <View
                  style={[
                    styles.formCard,
                    { backgroundColor: colors.surface, borderColor: colors.border },
                  ]}
                >
                  <Text style={[styles.formTitle, { color: colors.foreground }]}>
                    Create planned task
                  </Text>
                  <Field
                    label="Task title"
                    value={title}
                    onChangeText={(value) => {
                      setTitle(value);
                      setTaskCreateMutationId(null);
                    }}
                    placeholder="e.g. Install delivery main, chainage 0–250 m"
                  />
                  <Field
                    label="Work category (optional)"
                    value={workCategory}
                    onChangeText={(value) => {
                      setWorkCategory(value);
                      setTaskCreateMutationId(null);
                    }}
                    placeholder="Pipeline / concrete / electrical…"
                  />
                  <Field
                    label="Location / zone (optional)"
                    value={locationLabel}
                    onChangeText={(value) => {
                      setLocationLabel(value);
                      setTaskCreateMutationId(null);
                    }}
                    placeholder="Zone, chainage, structure"
                  />
                  <Field
                    label="Description (optional)"
                    value={description}
                    onChangeText={(value) => {
                      setDescription(value);
                      setTaskCreateMutationId(null);
                    }}
                    placeholder="Scope notes"
                    multiline
                  />
                  <View style={styles.twoColumns}>
                    <View style={styles.column}>
                      <Field
                        label="Planned start · YYYY-MM-DD"
                        value={plannedStart}
                        onChangeText={(value) => {
                          setPlannedStart(value);
                          setTaskCreateMutationId(null);
                        }}
                        placeholder="2026-10-26"
                      />
                      <Text style={[styles.fieldHint, { color: colors.muted }]}>
                        Initial planned end
                      </Text>
                      <Field
                        label="Planned end · YYYY-MM-DD"
                        value={plannedEnd}
                        onChangeText={(value) => {
                          setPlannedEnd(value);
                          setTaskCreateMutationId(null);
                        }}
                        placeholder="2026-10-26"
                      />
                    </View>
                  </View>
                  <Text style={[styles.inputLabel, { color: colors.muted }]}>Priority</Text>
                  <View style={styles.choiceRow}>
                    {(["Low", "Normal", "High", "Critical"] as const).map((item) => (
                      <Choice
                        key={item}
                        label={item}
                        selected={priority === item}
                        onPress={() => {
                          setPriority(item);
                          setTaskCreateMutationId(null);
                        }}
                      />
                    ))}
                  </View>
                  {activeTasks.length > 0 ? (
                    <>
                      <Text style={[styles.inputLabel, { color: colors.muted }]}>
                        Depends on (optional)
                      </Text>
                      <View style={styles.choiceStack}>
                        <Choice
                          label="No predecessor"
                          selected={!dependencyTaskId}
                          onPress={() => {
                            setDependencyTaskId("");
                            setTaskCreateMutationId(null);
                          }}
                        />
                        {activeTasks
                          .filter((task) => task.status !== "Cancelled")
                          .map((task) => (
                            <Choice
                              key={task.id}
                              label={`${task.taskCode} · ${task.title}`}
                              selected={dependencyTaskId === task.id}
                              onPress={() => {
                                setDependencyTaskId(task.id);
                                setTaskCreateMutationId(null);
                              }}
                            />
                          ))}
                      </View>
                    </>
                  ) : null}
                  <View
                    style={[
                      styles.notice,
                      {
                        backgroundColor: `${colors.warning}11`,
                        borderColor: `${colors.warning}35`,
                      },
                    ]}
                  >
                    <MaterialIcons name="info-outline" size={17} color={colors.warning} />
                    <Text style={[styles.noticeText, { color: colors.muted }]}>
                      Task creation is online-only. A Finish-to-Start predecessor must finish before
                      this task starts. No worker/team is assigned and no stock or cost is posted.
                    </Text>
                  </View>
                  <PrimaryButton
                    icon="save"
                    label={createMutation.isPending ? "Saving task…" : "Save task"}
                    disabled={createMutation.isPending}
                    onPress={() => {
                      void createTask();
                    }}
                  />
                </View>
              ) : null}

              {tasksQuery.isLoading ? (
                <LoadingLine label="Loading site schedule from the server…" />
              ) : tasksQuery.isError ? (
                <InlineError
                  message={tasksQuery.error.message}
                  onRetry={() => {
                    void tasksQuery.refetch();
                  }}
                />
              ) : activeTasks.length === 0 ? (
                <EmptyState
                  icon="event-busy"
                  title="No tasks scheduled"
                  detail={
                    canManage
                      ? "This site has no persisted tasks yet. Add a task to start its schedule."
                      : "No task record exists in this site yet."
                  }
                  action={canManage ? "Create first task" : undefined}
                  onPress={() => setShowCreate(true)}
                />
              ) : (
                <View style={styles.taskStack}>
                  {activeTasks.map((task) => {
                    const isRescheduling = rescheduleTaskId === task.id;
                    const isHistoryOpen = historyTaskId === task.id;
                    const statusIsOpen = statusTaskId === task.id;
                    return (
                      <View
                        key={task.id}
                        style={[
                          styles.taskCard,
                          { backgroundColor: colors.surface, borderColor: colors.border },
                        ]}
                      >
                        <View style={styles.cardTop}>
                          <View style={{ flex: 1 }}>
                            <Text style={[styles.taskCode, { color: colors.primary }]}>
                              {task.taskCode} · {task.priority.toUpperCase()}
                            </Text>
                            <Text style={[styles.cardTitle, { color: colors.foreground }]}>
                              {task.title}
                            </Text>
                          </View>
                          <StatusPill
                            label={task.status}
                            tone={taskTone(task.status as TaskStatus)}
                            compact
                          />
                        </View>
                        <Text style={[styles.cardDates, { color: colors.foreground }]}>
                          {friendlyDate(task.plannedStart)} — {friendlyDate(task.plannedEnd)} ·
                          Revision {task.scheduleRevision}
                        </Text>
                        {task.locationLabel ? (
                          <Text style={[styles.cardMeta, { color: colors.muted }]}>
                            {task.locationLabel}
                            {task.workCategory ? ` · ${task.workCategory}` : ""}
                          </Text>
                        ) : task.workCategory ? (
                          <Text style={[styles.cardMeta, { color: colors.muted }]}>
                            {task.workCategory}
                          </Text>
                        ) : null}
                        {task.description ? (
                          <Text style={[styles.cardDescription, { color: colors.muted }]}>
                            {task.description}
                          </Text>
                        ) : null}
                        {task.dependencies.map((dependency) => (
                          <Text
                            key={dependency.id}
                            style={[styles.cardDependency, { color: colors.primary }]}
                          >
                            {dependency.dependencyType} ·{" "}
                            {dependency.predecessor?.taskCode ?? "Predecessor"}
                            {dependency.lagDays ? ` + ${dependency.lagDays} calendar day(s)` : ""}
                          </Text>
                        ))}
                        <View style={styles.actionRow}>
                          {canManage &&
                          task.status !== "Completed" &&
                          task.status !== "Cancelled" ? (
                            <SecondaryButton
                              icon="event-repeat"
                              label="Reschedule"
                              onPress={() => {
                                if (isRescheduling) clearReschedule();
                                else {
                                  setRescheduleTaskId(task.id);
                                  setRescheduleMutationId(null);
                                  setNewStartDate(task.plannedStart);
                                  setPreviewRequest(null);
                                }
                                setMessage(null);
                              }}
                            />
                          ) : null}
                          <SecondaryButton
                            icon="history"
                            label={isHistoryOpen ? "Close history" : "History"}
                            onPress={() => setHistoryTaskId(isHistoryOpen ? null : task.id)}
                          />
                          {canUpdateStatus &&
                          task.status !== "Completed" &&
                          task.status !== "Cancelled" ? (
                            <SecondaryButton
                              icon="swap-horiz"
                              label={statusIsOpen ? "Close status" : "Update status"}
                              onPress={() => {
                                setStatusTaskId(statusIsOpen ? null : task.id);
                                setStatusTarget(null);
                                setStatusReason("");
                                setStatusMutationId(null);
                              }}
                            />
                          ) : null}
                        </View>

                        {isRescheduling ? (
                          <View
                            style={[
                              styles.inlinePanel,
                              { backgroundColor: colors.background, borderColor: colors.border },
                            ]}
                          >
                            <Text style={[styles.panelTitle, { color: colors.foreground }]}>
                              Propose a new start date
                            </Text>
                            <Field
                              label="New start · YYYY-MM-DD"
                              value={newStartDate}
                              onChangeText={(value) => {
                                setNewStartDate(value);
                                setPreviewRequest(null);
                                setRescheduleMutationId(null);
                              }}
                              placeholder="2026-10-27"
                            />
                            <Text style={[styles.inputLabel, { color: colors.muted }]}>
                              Impact strategy
                            </Text>
                            <View style={styles.choiceStack}>
                              <Choice
                                label="Move this task only"
                                selected={strategy === "selected_only"}
                                onPress={() => {
                                  setStrategy("selected_only");
                                  setPreviewRequest(null);
                                  setRescheduleMutationId(null);
                                }}
                              />
                              <Choice
                                label="Shift all dependent tasks by the same days"
                                selected={strategy === "shift_dependents"}
                                onPress={() => {
                                  setStrategy("shift_dependents");
                                  setPreviewRequest(null);
                                  setRescheduleMutationId(null);
                                }}
                              />
                            </View>
                            <Text style={[styles.inputLabel, { color: colors.muted }]}>Reason</Text>
                            <View style={styles.choiceStack}>
                              {REASONS.map(([code, label]) => (
                                <Choice
                                  key={code}
                                  label={label}
                                  selected={reasonCode === code}
                                  onPress={() => {
                                    setReasonCode(code);
                                    setRescheduleMutationId(null);
                                  }}
                                />
                              ))}
                            </View>
                            {reasonCode === "other" ? (
                              <Field
                                label="Reason note (required for Other)"
                                value={reasonText}
                                onChangeText={(value) => {
                                  setReasonText(value);
                                  setRescheduleMutationId(null);
                                }}
                                placeholder="Explain why this schedule must change"
                                multiline
                              />
                            ) : (
                              <Field
                                label="Additional note (optional)"
                                value={reasonText}
                                onChangeText={(value) => {
                                  setReasonText(value);
                                  setRescheduleMutationId(null);
                                }}
                                placeholder="Add context for the audit trail"
                                multiline
                              />
                            )}
                            <SecondaryButton
                              icon="preview"
                              label={
                                previewQuery.isFetching
                                  ? "Preparing preview…"
                                  : "Preview schedule impact"
                              }
                              disabled={previewQuery.isFetching}
                              onPress={previewSchedule}
                            />
                            {previewQuery.isError && previewRequest?.taskId === task.id ? (
                              <InlineError
                                message={previewQuery.error.message}
                                onRetry={previewSchedule}
                              />
                            ) : null}
                            {currentPreview ? (
                              <View
                                style={[
                                  styles.previewCard,
                                  {
                                    backgroundColor: `${currentPreview.canApply ? colors.primary : colors.error}10`,
                                    borderColor: `${currentPreview.canApply ? colors.primary : colors.error}45`,
                                  },
                                ]}
                              >
                                <Text style={[styles.previewTitle, { color: colors.foreground }]}>
                                  {currentPreview.canApply
                                    ? `Impact preview · ${currentPreview.deltaDays > 0 ? "+" : ""}${currentPreview.deltaDays} calendar day(s)`
                                    : "Schedule change blocked"}
                                </Text>
                                {currentPreview.impactedTasks.map((impact) => (
                                  <View
                                    key={impact.id}
                                    style={[styles.impactRow, { borderTopColor: colors.border }]}
                                  >
                                    <Text style={[styles.impactName, { color: colors.foreground }]}>
                                      {impact.title}
                                      {impact.willMove ? " · shifts" : " · unchanged"}
                                    </Text>
                                    <Text style={[styles.impactDates, { color: colors.muted }]}>
                                      {friendlyDate(impact.currentStart)}–
                                      {friendlyDate(impact.currentEnd)} →{" "}
                                      {friendlyDate(impact.proposedStart)}–
                                      {friendlyDate(impact.proposedEnd)}
                                    </Text>
                                  </View>
                                ))}
                                {currentPreview.blockingConflicts.map((conflict, index) => (
                                  <Text
                                    key={`${conflict.kind}-${index}`}
                                    style={[styles.conflictText, { color: colors.error }]}
                                  >
                                    {conflict.message}
                                  </Text>
                                ))}
                                <Text style={[styles.auditHint, { color: colors.muted }]}>
                                  Review the affected dates. Applying this change requires a second
                                  tap and records a reason and each old/new date.
                                </Text>
                                <PrimaryButton
                                  icon="check"
                                  label={
                                    rescheduleMutation.isPending
                                      ? "Applying…"
                                      : "Confirm reschedule"
                                  }
                                  disabled={
                                    !currentPreview.canApply || rescheduleMutation.isPending
                                  }
                                  onPress={() => {
                                    void applyReschedule();
                                  }}
                                />
                              </View>
                            ) : null}
                          </View>
                        ) : null}

                        {statusIsOpen ? (
                          <View
                            style={[
                              styles.inlinePanel,
                              { backgroundColor: colors.background, borderColor: colors.border },
                            ]}
                          >
                            <Text style={[styles.panelTitle, { color: colors.foreground }]}>
                              Task status
                            </Text>
                            <View style={styles.choiceStack}>
                              {(
                                [
                                  "Ready",
                                  "In Progress",
                                  "On Hold",
                                  "Blocked",
                                  "Awaiting Inspection",
                                  "Completed",
                                  "Cancelled",
                                ] as const
                              ).map((target) => (
                                <Choice
                                  key={target}
                                  label={target}
                                  selected={statusTarget === target}
                                  onPress={() => {
                                    setStatusTarget(target);
                                    setStatusMutationId(createClientMutationId());
                                  }}
                                />
                              ))}
                            </View>
                            {statusTarget &&
                            ["On Hold", "Blocked", "Cancelled"].includes(statusTarget) ? (
                              <Field
                                label="Reason (required)"
                                value={statusReason}
                                onChangeText={(value) => {
                                  setStatusReason(value);
                                  setStatusMutationId(createClientMutationId());
                                }}
                                placeholder="Why is this task changing status?"
                                multiline
                              />
                            ) : null}
                            <PrimaryButton
                              icon="save"
                              label={
                                statusMutation.isPending
                                  ? "Updating…"
                                  : `Save ${statusTarget ?? "status"}`
                              }
                              disabled={!statusTarget || statusMutation.isPending}
                              onPress={() => {
                                void applyStatus(task.id);
                              }}
                            />
                          </View>
                        ) : null}

                        {isHistoryOpen ? (
                          <View
                            style={[
                              styles.inlinePanel,
                              { backgroundColor: colors.background, borderColor: colors.border },
                            ]}
                          >
                            <Text style={[styles.panelTitle, { color: colors.foreground }]}>
                              Schedule history
                            </Text>
                            {historyQuery.isLoading ? (
                              <LoadingLine label="Loading immutable revisions…" />
                            ) : historyQuery.isError ? (
                              <InlineError
                                message={historyQuery.error.message}
                                onRetry={() => {
                                  void historyQuery.refetch();
                                }}
                              />
                            ) : (
                              (historyQuery.data ?? []).map((revision) => (
                                <View
                                  key={revision.id}
                                  style={[styles.historyRow, { borderTopColor: colors.border }]}
                                >
                                  <Text style={[styles.impactName, { color: colors.foreground }]}>
                                    Revision {revision.revisionNumber} · {revision.changeType}
                                  </Text>
                                  <Text style={[styles.impactDates, { color: colors.muted }]}>
                                    {revision.oldStart
                                      ? `${friendlyDate(revision.oldStart)}–${friendlyDate(revision.oldEnd!)} → `
                                      : "Initial plan · "}
                                    {friendlyDate(revision.newStart)}–
                                    {friendlyDate(revision.newEnd)}
                                  </Text>
                                  <Text style={[styles.auditHint, { color: colors.muted }]}>
                                    {revision.reasonCode.replaceAll("_", " ")}
                                    {revision.reasonText ? ` · ${revision.reasonText}` : ""} ·{" "}
                                    {revision.requesterName || "Account user"} ·{" "}
                                    {friendlyDate(revision.createdAt)}
                                  </Text>
                                </View>
                              ))
                            )}
                          </View>
                        ) : null}
                      </View>
                    );
                  })}
                </View>
              )}
              <View
                style={[
                  styles.notice,
                  { backgroundColor: colors.surface, borderColor: colors.border },
                ]}
              >
                <MaterialIcons name="history" size={16} color={colors.primary} />
                <Text style={[styles.noticeText, { color: colors.muted }]}>
                  Reschedule previews are re-computed on the server under a site schedule lock.
                  Conflicts block applying. Workday calendars, resource assignment conflicts,
                  calendar views, and approval routing remain future work.
                </Text>
              </View>
            </>
          ) : null}
        </ScrollView>
      </Screen>
    </AuthGate>
  );
}

function Field({
  label,
  value,
  onChangeText,
  placeholder,
  multiline = false,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
  multiline?: boolean;
}) {
  const colors = useColors();
  return (
    <View style={styles.field}>
      <Text style={[styles.inputLabel, { color: colors.muted }]}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.muted}
        multiline={multiline}
        autoCapitalize="sentences"
        style={[
          styles.input,
          multiline && styles.multiline,
          {
            color: colors.foreground,
            backgroundColor: colors.background,
            borderColor: colors.border,
          },
        ]}
      />
    </View>
  );
}

function Choice({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  const colors = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[
        styles.choice,
        {
          backgroundColor: selected ? `${colors.primary}13` : colors.background,
          borderColor: selected ? colors.primary : colors.border,
        },
      ]}
    >
      <Text style={[styles.choiceText, { color: selected ? colors.primary : colors.foreground }]}>
        {label}
      </Text>
    </Pressable>
  );
}

function LoadingLine({ label }: { label: string }) {
  const colors = useColors();
  return (
    <View style={styles.loading}>
      <ActivityIndicator color={colors.primary} />
      <Text style={[styles.loadingText, { color: colors.muted }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { paddingBottom: 34 },
  siteRow: { gap: 8, paddingBottom: 10 },
  siteChip: {
    minWidth: 154,
    maxWidth: 240,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  siteName: { fontSize: 12, fontWeight: "800" },
  siteProject: { fontSize: 10, marginTop: 4 },
  scopeNote: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    marginVertical: 10,
    padding: 12,
    borderRadius: 13,
  },
  scopeNoteText: { flex: 1, fontSize: 11, lineHeight: 16 },
  messageCard: { borderWidth: 1, borderRadius: 12, padding: 11, marginBottom: 12 },
  messageText: { fontSize: 12, lineHeight: 17 },
  taskHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 10,
    marginBottom: 12,
  },
  kicker: { fontSize: 9, letterSpacing: 1.25, fontWeight: "800" },
  taskHeading: { fontSize: 16, fontWeight: "800", marginTop: 3 },
  addButton: {
    minHeight: 40,
    borderRadius: 12,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  addText: { fontSize: 11, fontWeight: "800" },
  formCard: { borderWidth: 1, borderRadius: 18, padding: 14, marginBottom: 16 },
  formTitle: { fontSize: 15, fontWeight: "800", marginBottom: 9 },
  field: { marginBottom: 9 },
  inputLabel: { fontSize: 11, fontWeight: "800", marginBottom: 5 },
  input: {
    minHeight: 43,
    borderWidth: 1,
    borderRadius: 11,
    paddingHorizontal: 11,
    paddingVertical: 9,
    fontSize: 12,
  },
  multiline: { minHeight: 64, textAlignVertical: "top" },
  fieldHint: { fontSize: 10, marginTop: 0, marginBottom: 5 },
  twoColumns: { flexDirection: "row", gap: 8 },
  column: { flex: 1 },
  choiceRow: { flexDirection: "row", flexWrap: "wrap", gap: 7, marginBottom: 9 },
  choiceStack: { gap: 6, marginBottom: 9 },
  choice: {
    minHeight: 38,
    borderWidth: 1,
    borderRadius: 11,
    paddingHorizontal: 10,
    paddingVertical: 8,
    justifyContent: "center",
  },
  choiceText: { fontSize: 11, fontWeight: "700" },
  notice: {
    borderWidth: 1,
    borderRadius: 13,
    padding: 11,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    marginVertical: 10,
  },
  noticeText: { flex: 1, fontSize: 11, lineHeight: 16 },
  taskStack: { gap: 11 },
  taskCard: { borderWidth: 1, borderRadius: 17, padding: 13 },
  cardTop: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  taskCode: { fontSize: 9, letterSpacing: 0.7, fontWeight: "800" },
  cardTitle: { fontSize: 15, lineHeight: 20, fontWeight: "800", marginTop: 4 },
  cardDates: { fontSize: 11, fontWeight: "700", marginTop: 10 },
  cardMeta: { fontSize: 10, marginTop: 5 },
  cardDescription: { fontSize: 11, lineHeight: 16, marginTop: 7 },
  cardDependency: { fontSize: 10, fontWeight: "700", marginTop: 7 },
  actionRow: { flexDirection: "row", flexWrap: "wrap", gap: 7, marginTop: 12 },
  inlinePanel: { borderWidth: 1, borderRadius: 14, padding: 11, marginTop: 12 },
  panelTitle: { fontSize: 13, fontWeight: "800", marginBottom: 8 },
  previewCard: { borderWidth: 1, borderRadius: 13, padding: 11, marginTop: 10 },
  previewTitle: { fontSize: 13, fontWeight: "800", marginBottom: 6 },
  impactRow: { borderTopWidth: 1, paddingTop: 7, marginTop: 5 },
  historyRow: { borderTopWidth: 1, paddingTop: 8, marginTop: 6 },
  impactName: { fontSize: 11, fontWeight: "800" },
  impactDates: { fontSize: 10, lineHeight: 15, marginTop: 3 },
  conflictText: { fontSize: 11, lineHeight: 15, fontWeight: "700", marginTop: 8 },
  auditHint: { fontSize: 10, lineHeight: 15, marginTop: 7, marginBottom: 8 },
  loading: {
    minHeight: 80,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 9,
  },
  loadingText: { fontSize: 11 },
});
