import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { AttachmentStrip } from "@/components/jp/attachment-strip";
import { AuthGate } from "@/components/jp/auth-gate";
import {
  AppHeader,
  Card,
  ChipGroup,
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
} from "@/components/jp/ui";
import { useColors } from "@/hooks/use-colors";
import {
  actionButtonLabel,
  availableIssueActions,
  isIssueOverdue,
  severityTone,
  type IssueAction,
} from "@/lib/jp/issue-policy";
import { createClientMutationId } from "@/lib/jp/local-repository";
import { trpc } from "@/lib/trpc";
import { useT } from "@/lib/i18n";

export default function IssueDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const issueId = typeof id === "string" ? id : "";
  const colors = useColors();
  const { t } = useT();
  const detail = trpc.jp.issues.detail.useQuery({ issueId }, { enabled: Boolean(issueId) });
  const [action, setAction] = useState<IssueAction | null>(null);
  const [assignOpen, setAssignOpen] = useState(false);
  const [comment, setComment] = useState("");
  const [commentId, setCommentId] = useState(createClientMutationId);
  const [commentError, setCommentError] = useState<string | null>(null);
  const utils = trpc.useUtils();
  const addComment = trpc.jp.issues.comment.useMutation();

  const data = detail.data;
  const issue = data?.issue;
  const actions = issue && data ? availableIssueActions(issue.status, data.permissions) : [];

  const postComment = async () => {
    setCommentError(null);
    try {
      await addComment.mutateAsync({ issueId, note: comment.trim(), clientMutationId: commentId });
      setComment("");
      setCommentId(createClientMutationId());
      await utils.jp.issues.detail.invalidate({ issueId });
    } catch (cause) {
      setCommentError(cause instanceof Error ? cause.message : "Comment not saved.");
    }
  };

  return (
    <AuthGate>
      <Screen>
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 40 }}
          keyboardShouldPersistTaps="handled"
          refreshControl={
            <RefreshControl
              refreshing={detail.isRefetching}
              onRefresh={() => void detail.refetch()}
              tintColor={colors.primary}
            />
          }
        >
          <AppHeader
            eyebrow={issue ? `${issue.issueCode} · ${issue.siteName}` : "Issue"}
            title={issue?.title ?? "Issue"}
          />
          {detail.error ? (
            <InlineError message={detail.error.message} onRetry={() => void detail.refetch()} />
          ) : null}
          {detail.isLoading ? <LoadingBlock label="Loading issue…" /> : null}
          {issue && data ? (
            <>
              <View style={styles.pills}>
                <StatusPill label={issue.severity} tone={severityTone(issue.severity)} />
                <StatusPill
                  label={issue.status}
                  tone={
                    issue.status === "Closed"
                      ? "success"
                      : issue.status === "Resolved"
                        ? "info"
                        : "warning"
                  }
                />
                {issue.stopWork === "Yes" && issue.status !== "Closed" ? (
                  <StatusPill label="STOP WORK" tone="error" />
                ) : null}
                {isIssueOverdue(issue) ? <StatusPill label="Overdue" tone="error" /> : null}
              </View>

              <Card style={{ marginBottom: 16 }}>
                <View style={{ flex: 1, gap: 10 }}>
                  <Detail icon="category" label="Type" value={issue.category} />
                  <Detail icon="description" label="What was seen" value={issue.description} />
                  {issue.locationLabel ? (
                    <Detail icon="place" label="Location" value={issue.locationLabel} />
                  ) : null}
                  {issue.immediateAction ? (
                    <Detail
                      icon="flash-on"
                      label="Immediate action"
                      value={issue.immediateAction}
                    />
                  ) : null}
                  <Detail
                    icon="person-outline"
                    label="Raised"
                    value={`${issue.raisedByName ?? "Unknown"} · observed ${formatDateTime(issue.observedAt)}`}
                  />
                  <Detail
                    icon="assignment-ind"
                    label="Owner"
                    value={
                      issue.ownerNameSnapshot
                        ? `${issue.ownerNameSnapshot}${issue.targetDate ? ` · target ${issue.targetDate}` : ""}`
                        : "Not assigned yet"
                    }
                  />
                  {issue.correctiveAction ? (
                    <Detail
                      icon="build"
                      label={`Corrective action${issue.resolvedByName ? ` · ${issue.resolvedByName}` : ""}`}
                      value={issue.correctiveAction}
                    />
                  ) : null}
                  {issue.preventiveAction ? (
                    <Detail
                      icon="shield"
                      label="Preventive action"
                      value={issue.preventiveAction}
                    />
                  ) : null}
                  {issue.closureNote ? (
                    <Detail
                      icon="verified"
                      label={`Closed${issue.closedByName ? ` by ${issue.closedByName}` : ""}`}
                      value={issue.closureNote}
                    />
                  ) : null}
                </View>
              </Card>

              {actions.length || (data.permissions.manage && issue.status !== "Closed") ? (
                <View style={styles.actions}>
                  {actions.map((next) => (
                    <PrimaryButton
                      key={next}
                      label={t(actionButtonLabel(next))}
                      icon={
                        next === "resolve"
                          ? "task-alt"
                          : next === "close"
                            ? "verified"
                            : next === "reopen"
                              ? "replay"
                              : next === "send_back"
                                ? "undo"
                                : "play-arrow"
                      }
                      tone={next === "close" ? "gold" : next === "send_back" ? "danger" : "primary"}
                      onPress={() => setAction(next)}
                    />
                  ))}
                  {data.permissions.manage && issue.status !== "Closed" ? (
                    <SecondaryButton
                      icon="assignment-ind"
                      label={issue.ownerUserId ? "Reassign owner" : "Assign owner"}
                      onPress={() => setAssignOpen(true)}
                    />
                  ) : null}
                </View>
              ) : null}

              <Card style={{ marginBottom: 18 }}>
                <View style={{ flex: 1 }}>
                  <AttachmentStrip
                    entityType="site_issue"
                    entityId={issue.id}
                    canUpload={data.permissions.comment}
                    title={t("Photos & evidence")}
                  />
                </View>
              </Card>

              <SectionHeader
                title={t("History")}
                caption="Every step is kept and cannot be edited"
              />
              <View style={{ marginBottom: 14 }}>
                {data.events.map((event, index) => (
                  <View key={event.id} style={styles.event}>
                    <View style={styles.rail}>
                      <View
                        style={[
                          styles.dot,
                          {
                            backgroundColor:
                              event.eventType === "Comment"
                                ? colors.muted
                                : event.toStatus === "Closed"
                                  ? colors.success
                                  : event.eventType === "Reopened"
                                    ? colors.error
                                    : colors.accent,
                          },
                        ]}
                      />
                      {index < data.events.length - 1 ? (
                        <View style={[styles.line, { backgroundColor: colors.border }]} />
                      ) : null}
                    </View>
                    <View style={{ flex: 1, paddingBottom: 16 }}>
                      <Text style={[styles.eventTitle, { color: colors.foreground }]}>
                        {event.eventType === "Status Changed"
                          ? `${event.fromStatus} → ${event.toStatus}`
                          : event.eventType}
                      </Text>
                      {event.note ? (
                        <Text style={[styles.eventNote, { color: colors.foreground }]}>
                          {event.note}
                        </Text>
                      ) : null}
                      <Text style={[styles.eventMeta, { color: colors.muted }]}>
                        {event.actorName ?? "Unknown"} · {formatDateTime(event.createdAt)}
                      </Text>
                    </View>
                  </View>
                ))}
              </View>

              {data.permissions.comment ? (
                <Card>
                  <View style={{ flex: 1 }}>
                    {commentError ? (
                      <InlineError message={commentError} title="Not posted" />
                    ) : null}
                    <Field
                      label={t("Add an update")}
                      value={comment}
                      onChangeText={setComment}
                      multiline
                      placeholder="Progress, findings or follow-up"
                    />
                    <PrimaryButton
                      icon="send"
                      label={t("Post update")}
                      disabled={comment.trim().length < 2}
                      loading={addComment.isPending}
                      onPress={() => void postComment()}
                    />
                  </View>
                </Card>
              ) : null}
            </>
          ) : null}
        </ScrollView>
        {issue ? (
          <>
            <ActionSheet
              key={action ?? "none"}
              issueId={issue.id}
              action={action}
              severity={issue.severity}
              onClose={() => setAction(null)}
            />
            {assignOpen ? (
              <AssignSheet
                issueId={issue.id}
                siteId={issue.siteId}
                currentTarget={issue.targetDate}
                onClose={() => setAssignOpen(false)}
              />
            ) : null}
          </>
        ) : null}
      </Screen>
    </AuthGate>
  );
}

function Detail({
  icon,
  label,
  value,
}: {
  icon: keyof typeof MaterialIcons.glyphMap;
  label: string;
  value: string;
}) {
  const colors = useColors();
  return (
    <View style={styles.detail}>
      <MaterialIcons name={icon} size={17} color={colors.accent} style={{ marginTop: 2 }} />
      <View style={{ flex: 1 }}>
        <Text style={[styles.detailLabel, { color: colors.muted }]}>{label}</Text>
        <Text style={[styles.detailValue, { color: colors.foreground }]}>{value}</Text>
      </View>
    </View>
  );
}

function ActionSheet({
  issueId,
  action,
  severity,
  onClose,
}: {
  issueId: string;
  action: IssueAction | null;
  severity: string;
  onClose: () => void;
}) {
  const utils = trpc.useUtils();
  const transition = trpc.jp.issues.transition.useMutation();
  const [mutationId] = useState(createClientMutationId);
  const [note, setNote] = useState("");
  const [corrective, setCorrective] = useState("");
  const [preventive, setPreventive] = useState("");
  const [error, setError] = useState<string | null>(null);
  if (!action) return null;
  const resolving = action === "resolve";
  const needsNote = ["close", "send_back", "reopen"].includes(action);
  const disabled = resolving
    ? corrective.trim().length < 5
    : needsNote
      ? note.trim().length < 3
      : false;

  const save = async () => {
    setError(null);
    try {
      await transition.mutateAsync({
        issueId,
        action,
        note: note.trim() || undefined,
        correctiveAction: corrective.trim() || undefined,
        preventiveAction: preventive.trim() || undefined,
        clientMutationId: mutationId,
      });
      await Promise.all([utils.jp.issues.invalidate(), utils.jp.workspace.inbox.invalidate()]);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The issue was not updated.");
    }
  };

  return (
    <Sheet
      visible
      title={actionButtonLabel(action)}
      subtitle={
        action === "close" && (severity === "High" || severity === "Critical")
          ? "A High or Critical issue must be closed by someone other than the person who resolved it."
          : action === "close"
            ? "Confirm on site that the fix holds before closing."
            : undefined
      }
      onClose={onClose}
      footer={
        <PrimaryButton
          label={actionButtonLabel(action)}
          tone={action === "send_back" ? "danger" : action === "close" ? "gold" : "primary"}
          disabled={disabled}
          loading={transition.isPending}
          onPress={() => void save()}
        />
      }
    >
      {error ? <InlineError message={error} title="Not updated" /> : null}
      {resolving ? (
        <>
          <Field
            label="Corrective action taken"
            value={corrective}
            onChangeText={setCorrective}
            multiline
            placeholder="What was fixed and how"
          />
          <Field
            label="Preventive action (optional)"
            value={preventive}
            onChangeText={setPreventive}
            multiline
            placeholder="How it will be prevented next time"
          />
        </>
      ) : (
        <Field
          label={needsNote ? "Note (required)" : "Note (optional)"}
          value={note}
          onChangeText={setNote}
          multiline
          placeholder={
            action === "close" ? "e.g. Verified barricade in place on 2 Nov" : "Add context"
          }
        />
      )}
    </Sheet>
  );
}

function AssignSheet({
  issueId,
  siteId,
  currentTarget,
  onClose,
}: {
  issueId: string;
  siteId: string;
  currentTarget: string | null;
  onClose: () => void;
}) {
  const utils = trpc.useUtils();
  const owners = trpc.jp.issues.owners.useQuery({ siteId });
  const assign = trpc.jp.issues.assign.useMutation();
  const [mutationId] = useState(createClientMutationId);
  const [owner, setOwner] = useState<string | null>(null);
  const [target, setTarget] = useState(currentTarget ?? "");
  const [error, setError] = useState<string | null>(null);
  const people = owners.data ?? [];
  const targetValid = !target || /^\d{4}-\d{2}-\d{2}$/.test(target);

  const save = async () => {
    if (!owner) return;
    setError(null);
    try {
      await assign.mutateAsync({
        issueId,
        ownerUserId: Number(owner),
        targetDate: target || undefined,
        clientMutationId: mutationId,
      });
      await Promise.all([utils.jp.issues.invalidate(), utils.jp.workspace.inbox.invalidate()]);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The owner was not assigned.");
    }
  };

  return (
    <Sheet
      visible
      title="Assign owner"
      subtitle="The owner is responsible for fixing the issue by the target date."
      onClose={onClose}
      footer={
        <PrimaryButton
          icon="assignment-ind"
          label="Assign"
          disabled={!owner || !targetValid}
          loading={assign.isPending}
          onPress={() => void save()}
        />
      }
    >
      {error ? <InlineError message={error} title="Not assigned" /> : null}
      {owners.isLoading ? <LoadingBlock label="Loading site team…" /> : null}
      <ChipGroup
        label="Owner"
        options={people.map((person) => String(person.userId))}
        value={owner}
        onChange={setOwner}
        format={(value) => people.find((person) => String(person.userId) === value)?.name ?? value}
      />
      <Field
        label="Target date"
        value={target}
        onChangeText={setTarget}
        placeholder="YYYY-MM-DD"
        error={targetValid ? null : "Use YYYY-MM-DD."}
      />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  pills: { flexDirection: "row", gap: 8, flexWrap: "wrap", marginBottom: 14 },
  actions: { gap: 10, marginBottom: 18 },
  detail: { flexDirection: "row", gap: 10 },
  detailLabel: { fontSize: 11, fontWeight: "700" },
  detailValue: { fontSize: 14, lineHeight: 20, marginTop: 2 },
  event: { flexDirection: "row", gap: 12 },
  rail: { alignItems: "center", width: 14 },
  dot: { width: 12, height: 12, borderRadius: 6, marginTop: 3 },
  line: { width: 2, flex: 1, marginTop: 2 },
  eventTitle: { fontSize: 13, fontWeight: "800" },
  eventNote: { fontSize: 13, lineHeight: 19, marginTop: 3 },
  eventMeta: { fontSize: 11, marginTop: 4 },
});
