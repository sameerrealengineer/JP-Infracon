import { useRouter } from "expo-router";
import { useState } from "react";
import { RefreshControl, ScrollView, Text, View } from "react-native";
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
  StatusPill,
  formatDateTime,
  type Tone,
} from "@/components/jp/ui";
import { useColors } from "@/hooks/use-colors";
import { STAFF_CATEGORIES, WORKER_PROBLEMS, type ReportSource } from "@/lib/jp/app-reports";
import { useT } from "@/lib/i18n";
import { trpc } from "@/lib/trpc";

const SOURCE: Record<ReportSource, { label: string; tone: Tone }> = {
  pin_reset: { label: "Forgot PIN", tone: "warning" },
  worker: { label: "Worker help", tone: "warning" },
  staff: { label: "Staff report", tone: "info" },
  app_error: { label: "App error", tone: "error" },
};
const FILTERS = ["all", "pin_reset", "worker", "staff", "app_error"] as const;
type Filter = (typeof FILTERS)[number];

function categoryLabel(source: ReportSource, category: string) {
  if (source === "worker")
    return WORKER_PROBLEMS.find((item) => item.key === category)?.label ?? category;
  if (source === "staff")
    return STAFF_CATEGORIES.find((item) => item.key === category)?.label ?? category;
  return null;
}

/**
 * App problems: forgotten PINs, workers asking for help, staff reports and app errors the
 * phones sent by themselves. Leaders see all of them; site managers see their workers' ones.
 */
export default function AppReportsScreen() {
  const { t } = useT();
  const colors = useColors();
  const router = useRouter();
  const [status, setStatus] = useState<"Open" | "Resolved">("Open");
  const [filter, setFilter] = useState<Filter>("all");
  const [closing, setClosing] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const list = trpc.jp.feedback.list.useQuery({
    status,
    source: filter === "all" ? null : filter,
  });
  const utils = trpc.useUtils();
  const resolve = trpc.jp.feedback.resolve.useMutation({
    onSuccess: () => utils.jp.feedback.list.invalidate(),
  });
  const data = list.data;

  const close = async (id: string) => {
    setError(null);
    try {
      await resolve.mutateAsync({ id, resolution: note.trim() || null });
      setClosing(null);
      setNote("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("Could not save."));
    }
  };

  return (
    <AuthGate>
      <Screen>
        <ScrollView
          contentContainerStyle={{ paddingBottom: 36, gap: 12 }}
          refreshControl={
            <RefreshControl
              refreshing={list.isRefetching}
              onRefresh={() => void list.refetch()}
              tintColor={colors.primary}
            />
          }
        >
          <AppHeader
            eyebrow={t("Help")}
            title={t("App problems")}
            subtitle={
              data && !data.canSeeAll
                ? t("Worker requests on your sites.")
                : t("Errors, worker help, forgotten PINs and staff reports.")
            }
          />
          <ChipGroup
            options={["Open", "Resolved"] as const}
            value={status}
            onChange={setStatus}
            format={(value) =>
              value === "Open"
                ? `${t("Open")}${data ? ` (${Object.values(data.openCounts).reduce((a, b) => a + (b ?? 0), 0)})` : ""}`
                : t("Done")
            }
          />
          <ChipGroup
            options={FILTERS}
            value={filter}
            onChange={setFilter}
            format={(value) => {
              if (value === "all") return t("All");
              const count = status === "Open" ? data?.openCounts[value] : undefined;
              return `${t(SOURCE[value].label)}${count ? ` (${count})` : ""}`;
            }}
          />
          {error ? <InlineError message={error} /> : null}
          {list.isLoading ? (
            <LoadingBlock />
          ) : !data ? (
            <InlineError
              message={list.error?.message ?? t("Could not load.")}
              onRetry={() => void list.refetch()}
            />
          ) : data.items.length === 0 ? (
            <EmptyState
              icon="check-circle"
              title={status === "Open" ? t("Nothing open") : t("Nothing here yet")}
              detail={
                status === "Open"
                  ? t("No forgotten PINs, help requests or errors are waiting.")
                  : t("Problems marked done show here.")
              }
            />
          ) : (
            data.items.map((item) => {
              const source = SOURCE[item.source];
              const category = categoryLabel(item.source, item.category);
              return (
                <Card key={item.id} accent={source.tone}>
                  <View style={{ gap: 6 }}>
                    <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
                      <StatusPill label={t(source.label)} tone={source.tone} />
                      {item.repeatCount > 1 ? (
                        <StatusPill label={`×${item.repeatCount}`} tone="error" />
                      ) : null}
                    </View>
                    <Text style={{ color: colors.foreground, fontSize: 16, fontWeight: "800" }}>
                      {[item.who ?? t("Not signed in"), category ? t(category) : null]
                        .filter(Boolean)
                        .join(" · ")}
                    </Text>
                    {item.message && item.source !== "pin_reset" ? (
                      <Text selectable style={{ color: colors.foreground, fontSize: 15 }}>
                        {item.message}
                      </Text>
                    ) : null}
                    {item.detail ? (
                      <Text
                        selectable
                        numberOfLines={6}
                        style={{ color: colors.muted, fontSize: 12, fontFamily: "monospace" }}
                      >
                        {item.detail}
                      </Text>
                    ) : null}
                    <Text style={{ color: colors.muted, fontSize: 13 }}>
                      {[
                        item.siteName,
                        item.screen,
                        item.appVersion ? `v${item.appVersion}` : null,
                        item.platform,
                        formatDateTime(item.lastSeenAt),
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </Text>
                    {item.resolution ? (
                      <Text style={{ color: colors.success, fontSize: 14 }}>
                        ✓ {item.resolution}
                      </Text>
                    ) : null}
                    {item.status === "Open" ? (
                      closing === item.id ? (
                        <View style={{ gap: 8 }}>
                          <Field
                            label={t("What was done (optional)")}
                            value={note}
                            onChangeText={setNote}
                            maxLength={300}
                          />
                          <PrimaryButton
                            icon="check"
                            label={t("Mark done")}
                            loading={resolve.isPending}
                            onPress={() => void close(item.id)}
                          />
                          <SecondaryButton label={t("Cancel")} onPress={() => setClosing(null)} />
                        </View>
                      ) : (
                        <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
                          {item.personId && item.source !== "app_error" ? (
                            <SecondaryButton
                              icon="person"
                              label={
                                item.source === "pin_reset" ? t("Set a new PIN") : t("Open person")
                              }
                              onPress={() => router.push(`/person?id=${item.personId}` as never)}
                            />
                          ) : null}
                          <SecondaryButton
                            icon="check"
                            label={t("Mark done")}
                            onPress={() => {
                              setClosing(item.id);
                              setNote("");
                            }}
                          />
                        </View>
                      )
                    ) : null}
                  </View>
                </Card>
              );
            })
          )}
        </ScrollView>
      </Screen>
    </AuthGate>
  );
}
