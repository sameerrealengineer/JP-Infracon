import { useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { AuthGate } from "@/components/jp/auth-gate";
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
  Sheet,
  StatusPill,
  type Tone,
} from "@/components/jp/ui";
import { useColors } from "@/hooks/use-colors";
import { useT } from "@/lib/i18n";
import { LEAVE_TYPES, leaveLengthText, type LeaveType } from "@/lib/jp/leave-domain";
import { createClientMutationId } from "@/lib/jp/local-repository";
import { resolveSelectedId } from "@/lib/jp/selection";
import { trpc } from "@/lib/trpc";

const TONE: Record<string, Tone> = {
  Pending: "warning",
  Approved: "success",
  Rejected: "error",
  Cancelled: "info",
};
const today = () => new Date().toISOString().slice(0, 10);

/** Leave applications: apply for yourself or a worker, approve or reject, cancel. */
export default function LeaveScreen() {
  const { t } = useT();
  const colors = useColors();
  const [tab, setTab] = useState<"mine" | "review">("mine");
  const list = trpc.jp.leave.list.useQuery({ scope: tab });
  const review = trpc.jp.leave.review.useMutation();
  const cancel = trpc.jp.leave.cancel.useMutation();
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (work: () => Promise<unknown>) => {
    setError(null);
    try {
      await work();
      await list.refetch();
    } catch (cause) {
      setError(cause instanceof Error ? t(cause.message) : t("Could not save."));
    }
  };
  return (
    <AuthGate>
      <Screen>
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 32 }}
        >
          <AppHeader
            eyebrow={t("People")}
            title={t("Leave")}
            subtitle={t("Apply for leave for yourself or a worker; managers approve.")}
          />
          <View style={{ gap: 10 }}>
            <ChipGroup
              options={list.data?.canReview ? (["mine", "review"] as const) : (["mine"] as const)}
              value={tab}
              onChange={setTab}
              format={(value) => t(value === "mine" ? "My leave" : "To approve")}
            />
            <PrimaryButton
              icon="event-busy"
              label={t("Apply for leave")}
              onPress={() => setApplying(true)}
            />
            {error ? <InlineError message={error} onRetry={() => setError(null)} /> : null}
            {list.isLoading ? (
              <LoadingBlock label={t("Loading…")} />
            ) : list.isError ? (
              <InlineError message={t(list.error.message)} onRetry={() => void list.refetch()} />
            ) : !list.data?.rows.length ? (
              <EmptyState
                icon="event-available"
                title={t(tab === "mine" ? "No leave applied" : "Nothing to approve")}
                detail={t("Leave applications appear here with their status.")}
              />
            ) : (
              list.data.rows.map((row) => (
                <Card key={row.id} accent={TONE[row.status]}>
                  <View style={styles.top}>
                    <Text style={[styles.title, { color: colors.foreground }]}>{row.who}</Text>
                    <StatusPill compact label={t(row.status)} tone={TONE[row.status] ?? "info"} />
                  </View>
                  <Text style={[styles.meta, { color: colors.muted }]}>
                    {t(row.leaveType)} · {row.fromDate} → {row.toDate} ·{" "}
                    {t(leaveLengthText(row.halfDays))} · {row.siteName}
                  </Text>
                  <Text style={[styles.meta, { color: colors.foreground }]}>{row.reason}</Text>
                  {row.reviewNote ? (
                    <Text style={[styles.meta, { color: colors.muted }]}>{row.reviewNote}</Text>
                  ) : null}
                  {row.canReview ? (
                    <View style={styles.actions}>
                      <PrimaryButton
                        icon="check"
                        label={t("Approve")}
                        onPress={() =>
                          void run(() =>
                            review.mutateAsync({ leaveId: row.id, decision: "Approved" }),
                          )
                        }
                      />
                      <SecondaryButton
                        label={t("Reject")}
                        onPress={() =>
                          void run(() =>
                            review.mutateAsync({
                              leaveId: row.id,
                              decision: "Rejected",
                              note: "Not possible on these days",
                            }),
                          )
                        }
                      />
                    </View>
                  ) : null}
                  {tab === "mine" &&
                  (row.status === "Pending" ||
                    (row.status === "Approved" && row.fromDate > today())) ? (
                    <SecondaryButton
                      label={t("Cancel leave")}
                      onPress={() => void run(() => cancel.mutateAsync({ leaveId: row.id }))}
                    />
                  ) : null}
                </Card>
              ))
            )}
          </View>
        </ScrollView>
        {applying ? (
          <ApplyLeave onClose={() => setApplying(false)} onSaved={() => void list.refetch()} />
        ) : null}
      </Screen>
    </AuthGate>
  );
}

function ApplyLeave({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { t } = useT();
  const sites = trpc.jp.workspace.mySites.useQuery();
  const capabilities = trpc.jp.workspace.myCapabilities.useQuery();
  const people = trpc.jp.people.search.useQuery({ query: "" });
  const apply = trpc.jp.leave.request.useMutation();
  const [chosenSite, setSite] = useState("");
  const activeSites = (sites.data ?? []).filter((site) => site.status === "Active");
  const siteId = resolveSelectedId(activeSites, chosenSite);
  const canForWorker = (capabilities.data ?? []).some(
    (row) => row.siteId === siteId && (row as Record<string, unknown>)["workforce.manage"] === true,
  );
  const [forWhom, setForWhom] = useState<string>("me");
  const [leaveType, setLeaveType] = useState<LeaveType>("Casual");
  const [fromDate, setFrom] = useState(today());
  const [toDate, setTo] = useState(today());
  const [halfDay, setHalfDay] = useState<"no" | "yes">("no");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const workers = (people.data?.people ?? []).slice(0, 30);
  const save = async () => {
    setError(null);
    try {
      await apply.mutateAsync({
        siteId,
        personId: forWhom === "me" ? null : forWhom,
        leaveType,
        fromDate,
        toDate: halfDay === "yes" ? fromDate : toDate,
        halfDay: halfDay === "yes",
        reason,
        clientMutationId: createClientMutationId(),
      });
      onSaved();
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? t(cause.message) : t("Could not save."));
    }
  };
  return (
    <Sheet
      visible
      title={t("Apply for leave")}
      onClose={onClose}
      footer={
        <PrimaryButton
          icon="send"
          label={apply.isPending ? t("Saving…") : t("Send for approval")}
          disabled={apply.isPending || !siteId || reason.trim().length < 3}
          onPress={() => void save()}
        />
      }
    >
      <ChipGroup
        label={t("Site")}
        options={activeSites.map((site) => site.id)}
        value={siteId || null}
        onChange={setSite}
        format={(id) => activeSites.find((site) => site.id === id)?.name ?? id}
      />
      {canForWorker ? (
        <ChipGroup
          label={t("For")}
          options={["me", ...workers.map((person) => person.id)]}
          value={forWhom}
          onChange={setForWhom}
          format={(id) =>
            id === "me" ? t("Me") : (workers.find((person) => person.id === id)?.fullName ?? id)
          }
        />
      ) : null}
      <ChipGroup
        label={t("Type")}
        options={LEAVE_TYPES}
        value={leaveType}
        onChange={setLeaveType}
        format={(value) => t(value)}
      />
      <ChipGroup
        label={t("Half day")}
        options={["no", "yes"] as const}
        value={halfDay}
        onChange={setHalfDay}
        format={(value) => t(value === "yes" ? "Yes, half day" : "Full days")}
      />
      <Field label={t("From")} value={fromDate} onChangeText={setFrom} placeholder="2026-11-20" />
      {halfDay === "no" ? (
        <Field label={t("To")} value={toDate} onChangeText={setTo} placeholder="2026-11-21" />
      ) : null}
      <Field label={t("Reason")} value={reason} onChangeText={setReason} multiline />
      {error ? <InlineError message={error} onRetry={() => setError(null)} /> : null}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  top: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 },
  title: { fontSize: 15, fontWeight: "800", flexShrink: 1 },
  meta: { fontSize: 12, lineHeight: 18, marginTop: 3 },
  actions: { gap: 6, marginTop: 8 },
});
