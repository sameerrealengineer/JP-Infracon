import { useLocalSearchParams } from "expo-router";
import { RefreshControl, ScrollView, Text, View } from "react-native";
import { AuthGate } from "@/components/jp/auth-gate";
import { RUN_TONE, TotalRow, commercialStyles as styles } from "@/components/jp/commercial-ui";
import {
  AppHeader,
  Card,
  EmptyState,
  InlineError,
  LoadingBlock,
  Screen,
  SectionHeader,
  StatusPill,
} from "@/components/jp/ui";
import { useColors } from "@/hooks/use-colors";
import { formatMinorAsRupees } from "@/lib/jp/finance-domain";
import { useT } from "@/lib/i18n";
import { trpc } from "@/lib/trpc";

/** One person's khaata on a site: paid, still due, advance, with every pay run and advance. */
export default function KhaataScreen() {
  const { t } = useT();
  const colors = useColors();
  const params = useLocalSearchParams<{ siteId?: string; personId?: string }>();
  const siteId = typeof params.siteId === "string" ? params.siteId : "";
  const personId = typeof params.personId === "string" ? params.personId : "";
  const detail = trpc.jp.advances.person.useQuery(
    { siteId, personId },
    { enabled: Boolean(siteId && personId) },
  );
  const data = detail.data;

  return (
    <AuthGate>
      <Screen>
        <ScrollView
          showsVerticalScrollIndicator={false}
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
            <LoadingBlock label="Loading khaata…" />
          ) : !data ? (
            <>
              <AppHeader eyebrow={t("Khaata")} title={t("Not available")} />
              <InlineError
                message={detail.error?.message ?? "This khaata could not be opened."}
                onRetry={() => void detail.refetch()}
              />
            </>
          ) : (
            <>
              <AppHeader
                eyebrow={t("Khaata")}
                title={data.person.name}
                subtitle={`${data.person.trade ?? ""}${data.person.trade ? " · " : ""}${data.siteName}`}
              />
              <Card>
                {data.position.dueMinor !== null ? (
                  <TotalRow
                    label={t("Still to pay")}
                    value={formatMinorAsRupees(data.position.dueMinor)}
                    strong
                  />
                ) : null}
                {data.position.approvedUnpaidMinor !== null &&
                data.position.approvedUnpaidMinor !== "0" ? (
                  <TotalRow
                    label={t("Approved pay not paid yet")}
                    value={formatMinorAsRupees(data.position.approvedUnpaidMinor)}
                  />
                ) : null}
                {data.position.notInPayRunMinor !== null &&
                data.position.notInPayRunMinor !== "0" ? (
                  <TotalRow
                    label={t("Work not in a pay run yet (about)")}
                    value={formatMinorAsRupees(data.position.notInPayRunMinor)}
                  />
                ) : null}
                {data.position.paidMinor !== null ? (
                  <TotalRow
                    label={t("Paid so far")}
                    value={formatMinorAsRupees(data.position.paidMinor)}
                  />
                ) : null}
                <TotalRow
                  label={t("Advance given")}
                  value={formatMinorAsRupees(data.position.advanceGivenMinor)}
                />
                <TotalRow
                  label={t("Advance recovered")}
                  value={formatMinorAsRupees(data.position.advanceRecoveredMinor)}
                />
                <TotalRow
                  label={t("Advance to recover")}
                  value={formatMinorAsRupees(data.position.advanceOutstandingMinor)}
                  strong
                />
              </Card>
              {data.runs.length ? <SectionHeader title={t("Pay runs")} /> : null}
              {data.runs.map((run) => (
                <Card key={run.runId} accent={RUN_TONE[run.status] ?? "info"}>
                  <View style={styles.row}>
                    <Text style={[styles.title, { color: colors.foreground, flex: 1 }]}>
                      {run.month}
                    </Text>
                    <StatusPill
                      label={t(run.status)}
                      tone={RUN_TONE[run.status] ?? "info"}
                      compact
                    />
                  </View>
                  <TotalRow label={t("Gross")} value={formatMinorAsRupees(run.grossMinor)} />
                  {run.deductionMinor !== "0" ? (
                    <TotalRow
                      label={t("Advance recovery")}
                      value={`− ${formatMinorAsRupees(run.deductionMinor)}`}
                    />
                  ) : null}
                  <TotalRow label={t("Net pay")} value={formatMinorAsRupees(run.netMinor)} strong />
                  {run.paidOn ? (
                    <Text style={[styles.meta, { color: colors.muted }]}>
                      {t("Paid on {date}", { date: run.paidOn })}
                    </Text>
                  ) : null}
                </Card>
              ))}
              <SectionHeader title={t("Advances")} />
              {data.entries.length === 0 ? (
                <EmptyState
                  icon="savings"
                  title="No advances"
                  detail="Advances and repayments appear here."
                />
              ) : (
                data.entries.map((entry) => (
                  <Card key={entry.id} accent={RUN_TONE[entry.status] ?? "info"}>
                    <View style={styles.row}>
                      <Text style={[styles.title, { color: colors.foreground, flex: 1 }]}>
                        {t(entry.entryType)} {formatMinorAsRupees(entry.amountMinor)}
                      </Text>
                      <StatusPill
                        label={t(entry.status)}
                        tone={RUN_TONE[entry.status] ?? "info"}
                        compact
                      />
                    </View>
                    <Text style={[styles.meta, { color: colors.muted }]}>
                      {entry.entryDate} · {t(entry.mode)}
                      {entry.reference ? ` · ${entry.reference}` : ""} · {entry.reason}
                      {entry.reviewReason ? ` · ${entry.reviewReason}` : ""}
                    </Text>
                  </Card>
                ))
              )}
            </>
          )}
        </ScrollView>
      </Screen>
    </AuthGate>
  );
}
