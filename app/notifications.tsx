import { useRouter } from "expo-router";
import { useState } from "react";
import { RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { AuthGate } from "@/components/jp/auth-gate";
import { inboxIcon } from "@/components/jp/inbox-meta";
import {
  AppHeader,
  Card,
  ChipGroup,
  Divider,
  EmptyState,
  InlineError,
  ListRow,
  LoadingBlock,
  OfflineBanner,
  Screen,
  StatusPill,
  formatDateTime,
} from "@/components/jp/ui";
import { useColors } from "@/hooks/use-colors";
import { useConnectivity } from "@/hooks/use-connectivity";
import { siteScopedRoute } from "@/lib/jp/site-route";
import { trpc } from "@/lib/trpc";
import { useT } from "@/lib/i18n";

const views = ["All", "Urgent", "Approvals", "My corrections"] as const;
type View_ = (typeof views)[number];

export default function NotificationsScreen() {
  const colors = useColors();
  const { t } = useT();
  const router = useRouter();
  const { online } = useConnectivity();
  const inbox = trpc.jp.workspace.inbox.useQuery();
  const [view, setView] = useState<View_>("All");
  const all = inbox.data?.items ?? [];
  const inView = (v: View_, item: (typeof all)[number]) =>
    v === "All"
      ? true
      : v === "Urgent"
        ? item.severity === "high"
        : v === "My corrections"
          ? item.kind === "report.returned" || item.kind === "cash.acknowledge"
          : item.kind !== "report.returned" &&
            item.kind !== "task.overdue" &&
            item.kind !== "cash.acknowledge";
  const items = all.filter((item) => inView(view, item));
  const countFor = (v: View_) => all.filter((item) => inView(v, item)).length;

  return (
    <AuthGate>
      <Screen>
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 30 }}
          refreshControl={
            <RefreshControl
              refreshing={inbox.isRefetching}
              onRefresh={() => void inbox.refetch()}
              tintColor={colors.primary}
            />
          }
        >
          <AppHeader
            eyebrow="Inbox"
            title={t("Notifications")}
            subtitle="Work waiting on you, built live from records on your sites."
          />
          <OfflineBanner
            pendingCount={0}
            connected={online === false ? false : inbox.isSuccess ? true : online}
            lastSyncedAt={inbox.dataUpdatedAt ? formatDateTime(inbox.dataUpdatedAt) : null}
            onRetry={() => void inbox.refetch()}
            retrying={inbox.isRefetching}
          />
          {inbox.error && online !== false ? (
            <InlineError message={inbox.error.message} onRetry={() => void inbox.refetch()} />
          ) : null}
          {inbox.data?.unavailable.length ? (
            <InlineError
              title="Some checks are unavailable"
              message={`Could not check: ${inbox.data.unavailable.join(", ")}. Ask your administrator to finish the database update.`}
            />
          ) : null}
          <ChipGroup
            options={views}
            value={view}
            onChange={setView}
            format={(v) => (inbox.data ? `${t(v)} · ${countFor(v)}` : t(v))}
          />
          {inbox.isLoading ? (
            <LoadingBlock label="Checking your queue…" />
          ) : items.length === 0 ? (
            <EmptyState
              icon="notifications-none"
              title={view === "All" ? "You are all caught up" : "Nothing in this view"}
              detail="Reports to review, returned reports, material, invoice, payment, stock and petty cash approvals, custody acknowledgements and overdue tasks appear here."
            />
          ) : (
            <Card style={{ paddingVertical: 2 }}>
              {items.map((item, index) => (
                <View key={item.id}>
                  {index > 0 ? <Divider /> : null}
                  <ListRow
                    icon={inboxIcon[item.kind].icon}
                    tone={inboxIcon[item.kind].tone}
                    title={item.title}
                    detail={`${item.siteName} · ${item.detail} · ${formatDateTime(item.occurredAt)}`}
                    onPress={() => router.push(siteScopedRoute(item.route, item.siteId) as never)}
                    trailing={
                      item.severity === "high" ? (
                        <StatusPill label="Urgent" tone="error" compact />
                      ) : undefined
                    }
                  />
                </View>
              ))}
            </Card>
          )}
          <Text style={[styles.note, { color: colors.muted }]}>
            Opening an item takes you to its register, where your access is checked again.
          </Text>
          <Text
            accessibilityRole="link"
            onPress={() => router.push("/alert-settings" as never)}
            style={[styles.link, { color: colors.primary }]}
          >
            {t("Choose which alerts reach your phone and WhatsApp")}
          </Text>
        </ScrollView>
      </Screen>
    </AuthGate>
  );
}

const styles = StyleSheet.create({
  note: { fontSize: 11, textAlign: "center", marginTop: 14, lineHeight: 16 },
  link: { fontSize: 13, fontWeight: "700", textAlign: "center", marginTop: 12 },
});
