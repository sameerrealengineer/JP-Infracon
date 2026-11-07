import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { Linking, Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { AuthGate } from "@/components/jp/auth-gate";
import { QUOTE_TONE, STAGE_TONE, commercialStyles as styles } from "@/components/jp/commercial-ui";
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
  SectionHeader,
  StatusPill,
  formatDateTime,
} from "@/components/jp/ui";
import { useColors } from "@/hooks/use-colors";
import { ACTIVITY_KINDS, LEAD_STAGES, type LeadStage } from "@/lib/jp/billing-domain";
import { formatMinorAsRupees } from "@/lib/jp/finance-domain";
import { createClientMutationId } from "@/lib/jp/local-repository";
import { useT } from "@/lib/i18n";
import { trpc } from "@/lib/trpc";

/** One enquiry: details, stage, follow-up history and its quotations. */
export default function LeadScreen() {
  const { t } = useT();
  const colors = useColors();
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string }>();
  const leadId = typeof params.id === "string" ? params.id : "";
  const utils = trpc.useUtils();
  const lookups = trpc.jp.crm.lookups.useQuery();
  const detail = trpc.jp.crm.leads.detail.useQuery({ leadId }, { enabled: Boolean(leadId) });
  const addActivity = trpc.jp.crm.leads.addActivity.useMutation();
  const move = trpc.jp.crm.leads.move.useMutation();
  const [kind, setKind] = useState<(typeof ACTIVITY_KINDS)[number]>("Call");
  const [note, setNote] = useState("");
  const [followUp, setFollowUp] = useState("");
  const [activityKey, setActivityKey] = useState(createClientMutationId);
  const [nextStage, setNextStage] = useState<LeadStage | null>(null);
  const [reason, setReason] = useState("");
  const [moveKey, setMoveKey] = useState(createClientMutationId);
  const [error, setError] = useState<string | null>(null);
  const canManage = lookups.data?.canManage ?? false;
  const data = detail.data;

  const refresh = async () => {
    await Promise.all([
      utils.jp.crm.leads.detail.invalidate(),
      utils.jp.crm.leads.list.invalidate(),
    ]);
  };

  const logActivity = async () => {
    setError(null);
    try {
      await addActivity.mutateAsync({
        leadId,
        kind,
        note: note.trim(),
        nextFollowUpOn: followUp.trim() || undefined,
        clientMutationId: activityKey,
      });
      setNote("");
      setFollowUp("");
      setActivityKey(createClientMutationId());
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Not saved.");
    }
  };

  const changeStage = async () => {
    if (!nextStage) return;
    setError(null);
    try {
      await move.mutateAsync({
        leadId,
        stage: nextStage,
        reason: reason.trim() || null,
        clientMutationId: moveKey,
      });
      setNextStage(null);
      setReason("");
      setMoveKey(createClientMutationId());
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Not saved.");
    }
  };

  return (
    <AuthGate>
      <Screen>
        <ScrollView
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.content}
          refreshControl={
            <RefreshControl
              refreshing={detail.isRefetching}
              onRefresh={() => void detail.refetch()}
              tintColor={colors.primary}
            />
          }
        >
          {detail.isLoading ? (
            <LoadingBlock label="Loading enquiry…" />
          ) : !data ? (
            <>
              <AppHeader eyebrow={t("Enquiry")} title={t("Not available")} />
              <InlineError
                message={detail.error?.message ?? "This enquiry could not be opened."}
                onRetry={() => void detail.refetch()}
              />
            </>
          ) : (
            <>
              <AppHeader eyebrow={t("Enquiry")} title={data.lead.title} />
              <Card accent={STAGE_TONE[data.lead.stage as LeadStage] ?? "info"}>
                <View style={styles.row}>
                  <StatusPill
                    label={t(data.lead.stage)}
                    tone={STAGE_TONE[data.lead.stage as LeadStage] ?? "info"}
                  />
                  <Text style={[styles.money, { color: colors.foreground, textAlign: "right" }]}>
                    {data.lead.estimatedValueMinor
                      ? formatMinorAsRupees(data.lead.estimatedValueMinor)
                      : "—"}
                  </Text>
                </View>
                <Text style={[styles.meta, { color: colors.muted }]}>
                  {[
                    data.client?.name ?? data.lead.contactName,
                    data.lead.location,
                    t(data.lead.source),
                    data.ownerName ? `${t("Owner")}: ${data.ownerName}` : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </Text>
                {data.lead.nextFollowUpOn ? (
                  <Text style={[styles.meta, { color: colors.foreground }]}>
                    {t("Next follow-up")}: {String(data.lead.nextFollowUpOn)}
                  </Text>
                ) : null}
                {data.lead.lostReason ? (
                  <Text style={[styles.meta, { color: colors.error }]}>
                    {t("Lost because")}: {data.lead.lostReason}
                  </Text>
                ) : null}
                {data.lead.phone || data.client?.phone ? (
                  <Pressable
                    accessibilityRole="link"
                    onPress={() =>
                      void Linking.openURL(`tel:${data.lead.phone ?? data.client?.phone}`)
                    }
                    style={[styles.row, { marginTop: 10 }]}
                  >
                    <MaterialIcons name="call" size={18} color={colors.primary} />
                    <Text style={[styles.title, { color: colors.primary }]}>
                      {data.lead.phone ?? data.client?.phone}
                    </Text>
                  </Pressable>
                ) : null}
              </Card>

              {canManage ? (
                <>
                  <SectionHeader title={t("Move to stage")} />
                  <Card>
                    <ChipGroup
                      options={LEAD_STAGES.filter((stage) => stage !== data.lead.stage)}
                      value={nextStage}
                      onChange={setNextStage}
                      format={(v) => t(v)}
                    />
                    {nextStage ? (
                      <>
                        <Field
                          label={
                            nextStage === "Lost" ? t("Why was it lost?") : t("Note (optional)")
                          }
                          value={reason}
                          onChangeText={setReason}
                          multiline
                        />
                        <PrimaryButton
                          icon="arrow-forward"
                          label={t("Move to {stage}", { stage: t(nextStage) })}
                          loading={move.isPending}
                          onPress={() => void changeStage()}
                        />
                      </>
                    ) : null}
                  </Card>
                </>
              ) : null}

              <SectionHeader
                title={t("Quotations")}
                action={canManage && data.client ? t("New") : undefined}
                onPress={() =>
                  router.push(
                    `/quotation-editor?clientId=${data.client?.id}&leadId=${data.lead.id}` as never,
                  )
                }
              />
              {data.quotations.length === 0 ? (
                <EmptyState
                  icon="request-quote"
                  title="No quotation yet"
                  detail={
                    data.client
                      ? "Make one when the scope and rates are clear."
                      : "Link a client to this enquiry to make a quotation."
                  }
                />
              ) : (
                data.quotations.map((quote) => (
                  <Card
                    key={quote.id}
                    onPress={() => router.push(`/quotation?id=${quote.id}` as never)}
                    accessibilityLabel={`Open ${quote.quotationNumber}`}
                  >
                    <View style={styles.row}>
                      <Text style={[styles.title, { color: colors.foreground, flex: 1 }]}>
                        {quote.quotationNumber}
                      </Text>
                      <StatusPill
                        label={t(quote.status)}
                        tone={QUOTE_TONE[quote.status] ?? "info"}
                        compact
                      />
                    </View>
                    <Text style={[styles.meta, { color: colors.foreground }]}>
                      {formatMinorAsRupees(quote.totalMinor)}
                    </Text>
                  </Card>
                ))
              )}

              <SectionHeader title={t("Follow-ups & notes")} />
              {canManage ? (
                <Card>
                  <ChipGroup
                    options={ACTIVITY_KINDS}
                    value={kind}
                    onChange={setKind}
                    format={(v) => t(v)}
                  />
                  <Field label={t("What happened")} value={note} onChangeText={setNote} multiline />
                  <Field
                    label={t("Next follow-up (YYYY-MM-DD)")}
                    value={followUp}
                    onChangeText={setFollowUp}
                  />
                  <PrimaryButton
                    icon="save"
                    label={t("Save")}
                    loading={addActivity.isPending}
                    disabled={note.trim().length < 2}
                    onPress={() => void logActivity()}
                  />
                </Card>
              ) : null}
              {error ? <InlineError message={error} /> : null}
              {data.activities.map((activity) => (
                <Card key={activity.id}>
                  <View style={styles.row}>
                    <StatusPill label={t(activity.kind)} tone="info" compact />
                    {activity.stageTo ? (
                      <Text style={[styles.meta, { color: colors.muted, marginTop: 0 }]}>
                        {t(activity.stageFrom ?? "")} → {t(activity.stageTo)}
                      </Text>
                    ) : null}
                  </View>
                  <Text style={[styles.meta, { color: colors.foreground, fontSize: 14 }]}>
                    {activity.note}
                  </Text>
                  <Text style={[styles.meta, { color: colors.muted }]}>
                    {activity.byName ?? "—"} · {formatDateTime(activity.createdAt)}
                  </Text>
                </Card>
              ))}
            </>
          )}
        </ScrollView>
      </Screen>
    </AuthGate>
  );
}
