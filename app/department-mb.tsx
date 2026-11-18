import { useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { AuthGate } from "@/components/jp/auth-gate";
import { DataTable } from "@/components/jp/charts";
import {
  AppHeader,
  Card,
  ChipGroup,
  EmptyState,
  Field,
  InlineError,
  LoadingBlock,
  NoAccess,
  PrimaryButton,
  Screen,
  SecondaryButton,
  SectionHeader,
  StatusPill,
  isAccessDenied,
} from "@/components/jp/ui";
import { useColors } from "@/hooks/use-colors";
import { useT } from "@/lib/i18n";
import { formatThousandths } from "@/lib/jp/dept-mb";
import { createClientMutationId } from "@/lib/jp/local-repository";
import { measuredQuantity } from "@/lib/jp/subcontract-domain";
import { resolveSelectedId } from "@/lib/jp/selection";
import { trpc } from "@/lib/trpc";

function todayIst() {
  return new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
}
const q = (value: string) => formatThousandths(BigInt(value));

/**
 * Department measurement book: measure against the contract BOQ, record the department
 * engineer's signature, and see what is signed and still to bill. Only signed quantities can go
 * on the RA bill to the department.
 */
export default function DepartmentMbScreen() {
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
  const mb = trpc.jp.deptMb.list.useQuery(
    { projectId },
    { enabled: Boolean(projectId), retry: false },
  );
  const record = trpc.jp.deptMb.record.useMutation();
  const sign = trpc.jp.deptMb.sign.useMutation();
  const reject = trpc.jp.deptMb.reject.useMutation();
  const [itemId, setItemId] = useState<string | null>(null);
  const [form, setForm] = useState({
    location: "",
    nos: "",
    length: "",
    breadth: "",
    depth: "",
    date: todayIst(),
  });
  const [deduction, setDeduction] = useState(false);
  const [key, setKey] = useState(() => createClientMutationId());
  const [picked, setPicked] = useState<string[]>([]);
  const [signer, setSigner] = useState({ name: "", designation: "", date: todayIst(), mb: "" });
  const [error, setError] = useState<string | null>(null);
  const data = mb.data;
  const size = measuredQuantity({
    nos: form.nos || null,
    length: form.length || null,
    breadth: form.breadth || null,
    depth: form.depth || null,
  });

  const run = async (work: () => Promise<unknown>, after: () => void) => {
    setError(null);
    try {
      await work();
      after();
      await mb.refetch();
    } catch (cause) {
      setError(cause instanceof Error ? t(cause.message) : t("Could not save. Try again."));
    }
  };

  if (isAccessDenied(mb.error))
    return (
      <AuthGate>
        <Screen>
          <AppHeader title={t("Department MB")} />
          <NoAccess area={t("Department MB")} message={mb.error?.message} />
        </Screen>
      </AuthGate>
    );

  const recorded = data?.entries.filter((row) => row.status === "Recorded") ?? [];

  return (
    <AuthGate>
      <Screen>
        <ScrollView
          contentContainerStyle={{ paddingBottom: 40, gap: 12 }}
          keyboardShouldPersistTaps="handled"
          refreshControl={
            <RefreshControl refreshing={mb.isRefetching} onRefresh={() => void mb.refetch()} />
          }
        >
          <AppHeader
            eyebrow={t("Contract")}
            title={t("Department MB")}
            subtitle={t(
              "Measure against the contract BOQ and record the department engineer's signature. Only signed quantities go on the RA bill.",
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
          {mb.isLoading ? <LoadingBlock label={t("Loading…")} /> : null}
          {mb.isError && !isAccessDenied(mb.error) ? (
            <InlineError message={t(mb.error.message)} onRetry={() => void mb.refetch()} />
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
              <SectionHeader
                title={t("Abstract")}
                caption={t("Contract, measured, signed, billed, to bill")}
              />
              <Card>
                <DataTable
                  head={[t("Item"), t("Contract"), t("Signed"), t("Billed"), t("To bill")]}
                  rows={data.items.map((row) => [
                    `${row.code} (${row.unit})`,
                    q(row.contractThousandths),
                    q(row.signedThousandths),
                    q(row.billedThousandths),
                    q(row.toBillThousandths),
                  ])}
                />
              </Card>

              {data.canRecord ? (
                <Card>
                  <Text style={[styles.title, { color: colors.foreground }]}>
                    {t("New measurement")}
                  </Text>
                  <ChipGroup
                    label={t("BOQ item")}
                    options={data.items.map((row) => row.id)}
                    value={itemId}
                    onChange={setItemId}
                    format={(id) => {
                      const row = data.items.find((item) => item.id === id);
                      return row ? `${row.code} · ${row.description.slice(0, 28)}` : id;
                    }}
                  />
                  <Field
                    label="Location / chainage"
                    value={form.location}
                    onChangeText={(location) => setForm({ ...form, location })}
                    placeholder="e.g. OHT-03, staging column C1–C6"
                  />
                  <View style={styles.two}>
                    {(["nos", "length", "breadth", "depth"] as const).map((k) => (
                      <View key={k} style={{ flex: 1, minWidth: 70 }}>
                        <Field
                          label={
                            k === "nos"
                              ? "Nos"
                              : k === "length"
                                ? "L (m)"
                                : k === "breadth"
                                  ? "B (m)"
                                  : "D (m)"
                          }
                          value={form[k]}
                          onChangeText={(v) => setForm({ ...form, [k]: v })}
                          keyboardType="decimal-pad"
                        />
                      </View>
                    ))}
                  </View>
                  <View style={styles.two}>
                    <View style={{ flex: 1 }}>
                      <Field
                        label="Measured on"
                        value={form.date}
                        onChangeText={(date) => setForm({ ...form, date })}
                      />
                    </View>
                    <View style={{ flex: 1, justifyContent: "flex-end" }}>
                      <ChipGroup
                        options={["Add", "Deduct"] as const}
                        value={deduction ? "Deduct" : "Add"}
                        onChange={(v) => setDeduction(v === "Deduct")}
                        format={(v) => t(v)}
                      />
                    </View>
                  </View>
                  <Text
                    style={[
                      styles.meta,
                      { color: typeof size === "string" ? colors.muted : colors.foreground },
                    ]}
                  >
                    {typeof size === "string"
                      ? t(size)
                      : `${t("Quantity")}: ${deduction ? "−" : ""}${formatThousandths(size)}`}
                  </Text>
                  <PrimaryButton
                    icon="straighten"
                    label={t("Record measurement")}
                    disabled={
                      !itemId ||
                      typeof size === "string" ||
                      form.location.trim().length < 2 ||
                      record.isPending
                    }
                    onPress={() =>
                      void run(
                        () =>
                          record.mutateAsync({
                            projectId,
                            contractItemId: itemId!,
                            measuredOn: form.date,
                            location: form.location,
                            nos: form.nos || undefined,
                            length: form.length || undefined,
                            breadth: form.breadth || undefined,
                            depth: form.depth || undefined,
                            deduction,
                            clientMutationId: key,
                          }),
                        () => {
                          setForm({
                            ...form,
                            location: "",
                            nos: "",
                            length: "",
                            breadth: "",
                            depth: "",
                          });
                          setKey(createClientMutationId());
                        },
                      )
                    }
                  />
                </Card>
              ) : null}

              {recorded.length && data.canRecord ? (
                <Card accent="warning">
                  <Text style={[styles.title, { color: colors.foreground }]}>
                    {t("Record the department's signature")} ({picked.length}/{recorded.length})
                  </Text>
                  <Text style={[styles.meta, { color: colors.muted }]}>
                    {t(
                      "Tick the entries the engineer signed in the MB book, then enter their details.",
                    )}
                  </Text>
                  <SecondaryButton
                    label={picked.length === recorded.length ? t("Untick all") : t("Tick all")}
                    onPress={() =>
                      setPicked(
                        picked.length === recorded.length ? [] : recorded.map((row) => row.id),
                      )
                    }
                  />
                  <View style={styles.two}>
                    <View style={{ flex: 1 }}>
                      <Field
                        label="Engineer's name"
                        value={signer.name}
                        onChangeText={(name) => setSigner({ ...signer, name })}
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Field
                        label="Designation"
                        value={signer.designation}
                        onChangeText={(designation) => setSigner({ ...signer, designation })}
                        placeholder="e.g. JE / AE"
                      />
                    </View>
                  </View>
                  <View style={styles.two}>
                    <View style={{ flex: 1 }}>
                      <Field
                        label="Signed on"
                        value={signer.date}
                        onChangeText={(date) => setSigner({ ...signer, date })}
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Field
                        label="MB no. / page"
                        value={signer.mb}
                        onChangeText={(mbRef) => setSigner({ ...signer, mb: mbRef })}
                        placeholder="e.g. MB 214, p. 37–39"
                      />
                    </View>
                  </View>
                  <PrimaryButton
                    icon="draw"
                    label={t("Mark signed")}
                    disabled={
                      !picked.length ||
                      signer.name.trim().length < 2 ||
                      signer.designation.trim().length < 2 ||
                      !signer.mb.trim() ||
                      sign.isPending
                    }
                    onPress={() =>
                      void run(
                        () =>
                          sign.mutateAsync({
                            ids: picked,
                            signedByName: signer.name,
                            signedByDesignation: signer.designation,
                            signedOn: signer.date,
                            mbReference: signer.mb,
                          }),
                        () => setPicked([]),
                      )
                    }
                  />
                </Card>
              ) : null}

              <SectionHeader
                title={t("Measurements")}
                caption={t("{count} entries", { count: data.entries.length })}
              />
              {data.entries.map((row) => {
                const on = picked.includes(row.id);
                return (
                  <Card
                    key={row.id}
                    onPress={
                      row.status === "Recorded"
                        ? () =>
                            setPicked(
                              on ? picked.filter((id) => id !== row.id) : [...picked, row.id],
                            )
                        : undefined
                    }
                  >
                    <View style={styles.top}>
                      <Text style={[styles.title, { color: colors.foreground }]}>
                        {row.status === "Recorded" ? (on ? "☑ " : "☐ ") : ""}
                        {row.itemCode} · {row.deduction === "Yes" ? "−" : ""}
                        {q(row.quantityThousandths)} {row.unit}
                      </Text>
                      <StatusPill
                        compact
                        label={t(row.status)}
                        tone={
                          row.status === "Signed"
                            ? "success"
                            : row.status === "Rejected"
                              ? "error"
                              : "warning"
                        }
                      />
                    </View>
                    <Text style={[styles.meta, { color: colors.muted }]}>
                      {row.location} · {row.measuredOn} ·{" "}
                      {[row.nos, row.length, row.breadth, row.depth].filter(Boolean).join(" × ")}
                    </Text>
                    {row.status === "Signed" ? (
                      <Text style={[styles.meta, { color: colors.success }]}>
                        {t("Signed by {name}, {designation} on {date}", {
                          name: row.signedByName ?? "",
                          designation: row.signedByDesignation ?? "",
                          date: row.signedOn ?? "",
                        })}{" "}
                        · {row.mbReference}
                      </Text>
                    ) : null}
                    {row.rejectReason ? (
                      <Text style={[styles.meta, { color: colors.error }]}>{row.rejectReason}</Text>
                    ) : null}
                    {row.status === "Recorded" && data.canRecord ? (
                      <SecondaryButton
                        label={t("Not accepted by the department")}
                        onPress={() =>
                          void run(
                            () =>
                              reject.mutateAsync({
                                id: row.id,
                                reason: "Not accepted in the department's check",
                              }),
                            () => undefined,
                          )
                        }
                      />
                    ) : null}
                  </Card>
                );
              })}
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
  title: { fontSize: 15, fontWeight: "800", flexShrink: 1 },
  meta: { fontSize: 12, lineHeight: 18, marginTop: 3 },
});
