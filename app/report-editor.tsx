import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from "react-native";

import { AuthGate } from "@/components/jp/auth-gate";
import { LabourSummaryCard } from "@/components/jp/labour-summary";
import { VoiceReportAssist } from "@/components/jp/voice-assist";
import type { ReportDraftFields } from "@/lib/jp/ai-report-extraction";
import {
  AppHeader,
  Card,
  ChipGroup,
  EmptyState,
  Field,
  InlineError,
  LoadingBlock,
  PrimaryButton,
  Screen,
  SecondaryButton,
  SectionHeader,
} from "@/components/jp/ui";
import { useColors } from "@/hooks/use-colors";
import { useWorkspace } from "@/hooks/use-workspace";
import type { FieldReport } from "@/lib/jp/domain";
import {
  displayQuantity,
  MAX_DPR_ITEMS,
  SITE_STATUS_OPTIONS,
  WEATHER_OPTIONS,
  normalizeDprItem,
  suggestCumulative,
  type DprItemInput,
} from "@/lib/jp/dpr-domain";
import {
  createClientMutationId,
  removeLocalDraft,
  saveReportDraft,
} from "@/lib/jp/local-repository";
import { resolveSelectedId } from "@/lib/jp/selection";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@/server/routers";
import { trpc } from "@/lib/trpc";

/** A work line as typed on screen; quantities stay text until the rules normalise them. */
export type EditorLine = {
  key: string;
  taskId: string | null;
  description: string;
  locationLabel: string;
  unitCode: string;
  plannedQuantity: string;
  completedQuantityToday: string;
  cumulativeQuantity: string;
  /** Cumulative from the last report for this work, used to suggest today's cumulative. */
  previousCumulative: string | null;
  remarks: string;
};

type Kind = "DPR" | "DLR";

function today() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function blankLine(): EditorLine {
  return {
    key: createClientMutationId(),
    taskId: null,
    description: "",
    locationLabel: "",
    unitCode: "",
    plannedQuantity: "",
    completedQuantityToday: "",
    cumulativeQuantity: "",
    previousCumulative: null,
    remarks: "",
  };
}

function toInput(line: EditorLine): DprItemInput {
  return {
    taskId: line.taskId,
    description: line.description,
    locationLabel: line.locationLabel,
    unitCode: line.unitCode,
    plannedQuantity: line.plannedQuantity,
    completedQuantityToday: line.completedQuantityToday,
    cumulativeQuantity: line.cumulativeQuantity,
    remarks: line.remarks,
  };
}

function lineCheck(line: EditorLine, index: number) {
  try {
    return { item: normalizeDprItem(toInput(line), index + 1), error: null };
  } catch (error) {
    return { item: null, error: error instanceof Error ? error.message : "Check this line." };
  }
}

function errorText(error: unknown) {
  return error instanceof Error ? error.message : "The server did not confirm this action.";
}

const text = displayQuantity;

export default function ReportEditorScreen() {
  const params = useLocalSearchParams<{ reportId?: string; siteId?: string; kind?: string }>();
  const reportId = typeof params.reportId === "string" ? params.reportId : "";
  return (
    <AuthGate>
      <Screen>
        {reportId ? (
          <ExistingReport reportId={reportId} />
        ) : (
          <ReportForm
            mode="create"
            initialSiteId={typeof params.siteId === "string" ? params.siteId : ""}
            initialKind={params.kind === "DLR" ? "DLR" : null}
          />
        )}
      </Screen>
    </AuthGate>
  );
}

/** Opens a saved report: read only, or the correction form for its writer. */
function ExistingReport({ reportId }: { reportId: string }) {
  const detail = trpc.jp.reports.detail.useQuery({ reportId });
  if (detail.isLoading) return <LoadingBlock label="Loading report…" />;
  if (detail.error)
    return <InlineError message={detail.error.message} onRetry={() => void detail.refetch()} />;
  const data = detail.data!;
  if (data.canEdit)
    return (
      <ReportForm
        mode="edit"
        reportId={reportId}
        initialSiteId={data.report.siteId}
        initialKind={data.report.reportKind}
        initial={{
          title: data.report.title,
          weatherCode: data.report.weatherCode,
          overallStatus: data.report.overallStatus,
          remarks: data.report.remarks ?? "",
          nextDayPlan: data.report.nextDayPlan ?? "",
          returnReason: data.report.returnReason,
          reportDate: data.report.reportDate,
          lines: data.items.map((item) => ({
            key: item.id,
            taskId: item.taskId,
            description: item.description,
            locationLabel: item.locationLabel ?? "",
            unitCode: item.unitCode ?? "",
            plannedQuantity: text(item.plannedQuantity),
            completedQuantityToday: text(item.completedQuantityToday),
            cumulativeQuantity: text(item.cumulativeQuantity),
            previousCumulative: null,
            remarks: item.remarks ?? "",
          })),
        }}
      />
    );
  return <ReportView data={data} />;
}

type ReportDetail = inferRouterOutputs<AppRouter>["jp"]["reports"]["detail"];

function ReportView({ data }: { data: ReportDetail }) {
  const colors = useColors();
  const { report, items } = data;
  return (
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
      <AppHeader
        eyebrow={report.reportKind === "DPR" ? "Daily progress report" : "Daily labour report"}
        title={report.title}
        subtitle={`${report.siteName} · ${report.reportDate} · ${report.status}`}
      />
      <Card>
        <Meta label="Written by" value={report.creatorName ?? "—"} />
        <Meta label="Weather" value={report.weatherCode ?? "Not recorded"} />
        <Meta label="Site status" value={report.overallStatus ?? "Not recorded"} />
        {report.returnReason ? <Meta label="Returned because" value={report.returnReason} /> : null}
      </Card>
      {report.reportKind === "DPR" ? (
        <>
          <SectionHeader title={`Work done (${items.length})`} />
          {items.length === 0 ? (
            <Text style={[styles.muted, { color: colors.muted }]}>
              No work lines were recorded.
            </Text>
          ) : (
            items.map((item) => (
              <Card key={item.id}>
                <Text style={[styles.lineTitle, { color: colors.foreground }]}>
                  {item.description}
                </Text>
                {item.locationLabel ? (
                  <Text style={[styles.muted, { color: colors.muted }]}>{item.locationLabel}</Text>
                ) : null}
                {item.unitCode ? (
                  <Text style={[styles.lineNumbers, { color: colors.foreground }]}>
                    Today {text(item.completedQuantityToday) || "—"} · Total{" "}
                    {text(item.cumulativeQuantity) || "—"} of {text(item.plannedQuantity) || "—"}{" "}
                    {item.unitCode}
                    {item.estimatedPercent ? ` · about ${text(item.estimatedPercent)}%` : ""}
                  </Text>
                ) : null}
                {item.remarks ? (
                  <Text style={[styles.muted, { color: colors.muted }]}>{item.remarks}</Text>
                ) : null}
              </Card>
            ))
          )}
        </>
      ) : null}
      {data.labour ? (
        <>
          <SectionHeader title="Attendance for this day" />
          <LabourSummaryCard summary={data.labour} />
        </>
      ) : null}
      {report.remarks ? <Meta label="Notes" value={report.remarks} block /> : null}
      {report.nextDayPlan ? (
        <Meta label="Plan for tomorrow" value={report.nextDayPlan} block />
      ) : null}
    </ScrollView>
  );
}

function Meta({ label, value, block }: { label: string; value: string; block?: boolean }) {
  const colors = useColors();
  return (
    <View style={block ? styles.metaBlock : styles.metaRow}>
      <Text style={[styles.metaLabel, { color: colors.muted }]}>{label}</Text>
      <Text style={[styles.metaValue, { color: colors.foreground }]}>{value}</Text>
    </View>
  );
}

type Initial = {
  title: string;
  weatherCode: string | null;
  overallStatus: string | null;
  remarks: string;
  nextDayPlan: string;
  returnReason: string | null;
  reportDate: string;
  lines: EditorLine[];
};

function ReportForm({
  mode,
  reportId,
  initialSiteId,
  initialKind,
  initial,
}: {
  mode: "create" | "edit";
  reportId?: string;
  initialSiteId: string;
  initialKind: Kind | null;
  initial?: Initial;
}) {
  const colors = useColors();
  const router = useRouter();
  const utils = trpc.useUtils();
  const { me, sitesWith, capabilities } = useWorkspace();
  const sites = trpc.jp.workspace.mySites.useQuery();

  const canDpr = sitesWith("dpr.create");
  const canDlr = sitesWith("dlr.create");
  const defaultKind: Kind = canDpr.length === 0 && canDlr.length > 0 ? "DLR" : "DPR";
  const [chosenKind, setKind] = useState<Kind | null>(initialKind);
  const kind = chosenKind ?? defaultKind;
  const siteOptions = useMemo(
    () =>
      (sites.data ?? []).filter(
        (site) =>
          (kind === "DPR" ? canDpr : canDlr).includes(site.id) &&
          (mode === "edit" || site.status === "Active"),
      ),
    [sites.data, kind, canDpr, canDlr, mode],
  );
  const [chosenSiteId, setSiteId] = useState(initialSiteId);
  const siteId = mode === "edit" ? initialSiteId : resolveSelectedId(siteOptions, chosenSiteId);
  const site = siteOptions.find((row) => row.id === siteId);

  const [title, setTitle] = useState(initial?.title ?? "");
  const [weatherCode, setWeather] = useState<string | null>(initial?.weatherCode ?? null);
  const [overallStatus, setOverall] = useState<string | null>(initial?.overallStatus ?? null);
  const [remarks, setRemarks] = useState(initial?.remarks ?? "");
  const [nextDayPlan, setNextDayPlan] = useState(initial?.nextDayPlan ?? "");
  const [lines, setLines] = useState<EditorLine[]>(initial?.lines ?? []);
  const [message, setMessage] = useState<string | null>(null);
  const [aiNotice, setAiNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const reportDate = initial?.reportDate ?? today();
  const context = trpc.jp.reports.progressContext.useQuery(
    { siteId, excludeReportId: reportId },
    { enabled: kind === "DPR" && Boolean(siteId), retry: false },
  );
  const labour = trpc.jp.reports.labourSnapshot.useQuery(
    { siteId, workDate: reportDate },
    { enabled: kind === "DLR" && Boolean(siteId), retry: false },
  );
  const create = trpc.jp.reports.createDraft.useMutation();
  const update = trpc.jp.reports.updateDraft.useMutation();

  const checks = lines.map(lineCheck);
  const firstError = checks.find((check) => check.error)?.error ?? null;
  const titleError = title.trim().length < 2 ? "Give the report a short title." : null;

  const setLine = (key: string, patch: Partial<EditorLine>) =>
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)));

  /** Fills a line from a task or a past line, carrying the last cumulative forward. */
  const pickWork = (key: string, taskId: string | null, description: string) => {
    const last = context.data?.lastLines.find((row) =>
      taskId ? row.taskId === taskId : row.description.toLowerCase() === description.toLowerCase(),
    );
    const task = context.data?.tasks.find((row) => row.id === taskId);
    setLines((current) =>
      current.map((line) => {
        if (line.key !== key) return line;
        const previous = last ? text(last.cumulativeQuantity) || null : null;
        return {
          ...line,
          taskId,
          description: description || line.description,
          locationLabel: line.locationLabel || last?.locationLabel || task?.locationLabel || "",
          unitCode: line.unitCode || last?.unitCode || "",
          plannedQuantity: line.plannedQuantity || text(last?.plannedQuantity),
          previousCumulative: previous,
          cumulativeQuantity:
            suggestCumulative(previous, line.completedQuantityToday) ?? line.cumulativeQuantity,
        };
      }),
    );
  };

  const setToday = (line: EditorLine, value: string) => {
    let cumulative = line.cumulativeQuantity;
    try {
      cumulative = suggestCumulative(line.previousCumulative, value) ?? cumulative;
    } catch {
      // Keep what was typed until today's quantity is a valid number.
    }
    setLine(line.key, { completedQuantityToday: value, cumulativeQuantity: cumulative });
  };

  /** AI fields fill empty header fields and add work lines; the person reviews before saving. */
  const applyAi = (fields: ReportDraftFields) => {
    if (fields.title) setTitle((current) => current.trim() || fields.title);
    if (fields.weatherCode) setWeather(fields.weatherCode);
    if (fields.overallStatus) setOverall(fields.overallStatus);
    if (fields.remarks)
      setRemarks((current) =>
        current.trim() ? `${current.trim()}\n${fields.remarks}` : fields.remarks,
      );
    if (fields.nextDayPlan) setNextDayPlan((current) => current.trim() || fields.nextDayPlan);
    if (fields.items.length) {
      const added = fields.items.map((item): EditorLine => {
        const last = context.data?.lastLines.find((row) =>
          item.taskId
            ? row.taskId === item.taskId
            : row.description.toLowerCase() === item.description.toLowerCase(),
        );
        const previous = last ? text(last.cumulativeQuantity) || null : null;
        let cumulative = item.cumulativeQuantity ?? "";
        if (!cumulative) {
          try {
            cumulative = suggestCumulative(previous, item.completedQuantityToday ?? null) ?? "";
          } catch {
            cumulative = "";
          }
        }
        return {
          key: createClientMutationId(),
          taskId: item.taskId ?? null,
          description: item.description,
          locationLabel: item.locationLabel || last?.locationLabel || "",
          unitCode: item.unitCode || last?.unitCode || "",
          plannedQuantity: item.plannedQuantity || text(last?.plannedQuantity),
          completedQuantityToday: item.completedQuantityToday ?? "",
          cumulativeQuantity: cumulative,
          previousCumulative: previous,
          remarks: item.remarks ?? "",
        };
      });
      setLines((current) => [...current, ...added].slice(0, MAX_DPR_ITEMS));
    }
    setAiNotice(
      fields.warnings.length
        ? `AI filled the form. Check these before saving: ${fields.warnings.join(" ")}`
        : "AI filled the form. Check every field before saving.",
    );
  };

  const payloadItems = () => (kind === "DPR" ? lines.map(toInput) : []);

  const save = async () => {
    if (titleError || firstError) {
      setMessage(titleError ?? firstError);
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      if (mode === "edit" && reportId) {
        await update.mutateAsync({
          reportId,
          title: title.trim(),
          remarks: remarks.trim() || undefined,
          nextDayPlan: nextDayPlan.trim() || undefined,
          weatherCode: (weatherCode as (typeof WEATHER_OPTIONS)[number]) ?? null,
          overallStatus: (overallStatus as (typeof SITE_STATUS_OPTIONS)[number]) ?? null,
          items: payloadItems(),
        });
        await Promise.all([
          utils.jp.reports.detail.invalidate({ reportId }),
          utils.jp.reports.list.invalidate(),
        ]);
        router.back();
        return;
      }
      if (!site) {
        setMessage("Choose an assigned site before saving a report.");
        return;
      }
      const clientMutationId = createClientMutationId();
      const draft: FieldReport = {
        id: clientMutationId,
        clientMutationId,
        siteId: site.id,
        siteName: site.name,
        title: title.trim(),
        kind,
        date: today(),
        status: "Draft",
        evidenceCount: 0,
        author: me.data?.name || "Signed-in staff user",
        updatedAt: new Date().toISOString(),
        syncStatus: "Local Draft",
        lineSummary:
          kind === "DPR" && lines.length
            ? `${lines.length} work line${lines.length === 1 ? "" : "s"}`
            : remarks.trim() || "No work lines added.",
        remarks: remarks.trim() || undefined,
        nextDayPlan: nextDayPlan.trim() || undefined,
        weatherCode: weatherCode ?? undefined,
        overallStatus: overallStatus ?? undefined,
        items: payloadItems(),
      };
      // Keep a device copy first so nothing is lost if the network drops mid-save.
      await saveReportDraft(draft);
      try {
        await create.mutateAsync({
          siteId: draft.siteId,
          reportKind: draft.kind,
          reportDate: draft.date,
          shiftCode: "General",
          title: draft.title,
          remarks: draft.remarks,
          nextDayPlan: draft.nextDayPlan,
          weatherCode: (draft.weatherCode as (typeof WEATHER_OPTIONS)[number]) ?? null,
          overallStatus: (draft.overallStatus as (typeof SITE_STATUS_OPTIONS)[number]) ?? null,
          items: draft.items ?? [],
          clientMutationId,
        });
        await removeLocalDraft("report", draft.id);
        await utils.jp.reports.list.invalidate();
        router.back();
      } catch (error) {
        setMessage(
          `Saved on this phone; the server has not confirmed it yet. ${errorText(error)} You can retry from Reports.`,
        );
      }
    } catch (error) {
      setMessage(errorText(error));
    } finally {
      setSaving(false);
    }
  };

  if (sites.isLoading || capabilities.isLoading)
    return <LoadingBlock label="Loading your sites…" />;
  if (mode === "create" && siteOptions.length === 0)
    return (
      <ScrollView contentContainerStyle={styles.content}>
        <AppHeader eyebrow="Field records" title="New report" />
        <EmptyState
          icon="lock-outline"
          title="No site to report on"
          detail="Your role cannot create this kind of report on any active site."
        />
      </ScrollView>
    );

  const taskOptions = context.data?.tasks ?? [];
  const pastWork = (context.data?.lastLines ?? []).filter((row) => !row.taskId).slice(0, 8);

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.content}
      >
        <AppHeader
          eyebrow={mode === "edit" ? "Correct report" : "New field record"}
          title={kind === "DPR" ? "Daily progress report" : "Daily labour report"}
          subtitle={
            mode === "edit"
              ? "Change the report, then submit it again from Reports."
              : `Today, ${today()}. Saved as a draft; nothing is submitted until you submit it.`
          }
        />
        {initial?.returnReason ? (
          <Card accent="warning">
            <Text style={[styles.metaLabel, { color: colors.muted }]}>Returned because</Text>
            <Text style={[styles.metaValue, { color: colors.foreground }]}>
              {initial.returnReason}
            </Text>
          </Card>
        ) : null}

        {siteId ? <VoiceReportAssist siteId={siteId} reportKind={kind} onFields={applyAi} /> : null}
        {aiNotice ? (
          <Card accent={aiNotice.includes("Check these") ? "warning" : "info"}>
            <Text style={[styles.muted, { color: colors.foreground }]}>{aiNotice}</Text>
          </Card>
        ) : null}

        {mode === "create" ? (
          <>
            {canDpr.length && canDlr.length ? (
              <ChipGroup
                label="Report type"
                options={["DPR", "DLR"] as const}
                value={kind}
                onChange={setKind}
                format={(value) => (value === "DPR" ? "Progress (DPR)" : "Labour (DLR)")}
              />
            ) : null}
            <ChipGroup
              label="Site"
              options={siteOptions.map((row) => row.id)}
              value={siteId || null}
              onChange={setSiteId}
              format={(value) => siteOptions.find((row) => row.id === value)?.name ?? value}
            />
          </>
        ) : null}

        <Field
          label="Title"
          value={title}
          onChangeText={setTitle}
          placeholder={kind === "DPR" ? "e.g. Slab casting, Block B" : "e.g. Labour on site"}
          maxLength={180}
        />
        <ChipGroup
          label="Weather"
          options={WEATHER_OPTIONS}
          value={weatherCode as never}
          onChange={setWeather}
        />
        <ChipGroup
          label="Site status today"
          options={SITE_STATUS_OPTIONS}
          value={overallStatus as never}
          onChange={setOverall}
        />

        {kind === "DPR" ? (
          <>
            <SectionHeader
              title={`Work done (${lines.length})`}
              caption="Quantities are checked against the planned scope."
            />
            {lines.map((line, index) => (
              <Card key={line.key}>
                <View style={styles.lineHead}>
                  <Text style={[styles.lineTitle, { color: colors.foreground }]}>
                    Line {index + 1}
                  </Text>
                  <SecondaryButton
                    label="Remove"
                    onPress={() =>
                      setLines((current) => current.filter((row) => row.key !== line.key))
                    }
                  />
                </View>
                {taskOptions.length ? (
                  <ChipGroup
                    label="Schedule task (optional)"
                    options={taskOptions.map((task) => task.id)}
                    value={line.taskId}
                    onChange={(taskId) =>
                      pickWork(
                        line.key,
                        taskId,
                        taskOptions.find((task) => task.id === taskId)?.title ?? "",
                      )
                    }
                    format={(value) => {
                      const task = taskOptions.find((row) => row.id === value);
                      return task ? `${task.taskCode} · ${task.title}` : value;
                    }}
                  />
                ) : null}
                {!line.taskId && pastWork.length ? (
                  <ChipGroup
                    label="Continue earlier work"
                    options={pastWork.map((row) => row.description)}
                    value={null}
                    onChange={(description) => pickWork(line.key, null, description)}
                  />
                ) : null}
                <Field
                  label="Work done"
                  value={line.description}
                  onChangeText={(value) => setLine(line.key, { description: value })}
                  placeholder="e.g. Internal plaster"
                  maxLength={240}
                />
                <Field
                  label="Location (floor, block, zone)"
                  value={line.locationLabel}
                  onChangeText={(value) => setLine(line.key, { locationLabel: value })}
                  placeholder="e.g. First floor, Block A"
                  maxLength={180}
                />
                <View style={styles.row}>
                  <View style={styles.cell}>
                    <Field
                      label="Unit"
                      value={line.unitCode}
                      onChangeText={(value) => setLine(line.key, { unitCode: value })}
                      placeholder="sqft, cum, nos"
                      autoCapitalize="none"
                      maxLength={32}
                    />
                  </View>
                  <View style={styles.cell}>
                    <Field
                      label="Planned total"
                      value={line.plannedQuantity}
                      onChangeText={(value) => setLine(line.key, { plannedQuantity: value })}
                      keyboardType="decimal-pad"
                      placeholder="0"
                    />
                  </View>
                </View>
                <View style={styles.row}>
                  <View style={styles.cell}>
                    <Field
                      label="Done today"
                      value={line.completedQuantityToday}
                      onChangeText={(value) => setToday(line, value)}
                      keyboardType="decimal-pad"
                      placeholder="0"
                    />
                  </View>
                  <View style={styles.cell}>
                    <Field
                      label="Done so far"
                      value={line.cumulativeQuantity}
                      onChangeText={(value) => setLine(line.key, { cumulativeQuantity: value })}
                      keyboardType="decimal-pad"
                      placeholder="0"
                      hint={
                        line.previousCumulative
                          ? `Last report: ${line.previousCumulative}`
                          : undefined
                      }
                    />
                  </View>
                </View>
                <Field
                  label="Line note (optional)"
                  value={line.remarks}
                  onChangeText={(value) => setLine(line.key, { remarks: value })}
                  placeholder="Blockers, measurement notes"
                />
                {checks[index].error ? (
                  <Text style={[styles.lineError, { color: colors.error }]}>
                    {checks[index].error}
                  </Text>
                ) : checks[index].item?.estimatedPercent ? (
                  <Text style={[styles.muted, { color: colors.muted }]}>
                    About {checks[index].item?.estimatedPercent}% of the planned total (estimate)
                  </Text>
                ) : null}
              </Card>
            ))}
            {lines.length < MAX_DPR_ITEMS ? (
              <SecondaryButton
                label="Add work line"
                onPress={() => setLines((current) => [...current, blankLine()])}
              />
            ) : null}
          </>
        ) : (
          <>
            <SectionHeader
              title="Attendance today"
              caption="Counted from Attendance; correct it there."
            />
            {labour.data ? (
              <LabourSummaryCard summary={labour.data} />
            ) : labour.isLoading ? (
              <LoadingBlock label="Loading attendance…" />
            ) : null}
            <Card>
              <View style={styles.lineHead}>
                <MaterialIcons name="how-to-reg" size={18} color={colors.primary} />
                <Text style={[styles.muted, { color: colors.muted, flex: 1 }]}>
                  Workers, hours and overtime are recorded in Attendance for this site and day. Use
                  this report for the day&apos;s labour summary and notes.
                </Text>
              </View>
              {site ? (
                <SecondaryButton
                  label="Open attendance"
                  onPress={() =>
                    router.push(`/attendance?siteId=${encodeURIComponent(site.id)}` as never)
                  }
                />
              ) : null}
            </Card>
          </>
        )}

        <Field
          label="Notes (optional)"
          value={remarks}
          onChangeText={setRemarks}
          multiline
          placeholder="Delays, safety, quality, material or equipment issues"
          maxLength={5000}
        />
        <Field
          label="Plan for tomorrow (optional)"
          value={nextDayPlan}
          onChangeText={setNextDayPlan}
          multiline
          maxLength={3000}
        />
        {message ? <InlineError message={message} /> : null}
        <PrimaryButton
          icon="save"
          label={saving ? "Saving…" : mode === "edit" ? "Save changes" : "Save draft"}
          disabled={saving}
          onPress={() => void save()}
        />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  content: { paddingBottom: 40, gap: 12 },
  muted: { fontSize: 13, lineHeight: 19 },
  lineHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  lineTitle: { fontSize: 15, fontWeight: "800" },
  lineNumbers: { fontSize: 13, fontWeight: "700", marginTop: 6 },
  lineError: { fontSize: 13, fontWeight: "700" },
  row: { flexDirection: "row", gap: 10 },
  cell: { flex: 1 },
  metaRow: { flexDirection: "row", justifyContent: "space-between", gap: 12, paddingVertical: 4 },
  metaBlock: { gap: 4, paddingVertical: 6 },
  metaLabel: { fontSize: 12, fontWeight: "700" },
  metaValue: { fontSize: 14, flexShrink: 1, textAlign: "left" },
});
