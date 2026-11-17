import { RefreshControl, ScrollView, StyleSheet, Text } from "react-native";
import { AuthGate } from "@/components/jp/auth-gate";
import { AppHeader, Card, EmptyState, InlineError, LoadingBlock, Screen } from "@/components/jp/ui";
import { useColors } from "@/hooks/use-colors";
import { useT } from "@/lib/i18n";
import { trpc } from "@/lib/trpc";

/** Today's summary so far: the same text leaders and site managers get on WhatsApp at 11 PM. */
export default function DaySummaryScreen() {
  const { t } = useT();
  const colors = useColors();
  const summary = trpc.jp.dailySummary.today.useQuery();
  return (
    <AuthGate>
      <Screen>
        <ScrollView
          contentContainerStyle={{ paddingBottom: 32 }}
          refreshControl={
            <RefreshControl
              refreshing={summary.isRefetching}
              onRefresh={() => void summary.refetch()}
            />
          }
        >
          <AppHeader
            eyebrow={t("Today")}
            title={t("Day summary")}
            subtitle={t(
              "Attendance, reports, work measured and money out today. Sent on WhatsApp at 11 PM to leaders and site managers who switched WhatsApp on in their profile.",
            )}
          />
          {summary.isLoading ? <LoadingBlock label={t("Loading…")} /> : null}
          {summary.isError ? (
            <InlineError
              message={t(summary.error.message)}
              onRetry={() => void summary.refetch()}
            />
          ) : null}
          {summary.data && !summary.data.text ? (
            <EmptyState
              icon="summarize"
              title={t("No sites to summarise")}
              detail={t("The summary is for leaders and site managers of a site.")}
            />
          ) : null}
          {summary.data?.text ? (
            <Card>
              <Text selectable style={[styles.text, { color: colors.foreground }]}>
                {summary.data.text}
              </Text>
            </Card>
          ) : null}
        </ScrollView>
      </Screen>
    </AuthGate>
  );
}

const styles = StyleSheet.create({
  text: { fontSize: 14, lineHeight: 21 },
});
