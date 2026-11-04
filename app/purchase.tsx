import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { RefreshControl, ScrollView, Text, View } from "react-native";
import { AuthGate } from "@/components/jp/auth-gate";
import { PO_TONE, commercialStyles as styles } from "@/components/jp/commercial-ui";
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
import { formatMinorAsRupees } from "@/lib/jp/finance-domain";
import { resolveSelectedId } from "@/lib/jp/selection";
import { useT } from "@/lib/i18n";
import { trpc } from "@/lib/trpc";

/** Purchase orders for a site: status, delivery and billing at a glance. */
export default function PurchaseScreen() {
  const { t } = useT();
  const colors = useColors();
  const router = useRouter();
  const params = useLocalSearchParams<{ siteId?: string }>();
  const workspace = useWorkspace();
  const sites = trpc.jp.workspace.mySites.useQuery();
  const options = (sites.data ?? []).filter((site) =>
    workspace.sitesWith("purchase.view").includes(site.id),
  );
  const [chosen, setChosen] = useState<string | null>(
    typeof params.siteId === "string" ? params.siteId : null,
  );
  const siteId = resolveSelectedId(options, chosen);
  const list = trpc.jp.purchase.list.useQuery({ siteId }, { enabled: Boolean(siteId) });
  const canCreate = workspace.sitesWith("purchase.create").includes(siteId);

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
            eyebrow={t("Materials & stock")}
            title={t("Purchase orders")}
            subtitle={t(
              "Order from suppliers with quotes compared, approve, receive at site, and match the bill.",
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
              icon="add-shopping-cart"
              label={t("New purchase order")}
              onPress={() => router.push(`/po-editor?siteId=${siteId}` as never)}
            />
          ) : null}
          {!siteId ? (
            <EmptyState
              icon="shopping-cart"
              title="No site"
              detail="Purchase orders are made for a site you are assigned to."
            />
          ) : list.isLoading ? (
            <LoadingBlock label="Loading orders…" />
          ) : (list.data?.length ?? 0) === 0 ? (
            <EmptyState
              icon="shopping-cart"
              title="No purchase orders yet"
              detail="Raise one from an approved material request or directly."
            />
          ) : (
            list.data?.map((order) => (
              <Card
                key={order.id}
                accent={PO_TONE[order.status] ?? "info"}
                onPress={() => router.push(`/po?siteId=${siteId}&id=${order.id}` as never)}
                accessibilityLabel={`Open ${order.poNumber}`}
              >
                <View style={styles.row}>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.title, { color: colors.foreground }]}>
                      {order.poNumber}
                    </Text>
                    <Text style={[styles.meta, { color: colors.muted }]}>
                      {order.vendorName} · {String(order.orderDate)}
                    </Text>
                  </View>
                  <StatusPill
                    label={t(order.status)}
                    tone={PO_TONE[order.status] ?? "info"}
                    compact
                  />
                </View>
                <View style={[styles.row, { marginTop: 8 }]}>
                  <Text style={[styles.money, { color: colors.foreground }]}>
                    {formatMinorAsRupees(order.totalMinor)}
                  </Text>
                  {order.status === "Approved" || order.status === "Closed" ? (
                    <StatusPill
                      label={t(order.receipt)}
                      tone={PO_TONE[order.receipt] ?? "info"}
                      compact
                    />
                  ) : null}
                </View>
              </Card>
            ))
          )}
        </ScrollView>
      </Screen>
    </AuthGate>
  );
}
