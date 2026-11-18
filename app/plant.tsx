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
  NoAccess,
  PrimaryButton,
  Screen,
  SecondaryButton,
  StatusPill,
  isAccessDenied,
} from "@/components/jp/ui";
import { useColors } from "@/hooks/use-colors";
import { useT } from "@/lib/i18n";
import { shortRupees } from "@/lib/jp/analytics";
import { createClientMutationId } from "@/lib/jp/local-repository";
import { formatQty } from "@/lib/jp/plant-domain";
import { trpc } from "@/lib/trpc";

function todayIst() {
  return new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
}
const hrs = (v: string | null) => (v === null ? "—" : formatQty(BigInt(v)));

/** Plant & machinery: machines, daily logsheets, fuel against norm, hire and service. */
export default function PlantScreen() {
  const { t } = useT();
  const colors = useColors();
  const register = trpc.jp.plant.register.useQuery({}, { retry: false });
  const add = trpc.jp.plant.addEquipment.useMutation();
  const log = trpc.jp.plant.log.useMutation();
  const update = trpc.jp.plant.update.useMutation();
  const service = trpc.jp.plant.service.useMutation();
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({
    name: "",
    type: null as string | null,
    reg: "",
    ownership: "Owned" as "Owned" | "Hired",
    owner: "",
    basis: "Hour" as "Hour" | "Day" | "Month",
    rate: "",
    from: todayIst(),
    norm: "",
    interval: "",
    meter: "",
    site: null as string | null,
  });
  const [logFor, setLogFor] = useState<string | null>(null);
  const [entry, setEntry] = useState({
    date: todayIst(),
    start: "",
    end: "",
    idle: "",
    fuel: "",
    operator: "",
    work: "",
    site: null as string | null,
  });
  const [action, setAction] = useState<{ id: string; kind: "status" | "service" } | null>(null);
  const [status, setStatus] = useState<"Working" | "Idle" | "Breakdown" | "Off-hired" | "Disposed">(
    "Working",
  );
  const [note, setNote] = useState("");
  const [meter, setMeter] = useState("");
  const [moveTo, setMoveTo] = useState<string | null>(null);
  const [key, setKey] = useState(() => createClientMutationId());
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const data = register.data;
  const manageSites = data?.sites.filter((s) => s.canManage) ?? [];

  const run = async (work: () => Promise<unknown>, after: (result: unknown) => void) => {
    setError(null);
    setNotice(null);
    try {
      const result = await work();
      after(result);
      setKey(createClientMutationId());
      await register.refetch();
    } catch (cause) {
      setError(cause instanceof Error ? t(cause.message) : t("Could not save. Try again."));
    }
  };

  if (isAccessDenied(register.error))
    return (
      <AuthGate>
        <Screen>
          <AppHeader title={t("Plant & machinery")} />
          <NoAccess area={t("Plant & machinery")} message={register.error?.message} />
        </Screen>
      </AuthGate>
    );

  const totals = data
    ? {
        hours: data.machines.reduce((s, m) => s + BigInt(m.month.workingThousandths), 0n),
        fuel: data.machines.reduce((s, m) => s + BigInt(m.month.fuelThousandths), 0n),
        hire: data.machines.reduce((s, m) => s + BigInt(m.month.hireMinor ?? "0"), 0n),
        flags: data.machines.filter(
          (m) =>
            m.month.fuelHigh ||
            (m.serviceLeftThousandths !== null && BigInt(m.serviceLeftThousandths) <= 0n),
        ).length,
      }
    : null;

  return (
    <AuthGate>
      <Screen>
        <ScrollView
          contentContainerStyle={{ paddingBottom: 40, gap: 12 }}
          keyboardShouldPersistTaps="handled"
          refreshControl={
            <RefreshControl
              refreshing={register.isRefetching}
              onRefresh={() => void register.refetch()}
            />
          }
        >
          <AppHeader
            eyebrow={t("Plant")}
            title={t("Plant & machinery")}
            subtitle={t(
              "Daily logsheets from the hour meter, fuel against each machine's norm, hire charges and service due.",
            )}
          />
          {register.isLoading ? <LoadingBlock label={t("Loading…")} /> : null}
          {register.isError && !isAccessDenied(register.error) ? (
            <InlineError
              message={t(register.error.message)}
              onRetry={() => void register.refetch()}
            />
          ) : null}
          {error ? <InlineError message={error} onRetry={() => setError(null)} /> : null}
          {notice ? (
            <Text style={{ color: colors.warning, fontWeight: "700" }}>{notice}</Text>
          ) : null}
          {data && totals ? (
            <>
              <KpiGrid
                items={[
                  { label: t("Working hours this month"), value: formatQty(totals.hours) },
                  { label: t("Fuel this month (L)"), value: formatQty(totals.fuel) },
                  { label: t("Hire charges this month"), value: shortRupees(totals.hire) },
                  {
                    label: t("Need attention"),
                    value: String(totals.flags),
                    tone: totals.flags ? "warn" : "good",
                    sub: t("fuel over norm or service due"),
                  },
                ]}
              />
              {manageSites.length && !adding ? (
                <PrimaryButton
                  icon="add"
                  label={t("Add a machine")}
                  onPress={() => setAdding(true)}
                />
              ) : null}
              {adding ? (
                <Card>
                  <Field
                    label="Name"
                    value={form.name}
                    onChangeText={(name) => setForm({ ...form, name })}
                    placeholder="e.g. JCB 3DX (Rabi)"
                  />
                  <ChipGroup
                    label={t("Type")}
                    options={data.types}
                    value={form.type}
                    onChange={(type) => setForm({ ...form, type })}
                    format={(v) => t(v)}
                  />
                  <ChipGroup
                    label={t("Site")}
                    options={manageSites.map((s) => s.id)}
                    value={form.site}
                    onChange={(site) => setForm({ ...form, site })}
                    format={(id) => manageSites.find((s) => s.id === id)?.name ?? id}
                  />
                  <View style={styles.row}>
                    <View style={{ flex: 1 }}>
                      <Field
                        label="Vehicle no. (optional)"
                        value={form.reg}
                        onChangeText={(reg) => setForm({ ...form, reg })}
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <ChipGroup
                        options={["Owned", "Hired"] as const}
                        value={form.ownership}
                        onChange={(ownership) => setForm({ ...form, ownership })}
                        format={(v) => t(v)}
                      />
                    </View>
                  </View>
                  {form.ownership === "Hired" ? (
                    <>
                      <Field
                        label="Hired from (owner)"
                        value={form.owner}
                        onChangeText={(owner) => setForm({ ...form, owner })}
                      />
                      <ChipGroup
                        label={t("Hire per")}
                        options={data.hireBases}
                        value={form.basis}
                        onChange={(basis) => setForm({ ...form, basis })}
                        format={(v) => t(v)}
                      />
                      <View style={styles.row}>
                        <View style={{ flex: 1 }}>
                          <Field
                            label="Rate (₹)"
                            value={form.rate}
                            onChangeText={(rate) => setForm({ ...form, rate })}
                            keyboardType="decimal-pad"
                          />
                        </View>
                        <View style={{ flex: 1 }}>
                          <Field
                            label="On hire from"
                            value={form.from}
                            onChangeText={(from) => setForm({ ...form, from })}
                          />
                        </View>
                      </View>
                    </>
                  ) : null}
                  <View style={styles.row}>
                    <View style={{ flex: 1 }}>
                      <Field
                        label="Fuel norm (L/hour)"
                        value={form.norm}
                        onChangeText={(norm) => setForm({ ...form, norm })}
                        keyboardType="decimal-pad"
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Field
                        label="Service every (hours)"
                        value={form.interval}
                        onChangeText={(interval) => setForm({ ...form, interval })}
                        keyboardType="number-pad"
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Field
                        label="Meter now"
                        value={form.meter}
                        onChangeText={(m) => setForm({ ...form, meter: m })}
                        keyboardType="decimal-pad"
                      />
                    </View>
                  </View>
                  <PrimaryButton
                    icon="save"
                    label={t("Save machine")}
                    disabled={
                      form.name.trim().length < 2 || !form.type || !form.site || add.isPending
                    }
                    onPress={() =>
                      void run(
                        () =>
                          add.mutateAsync({
                            siteId: form.site!,
                            name: form.name,
                            equipmentType: form.type as never,
                            registrationNumber: form.reg || undefined,
                            ownership: form.ownership,
                            ownerName: form.owner || undefined,
                            hireBasis: form.ownership === "Hired" ? form.basis : undefined,
                            hireRateRupees: form.ownership === "Hired" ? form.rate : undefined,
                            hireFrom: form.ownership === "Hired" ? form.from : undefined,
                            fuelNorm: form.norm || undefined,
                            serviceIntervalHours: form.interval ? Number(form.interval) : undefined,
                            currentMeter: form.meter || undefined,
                            clientMutationId: key,
                          }),
                        () => setAdding(false),
                      )
                    }
                  />
                  <SecondaryButton label={t("Cancel")} onPress={() => setAdding(false)} />
                </Card>
              ) : null}
              {!data.machines.length ? (
                <EmptyState
                  icon="agriculture"
                  title={t("No machines yet")}
                  detail={t("Add each JCB, mixer, tipper or DG set, owned or hired.")}
                />
              ) : null}
              {data.machines.map((m) => {
                const serviceDue =
                  m.serviceLeftThousandths !== null && BigInt(m.serviceLeftThousandths) <= 0n;
                const canLogHere = data.sites.some((s) => s.canLog);
                return (
                  <Card key={m.id} accent={m.month.fuelHigh || serviceDue ? "warning" : undefined}>
                    <View style={styles.top}>
                      <Text style={[styles.title, { color: colors.foreground }]}>
                        {m.code} · {m.name}
                      </Text>
                      <StatusPill
                        compact
                        label={t(m.status)}
                        tone={
                          m.status === "Working"
                            ? "success"
                            : m.status === "Breakdown"
                              ? "error"
                              : "info"
                        }
                      />
                    </View>
                    <Text style={[styles.meta, { color: colors.muted }]}>
                      {t(m.equipmentType)} · {t(m.ownership)}
                      {m.ownerName ? ` (${m.ownerName})` : ""}
                      {m.siteName ? ` · ${m.siteName}` : ""}
                      {m.registrationNumber ? ` · ${m.registrationNumber}` : ""}
                    </Text>
                    <Text style={[styles.meta, { color: colors.foreground }]}>
                      {t("This month")}: {hrs(m.month.workingThousandths)} {t("h working")} ·{" "}
                      {hrs(m.month.fuelThousandths)} L
                      {m.month.fuelVariancePct !== null
                        ? ` (${m.month.fuelVariancePct > 0 ? "+" : ""}${m.month.fuelVariancePct}% ${t("vs norm")})`
                        : ""}
                      {m.month.hireMinor ? ` · ${t("hire")} ${shortRupees(m.month.hireMinor)}` : ""}
                    </Text>
                    {m.month.fuelHigh ? (
                      <Text style={[styles.meta, { color: colors.error }]}>
                        ⚠ {t("Fuel more than 10% over the norm — check for leaks or misuse.")}
                      </Text>
                    ) : null}
                    {m.serviceLeftThousandths !== null ? (
                      <Text
                        style={[styles.meta, { color: serviceDue ? colors.error : colors.muted }]}
                      >
                        {serviceDue
                          ? `⚠ ${t("Service overdue by {hours} h", { hours: hrs((-BigInt(m.serviceLeftThousandths)).toString()) })}`
                          : t("Service in {hours} h", { hours: hrs(m.serviceLeftThousandths) })}
                      </Text>
                    ) : null}
                    {m.recentLogs.length ? (
                      <Text style={[styles.meta, { color: colors.muted }]}>
                        {t("Last log")}: {m.recentLogs[0]!.logDate} · {t("meter")}{" "}
                        {hrs(m.recentLogs[0]!.endMeterThousandths)}
                        {m.recentLogs[0]!.operatorName ? ` · ${m.recentLogs[0]!.operatorName}` : ""}
                      </Text>
                    ) : null}
                    {logFor === m.id ? (
                      <View style={{ gap: 6, marginTop: 6 }}>
                        <ChipGroup
                          label={t("Site")}
                          options={data.sites.filter((s) => s.canLog).map((s) => s.id)}
                          value={entry.site ?? m.siteId}
                          onChange={(site) => setEntry({ ...entry, site })}
                          format={(id) => data.sites.find((s) => s.id === id)?.name ?? id}
                        />
                        <View style={styles.row}>
                          <View style={{ flex: 1 }}>
                            <Field
                              label="Date"
                              value={entry.date}
                              onChangeText={(date) => setEntry({ ...entry, date })}
                            />
                          </View>
                          <View style={{ flex: 1 }}>
                            <Field
                              label="Opening meter"
                              value={entry.start}
                              onChangeText={(start) => setEntry({ ...entry, start })}
                              keyboardType="decimal-pad"
                            />
                          </View>
                          <View style={{ flex: 1 }}>
                            <Field
                              label="Closing meter"
                              value={entry.end}
                              onChangeText={(end) => setEntry({ ...entry, end })}
                              keyboardType="decimal-pad"
                            />
                          </View>
                        </View>
                        <View style={styles.row}>
                          <View style={{ flex: 1 }}>
                            <Field
                              label="Idle hours"
                              value={entry.idle}
                              onChangeText={(idle) => setEntry({ ...entry, idle })}
                              keyboardType="decimal-pad"
                            />
                          </View>
                          <View style={{ flex: 1 }}>
                            <Field
                              label="Fuel (L)"
                              value={entry.fuel}
                              onChangeText={(fuel) => setEntry({ ...entry, fuel })}
                              keyboardType="decimal-pad"
                            />
                          </View>
                          <View style={{ flex: 1 }}>
                            <Field
                              label="Operator"
                              value={entry.operator}
                              onChangeText={(operator) => setEntry({ ...entry, operator })}
                            />
                          </View>
                        </View>
                        <Field
                          label="Work done"
                          value={entry.work}
                          onChangeText={(work) => setEntry({ ...entry, work })}
                          placeholder="e.g. Excavation for OHT footing, 120 cum"
                        />
                        <PrimaryButton
                          icon="save"
                          label={t("Save logsheet")}
                          disabled={!entry.start || !entry.end || log.isPending}
                          onPress={() =>
                            void run(
                              () =>
                                log.mutateAsync({
                                  equipmentId: m.id,
                                  siteId:
                                    entry.site ?? m.siteId ?? data.sites.find((s) => s.canLog)!.id,
                                  logDate: entry.date,
                                  startMeter: entry.start,
                                  endMeter: entry.end,
                                  idle: entry.idle || undefined,
                                  fuel: entry.fuel || undefined,
                                  operatorName: entry.operator || undefined,
                                  workDone: entry.work || undefined,
                                  clientMutationId: key,
                                }),
                              (result) => {
                                setLogFor(null);
                                const r = result as {
                                  fuelHigh?: boolean;
                                  fuelVariancePct?: number | null;
                                };
                                if (r?.fuelHigh)
                                  setNotice(
                                    t("Saved. Fuel is {pct}% over the norm for this machine.", {
                                      pct: r.fuelVariancePct ?? 0,
                                    }),
                                  );
                              },
                            )
                          }
                        />
                        <SecondaryButton label={t("Cancel")} onPress={() => setLogFor(null)} />
                      </View>
                    ) : action?.id === m.id ? (
                      <View style={{ gap: 6, marginTop: 6 }}>
                        {action.kind === "status" ? (
                          <>
                            <ChipGroup
                              label={t("Status")}
                              options={
                                ["Working", "Idle", "Breakdown", "Off-hired", "Disposed"] as const
                              }
                              value={status}
                              onChange={setStatus}
                              format={(v) => t(v)}
                            />
                            <ChipGroup
                              label={t("Site")}
                              options={manageSites.map((s) => s.id)}
                              value={moveTo ?? m.siteId}
                              onChange={setMoveTo}
                              format={(id) => manageSites.find((s) => s.id === id)?.name ?? id}
                            />
                          </>
                        ) : (
                          <Field
                            label="Meter at service"
                            value={meter}
                            onChangeText={setMeter}
                            keyboardType="decimal-pad"
                          />
                        )}
                        <Field label="Note" value={note} onChangeText={setNote} />
                        <PrimaryButton
                          icon="check"
                          label={t("Save")}
                          disabled={note.trim().length < 3}
                          onPress={() =>
                            void run(
                              () =>
                                action.kind === "status"
                                  ? update.mutateAsync({
                                      id: m.id,
                                      siteId: (moveTo ?? m.siteId ?? manageSites[0]!.id)!,
                                      status,
                                      note,
                                    })
                                  : service.mutateAsync({
                                      id: m.id,
                                      siteId: (m.siteId ?? manageSites[0]!.id)!,
                                      meter,
                                      note,
                                    }),
                              () => {
                                setAction(null);
                                setNote("");
                                setMeter("");
                                setMoveTo(null);
                              },
                            )
                          }
                        />
                      </View>
                    ) : (
                      <View style={styles.actions}>
                        {canLogHere && m.status !== "Disposed" ? (
                          <SecondaryButton
                            icon="edit-note"
                            label={t("Daily log")}
                            onPress={() => {
                              setLogFor(m.id);
                              setEntry({
                                date: todayIst(),
                                start: m.lastMeterThousandths ? hrs(m.lastMeterThousandths) : "",
                                end: "",
                                idle: "",
                                fuel: "",
                                operator: m.recentLogs[0]?.operatorName ?? "",
                                work: "",
                                site: m.siteId,
                              });
                            }}
                          />
                        ) : null}
                        {manageSites.length ? (
                          <>
                            <SecondaryButton
                              label={t("Status / move")}
                              onPress={() => {
                                setAction({ id: m.id, kind: "status" });
                                setStatus(m.status);
                              }}
                            />
                            {m.serviceIntervalHours ? (
                              <SecondaryButton
                                label={t("Serviced")}
                                onPress={() => {
                                  setAction({ id: m.id, kind: "service" });
                                  setMeter(
                                    m.lastMeterThousandths ? hrs(m.lastMeterThousandths) : "",
                                  );
                                }}
                              />
                            ) : null}
                          </>
                        ) : null}
                      </View>
                    )}
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
  row: { flexDirection: "row", gap: 10, flexWrap: "wrap" },
  top: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  title: { fontSize: 15, fontWeight: "800", flexShrink: 1 },
  meta: { fontSize: 12, lineHeight: 18, marginTop: 3 },
  actions: { flexDirection: "row", gap: 8, flexWrap: "wrap", marginTop: 6 },
});
