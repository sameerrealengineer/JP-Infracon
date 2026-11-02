import { useMemo, useState } from "react";
import { RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { AuthGate } from "@/components/jp/auth-gate";
import {
  AppHeader,
  Card,
  ChipGroup,
  Divider,
  EmptyState,
  HeroCard,
  HeroStat,
  InlineError,
  LoadingBlock,
  PrimaryButton,
  Screen,
  SecondaryButton,
  SectionHeader,
  StatusPill,
} from "@/components/jp/ui";
import { useColors } from "@/hooks/use-colors";
import { useConnectivity } from "@/hooks/use-connectivity";
import { useWorkspace } from "@/hooks/use-workspace";
import {
  attendanceStatuses,
  defaultHours,
  validateAttendanceEntry,
  type AttendanceStatus,
} from "@/lib/jp/attendance-domain";
import { formatMinorAsRupees } from "@/lib/jp/finance-domain";
import { createClientMutationId } from "@/lib/jp/local-repository";
import { resolveSelectedId } from "@/lib/jp/selection";
import { trpc } from "@/lib/trpc";

type Entry = { status: AttendanceStatus; regularHours: string; overtimeHours: string };
const views = ["Mark attendance", "Labour cost"] as const;
const shortStatus: Record<AttendanceStatus, string> = {
  "Full Day": "Full",
  "Half Day": "Half",
  Absent: "Absent",
  Leave: "Leave",
  "Present-hours-based": "Hours",
};

function isoDay(offset = 0) {
  return new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
}

export default function AttendanceScreen() {
  const colors = useColors();
  const { online } = useConnectivity();
  const { sitesWith } = useWorkspace();
  const sites = trpc.jp.workspace.mySites.useQuery();
  const siteOptions = (sites.data ?? []).filter((site) =>
    sitesWith("attendance.view").includes(site.id),
  );
  const [chosenSite, setChosenSite] = useState<string | null>(null);
  const siteId = resolveSelectedId(siteOptions, chosenSite);
  const [view, setView] = useState<(typeof views)[number]>("Mark attendance");
  const canSeeCost = sitesWith("compensation.view").includes(siteId);
  const canMark = sitesWith("attendance.mark").includes(siteId);
  const canApprove = sitesWith("attendance.approve").includes(siteId);

  return (
    <AuthGate>
      <Screen>
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 40 }}
          keyboardShouldPersistTaps="handled"
        >
          <AppHeader
            eyebrow="Workforce"
            title="Attendance"
            subtitle="Mark daily attendance, approve it, and see the estimated labour cost."
          />
          {sites.isLoading ? <LoadingBlock /> : null}
          {sites.isSuccess && !siteOptions.length ? (
            <EmptyState
              icon="lock-outline"
              title="No attendance access"
              detail="Your role does not include attendance for any site."
            />
          ) : null}
          {siteOptions.length > 1 ? (
            <ChipGroup
              label="Site"
              options={siteOptions.map((site) => site.id)}
              value={siteId}
              onChange={setChosenSite}
              format={(id) => siteOptions.find((site) => site.id === id)?.name ?? id}
            />
          ) : null}
          {siteId ? (
            <>
              {canSeeCost ? <ChipGroup options={views} value={view} onChange={setView} /> : null}
              {view === "Labour cost" && canSeeCost ? (
                <LabourCost siteId={siteId} />
              ) : (
                <MarkDay
                  key={siteId}
                  siteId={siteId}
                  canMark={canMark}
                  canApprove={canApprove}
                  online={online}
                />
              )}
            </>
          ) : null}
          <Text style={[styles.note, { color: colors.muted }]}>
            Attendance needs a connection to save. Estimates are not payables: wages are paid only
            through approved records.
          </Text>
        </ScrollView>
      </Screen>
    </AuthGate>
  );
}

function MarkDay({
  siteId,
  canMark,
  canApprove,
  online,
}: {
  siteId: string;
  canMark: boolean;
  canApprove: boolean;
  online: boolean | null;
}) {
  const colors = useColors();
  const utils = trpc.useUtils();
  const [dayChoice, setDayChoice] = useState<"Today" | "Yesterday">("Today");
  const workDate = dayChoice === "Today" ? isoDay(0) : isoDay(-1);
  const roster = trpc.jp.attendance.roster.useQuery({ siteId, workDate, shiftCode: "GEN" });
  const mark = trpc.jp.attendance.mark.useMutation();
  const approve = trpc.jp.attendance.approve.useMutation();
  const [edits, setEdits] = useState<Record<string, Entry>>({});
  const [editsKey, setEditsKey] = useState(workDate);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  // Edits belong to one date; switching the date starts fresh (adjusted during render, not in an effect).
  if (editsKey !== workDate) {
    setEditsKey(workDate);
    setEdits({});
    setMessage(null);
  }

  const rows = useMemo(() => roster.data?.rows ?? [], [roster.data]);
  const valueOf = (row: (typeof rows)[number]): Entry =>
    edits[row.engagementId] ??
    (row.record
      ? {
          status: row.record.status,
          regularHours: row.record.regularHours,
          overtimeHours: row.record.overtimeHours,
        }
      : { status: "Full Day", regularHours: "8", overtimeHours: "0" });
  const editable = rows.filter((row) => !row.record?.approved);
  const pendingApproval = rows.filter((row) => row.record && !row.record.approved);
  const hasPendingOt = pendingApproval.some(
    (row) => row.record?.overtimeApprovalStatus === "Pending",
  );
  const problems = editable.map((row) => validateAttendanceEntry(valueOf(row))).filter(Boolean);
  const present = rows.filter((row) =>
    ["Full Day", "Half Day", "Present-hours-based"].includes(valueOf(row).status),
  ).length;

  const update = (id: string, patch: Partial<Entry>, base: Entry) =>
    setEdits((current) => ({ ...current, [id]: { ...base, ...patch } }));

  const save = async () => {
    setMessage(null);
    try {
      const result = await mark.mutateAsync({
        siteId,
        workDate,
        shiftCode: "GEN",
        entries: editable.map((row) => ({ engagementId: row.engagementId, ...valueOf(row) })),
        clientMutationId: createClientMutationId(),
      });
      setEdits({});
      await utils.jp.attendance.invalidate();
      setMessage({
        tone: "success",
        text: `Saved ${result.saved} worker${result.saved === 1 ? "" : "s"}${result.locked ? ` · ${result.locked} already approved and unchanged` : ""}.`,
      });
    } catch (cause) {
      setMessage({ tone: "error", text: cause instanceof Error ? cause.message : "Not saved." });
    }
  };

  const approveDay = async (overtime: "approve" | "reject") => {
    setMessage(null);
    try {
      const result = await approve.mutateAsync({
        siteId,
        workDate,
        shiftCode: "GEN",
        overtime,
        clientMutationId: createClientMutationId(),
      });
      await utils.jp.attendance.invalidate();
      setMessage({
        tone: "success",
        text: `Approved ${result.approved} record${result.approved === 1 ? "" : "s"}${result.skippedOwn ? ` · ${result.skippedOwn} you marked need someone else` : ""}.`,
      });
    } catch (cause) {
      setMessage({ tone: "error", text: cause instanceof Error ? cause.message : "Not approved." });
    }
  };

  return (
    <>
      <ChipGroup
        options={["Today", "Yesterday"] as const}
        value={dayChoice}
        onChange={setDayChoice}
        format={(value) => `${value} · ${value === "Today" ? isoDay(0) : isoDay(-1)}`}
      />
      <HeroCard>
        <View style={styles.heroStats}>
          <HeroStat value={roster.data ? String(rows.length) : "—"} label="On roster" />
          <View style={styles.heroDivider} />
          <HeroStat value={roster.data ? String(present) : "—"} label="Present" />
          <View style={styles.heroDivider} />
          <HeroStat
            value={roster.data ? String(rows.filter((row) => row.record?.approved).length) : "—"}
            label="Approved"
          />
        </View>
      </HeroCard>
      {roster.error ? (
        <InlineError message={roster.error.message} onRetry={() => void roster.refetch()} />
      ) : null}
      {message ? (
        message.tone === "error" ? (
          <InlineError message={message.text} title="Not done" />
        ) : (
          <Card accent="success" style={{ marginBottom: 12 }}>
            <Text style={{ color: colors.foreground, fontWeight: "700" }}>{message.text}</Text>
          </Card>
        )
      ) : null}
      {roster.isLoading ? (
        <LoadingBlock label="Loading roster…" />
      ) : rows.length === 0 ? (
        <EmptyState
          icon="groups"
          title="No workers on this site"
          detail="Add workers and get their rate approved in Workforce; they then appear here every day."
        />
      ) : (
        <Card style={{ paddingVertical: 4, marginBottom: 14 }}>
          <View style={{ flex: 1 }}>
            {rows.map((row, index) => {
              const value = valueOf(row);
              const locked = Boolean(row.record?.approved) || !canMark;
              return (
                <View key={row.engagementId}>
                  {index > 0 ? <Divider /> : null}
                  <View style={styles.worker}>
                    <View style={styles.workerTop}>
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.name, { color: colors.foreground }]}>{row.name}</Text>
                        <Text style={[styles.meta, { color: colors.muted }]}>
                          {[row.trade, row.engagementType].filter(Boolean).join(" · ")}
                        </Text>
                      </View>
                      {row.record?.approved ? (
                        <StatusPill label="Approved" tone="success" compact />
                      ) : row.record ? (
                        <StatusPill label="Marked" tone="warning" compact />
                      ) : null}
                    </View>
                    {locked ? (
                      <Text style={[styles.meta, { color: colors.foreground }]}>
                        {row.record
                          ? `${value.status} · ${value.regularHours} h${Number(value.overtimeHours) > 0 ? ` + ${value.overtimeHours} h OT (${row.record.overtimeApprovalStatus})` : ""}`
                          : "Not marked"}
                      </Text>
                    ) : (
                      <>
                        <View style={styles.statusRow}>
                          {attendanceStatuses.map((status) => {
                            const selected = value.status === status;
                            return (
                              <Text
                                key={status}
                                accessibilityRole="radio"
                                accessibilityState={{ selected }}
                                accessibilityLabel={`${row.name} ${status}`}
                                onPress={() =>
                                  update(
                                    row.engagementId,
                                    {
                                      status,
                                      regularHours: defaultHours(status),
                                      overtimeHours:
                                        status === "Absent" || status === "Leave"
                                          ? "0"
                                          : value.overtimeHours,
                                    },
                                    value,
                                  )
                                }
                                style={[
                                  styles.statusChip,
                                  {
                                    backgroundColor: selected ? colors.primary : colors.background,
                                    color: selected ? colors.background : colors.foreground,
                                    borderColor: selected ? colors.primary : colors.border,
                                  },
                                ]}
                              >
                                {shortStatus[status]}
                              </Text>
                            );
                          })}
                        </View>
                        {value.status !== "Absent" && value.status !== "Leave" ? (
                          <View style={styles.hoursRow}>
                            <Text style={[styles.meta, { color: colors.muted }]}>Hours</Text>
                            <TextInput
                              value={value.regularHours}
                              onChangeText={(text) =>
                                update(row.engagementId, { regularHours: text }, value)
                              }
                              keyboardType="decimal-pad"
                              accessibilityLabel={`${row.name} hours`}
                              style={[
                                styles.hoursInput,
                                { color: colors.foreground, borderColor: colors.border },
                              ]}
                            />
                            <Text style={[styles.meta, { color: colors.muted }]}>Overtime</Text>
                            <TextInput
                              value={value.overtimeHours}
                              onChangeText={(text) =>
                                update(row.engagementId, { overtimeHours: text }, value)
                              }
                              keyboardType="decimal-pad"
                              accessibilityLabel={`${row.name} overtime hours`}
                              style={[
                                styles.hoursInput,
                                { color: colors.foreground, borderColor: colors.border },
                              ]}
                            />
                          </View>
                        ) : null}
                        {validateAttendanceEntry(value) ? (
                          <Text style={[styles.meta, { color: colors.error }]}>
                            {validateAttendanceEntry(value)}
                          </Text>
                        ) : null}
                      </>
                    )}
                  </View>
                </View>
              );
            })}
          </View>
        </Card>
      )}
      {canMark && editable.length > 0 ? (
        <PrimaryButton
          icon="how-to-reg"
          label={online === false ? "Connect to save" : `Save attendance (${editable.length})`}
          disabled={problems.length > 0 || online === false}
          loading={mark.isPending}
          onPress={() => void save()}
        />
      ) : null}
      {canApprove && pendingApproval.length > 0 ? (
        <View style={{ gap: 10, marginTop: 12 }}>
          <SectionHeader
            title="Approve this day"
            caption={`${pendingApproval.length} marked, not yet approved`}
          />
          <PrimaryButton
            icon="verified"
            tone="gold"
            label={hasPendingOt ? "Approve with overtime" : "Approve attendance"}
            loading={approve.isPending}
            onPress={() => void approveDay("approve")}
          />
          {hasPendingOt ? (
            <SecondaryButton
              icon="block"
              label="Approve, reject overtime"
              onPress={() => void approveDay("reject")}
            />
          ) : null}
        </View>
      ) : null}
    </>
  );
}

function LabourCost({ siteId }: { siteId: string }) {
  const colors = useColors();
  const now = new Date();
  const from = new Date(Date.UTC(now.getFullYear(), now.getMonth(), 1)).toISOString().slice(0, 10);
  const to = isoDay(0);
  const summary = trpc.jp.attendance.labourSummary.useQuery({ siteId, from, to });
  const data = summary.data;
  return (
    <ScrollView
      scrollEnabled={false}
      refreshControl={
        <RefreshControl
          refreshing={summary.isRefetching}
          onRefresh={() => void summary.refetch()}
        />
      }
    >
      <HeroCard>
        <Text style={styles.heroKicker}>
          THIS MONTH · {from} → {to}
        </Text>
        <View style={[styles.heroStats, { marginTop: 10 }]}>
          <HeroStat
            value={data ? formatMinorAsRupees(data.totals.approvedMinor) : "—"}
            label="Approved earnings"
          />
          <View style={styles.heroDivider} />
          <HeroStat
            value={data ? formatMinorAsRupees(data.totals.pendingMinor) : "—"}
            label="Awaiting approval"
          />
        </View>
      </HeroCard>
      {summary.error ? (
        <InlineError message={summary.error.message} onRetry={() => void summary.refetch()} />
      ) : null}
      {summary.isLoading ? <LoadingBlock /> : null}
      {data && data.workers.length === 0 ? (
        <EmptyState
          icon="payments"
          title="No attendance this month"
          detail="Labour cost appears once attendance is marked."
        />
      ) : null}
      {data && data.workers.length ? (
        <Card style={{ paddingVertical: 4 }}>
          <View style={{ flex: 1 }}>
            {data.workers.map((worker, index) => (
              <View key={worker.engagementId}>
                {index > 0 ? <Divider /> : null}
                <View style={styles.worker}>
                  <View style={styles.workerTop}>
                    <Text style={[styles.name, { color: colors.foreground, flex: 1 }]}>
                      {worker.name}
                    </Text>
                    <Text style={[styles.name, { color: colors.foreground }]}>
                      {formatMinorAsRupees(worker.approvedMinor)}
                    </Text>
                  </View>
                  <Text style={[styles.meta, { color: colors.muted }]}>
                    {worker.presentDays} days · {worker.regularHours} h · OT{" "}
                    {worker.overtimeApprovedHours} h approved
                    {worker.overtimePendingHours !== "0"
                      ? `, ${worker.overtimePendingHours} h pending`
                      : ""}
                  </Text>
                  {worker.pendingMinor !== "0" ? (
                    <Text style={[styles.meta, { color: colors.warning }]}>
                      + {formatMinorAsRupees(worker.pendingMinor)} awaiting approval
                    </Text>
                  ) : null}
                  {worker.missingRate ? (
                    <Text style={[styles.meta, { color: colors.error }]}>
                      {worker.missingRate} day(s) without an approved rate
                    </Text>
                  ) : null}
                  {worker.notAttendanceBased ? (
                    <Text style={[styles.meta, { color: colors.muted }]}>
                      Paid by piece/measurement/contract — not priced from attendance
                    </Text>
                  ) : null}
                </View>
              </View>
            ))}
          </View>
        </Card>
      ) : null}
      <Text style={[styles.note, { color: colors.muted }]}>
        Overtime is priced at the base hourly rate (daily rate ÷ 8 h) and only once approved. Check
        local labour rules before paying.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  heroStats: { flexDirection: "row", alignItems: "center", marginTop: 8 },
  heroDivider: {
    width: 1,
    height: 34,
    backgroundColor: "rgba(255,255,255,0.14)",
    marginHorizontal: 12,
  },
  heroKicker: {
    color: "#D9B76A",
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1.2,
    marginTop: 6,
  },
  worker: { paddingVertical: 12, gap: 8 },
  workerTop: { flexDirection: "row", alignItems: "center", gap: 8 },
  name: { fontSize: 14, fontWeight: "800" },
  meta: { fontSize: 12 },
  statusRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  statusChip: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
    fontSize: 12,
    fontWeight: "700",
    overflow: "hidden",
  },
  hoursRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  hoursInput: {
    borderWidth: 1,
    borderRadius: 10,
    minWidth: 56,
    paddingHorizontal: 10,
    paddingVertical: 6,
    fontSize: 14,
  },
  note: { fontSize: 11, lineHeight: 16, marginTop: 16, textAlign: "center" },
});
