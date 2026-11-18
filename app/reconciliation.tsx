import { useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { AuthGate } from "@/components/jp/auth-gate";
import { KpiGrid } from "@/components/jp/charts";
import {
  AppHeader,
  Card,
  ChipGroup,
  EmptyState,
  InlineError,
  LoadingBlock,
  NoAccess,
  Screen,
  SectionHeader,
  isAccessDenied,
} from "@/components/jp/ui";
import { useColors } from "@/hooks/use-colors";
import { useT } from "@/lib/i18n";
import { formatThousandths } from "@/lib/jp/dept-mb";
import { resolveSelectedId } from "@/lib/jp/selection";
import { trpc } from "@/lib/trpc";

const q = (v: string | null) => (v === null ? "" : formatThousandths(BigInt(v)));

/** Cement & steel reconciliation: theoretical from measured work vs issued from the store. */
export default function ReconciliationScreen() {
  const { t } = useT();
  const colors = useColors();
  const params = useLocalSearchParams<{ projectId?: string }>();
  const sites = trpc.jp.workspace.mySites.useQuery();
  const projects = [
    ...new Map(
      (sites.data ?? []).map((s) => [s.projectId, { id: s.projectId, name: s.project }]),
    ).values(),
  ];
  const [chosen, setChosen] = useState(
    typeof params.projectId === "string" ? params.projectId : "",
  );
  const projectId = resolveSelectedId(projects, chosen);
  const rec = trpc.jp.quality.reconciliation.useQuery(
    { projectId },
    { enabled: Boolean(projectId), retry: false },
  );
  const save = trpc.jp.quality.setCoefficient.useMutation();
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const data = rec.data;

  const commit = async (itemId: string, material: "Cement" | "Steel") => {
    const text = draft[`${itemId}:${material}`];
    if (text === undefined) return;
    setError(null);
    try {
      await save.mutateAsync({
        projectId,
        contractItemId: itemId,
        material,
        perUnit: text.trim() ? text.trim() : null,
      });
      await rec.refetch();
    } catch (cause) {
      setError(cause instanceof Error ? t(cause.message) : t("Could not save. Try again."));
    }
  };

  if (isAccessDenied(rec.error))
    return (
      <AuthGate>
        <Screen>
          <AppHeader title={t("Cement & steel reconciliation")} />
          <NoAccess area={t("Cement & steel reconciliation")} message={rec.error?.message} />
        </Screen>
      </AuthGate>
    );

  return (
    <AuthGate>
      <Screen>
        <ScrollView
          contentContainerStyle={{ paddingBottom: 40, gap: 12 }}
          keyboardShouldPersistTaps="handled"
          refreshControl={
            <RefreshControl refreshing={rec.isRefetching} onRefresh={() => void rec.refetch()} />
          }
        >
          <AppHeader
            eyebrow={t("Quality")}
            title={t("Cement & steel reconciliation")}
            subtitle={t(
              "Theoretical use from measured work (department MB) × consumption per unit, against what the store issued.",
            )}
          />
          {projects.length > 1 ? (
            <ChipGroup
              options={projects.map((p) => p.id)}
              value={projectId || null}
              onChange={setChosen}
              format={(id) => projects.find((p) => p.id === id)?.name ?? id}
            />
          ) : null}
          {rec.isLoading ? <LoadingBlock label={t("Loading…")} /> : null}
          {rec.isError && !isAccessDenied(rec.error) ? (
            <InlineError message={t(rec.error.message)} onRetry={() => void rec.refetch()} />
          ) : null}
          {error ? <InlineError message={error} onRetry={() => setError(null)} /> : null}
          {data && !data.items.length ? (
            <EmptyState
              icon="list-alt"
              title={t("No contract BOQ yet")}
              detail={t("Add the contract items (BOQ) in Client billing first.")}
            />
          ) : null}
          {data && data.items.length ? (
            <>
              <KpiGrid
                items={data.materials.map((m) => ({
                  label: t(m.material),
                  value:
                    m.variancePct === null
                      ? "—"
                      : `${m.variancePct > 0 ? "+" : ""}${m.variancePct}%`,
                  sub: `${t("theoretical")} ${q(m.theoreticalThousandths)} ${m.unit} · ${t("issued")} ${q(m.actualThousandths)}`,
                  tone: m.ok === null ? undefined : m.ok ? ("good" as const) : ("bad" as const),
                }))}
              />
              {data.materials.some((m) => m.storeUnits.length && !m.storeUnits.includes(m.unit)) ? (
                <Text style={[styles.meta, { color: colors.warning }]}>
                  {t(
                    "The store keeps some of this material in other units; keep cement in bags and steel in kg so the totals compare.",
                  )}
                </Text>
              ) : null}
              <SectionHeader
                title={t("Consumption per unit of each BOQ item")}
                caption={t("Cement in bags, steel in kg per unit")}
              />
              {data.items.map((item) => (
                <Card key={item.id}>
                  <Text style={[styles.title, { color: colors.foreground }]}>
                    {item.code} · {item.description}
                  </Text>
                  <View style={styles.row}>
                    {(["Cement", "Steel"] as const).map((material) => {
                      const k = `${item.id}:${material}`;
                      const current = material === "Cement" ? item.cement : item.steel;
                      return (
                        <View key={material} style={{ flex: 1 }}>
                          <Text style={[styles.meta, { color: colors.muted }]}>
                            {t(material)} ({material === "Cement" ? t("bags") : "kg"}/{item.unit})
                          </Text>
                          <TextInput
                            accessibilityLabel={`${t(material)} ${item.code}`}
                            editable={data.canEdit}
                            value={draft[k] ?? q(current === null ? null : String(current))}
                            onChangeText={(v) => setDraft({ ...draft, [k]: v })}
                            onBlur={() => void commit(item.id, material)}
                            keyboardType="decimal-pad"
                            placeholder="—"
                            placeholderTextColor={colors.muted}
                            style={[
                              styles.input,
                              { borderColor: colors.border, color: colors.foreground },
                            ]}
                          />
                        </View>
                      );
                    })}
                  </View>
                </Card>
              ))}
              <Text style={[styles.meta, { color: colors.muted }]}>
                {t(
                  "Permitted variation used here: cement ±2%, steel ±3%. Check your agreement's clause.",
                )}
              </Text>
            </>
          ) : null}
        </ScrollView>
      </Screen>
    </AuthGate>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", gap: 10, marginTop: 6 },
  title: { fontSize: 14, fontWeight: "800" },
  meta: { fontSize: 12, lineHeight: 18 },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 14,
    marginTop: 4,
  },
});
