import type { inferRouterOutputs } from "@trpc/server";
import { useState } from "react";
import { RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";

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
  SectionHeader,
  Sheet,
  StatusPill,
  formatDateTime,
  useToneColor,
  type Tone,
} from "@/components/jp/ui";
import { useColors } from "@/hooks/use-colors";
import { useSiteParam } from "@/hooks/use-site-param";
import { COST_HEADS, formatTenths, type CostHead, type HeadState } from "@/lib/jp/budget-domain";
import { formatMinorAsRupees, parseRupeesToMinor } from "@/lib/jp/finance-domain";
import { createClientMutationId } from "@/lib/jp/local-repository";
import { resolveSelectedId } from "@/lib/jp/selection";
import { trpc } from "@/lib/trpc";
import type { AppRouter } from "@/server/routers";

const rupees = (minor: string | null | undefined) =>
  minor === null || minor === undefined ? "—" : formatMinorAsRupees(BigInt(minor));

const STATE_LABEL: Record<HeadState, { label: string; tone: Tone }> = {
  ok: { label: "Within budget", tone: "success" },
  near: { label: "Near the limit", tone: "warning" },
  over: { label: "Over budget", tone: "error" },
  unbudgeted: { label: "No budget set", tone: "warning" },
  none: { label: "Not used", tone: "info" },
};

const STATUS_TONE: Record<string, Tone> = {
  Proposed: "warning",
  Approved: "success",
  Rejected: "error",
  Superseded: "info",
};

function minorToRupeeText(minor: string) {
  const value = BigInt(minor);
  const whole = (value / 100n).toString();
  const paise = value % 100n;
  return paise === 0n ? whole : `${whole}.${paise.toString().padStart(2, "0")}`;
}

export default function ProjectBudgetScreen() {
  const colors = useColors();
  const siteParam = useSiteParam();
  const options = trpc.jp.budgets.options.useQuery();
  const sitesQuery = trpc.jp.workspace.mySites.useQuery(undefined, {
    enabled: Boolean(siteParam),
  });
  const projects = options.data?.projects ?? [];
  const [chosen, setChosen] = useState<string | null>(null);
  const fromSite = sitesQuery.data?.find((site) => site.id === siteParam)?.projectId ?? null;
  const projectId = resolveSelectedId(projects, chosen ?? fromSite);
  const overview = trpc.jp.budgets.overview.useQuery(
    { projectId: projectId ?? "" },
    { enabled: Boolean(projectId) },
  );
  const [editing, setEditing] = useState(false);
  const data = overview.data;

  return (
    <AuthGate>
      <Screen>
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          refreshControl={
            <RefreshControl
              refreshing={overview.isRefetching}
              onRefresh={() => void overview.refetch()}
              tintColor={colors.primary}
            />
          }
        >
          <AppHeader
            eyebrow="Money"
            title="Project budget"
            subtitle="Approved budget per cost head against the approved bills, labour and site expenses."
          />
          {options.error ? (
            <InlineError message={options.error.message} onRetry={() => void options.refetch()} />
          ) : null}
          {options.isLoading ? <LoadingBlock label="Loading projects…" /> : null}
          {options.data && projects.length === 0 ? (
            <EmptyState
              icon="lock"
              title="No budgets to show"
              detail="Your role cannot see project budgets."
            />
          ) : null}
          {projects.length > 1 ? (
            <ChipGroup
              label="Project"
              options={projects.map((row) => row.id)}
              value={projectId}
              onChange={setChosen}
              format={(id) => projects.find((row) => row.id === id)?.name ?? id}
            />
          ) : null}
          {overview.isLoading && projectId ? <LoadingBlock label="Loading budget…" /> : null}
          {overview.error ? (
            <InlineError message={overview.error.message} onRetry={() => void overview.refetch()} />
          ) : null}
          {data ? (
            <>
              <Text style={[styles.projectName, { color: colors.foreground }]}>
                {data.project.name} · {data.project.code}
              </Text>
              {data.proposed ? (
                <ProposedCard
                  proposed={data.proposed}
                  current={data.current}
                  canApprove={data.canApprove}
                  onChanged={() => void overview.refetch()}
                />
              ) : null}
              {data.current ? (
                <>
                  <Summary data={data} />
                  <SectionHeader
                    title="By cost head"
                    caption="Spent = approved bills, approved attendance and posted petty cash"
                  />
                  {data.comparison.heads
                    .filter((head) => head.state !== "none" || head.budgetMinor !== "0")
                    .map((head) => (
                      <HeadRow key={head.costHead} head={head} />
                    ))}
                  {data.labourMissingRate > 0 ? (
                    <Text style={[styles.note, { color: colors.muted }]}>
                      {data.labourMissingRate} attendance entries have no rate, so their labour cost
                      is not counted yet.
                    </Text>
                  ) : null}
                  {data.sites.length > 1 ? (
                    <>
                      <SectionHeader title="Spent by site" />
                      <Card>
                        {data.sites.map((site) => (
                          <View key={site.id} style={styles.rowBetween}>
                            <Text style={[styles.body, { color: colors.foreground }]}>
                              {site.name}
                            </Text>
                            <Text style={[styles.bodyStrong, { color: colors.foreground }]}>
                              {rupees(site.actualMinor)}
                            </Text>
                          </View>
                        ))}
                      </Card>
                    </>
                  ) : null}
                </>
              ) : !data.proposed ? (
                <EmptyState
                  icon="account-balance-wallet"
                  title="No budget yet"
                  detail={
                    data.canManage
                      ? "Set the contract value and an amount for each cost head. Another person approves it."
                      : "A budget has not been set for this project."
                  }
                />
              ) : null}
              {data.canManage && !data.proposed ? (
                <PrimaryButton
                  icon="edit-note"
                  label={data.current ? "Propose a revision" : "Set the budget"}
                  onPress={() => setEditing(true)}
                />
              ) : null}
              {data.history.length > 0 ? (
                <>
                  <SectionHeader title="Revisions" />
                  {data.history.map((row) => (
                    <Card key={row.id}>
                      <View style={styles.rowBetween}>
                        <Text style={[styles.bodyStrong, { color: colors.foreground }]}>
                          Revision {row.revisionNumber} · {rupees(row.totalMinor)}
                        </Text>
                        <StatusPill
                          label={row.status}
                          tone={STATUS_TONE[row.status] ?? "info"}
                          compact
                        />
                      </View>
                      <Text style={[styles.note, { color: colors.muted }]}>
                        Proposed by {row.proposerName} · {formatDateTime(row.createdAt)}
                        {row.reviewerName
                          ? `\n${row.status === "Approved" || row.status === "Superseded" ? "Approved" : "Decided"} by ${row.reviewerName} · ${formatDateTime(row.reviewedAt)}`
                          : ""}
                      </Text>
                      {row.reason ? (
                        <Text style={[styles.body, { color: colors.foreground }]}>
                          Reason: {row.reason}
                        </Text>
                      ) : null}
                      {row.reviewReason ? (
                        <Text style={[styles.body, { color: colors.foreground }]}>
                          Decision note: {row.reviewReason}
                        </Text>
                      ) : null}
                    </Card>
                  ))}
                </>
              ) : null}
            </>
          ) : null}
        </ScrollView>
        {editing && data ? (
          <BudgetSheet
            projectId={data.project.id}
            current={data.current}
            onClose={() => setEditing(false)}
            onDone={() => {
              setEditing(false);
              void overview.refetch();
            }}
          />
        ) : null}
      </Screen>
    </AuthGate>
  );
}

type Overview = inferRouterOutputs<AppRouter>["jp"]["budgets"]["overview"];

function Summary({ data }: { data: Overview }) {
  const colors = useColors();
  const totals = data.comparison.totals;
  const tone = STATE_LABEL[totals.state].tone;
  const barColor = useToneColor(tone);
  const used = Math.min(totals.usedTenths ?? 0, 1000) / 10;
  const lines: [string, string][] = [
    ["Contract value", rupees(data.current?.contractValueMinor)],
    ["Approved budget", rupees(totals.budgetMinor)],
    ["Spent (approved)", rupees(totals.actualMinor)],
    ["Waiting for approval", rupees(totals.pendingMinor)],
    ["Budget left", rupees(totals.remainingMinor)],
  ];
  if (data.margins.plannedMinor !== null)
    lines.push(["Planned margin", rupees(data.margins.plannedMinor)]);
  return (
    <Card>
      <View style={styles.rowBetween}>
        <Text style={[styles.bodyStrong, { color: colors.foreground }]}>
          Revision {data.current?.revisionNumber} · {formatTenths(totals.usedTenths)} used
        </Text>
        <StatusPill label={STATE_LABEL[totals.state].label} tone={tone} compact />
      </View>
      <View style={[styles.track, { backgroundColor: colors.border }]}>
        <View style={[styles.fill, { width: `${used}%`, backgroundColor: barColor }]} />
      </View>
      {lines.map(([label, value]) => (
        <View key={label} style={styles.rowBetween}>
          <Text style={[styles.body, { color: colors.muted }]}>{label}</Text>
          <Text style={[styles.bodyStrong, { color: colors.foreground }]}>{value}</Text>
        </View>
      ))}
    </Card>
  );
}

function HeadRow({ head }: { head: Overview["comparison"]["heads"][number] }) {
  const colors = useColors();
  const state = STATE_LABEL[head.state];
  const barColor = useToneColor(state.tone);
  const used = Math.min(head.usedTenths ?? (head.state === "unbudgeted" ? 1000 : 0), 1000) / 10;
  return (
    <Card>
      <View style={styles.rowBetween}>
        <Text style={[styles.bodyStrong, { color: colors.foreground }]}>{head.costHead}</Text>
        <StatusPill label={state.label} tone={state.tone} compact />
      </View>
      <View style={[styles.track, { backgroundColor: colors.border }]}>
        <View style={[styles.fill, { width: `${used}%`, backgroundColor: barColor }]} />
      </View>
      <Text style={[styles.note, { color: colors.muted }]}>
        Spent {rupees(head.actualMinor)} of {rupees(head.budgetMinor)} (
        {formatTenths(head.usedTenths)}) · Left {rupees(head.remainingMinor)}
        {head.pendingMinor !== "0" ? `\nWaiting for approval: ${rupees(head.pendingMinor)}` : ""}
      </Text>
    </Card>
  );
}

function ProposedCard({
  proposed,
  current,
  canApprove,
  onChanged,
}: {
  proposed: NonNullable<Overview["proposed"]>;
  current: Overview["current"];
  canApprove: boolean;
  onChanged: () => void;
}) {
  const colors = useColors();
  const review = trpc.jp.budgets.review.useMutation();
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const before = new Map((current?.lines ?? []).map((line) => [line.costHead, line.amountMinor]));

  const decide = async (decision: "Approve" | "Reject" | "Withdraw") => {
    setError(null);
    try {
      await review.mutateAsync({
        budgetId: proposed.id,
        decision,
        reason: reason.trim() || null,
        clientMutationId: createClientMutationId(),
      });
      onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The decision was not saved.");
    }
  };

  return (
    <Card>
      <View style={styles.rowBetween}>
        <Text style={[styles.bodyStrong, { color: colors.foreground }]}>
          Revision {proposed.revisionNumber} waiting for approval
        </Text>
        <StatusPill label="Proposed" tone="warning" compact />
      </View>
      <Text style={[styles.note, { color: colors.muted }]}>
        By {proposed.proposerName} · {formatDateTime(proposed.createdAt)}
      </Text>
      {proposed.reason ? (
        <Text style={[styles.body, { color: colors.foreground }]}>Reason: {proposed.reason}</Text>
      ) : null}
      <View style={styles.rowBetween}>
        <Text style={[styles.body, { color: colors.muted }]}>Contract value</Text>
        <Text style={[styles.bodyStrong, { color: colors.foreground }]}>
          {rupees(proposed.contractValueMinor)}
        </Text>
      </View>
      {proposed.lines.map((line) => {
        const old = before.get(line.costHead);
        return (
          <View key={line.costHead} style={styles.rowBetween}>
            <Text style={[styles.body, { color: colors.muted }]}>{line.costHead}</Text>
            <Text style={[styles.bodyStrong, { color: colors.foreground }]}>
              {rupees(line.amountMinor)}
              {current && old !== line.amountMinor ? ` (was ${rupees(old ?? "0")})` : ""}
            </Text>
          </View>
        );
      })}
      <View style={styles.rowBetween}>
        <Text style={[styles.bodyStrong, { color: colors.foreground }]}>Total</Text>
        <Text style={[styles.bodyStrong, { color: colors.foreground }]}>
          {rupees(proposed.totalMinor)}
        </Text>
      </View>
      {canApprove || proposed.mine ? (
        <Field
          label="Note (needed to reject)"
          value={reason}
          onChangeText={setReason}
          maxLength={1000}
        />
      ) : null}
      {error ? <InlineError message={error} /> : null}
      {canApprove ? (
        <>
          <PrimaryButton
            icon="check-circle"
            label="Approve budget"
            disabled={review.isPending}
            onPress={() => void decide("Approve")}
          />
          <SecondaryButton
            icon="cancel"
            label="Reject"
            disabled={review.isPending}
            onPress={() => void decide("Reject")}
          />
        </>
      ) : proposed.mine ? (
        <>
          <Text style={[styles.note, { color: colors.muted }]}>
            Another person with budget approval must approve it.
          </Text>
          <SecondaryButton
            icon="undo"
            label="Withdraw"
            disabled={review.isPending}
            onPress={() => void decide("Withdraw")}
          />
        </>
      ) : null}
    </Card>
  );
}

function BudgetSheet({
  projectId,
  current,
  onClose,
  onDone,
}: {
  projectId: string;
  current: Overview["current"];
  onClose: () => void;
  onDone: () => void;
}) {
  const colors = useColors();
  const propose = trpc.jp.budgets.propose.useMutation();
  const [contract, setContract] = useState(
    current?.contractValueMinor ? minorToRupeeText(current.contractValueMinor) : "",
  );
  const [amounts, setAmounts] = useState<Record<CostHead, string>>(() => {
    const start = Object.fromEntries(COST_HEADS.map((head) => [head, ""])) as Record<
      CostHead,
      string
    >;
    for (const line of current?.lines ?? [])
      start[line.costHead] = minorToRupeeText(line.amountMinor);
    return start;
  });
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [mutationId] = useState(createClientMutationId);

  let total = 0n;
  let invalid: string | null = null;
  const lines: { costHead: CostHead; amountMinor: string }[] = [];
  for (const head of COST_HEADS) {
    const text = amounts[head].trim();
    if (!text) continue;
    try {
      const minor = parseRupeesToMinor(text);
      total += BigInt(minor);
      lines.push({ costHead: head, amountMinor: minor });
    } catch {
      invalid = `Check the amount for ${head}.`;
    }
  }

  const save = async () => {
    setError(null);
    if (invalid) return setError(invalid);
    if (lines.length === 0) return setError("Enter an amount for at least one cost head.");
    if (current && reason.trim().length < 3)
      return setError("Give a reason for revising the approved budget.");
    let contractMinor: string | null = null;
    if (contract.trim()) {
      try {
        contractMinor = parseRupeesToMinor(contract);
      } catch {
        return setError("Check the contract value.");
      }
    }
    try {
      await propose.mutateAsync({
        projectId,
        contractValueMinor: contractMinor,
        lines,
        reason: reason.trim() || null,
        clientMutationId: mutationId,
      });
      onDone();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The budget was not saved.");
    }
  };

  return (
    <Sheet visible title={current ? "Propose a revision" : "Set the budget"} onClose={onClose}>
      <Field
        label="Contract value (₹, optional)"
        value={contract}
        onChangeText={setContract}
        keyboardType="decimal-pad"
        placeholder="e.g. 50000000"
      />
      {COST_HEADS.map((head) => (
        <Field
          key={head}
          label={`${head} (₹)`}
          value={amounts[head]}
          onChangeText={(text) => setAmounts((prev) => ({ ...prev, [head]: text }))}
          keyboardType="decimal-pad"
          placeholder="Leave empty if not used"
        />
      ))}
      <View style={styles.rowBetween}>
        <Text style={[styles.bodyStrong, { color: colors.foreground }]}>Total budget</Text>
        <Text style={[styles.bodyStrong, { color: colors.foreground }]}>
          {formatMinorAsRupees(total)}
        </Text>
      </View>
      <Field
        label={current ? "Reason for the revision" : "Note (optional)"}
        value={reason}
        onChangeText={setReason}
        multiline
        maxLength={1000}
      />
      <Text style={[styles.note, { color: colors.muted }]}>
        The budget counts only after another person with approval rights approves it.
      </Text>
      {error ? <InlineError message={error} /> : null}
      <PrimaryButton
        icon="send"
        label={propose.isPending ? "Sending…" : "Send for approval"}
        disabled={propose.isPending}
        onPress={() => void save()}
      />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  content: { paddingBottom: 120, gap: 12 },
  projectName: { fontSize: 16, fontWeight: "800" },
  rowBetween: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 8,
    marginTop: 6,
  },
  body: { fontSize: 14, lineHeight: 20, marginTop: 4, flexShrink: 1 },
  bodyStrong: { fontSize: 14, fontWeight: "800", flexShrink: 1 },
  note: { fontSize: 12, lineHeight: 18, marginTop: 6 },
  track: { height: 8, borderRadius: 4, marginTop: 10, overflow: "hidden" },
  fill: { height: 8, borderRadius: 4 },
});
