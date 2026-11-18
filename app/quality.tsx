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

const TONE = {
  Due: "info",
  Overdue: "error",
  Passed: "success",
  Failed: "error",
  Done: "info",
} as const;

/** Quality test register: cube sets (7/28 days), slump and other tests, with due dates. */
export default function QualityScreen() {
  const { t } = useT();
  const colors = useColors();
  const params = useLocalSearchParams<{ siteId?: string }>();
  const sites = trpc.jp.workspace.mySites.useQuery();
  const caps = trpc.jp.workspace.myCapabilities.useQuery();
  const [chosen, setChosen] = useState(typeof params.siteId === "string" ? params.siteId : "");
  const siteId = resolveSelectedId(sites.data ?? [], chosen);
  const list = trpc.jp.quality.list.useQuery(
    { siteId },
    { enabled: Boolean(siteId), retry: false },
  );
  const addSet = trpc.jp.quality.addCubeSet.useMutation();
  const addTest = trpc.jp.quality.addTest.useMutation();
  const record = trpc.jp.quality.recordResult.useMutation();
  const canWrite = Boolean(caps.data?.find((row) => row.siteId === siteId)?.["dpr.create"]);
  const [mode, setMode] = useState<"none" | "cubes" | "test">("none");
  const [cube, setCube] = useState({ grade: "M20", location: "", cast: todayIst(), slump: "" });
  const [test, setTest] = useState({
    type: null as string | null,
    location: "",
    sampled: todayIst(),
    due: "",
    min: "",
    max: "",
  });
  const [key, setKey] = useState(() => createClientMutationId());
  const [resultFor, setResultFor] = useState<string | null>(null);
  const [result, setResult] = useState({ values: "", lab: "", ref: "" });
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
            eyebrow={t("Quality")}
            title={t("Quality test register")}
            subtitle={t(
              "Cube tests at 7 and 28 days, slump, steel, bricks, soil and water tests, with due dates and results.",
            )}
          />
          {(sites.data?.length ?? 0) > 1 ? (
            <ChipGroup
              options={(sites.data ?? []).map((s) => s.id)}
              value={siteId || null}
              onChange={setChosen}
              format={(id) => sites.data?.find((s) => s.id === id)?.name ?? id}
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
                    label: t("Due today"),
                    value: String(data.summary.dueToday),
                    tone: data.summary.dueToday ? "warn" : "good",
                  },
                  {
                    label: t("Overdue"),
                    value: String(data.summary.overdue),
                    tone: data.summary.overdue ? "bad" : "good",
                  },
                  {
                    label: t("Failed"),
                    value: String(data.summary.failed),
                    tone: data.summary.failed ? "bad" : "good",
                  },
                  { label: t("Passed"), value: String(data.summary.passed) },
                ]}
              />
              {canWrite && mode === "none" ? (
                <View style={styles.row}>
                  <View style={{ flex: 1 }}>
                    <PrimaryButton
                      icon="science"
                      label={t("Cubes cast today")}
                      onPress={() => setMode("cubes")}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <SecondaryButton
                      icon="add"
                      label={t("Other test")}
                      onPress={() => setMode("test")}
                    />
                  </View>
                </View>
              ) : null}
              {mode === "cubes" ? (
                <Card>
                  <ChipGroup
                    label={t("Grade")}
                    options={["M10", "M15", "M20", "M25", "M30"] as const}
                    value={cube.grade as never}
                    onChange={(grade) => setCube({ ...cube, grade })}
                  />
                  <Field
                    label="Where poured"
                    value={cube.location}
                    onChangeText={(location) => setCube({ ...cube, location })}
                    placeholder="e.g. OHT-2 staging beam B3"
                  />
                  <View style={styles.row}>
                    <View style={{ flex: 1 }}>
                      <Field
                        label="Cast on"
                        value={cube.cast}
                        onChangeText={(cast) => setCube({ ...cube, cast })}
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Field
                        label="Slump (mm, optional)"
                        value={cube.slump}
                        onChangeText={(slump) => setCube({ ...cube, slump })}
                        keyboardType="decimal-pad"
                      />
                    </View>
                  </View>
                  <Text style={[styles.meta, { color: colors.muted }]}>
                    {t("Two tests are created: 7-day and 28-day, with their due dates.")}
                  </Text>
                  <PrimaryButton
                    icon="save"
                    label={t("Save cube set")}
                    disabled={cube.location.trim().length < 2 || addSet.isPending}
                    onPress={() =>
                      void run(
                        () =>
                          addSet.mutateAsync({
                            siteId,
                            grade: cube.grade,
                            location: cube.location,
                            castOn: cube.cast,
                            slump: cube.slump || undefined,
                            clientMutationId: key,
                          }),
                        () => {
                          setMode("none");
                          setCube({ ...cube, location: "", slump: "" });
                          setKey(createClientMutationId());
                        },
                      )
                    }
                  />
                  <SecondaryButton label={t("Cancel")} onPress={() => setMode("none")} />
                </Card>
              ) : null}
              {mode === "test" ? (
                <Card>
                  <ChipGroup
                    label={t("Test")}
                    options={data.types.filter((x) => !x.startsWith("Concrete cube"))}
                    value={test.type}
                    onChange={(type) => setTest({ ...test, type })}
                    format={(v) => t(v)}
                  />
                  <Field
                    label="Sample / location"
                    value={test.location}
                    onChangeText={(location) => setTest({ ...test, location })}
                  />
                  <View style={styles.row}>
                    <View style={{ flex: 1 }}>
                      <Field
                        label="Sampled on"
                        value={test.sampled}
                        onChangeText={(sampled) => setTest({ ...test, sampled })}
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Field
                        label="Result due (optional)"
                        value={test.due}
                        onChangeText={(due) => setTest({ ...test, due })}
                        placeholder="YYYY-MM-DD"
                      />
                    </View>
                  </View>
                  <View style={styles.row}>
                    <View style={{ flex: 1 }}>
                      <Field
                        label="Minimum allowed"
                        value={test.min}
                        onChangeText={(min) => setTest({ ...test, min })}
                        keyboardType="decimal-pad"
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Field
                        label="Maximum allowed"
                        value={test.max}
                        onChangeText={(max) => setTest({ ...test, max })}
                        keyboardType="decimal-pad"
                      />
                    </View>
                  </View>
                  <PrimaryButton
                    icon="save"
                    label={t("Save test")}
                    disabled={!test.type || test.location.trim().length < 2 || addTest.isPending}
                    onPress={() =>
                      void run(
                        () =>
                          addTest.mutateAsync({
                            siteId,
                            testType: test.type as never,
                            location: test.location,
                            sampledOn: test.sampled,
                            dueDate: test.due || undefined,
                            minValue: test.min || undefined,
                            maxValue: test.max || undefined,
                            clientMutationId: key,
                          }),
                        () => {
                          setMode("none");
                          setTest({
                            type: null,
                            location: "",
                            sampled: todayIst(),
                            due: "",
                            min: "",
                            max: "",
                          });
                          setKey(createClientMutationId());
                        },
                      )
                    }
                  />
                  <SecondaryButton label={t("Cancel")} onPress={() => setMode("none")} />
                </Card>
              ) : null}
              <SectionHeader
                title={t("Tests")}
                caption={t("{count} entries", { count: data.tests.length })}
              />
              {!data.tests.length ? (
                <EmptyState
                  icon="science"
                  title={t("No tests yet")}
                  detail={t(
                    "Record cubes the day concrete is poured; the app reminds you on the test days.",
                  )}
                />
              ) : null}
              {data.tests.map((row) => (
                <Card
                  key={row.id}
                  accent={
                    row.state === "Overdue" || row.state === "Failed"
                      ? "error"
                      : row.state === "Passed"
                        ? "success"
                        : undefined
                  }
                >
                  <View style={styles.top}>
                    <Text style={[styles.title, { color: colors.foreground }]}>
                      {t(row.testType)}
                      {row.grade ? ` · ${row.grade}` : ""}
                    </Text>
                    <StatusPill compact label={t(row.state)} tone={TONE[row.state]} />
                  </View>
                  <Text style={[styles.meta, { color: colors.muted }]}>
                    {row.location} · {t("sampled {date}", { date: row.sampledOn })}
                    {row.dueDate && row.status === "Pending"
                      ? ` · ${t("due {date}", { date: row.dueDate })}`
                      : ""}
                  </Text>
                  {row.results ? (
                    <Text style={[styles.meta, { color: colors.foreground }]}>
                      {t("Results")}: {row.results}
                      {row.labName ? ` · ${row.labName}` : ""}
                      {row.reportReference ? ` · ${row.reportReference}` : ""}
                    </Text>
                  ) : null}
                  {row.verdict ? (
                    <Text
                      style={[
                        styles.meta,
                        { color: row.pass === "No" ? colors.error : colors.success },
                      ]}
                    >
                      {row.verdict}
                    </Text>
                  ) : null}
                  {canWrite && row.status === "Pending" ? (
                    resultFor === row.id ? (
                      <View style={{ gap: 6, marginTop: 6 }}>
                        <Field
                          label={
                            row.testType.startsWith("Concrete cube")
                              ? "Cube strengths (MPa), e.g. 21.5, 22, 20.8"
                              : "Results"
                          }
                          value={result.values}
                          onChangeText={(values) => setResult({ ...result, values })}
                        />
                        <View style={styles.row}>
                          <View style={{ flex: 1 }}>
                            <Field
                              label="Lab (optional)"
                              value={result.lab}
                              onChangeText={(lab) => setResult({ ...result, lab })}
                            />
                          </View>
                          <View style={{ flex: 1 }}>
                            <Field
                              label="Report no. (optional)"
                              value={result.ref}
                              onChangeText={(ref) => setResult({ ...result, ref })}
                            />
                          </View>
                        </View>
                        <PrimaryButton
                          icon="check"
                          label={t("Save result")}
                          disabled={!result.values.trim() || record.isPending}
                          onPress={() =>
                            void run(
                              () =>
                                record.mutateAsync({
                                  siteId,
                                  id: row.id,
                                  results: result.values,
                                  labName: result.lab || undefined,
                                  reportReference: result.ref || undefined,
                                }),
                              () => {
                                setResultFor(null);
                                setResult({ values: "", lab: "", ref: "" });
                              },
                            )
                          }
                        />
                      </View>
                    ) : (
                      <SecondaryButton
                        icon="edit"
                        label={t("Enter result")}
                        onPress={() => setResultFor(row.id)}
                      />
                    )
                  ) : null}
                </Card>
              ))}
              <Text style={[styles.meta, { color: colors.muted }]}>
                {t(
                  "Cube acceptance here is the per-set check of IS 456 (average ≥ fck, no cube below fck − 3). The department applies the full statistical rule.",
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
  row: { flexDirection: "row", gap: 10, flexWrap: "wrap" },
  top: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  title: { fontSize: 15, fontWeight: "800", flexShrink: 1 },
  meta: { fontSize: 12, lineHeight: 18, marginTop: 3 },
});
