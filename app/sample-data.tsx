import { useState } from "react";
import { Alert, Platform, ScrollView, StyleSheet, Text, View } from "react-native";
import { AuthGate } from "@/components/jp/auth-gate";
import {
  AppHeader,
  Card,
  EmptyState,
  InlineError,
  LoadingBlock,
  PrimaryButton,
  Screen,
} from "@/components/jp/ui";
import { useColors } from "@/hooks/use-colors";
import { useT } from "@/lib/i18n";
import { trpc } from "@/lib/trpc";

/**
 * Super Admin and company leaders: see how much example (SAMPLE) data the app holds and remove
 * all of it in one step. Real records stay; a sample record that real work now depends on stays
 * too and is counted.
 */
export default function SampleDataScreen() {
  const { t } = useT();
  const colors = useColors();
  const utils = trpc.useUtils();
  const options = trpc.jp.accounts.options.useQuery(undefined, { retry: false });
  const company = options.data?.find((item) => item.wholeCompany) ?? null;
  const status = trpc.jp.sampleData.status.useQuery(
    { organizationId: company?.id ?? "" },
    { enabled: Boolean(company), retry: false },
  );
  const remove = trpc.jp.sampleData.remove.useMutation();
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    if (!company) return;
    setError(null);
    setNote(null);
    try {
      const result = await remove.mutateAsync({
        organizationId: company.id,
        confirm: "REMOVE SAMPLE DATA",
      });
      setNote(
        result.kept
          ? t("{removed} sample records removed. {kept} stay because real records use them.", {
              removed: result.removed,
              kept: result.kept,
            })
          : t("All {removed} sample records removed.", { removed: result.removed }),
      );
      await utils.invalidate();
    } catch (cause) {
      setError(cause instanceof Error ? t(cause.message) : t("Could not remove."));
    }
  };

  const ask = () => {
    const title = t("Remove all sample data?");
    const message = t(
      "Every record marked SAMPLE (example tasks, reports, bills, payroll and the example accounts login) is deleted for everyone. Real people, suppliers, sites and anything you entered stay. This cannot be undone.",
    );
    if (Platform.OS === "web") {
      if (window.confirm(`${title}\n\n${message}`)) void run();
      return;
    }
    Alert.alert(title, message, [
      { text: t("Cancel"), style: "cancel" },
      { text: t("Remove"), style: "destructive", onPress: () => void run() },
    ]);
  };

  return (
    <AuthGate>
      <Screen>
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 32 }}
        >
          <AppHeader
            eyebrow={t("Administration")}
            title={t("Sample data")}
            subtitle={t("Example records that show how each form is filled.")}
          />
          {options.isLoading || status.isLoading ? (
            <LoadingBlock label={t("Loading…")} />
          ) : !company ? (
            <EmptyState
              icon="lock-outline"
              title={t("Leaders only")}
              detail={t("Only the Super Admin, Owner, Director or Admin can remove sample data.")}
            />
          ) : status.isError ? (
            <InlineError message={t(status.error.message)} onRetry={() => void status.refetch()} />
          ) : (
            <View style={{ gap: 12 }}>
              <Card>
                <Text style={[styles.count, { color: colors.foreground }]}>
                  {status.data?.total ?? 0}
                </Text>
                <Text style={[styles.detail, { color: colors.muted }]}>
                  {t("sample records in the app")}
                </Text>
              </Card>
              <Text style={[styles.detail, { color: colors.muted }]}>
                {t(
                  "When your team has learned the forms, remove the examples with one tap. Real people, suppliers, sites and everything your team entered stay.",
                )}
              </Text>
              {note ? (
                <Text accessibilityRole="alert" style={[styles.note, { color: colors.success }]}>
                  {note}
                </Text>
              ) : null}
              {error ? <InlineError message={error} onRetry={() => setError(null)} /> : null}
              <PrimaryButton
                icon="delete-sweep"
                label={remove.isPending ? t("Removing…") : t("Remove all sample data")}
                disabled={remove.isPending || !status.data?.total}
                onPress={ask}
              />
            </View>
          )}
        </ScrollView>
      </Screen>
    </AuthGate>
  );
}

const styles = StyleSheet.create({
  count: { fontSize: 34, fontWeight: "900" },
  detail: { fontSize: 13, lineHeight: 19 },
  note: { fontSize: 13, fontWeight: "700" },
});
