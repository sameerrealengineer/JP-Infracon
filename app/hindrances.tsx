import { useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { AuthGate } from "@/components/jp/auth-gate";
import { KpiGrid } from "@/components/jp/charts";
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
  SectionHeader,
  StatusPill,
} from "@/components/jp/ui";
import { useColors } from "@/hooks/use-colors";
import { useT } from "@/lib/i18n";
import { createClientMutationId } from "@/lib/jp/local-repository";
import { resolveSelectedId } from "@/lib/jp/selection";
import { trpc } from "@/lib/trpc";

function todayIst() {
  return new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
}

/** Hindrance register: what stopped the work, for how long, letters sent, EOT days. */
export default function HindrancesScreen() {
  const { t } = useT();
  const colors = useColors();
  const params = useLocalSearchParams<{ siteId?: string }>();
  const sites = trpc.jp.workspace.mySites.useQuery();
  const caps = trpc.jp.workspace.myCapabilities.useQuery();
  const [chosen, setChosen] = useState(typeof params.siteId === "string" ? params.siteId : "");
  const siteId = resolveSelectedId(sites.data ?? [], chosen);
  const list = trpc.jp.diary.hindrances.useQuery(
    { siteId },
    { enabled: Boolean(siteId), retry: false },
  );
  const add = trpc.jp.diary.addHindrance.useMutation();
  const close = trpc.jp.diary.closeHindrance.useMutation();
  const canWrite = Boolean(caps.data?.find((row) => row.siteId === siteId)?.["dpr.create"]);
  const [adding, setAdding] = useState(false);
  const [category, setCategory] = useState<string | null>(null);
  const [description, setDescription] = useState("");
  const [startDate, setStartDate] = useState(todayIst());
  const [affects, setAffects] = useState<"Full stop" | "Partial">("Full stop");
  const [letter, setLetter] = useState("");
  const [key, setKey] = useState(() => createClientMutationId());
  const [closing, setClosing] = useState<string | null>(null);
  const [endDate, setEndDate] = useState(todayIst());
  const [closeNote, setCloseNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const data = list.data;

  const run = async (work: () => Promise<unknown>, after: () => void) => {
    setError(null);
    try {
      await work();
      after();
      await list.refetch();
    } catch (cause) {
      setError(cause instanceof Error ? t(cause.message) : t("Could not save. Try again."));
    }
  };

  return (
    <AuthGate>
      <Screen>
        <ScrollView
          contentContainerStyle={{ paddingBottom: 40, gap: 12 }}
          keyboardShouldPersistTaps="handled"
          refreshControl={
            <RefreshControl refreshing={list.isRefetching} onRefresh={() => void list.refetch()} />
          }
        >
          <AppHeader
            eyebrow={t("Contract")}
            title={t("Hindrance register")}
            subtitle={t(
              "Record every hold-up with dates and the letter to the department. It is the basis for an extension of time.",
            )}
          />
          {(sites.data?.length ?? 0) > 1 ? (
            <ChipGroup
              options={(sites.data ?? []).map((site) => site.id)}
              value={siteId || null}
              onChange={setChosen}
              format={(id) => sites.data?.find((site) => site.id === id)?.name ?? id}
            />
          ) : null}
          {list.isLoading ? <LoadingBlock label={t("Loading…")} /> : null}
          {list.isError ? (
            <InlineError message={t(list.error.message)} onRetry={() => void list.refetch()} />
          ) : null}
          {error ? <InlineError message={error} onRetry={() => setError(null)} /> : null}
          {data ? (
            <>
              <KpiGrid
                items={[
                  {
                    label: t("Full-stop days (EOT claim)"),
                    value: String(data.summary.fullStopDays),
                    sub: t("overlaps counted once"),
                  },
                  {
                    label: t("Partial hindrance days"),
                    value: String(data.summary.partialDays),
                    sub: t("for the engineer to assess"),
                  },
                  {
                    label: t("Still open"),
                    value: String(data.summary.open),
                    tone: data.summary.open ? "warn" : "good",
                  },
                ]}
              />
              {canWrite && !adding ? (
                <PrimaryButton
                  icon="add"
                  label={t("Record a hindrance")}
                  onPress={() => setAdding(true)}
                />
              ) : null}
              {adding ? (
                <Card>
                  <ChipGroup
                    label={t("Cause")}
                    options={data.categories}
                    value={category}
                    onChange={setCategory}
                    format={(value) => t(value)}
                  />
                  <Field
                    label="What happened"
                    value={description}
                    onChangeText={setDescription}
                    multiline
                    placeholder="e.g. Revised drawing for tank staging not issued"
                  />
                  <View style={styles.two}>
                    <View style={{ flex: 1 }}>
                      <Field
                        label="From (YYYY-MM-DD)"
                        value={startDate}
                        onChangeText={setStartDate}
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Field
                        label="Letter no. to department (optional)"
                        value={letter}
                        onChangeText={setLetter}
                      />
                    </View>
                  </View>
                  <ChipGroup
                    label={t("Effect on work")}
                    options={["Full stop", "Partial"] as const}
                    value={affects}
                    onChange={setAffects}
                    format={(value) => t(value)}
                  />
                  <PrimaryButton
                    icon="save"
                    label={t("Save hindrance")}
                    disabled={!category || description.trim().length < 5 || add.isPending}
                    onPress={() =>
                      void run(
                        () =>
                          add.mutateAsync({
                            siteId,
                            category: category!,
                            description,
                            startDate,
                            endDate: null,
                            affectsWork: affects,
                            letterReference: letter || undefined,
                            clientMutationId: key,
                          }),
                        () => {
                          setAdding(false);
                          setDescription("");
                          setLetter("");
                          setCategory(null);
                          setKey(createClientMutationId());
                        },
                      )
                    }
                  />
                  <SecondaryButton label={t("Cancel")} onPress={() => setAdding(false)} />
                </Card>
              ) : null}
              <SectionHeader
                title={t("Register")}
                caption={t("{count} entries", { count: data.rows.length })}
              />
              {!data.rows.length ? (
                <EmptyState
                  icon="event-busy"
                  title={t("No hindrances recorded")}
                  detail={t("Record a hold-up the day it starts, with its cause.")}
                />
              ) : null}
              {data.rows.map((row) => (
                <Card key={row.id} accent={row.status === "Open" ? "warning" : undefined}>
                  <View style={styles.top}>
                    <Text style={[styles.code, { color: colors.foreground }]}>{row.code}</Text>
                    <StatusPill
                      compact
                      label={t(row.status)}
                      tone={row.status === "Open" ? "warning" : "success"}
                    />
                  </View>
                  <Text style={[styles.meta, { color: colors.primary }]}>
                    {t(row.category)} · {t(row.affectsWork)}
                  </Text>
                  <Text style={[styles.body, { color: colors.foreground }]}>{row.description}</Text>
                  <Text style={[styles.meta, { color: colors.muted }]}>
                    {row.startDate} → {row.endDate ?? t("continuing")} ·{" "}
                    {t("{count} days", { count: row.days })}
                    {row.letterReference ? ` · ${t("Letter")} ${row.letterReference}` : ""}
                  </Text>
                  {row.closeNote ? (
                    <Text style={[styles.meta, { color: colors.muted }]}>{row.closeNote}</Text>
                  ) : null}
                  {canWrite && row.status === "Open" ? (
                    closing === row.id ? (
                      <View style={{ gap: 6, marginTop: 6 }}>
                        <Field
                          label="Ended on (YYYY-MM-DD)"
                          value={endDate}
                          onChangeText={setEndDate}
                        />
                        <Field
                          label="How it was cleared"
                          value={closeNote}
                          onChangeText={setCloseNote}
                          placeholder="e.g. Drawing received on letter no. …"
                        />
                        <PrimaryButton
                          icon="check"
                          label={t("Close hindrance")}
                          disabled={closeNote.trim().length < 3 || close.isPending}
                          onPress={() =>
                            void run(
                              () => close.mutateAsync({ siteId, id: row.id, endDate, closeNote }),
                              () => {
                                setClosing(null);
                                setCloseNote("");
                              },
                            )
                          }
                        />
                      </View>
                    ) : (
                      <SecondaryButton
                        icon="event-available"
                        label={t("It has ended")}
                        onPress={() => setClosing(row.id)}
                      />
                    )
                  ) : null}
                </Card>
              ))}
            </>
          ) : null}
        </ScrollView>
      </Screen>
    </AuthGate>
  );
}

const styles = StyleSheet.create({
  two: { flexDirection: "row", gap: 10, flexWrap: "wrap" },
  top: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  code: { fontSize: 15, fontWeight: "800" },
  meta: { fontSize: 12, lineHeight: 18, marginTop: 4 },
  body: { fontSize: 14, lineHeight: 20, marginTop: 4 },
});
