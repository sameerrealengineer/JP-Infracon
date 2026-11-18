import type { inferRouterOutputs } from "@trpc/server";
import { useState } from "react";
import type { AppRouter } from "@/server/routers";
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
import { formatMinorAsRupees } from "@/lib/jp/finance-domain";
import { createClientMutationId } from "@/lib/jp/local-repository";
import { trpc } from "@/lib/trpc";

type Tab = "tenders" | "guarantees" | "extensions";

function todayIst() {
  return new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
}

const STATE_TONE = {
  Active: "success",
  Expiring: "warning",
  Expired: "error",
  Released: "info",
  Encashed: "error",
} as const;

/** Tenders & contracts: tender register, guarantees and deposits, extensions of time. */
export default function ContractsScreen() {
  const { t } = useT();
  const colors = useColors();
  const overview = trpc.jp.contracts.overview.useQuery(undefined, { retry: false });
  const [tab, setTab] = useState<Tab>("tenders");
  const [error, setError] = useState<string | null>(null);
  const data = overview.data;

  const run = async (work: () => Promise<unknown>, after?: () => void) => {
    setError(null);
    try {
      await work();
      after?.();
      await overview.refetch();
    } catch (cause) {
      setError(cause instanceof Error ? t(cause.message) : t("Could not save. Try again."));
    }
  };

  if (isAccessDenied(overview.error))
    return (
      <AuthGate>
        <Screen>
          <AppHeader eyebrow={t("Contract")} title={t("Tenders & contracts")} />
          <NoAccess area={t("Tenders & contracts")} message={overview.error?.message} />
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
            <RefreshControl
              refreshing={overview.isRefetching}
              onRefresh={() => void overview.refetch()}
            />
          }
        >
          <AppHeader
            eyebrow={t("Contract")}
            title={t("Tenders & contracts")}
            subtitle={t(
              "Tenders and their EMD, bank guarantees and deposits with expiry, and extensions of time.",
            )}
          />
          {overview.isLoading ? <LoadingBlock label={t("Loading…")} /> : null}
          {overview.isError && !isAccessDenied(overview.error) ? (
            <InlineError
              message={t(overview.error.message)}
              onRetry={() => void overview.refetch()}
            />
          ) : null}
          {error ? <InlineError message={error} onRetry={() => setError(null)} /> : null}
          {data ? (
            <>
              <KpiGrid
                items={[
                  {
                    label: t("Money locked in guarantees"),
                    value: shortRupees(
                      data.summary.locked.reduce((s, r) => s + BigInt(r.amountMinor), 0n),
                    ),
                    sub:
                      data.summary.locked
                        .map((r) => `${t(r.kind)} ${shortRupees(r.amountMinor)}`)
                        .join(" · ") || undefined,
                  },
                  {
                    label: t("Expiring in 30 days"),
                    value: String(data.summary.expiringSoon),
                    tone: data.summary.expiringSoon ? "warn" : "good",
                    sub: data.summary.expired
                      ? t("{count} already expired", { count: data.summary.expired })
                      : undefined,
                  },
                  {
                    label: t("EMD to get back"),
                    value: shortRupees(data.summary.emdToRecover),
                    sub: t("from tenders not won"),
                    tone: data.summary.emdToRecover !== "0" ? "warn" : "good",
                  },
                  {
                    label: t("Tenders"),
                    value: String(data.summary.tendersOpen),
                    sub: t("open · {won} won", { won: data.summary.tendersWon }),
                  },
                ]}
              />
              <ChipGroup
                options={["tenders", "guarantees", "extensions"] as const}
                value={tab}
                onChange={setTab}
                format={(value) =>
                  value === "tenders"
                    ? t("Tenders")
                    : value === "guarantees"
                      ? t("Guarantees & deposits")
                      : t("Time extensions")
                }
              />
              {tab === "tenders" ? <Tenders data={data} run={run} /> : null}
              {tab === "guarantees" ? <Guarantees data={data} run={run} /> : null}
              {tab === "extensions" ? <Extensions data={data} run={run} /> : null}
              <Text style={[styles.note, { color: colors.muted }]}>
                {t("Records only. No bank or e-tender portal is contacted from the app.")}
              </Text>
            </>
          ) : null}
        </ScrollView>
      </Screen>
    </AuthGate>
  );
}

type Data = inferRouterOutputs<AppRouter>["jp"]["contracts"]["overview"];
type Run = (work: () => Promise<unknown>, after?: () => void) => Promise<void>;

function Tenders({ data, run }: { data: Data; run: Run }) {
  const { t } = useT();
  const colors = useColors();
  const create = trpc.jp.contracts.createTender.useMutation();
  const move = trpc.jp.contracts.moveTender.useMutation();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    nit: "",
    department: "",
    work: "",
    location: "",
    estimate: "",
    due: "",
  });
  const [key, setKey] = useState(() => createClientMutationId());
  const [result, setResult] = useState<{ id: string; to: string } | null>(null);
  const [quoted, setQuoted] = useState("");
  const [rank, setRank] = useState("");
  const [note, setNote] = useState("");
  const [projectId, setProjectId] = useState<string | null>(null);
  const next = (status: string) =>
    status === "Preparing"
      ? ["Submitted", "Withdrawn"]
      : status === "Submitted"
        ? ["Opened", "Withdrawn"]
        : status === "Opened"
          ? ["Won", "Lost"]
          : [];
  return (
    <View style={{ gap: 10 }}>
      {data.canManage && !open ? (
        <PrimaryButton icon="add" label={t("New tender")} onPress={() => setOpen(true)} />
      ) : null}
      {open ? (
        <Card>
          <Field
            label="NIT / tender number"
            value={form.nit}
            onChangeText={(nit) => setForm({ ...form, nit })}
            placeholder="e.g. RWSS/BAM/12/2026-27"
          />
          <Field
            label="Department"
            value={form.department}
            onChangeText={(department) => setForm({ ...form, department })}
            placeholder="e.g. RWSS Division, Berhampur"
          />
          <Field
            label="Name of work"
            value={form.work}
            onChangeText={(work) => setForm({ ...form, work })}
            multiline
          />
          <Field
            label="Location (optional)"
            value={form.location}
            onChangeText={(location) => setForm({ ...form, location })}
          />
          <View style={styles.two}>
            <View style={{ flex: 1 }}>
              <Field
                label="Estimated value (₹)"
                value={form.estimate}
                onChangeText={(estimate) => setForm({ ...form, estimate })}
                keyboardType="decimal-pad"
              />
            </View>
            <View style={{ flex: 1 }}>
              <Field
                label="Bid due (YYYY-MM-DD)"
                value={form.due}
                onChangeText={(due) => setForm({ ...form, due })}
              />
            </View>
          </View>
          <PrimaryButton
            icon="save"
            label={t("Save tender")}
            disabled={!form.nit.trim() || !form.department.trim() || form.work.trim().length < 3}
            onPress={() =>
              void run(
                () =>
                  create.mutateAsync({
                    nitNumber: form.nit,
                    department: form.department,
                    workName: form.work,
                    location: form.location || undefined,
                    estimateRupees: form.estimate || undefined,
                    bidDueDate: form.due || undefined,
                    clientMutationId: key,
                  }),
                () => {
                  setOpen(false);
                  setForm({
                    nit: "",
                    department: "",
                    work: "",
                    location: "",
                    estimate: "",
                    due: "",
                  });
                  setKey(createClientMutationId());
                },
              )
            }
          />
          <SecondaryButton label={t("Cancel")} onPress={() => setOpen(false)} />
        </Card>
      ) : null}
      {!data.tenders.length ? (
        <EmptyState
          icon="gavel"
          title={t("No tenders yet")}
          detail={t("Add each tender you plan to bid for, with its EMD.")}
        />
      ) : null}
      {data.tenders.map((row) => (
        <Card key={row.id}>
          <View style={styles.top}>
            <Text style={[styles.title, { color: colors.foreground }]}>{row.code}</Text>
            <StatusPill
              compact
              label={t(row.status)}
              tone={
                row.status === "Won"
                  ? "success"
                  : ["Lost", "Withdrawn", "Cancelled"].includes(row.status)
                    ? "error"
                    : "info"
              }
            />
          </View>
          <Text style={[styles.body, { color: colors.foreground }]}>{row.workName}</Text>
          <Text style={[styles.meta, { color: colors.muted }]}>
            {row.department} · NIT {row.nitNumber}
          </Text>
          <Text style={[styles.meta, { color: colors.muted }]}>
            {row.estimateMinor ? `${t("Estimate")} ${formatMinorAsRupees(row.estimateMinor)}` : ""}
            {row.quotedMinor ? ` · ${t("Quoted")} ${formatMinorAsRupees(row.quotedMinor)}` : ""}
            {row.quotedPercent !== null
              ? ` (${row.quotedPercent > 0 ? "+" : ""}${row.quotedPercent}%)`
              : ""}
            {row.rank ? ` · ${row.rank}` : ""}
          </Text>
          {row.bidDueDate && ["Preparing", "Submitted"].includes(row.status) ? (
            <Text
              style={[
                styles.meta,
                {
                  color:
                    row.bidDueInDays !== null && row.bidDueInDays <= 3
                      ? colors.error
                      : colors.muted,
                },
              ]}
            >
              {t("Bid due {date}", { date: row.bidDueDate })}
              {row.bidDueInDays !== null
                ? ` · ${t("{count} days left", { count: row.bidDueInDays })}`
                : ""}
            </Text>
          ) : null}
          {row.projectName ? (
            <Text style={[styles.meta, { color: colors.primary }]}>
              {t("Project")}: {row.projectName}
            </Text>
          ) : null}
          {row.resultNote ? (
            <Text style={[styles.meta, { color: colors.muted }]}>{row.resultNote}</Text>
          ) : null}
          {data.canManage && next(row.status).length ? (
            result && result.id === row.id ? (
              <View style={{ gap: 6, marginTop: 6 }}>
                {result.to === "Opened" || result.to === "Won" || result.to === "Lost" ? (
                  <View style={styles.two}>
                    <View style={{ flex: 1 }}>
                      <Field
                        label="Our quoted value (₹)"
                        value={quoted}
                        onChangeText={setQuoted}
                        keyboardType="decimal-pad"
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Field label="Rank (L1, L2…)" value={rank} onChangeText={setRank} />
                    </View>
                  </View>
                ) : null}
                {result.to === "Won" ? (
                  <ChipGroup
                    label={t("Project for this work")}
                    options={data.projects.map((p) => p.id)}
                    value={projectId}
                    onChange={setProjectId}
                    format={(id) => data.projects.find((p) => p.id === id)?.name ?? id}
                  />
                ) : null}
                <Field label="Note / reason" value={note} onChangeText={setNote} />
                <PrimaryButton
                  icon="check"
                  label={t("Mark {status}", { status: t(result.to) })}
                  onPress={() =>
                    void run(
                      () =>
                        move.mutateAsync({
                          id: row.id,
                          to: result!.to as never,
                          quotedRupees: quoted || undefined,
                          rank: rank || undefined,
                          resultNote: note || undefined,
                          projectId: projectId ?? undefined,
                        }),
                      () => {
                        setResult(null);
                        setQuoted("");
                        setRank("");
                        setNote("");
                      },
                    )
                  }
                />
              </View>
            ) : (
              <View style={styles.actions}>
                {next(row.status).map((to) => (
                  <SecondaryButton
                    key={to}
                    label={t(to)}
                    onPress={() => setResult({ id: row.id, to })}
                  />
                ))}
              </View>
            )
          ) : null}
        </Card>
      ))}
    </View>
  );
}

function Guarantees({ data, run }: { data: Data; run: Run }) {
  const { t } = useT();
  const colors = useColors();
  const add = trpc.jp.contracts.addGuarantee.useMutation();
  const renew = trpc.jp.contracts.renewGuarantee.useMutation();
  const close = trpc.jp.contracts.closeGuarantee.useMutation();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<string | null>("EMD");
  const [instrument, setInstrument] = useState<string | null>("Bank guarantee");
  const [link, setLink] = useState<string | null>(null);
  const [form, setForm] = useState({
    amount: "",
    bank: "",
    number: "",
    beneficiary: "",
    issue: todayIst(),
    expiry: "",
    claim: "",
  });
  const [key, setKey] = useState(() => createClientMutationId());
  const [action, setAction] = useState<{
    id: string;
    kind: "renew" | "Released" | "Encashed";
  } | null>(null);
  const [date, setDate] = useState(todayIst());
  const [note, setNote] = useState("");
  const links = [
    ...data.tenders.map((row) => ({
      id: `t:${row.id}`,
      label: `${row.code} · ${row.workName.slice(0, 30)}`,
    })),
    ...data.projects.map((row) => ({ id: `p:${row.id}`, label: row.name })),
  ];
  return (
    <View style={{ gap: 10 }}>
      {data.canManage && !open ? (
        <PrimaryButton
          icon="add"
          label={t("Add guarantee or deposit")}
          onPress={() => setOpen(true)}
        />
      ) : null}
      {open ? (
        <Card>
          <ChipGroup
            label={t("Type")}
            options={data.kinds}
            value={kind}
            onChange={setKind}
            format={(v) => t(v)}
          />
          <ChipGroup
            label={t("Given as")}
            options={data.instruments}
            value={instrument}
            onChange={setInstrument}
            format={(v) => t(v)}
          />
          {links.length ? (
            <ChipGroup
              label={t("For tender or project")}
              options={links.map((l) => l.id)}
              value={link}
              onChange={setLink}
              format={(id) => links.find((l) => l.id === id)?.label ?? id}
            />
          ) : null}
          <View style={styles.two}>
            <View style={{ flex: 1 }}>
              <Field
                label="Amount (₹)"
                value={form.amount}
                onChangeText={(amount) => setForm({ ...form, amount })}
                keyboardType="decimal-pad"
              />
            </View>
            <View style={{ flex: 1 }}>
              <Field
                label="Bank (optional)"
                value={form.bank}
                onChangeText={(bank) => setForm({ ...form, bank })}
              />
            </View>
          </View>
          <View style={styles.two}>
            <View style={{ flex: 1 }}>
              <Field
                label="BG / DD / FDR number"
                value={form.number}
                onChangeText={(number) => setForm({ ...form, number })}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Field
                label="In favour of"
                value={form.beneficiary}
                onChangeText={(beneficiary) => setForm({ ...form, beneficiary })}
                placeholder="e.g. EE, RWSS Division"
              />
            </View>
          </View>
          <View style={styles.two}>
            <View style={{ flex: 1 }}>
              <Field
                label="Issued on"
                value={form.issue}
                onChangeText={(issue) => setForm({ ...form, issue })}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Field
                label="Valid till"
                value={form.expiry}
                onChangeText={(expiry) => setForm({ ...form, expiry })}
                placeholder="YYYY-MM-DD"
              />
            </View>
            <View style={{ flex: 1 }}>
              <Field
                label="Claim period till"
                value={form.claim}
                onChangeText={(claim) => setForm({ ...form, claim })}
                placeholder="YYYY-MM-DD"
              />
            </View>
          </View>
          <PrimaryButton
            icon="save"
            label={t("Save")}
            disabled={!kind || !instrument || !form.amount}
            onPress={() =>
              void run(
                () =>
                  add.mutateAsync({
                    kind: kind!,
                    instrument: instrument!,
                    tenderId: link?.startsWith("t:") ? link.slice(2) : undefined,
                    projectId: link?.startsWith("p:") ? link.slice(2) : undefined,
                    amountRupees: form.amount,
                    bankName: form.bank || undefined,
                    instrumentNumber: form.number || undefined,
                    beneficiary: form.beneficiary || undefined,
                    issueDate: form.issue,
                    expiryDate: form.expiry || undefined,
                    claimDate: form.claim || undefined,
                    clientMutationId: key,
                  }),
                () => {
                  setOpen(false);
                  setForm({
                    amount: "",
                    bank: "",
                    number: "",
                    beneficiary: "",
                    issue: todayIst(),
                    expiry: "",
                    claim: "",
                  });
                  setKey(createClientMutationId());
                },
              )
            }
          />
          <SecondaryButton label={t("Cancel")} onPress={() => setOpen(false)} />
        </Card>
      ) : null}
      {!data.guarantees.length ? (
        <EmptyState
          icon="account-balance"
          title={t("No guarantees recorded")}
          detail={t(
            "Add each EMD, BG, FDR or security deposit so you never miss an expiry or a release.",
          )}
        />
      ) : null}
      {data.guarantees.map((row) => (
        <Card
          key={row.id}
          accent={
            row.state === "Expiring" ? "warning" : row.state === "Expired" ? "error" : undefined
          }
        >
          <View style={styles.top}>
            <Text style={[styles.title, { color: colors.foreground }]}>
              {t(row.kind)} · {formatMinorAsRupees(row.amountMinor)}
            </Text>
            <StatusPill compact label={t(row.state)} tone={STATE_TONE[row.state]} />
          </View>
          <Text style={[styles.meta, { color: colors.muted }]}>
            {t(row.instrument)}
            {row.bankName ? ` · ${row.bankName}` : ""}
            {row.instrumentNumber ? ` · ${row.instrumentNumber}` : ""}
          </Text>
          <Text style={[styles.meta, { color: colors.muted }]}>
            {row.tenderCode ?? row.projectName ?? ""}
            {row.beneficiary ? ` · ${t("in favour of")} ${row.beneficiary}` : ""}
          </Text>
          <Text
            style={[
              styles.meta,
              {
                color:
                  row.state === "Expired" || row.state === "Expiring" ? colors.error : colors.muted,
              },
            ]}
          >
            {t("Issued {date}", { date: row.issueDate })}
            {row.expiryDate ? ` · ${t("valid till {date}", { date: row.expiryDate })}` : ""}
            {row.daysLeft !== null && row.status === "Active"
              ? ` · ${row.daysLeft >= 0 ? t("{count} days left", { count: row.daysLeft }) : t("expired {count} days ago", { count: -row.daysLeft })}`
              : ""}
          </Text>
          {row.note ? <Text style={[styles.meta, { color: colors.muted }]}>{row.note}</Text> : null}
          {data.canManage && row.status === "Active" ? (
            action?.id === row.id ? (
              <View style={{ gap: 6, marginTop: 6 }}>
                <Field
                  label={action.kind === "renew" ? "New valid-till date" : "Date"}
                  value={date}
                  onChangeText={setDate}
                />
                <Field label="Note (letter no., reason)" value={note} onChangeText={setNote} />
                <PrimaryButton
                  icon="check"
                  label={
                    action.kind === "renew"
                      ? t("Save extension")
                      : t("Mark {status}", { status: t(action.kind) })
                  }
                  disabled={note.trim().length < 3}
                  onPress={() =>
                    void run(
                      () =>
                        action.kind === "renew"
                          ? renew.mutateAsync({ id: row.id, expiryDate: date, note })
                          : close.mutateAsync({
                              id: row.id,
                              status: action.kind,
                              closedOn: date,
                              note,
                            }),
                      () => {
                        setAction(null);
                        setNote("");
                      },
                    )
                  }
                />
              </View>
            ) : (
              <View style={styles.actions}>
                <SecondaryButton
                  label={t("Extend validity")}
                  onPress={() => setAction({ id: row.id, kind: "renew" })}
                />
                <SecondaryButton
                  label={t("Released")}
                  onPress={() => setAction({ id: row.id, kind: "Released" })}
                />
                {data.canApprove ? (
                  <SecondaryButton
                    label={t("Encashed")}
                    onPress={() => setAction({ id: row.id, kind: "Encashed" })}
                  />
                ) : null}
              </View>
            )
          ) : null}
        </Card>
      ))}
    </View>
  );
}

function Extensions({ data, run }: { data: Data; run: Run }) {
  const { t } = useT();
  const colors = useColors();
  const add = trpc.jp.contracts.addExtension.useMutation();
  const decide = trpc.jp.contracts.decideExtension.useMutation();
  const [open, setOpen] = useState(false);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [form, setForm] = useState({
    stipulated: "",
    days: "",
    basis: "",
    letter: "",
    requested: todayIst(),
  });
  const [key, setKey] = useState(() => createClientMutationId());
  const [deciding, setDeciding] = useState<string | null>(null);
  const [granted, setGranted] = useState("");
  const [ref, setRef] = useState("");
  return (
    <View style={{ gap: 10 }}>
      {data.canManage && !open ? (
        <PrimaryButton
          icon="add"
          label={t("Ask for extension of time")}
          onPress={() => setOpen(true)}
        />
      ) : null}
      {open ? (
        <Card>
          <ChipGroup
            label={t("Project")}
            options={data.projects.map((p) => p.id)}
            value={projectId}
            onChange={(id) => {
              setProjectId(id);
              const p = data.projects.find((row) => row.id === id);
              if (p?.targetEndDate && !form.stipulated)
                setForm({ ...form, stipulated: p.targetEndDate });
            }}
            format={(id) => data.projects.find((p) => p.id === id)?.name ?? id}
          />
          <View style={styles.two}>
            <View style={{ flex: 1 }}>
              <Field
                label="Stipulated completion"
                value={form.stipulated}
                onChangeText={(stipulated) => setForm({ ...form, stipulated })}
                placeholder="YYYY-MM-DD"
              />
            </View>
            <View style={{ flex: 1 }}>
              <Field
                label="Days asked"
                value={form.days}
                onChangeText={(days) => setForm({ ...form, days })}
                keyboardType="number-pad"
              />
            </View>
          </View>
          <Field
            label="Grounds (hindrance numbers, reasons)"
            value={form.basis}
            onChangeText={(basis) => setForm({ ...form, basis })}
            multiline
            placeholder="e.g. HIN-SHG-OHT01-001 to 004: drawing delay, rain"
          />
          <View style={styles.two}>
            <View style={{ flex: 1 }}>
              <Field
                label="Letter no."
                value={form.letter}
                onChangeText={(letter) => setForm({ ...form, letter })}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Field
                label="Asked on"
                value={form.requested}
                onChangeText={(requested) => setForm({ ...form, requested })}
              />
            </View>
          </View>
          <PrimaryButton
            icon="save"
            label={t("Save request")}
            disabled={
              !projectId || !form.stipulated || !Number(form.days) || form.basis.trim().length < 5
            }
            onPress={() =>
              void run(
                () =>
                  add.mutateAsync({
                    projectId: projectId!,
                    stipulatedCompletion: form.stipulated,
                    requestedDays: Number(form.days),
                    basis: form.basis,
                    letterReference: form.letter || undefined,
                    requestDate: form.requested,
                    clientMutationId: key,
                  }),
                () => {
                  setOpen(false);
                  setForm({
                    stipulated: "",
                    days: "",
                    basis: "",
                    letter: "",
                    requested: todayIst(),
                  });
                  setKey(createClientMutationId());
                },
              )
            }
          />
          <SecondaryButton label={t("Cancel")} onPress={() => setOpen(false)} />
        </Card>
      ) : null}
      {!data.extensions.length ? (
        <EmptyState
          icon="update"
          title={t("No extensions asked")}
          detail={t("Use the hindrance register as the grounds for an extension of time.")}
        />
      ) : null}
      {data.extensions.map((row) => (
        <Card key={row.id}>
          <View style={styles.top}>
            <Text style={[styles.title, { color: colors.foreground }]}>{row.projectName}</Text>
            <StatusPill
              compact
              label={t(row.status)}
              tone={
                row.status === "Granted"
                  ? "success"
                  : row.status === "Rejected"
                    ? "error"
                    : "warning"
              }
            />
          </View>
          <Text style={[styles.meta, { color: colors.muted }]}>
            {t("Asked {days} days on {date}", { days: row.requestedDays, date: row.requestDate })}
            {row.letterReference ? ` · ${row.letterReference}` : ""}
          </Text>
          <Text style={[styles.body, { color: colors.foreground }]}>{row.basis}</Text>
          {row.status === "Granted" ? (
            <Text style={[styles.meta, { color: colors.success }]}>
              {t("{days} days granted · completion now {date}", {
                days: row.grantedDays ?? 0,
                date: row.newCompletion,
              })}
            </Text>
          ) : null}
          {data.canManage && row.status === "Requested" ? (
            deciding === row.id ? (
              <View style={{ gap: 6, marginTop: 6 }}>
                <Field
                  label="Days granted"
                  value={granted}
                  onChangeText={setGranted}
                  keyboardType="number-pad"
                />
                <Field label="Department letter no." value={ref} onChangeText={setRef} />
                <View style={styles.actions}>
                  <PrimaryButton
                    icon="check"
                    label={t("Granted")}
                    disabled={!Number(granted)}
                    onPress={() =>
                      void run(
                        () =>
                          decide.mutateAsync({
                            id: row.id,
                            status: "Granted",
                            grantedDays: Number(granted),
                            decisionDate: todayIst(),
                            decisionReference: ref || undefined,
                          }),
                        () => setDeciding(null),
                      )
                    }
                  />
                  <SecondaryButton
                    label={t("Rejected")}
                    onPress={() =>
                      void run(
                        () =>
                          decide.mutateAsync({
                            id: row.id,
                            status: "Rejected",
                            decisionDate: todayIst(),
                            decisionReference: ref || undefined,
                          }),
                        () => setDeciding(null),
                      )
                    }
                  />
                </View>
              </View>
            ) : (
              <SecondaryButton
                label={t("Record the decision")}
                onPress={() => setDeciding(row.id)}
              />
            )
          ) : null}
        </Card>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  two: { flexDirection: "row", gap: 10, flexWrap: "wrap" },
  top: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  title: { fontSize: 15, fontWeight: "800", flexShrink: 1 },
  body: { fontSize: 14, lineHeight: 20, marginTop: 4 },
  meta: { fontSize: 12, lineHeight: 18, marginTop: 3 },
  actions: { flexDirection: "row", gap: 8, flexWrap: "wrap", marginTop: 6 },
  note: { fontSize: 12, lineHeight: 18 },
});
