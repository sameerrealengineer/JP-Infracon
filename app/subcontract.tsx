import { useLocalSearchParams, useRouter } from "expo-router";
import { HelpButton } from "@/components/jp/help";
import { useState } from "react";
import { RefreshControl, ScrollView, Text, View } from "react-native";
import { AuthGate } from "@/components/jp/auth-gate";
import { WO_TONE, commercialStyles as styles } from "@/components/jp/commercial-ui";
import {
  AppHeader,
  Card,
  ChipGroup,
  EmptyState,
  InlineError,
  LoadingBlock,
  PrimaryButton,
  Screen,
  StatusPill,
} from "@/components/jp/ui";
import { useColors } from "@/hooks/use-colors";
import { useWorkspace } from "@/hooks/use-workspace";
import { formatPercent } from "@/lib/jp/billing-domain";
import { formatMinorAsRupees } from "@/lib/jp/finance-domain";
import { resolveSelectedId } from "@/lib/jp/selection";
import { useT } from "@/lib/i18n";
import { trpc } from "@/lib/trpc";

/** Work orders to subcontractors on a site: status, progress, billed, measurements to check. */
export default function SubcontractScreen() {
  const { t } = useT();
  const colors = useColors();
  const router = useRouter();
  const params = useLocalSearchParams<{ siteId?: string }>();
  const workspace = useWorkspace();
  const sites = trpc.jp.workspace.mySites.useQuery();
  const options = (sites.data ?? []).filter((site) =>
    workspace.sitesWith("subcontract.view").includes(site.id),
  );
  const [chosen, setChosen] = useState<string | null>(
    typeof params.siteId === "string" ? params.siteId : null,
  );
  const siteId = resolveSelectedId(options, chosen);
  const list = trpc.jp.subcontract.list.useQuery({ siteId }, { enabled: Boolean(siteId) });
  const canCreate = workspace.sitesWith("subcontract.create").includes(siteId);

  return (
    <AuthGate>
      <Screen>
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.content}
          refreshControl={
            <RefreshControl
              refreshing={list.isRefetching}
              onRefresh={() => void list.refetch()}
              tintColor={colors.primary}
            />
          }
        >
          <AppHeader
            right={<HelpButton topicKey="subcontract" />}
            eyebrow={t("Subcontractors")}
            title={t("Work orders")}
            subtitle={t(
              "Work orders with their own rates, measurement book, RA bills, retention and advance recovery.",
            )}
          />
          {options.length > 1 ? (
            <ChipGroup
              options={options.map((site) => site.id)}
              value={siteId}
              onChange={setChosen}
              format={(id) => options.find((site) => site.id === id)?.name ?? id}
            />
          ) : null}
          {list.error ? (
            <InlineError message={list.error.message} onRetry={() => void list.refetch()} />
          ) : null}
          {canCreate ? (
            <PrimaryButton
              icon="engineering"
              label={t("New work order")}
              onPress={() => router.push(`/wo-editor?siteId=${siteId}` as never)}
            />
          ) : null}
          {!siteId ? (
            <EmptyState
              icon="engineering"
              title="No site"
              detail="Work orders are made for a site you are assigned to."
            />
          ) : list.isLoading ? (
            <LoadingBlock label="Loading work orders…" />
          ) : (list.data?.length ?? 0) === 0 ? (
            <EmptyState
              icon="engineering"
              title="No work orders yet"
              detail="Give a subcontractor a work order with items, quantities and rates."
            />
          ) : (
            list.data?.map((order) => (
              <Card
                key={order.id}
                accent={WO_TONE[order.status] ?? "info"}
                onPress={() => router.push(`/work-order?siteId=${siteId}&id=${order.id}` as never)}
                accessibilityLabel={`Open ${order.woNumber}`}
              >
                <View style={styles.row}>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.title, { color: colors.foreground }]}>
                      {order.woNumber}
                    </Text>
                    <Text style={[styles.meta, { color: colors.muted }]}>
                      {order.title} · {order.vendorName}
                    </Text>
                  </View>
                  <StatusPill
                    label={t(order.status)}
                    tone={WO_TONE[order.status] ?? "info"}
                    compact
                  />
                </View>
                <View style={[styles.row, { marginTop: 8 }]}>
                  <Text style={[styles.money, { color: colors.foreground }]}>
                    {formatMinorAsRupees(order.valueMinor)}
                  </Text>
                  <Text style={[styles.meta, { color: colors.muted }]}>
                    {t("{pct} done", { pct: formatPercent(order.progressBps) })} ·{" "}
                    {t("billed {amount}", { amount: formatMinorAsRupees(order.billedValueMinor) })}
                  </Text>
                </View>
                {order.toCheck > 0 ? (
                  <Text style={[styles.meta, { color: colors.warning }]}>
                    {t("{count} measurements to check", { count: order.toCheck })}
                  </Text>
                ) : null}
              </Card>
            ))
          )}
        </ScrollView>
      </Screen>
    </AuthGate>
  );
}
