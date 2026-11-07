import { useLocalSearchParams, useRouter } from "expo-router";
import { HelpButton } from "@/components/jp/help";
import { useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { AuthGate } from "@/components/jp/auth-gate";
import { RUN_TONE, TotalRow, commercialStyles as styles } from "@/components/jp/commercial-ui";
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
import { useWorkspace } from "@/hooks/use-workspace";
import { formatMinorAsRupees } from "@/lib/jp/finance-domain";
import { createClientMutationId } from "@/lib/jp/local-repository";
import { previousMonth } from "@/lib/jp/payroll-domain";
import { resolveSelectedId } from "@/lib/jp/selection";
import { useT } from "@/lib/i18n";
import { trpc } from "@/lib/trpc";

const todayText = () => new Date().toISOString().slice(0, 10);
const TABS = ["runs", "khaata", "people", "rates"] as const;
type Tab = (typeof TABS)[number];

function recentMonths(today: string) {
  const months: string[] = [];
  let month = today.slice(0, 7);
  for (let i = 0; i < 4; i += 1) {
    months.push(month);
    month = previousMonth(`${month}-15`);
  }
  return months;
}
/** Paise → editable rupees text ("2500000" → "25000", "150" → "1.50"), exact. */
function rupeeText(minor: string) {
  const value = BigInt(minor);
  if (value === 0n) return "";
  const paise = value % 100n;
  return paise === 0n ? `${value / 100n}` : `${value / 100n}.${String(paise).padStart(2, "0")}`;
}
const percentText = (bps: number) => String(bps / 100);

/** Payroll for a site: monthly pay runs, each person's pay details, and the company's rates. */
export default function PayrollScreen() {
  const { t } = useT();
  const colors = useColors();
  const params = useLocalSearchParams<{ siteId?: string; tab?: string }>();
  const workspace = useWorkspace();
  const sites = trpc.jp.workspace.mySites.useQuery();
  const viewSites = workspace.sitesWith("payroll.view");
  const advanceSites = workspace.sitesWith("payroll.advance");
  const options = (sites.data ?? []).filter(
    (site) => viewSites.includes(site.id) || advanceSites.includes(site.id),
  );
  const [chosen, setChosen] = useState<string | null>(
    typeof params.siteId === "string" ? params.siteId : null,
  );
  const siteId = resolveSelectedId(options, chosen);
  const [tabChoice, setTab] = useState<string | null>(
    typeof params.tab === "string" ? params.tab : null,
  );
  // Someone who only hands out advances (a supervisor) sees the khaata and nothing else.
  const tabs: readonly Tab[] = viewSites.includes(siteId) ? TABS : ["khaata"];
  const tab: Tab = tabs.find((value) => value === tabChoice) ?? tabs[0];

  return (
    <AuthGate>
      <Screen>
        <ScrollView
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.content}
        >
          <AppHeader
            right={<HelpButton topicKey="payroll" />}
            eyebrow={t("Payroll")}
            title={t("Wages and salaries")}
            subtitle={t(
              "Monthly pay from approved attendance and salary details, with PF, ESI and payslips. Paid is a record, not a bank transfer.",
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
          {tabs.length > 1 ? (
            <ChipGroup
              options={tabs}
              value={tab}
              onChange={setTab}
              format={(value) =>
                value === "runs"
                  ? t("Pay runs")
                  : value === "khaata"
                    ? t("Khaata")
                    : value === "people"
                      ? t("Pay details")
                      : t("Rates")
              }
            />
          ) : null}
          {!siteId ? (
            <EmptyState
              icon="payments"
              title="No site"
              detail="Payroll is prepared for a site you are assigned to."
            />
          ) : tab === "runs" ? (
            <Runs siteId={siteId} colors={colors} />
          ) : tab === "khaata" ? (
            <Khaata siteId={siteId} colors={colors} />
          ) : tab === "people" ? (
            <People siteId={siteId} colors={colors} />
          ) : (
            <Rates siteId={siteId} colors={colors} />
          )}
        </ScrollView>
      </Screen>
    </AuthGate>
  );
}

type Colors = ReturnType<typeof useColors>;

function Runs({ siteId, colors }: { siteId: string; colors: Colors }) {
  const { t } = useT();
  const router = useRouter();
  const utils = trpc.useUtils();
  const runs = trpc.jp.payroll.runs.useQuery({ siteId });
  const months = recentMonths(todayText());
  const [monthChoice, setMonth] = useState<string | null>(null);
  const month = monthChoice && months.includes(monthChoice) ? monthChoice : months[1];
  const canPrepare = runs.data?.can.prepare ?? false;
  const preview = trpc.jp.payroll.preview.useQuery({ siteId, month }, { enabled: canPrepare });
  const create = trpc.jp.payroll.create.useMutation();
  const [key, setKey] = useState(createClientMutationId);
  const [error, setError] = useState<string | null>(null);

  const make = async () => {
    setError(null);
    try {
      const result = await create.mutateAsync({ siteId, month, clientMutationId: key });
      setKey(createClientMutationId());
      await utils.jp.payroll.invalidate();
      router.push(`/pay-run?siteId=${siteId}&id=${result.id}` as never);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Not saved.");
    }
  };

  return (
    <>
      {canPrepare ? (
        <Card>
          <ChipGroup label={t("Month to pay")} options={months} value={month} onChange={setMonth} />
          {preview.isLoading ? (
            <LoadingBlock label="Working out pay…" />
          ) : preview.error ? (
            <InlineError message={preview.error.message} onRetry={() => void preview.refetch()} />
          ) : preview.data ? (
            <>
              <TotalRow label={t("People")} value={String(preview.data.lineCount)} />
              <TotalRow
                label={t("Gross pay")}
                value={formatMinorAsRupees(preview.data.grossMinor)}
              />
              <TotalRow
                label={t("Net pay")}
                value={formatMinorAsRupees(preview.data.netMinor)}
                strong
              />
              <TotalRow
                label={t("Cost to company")}
                value={formatMinorAsRupees(preview.data.costMinor)}
              />
              {preview.data.unapproved > 0 ? (
                <Text style={[styles.meta, { color: colors.warning }]}>
                  {t(
                    "{count} attendance entries this month are not approved yet; they are left out.",
                    {
                      count: preview.data.unapproved,
                    },
                  )}
                </Text>
              ) : null}
              {preview.data.monthNotOver ? (
                <Text style={[styles.meta, { color: colors.warning }]}>
                  {t("This month is not over yet.")}
                </Text>
              ) : null}
              {preview.data.ratesAreDefault ? (
                <Text style={[styles.meta, { color: colors.warning }]}>
                  {t("PF and ESI use the standard rates. Ask your CA to confirm them under Rates.")}
                </Text>
              ) : null}
              {preview.data.existing ? (
                <Text
                  style={[styles.link, { color: colors.primary }]}
                  accessibilityRole="button"
                  onPress={() =>
                    router.push(
                      `/pay-run?siteId=${siteId}&id=${preview.data!.existing!.id}` as never,
                    )
                  }
                >
                  {t("{run} ({status}) already covers this month. Open it", {
                    run: preview.data.existing.runNumber,
                    status: t(preview.data.existing.status),
                  })}
                </Text>
              ) : (
                <PrimaryButton
                  icon="payments"
                  label={t("Make pay run for {month}", { month })}
                  loading={create.isPending}
                  disabled={preview.data.lineCount === 0}
                  onPress={() => void make()}
                />
              )}
            </>
          ) : null}
          {error ? <InlineError message={error} /> : null}
        </Card>
      ) : null}
      <SectionHeader title={t("Pay runs")} />
      {runs.isLoading ? (
        <LoadingBlock label="Loading pay runs…" />
      ) : runs.error ? (
        <InlineError message={runs.error.message} onRetry={() => void runs.refetch()} />
      ) : (runs.data?.runs.length ?? 0) === 0 ? (
        <EmptyState
          icon="payments"
          title="No pay runs yet"
          detail="Approve the month's attendance, then make a pay run."
        />
      ) : (
        runs.data?.runs.map((run) => (
          <Card
            key={run.id}
            accent={RUN_TONE[run.status] ?? "info"}
            onPress={() => router.push(`/pay-run?siteId=${siteId}&id=${run.id}` as never)}
            accessibilityLabel={`Open ${run.runNumber}`}
          >
            <View style={styles.row}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.title, { color: colors.foreground }]}>{run.runNumber}</Text>
                <Text style={[styles.meta, { color: colors.muted }]}>
                  {t("{count} people", { count: run.lineCount })} ·{" "}
                  {t("gross {amount}", { amount: formatMinorAsRupees(run.grossMinor) })}
                </Text>
              </View>
              <StatusPill label={t(run.status)} tone={RUN_TONE[run.status] ?? "info"} compact />
            </View>
            <Text style={[styles.money, { color: colors.foreground, marginTop: 6 }]}>
              {t("Net {amount}", { amount: formatMinorAsRupees(run.netMinor) })}
            </Text>
          </Card>
        ))
      )}
    </>
  );
}

function People({ siteId, colors }: { siteId: string; colors: Colors }) {
  const { t } = useT();
  const utils = trpc.useUtils();
  const list = trpc.jp.payroll.people.useQuery({ siteId });
  const save = trpc.jp.payroll.saveProfile.useMutation();
  const review = trpc.jp.payroll.reviewProfile.useMutation();
  const [editing, setEditing] = useState<string | null>(null);
  const [payType, setPayType] = useState<"Daily" | "Monthly">("Daily");
  const [basic, setBasic] = useState("");
  const [hra, setHra] = useState("");
  const [other, setOther] = useState("");
  const [pf, setPf] = useState<"Yes" | "No">("No");
  const [esi, setEsi] = useState<"Yes" | "No">("Yes");
  const [pt, setPt] = useState<"Yes" | "No">("No");
  const [uan, setUan] = useState("");
  const [esiNumber, setEsiNumber] = useState("");
  const [from, setFrom] = useState(`${todayText().slice(0, 7)}-01`);
  const [reason, setReason] = useState("");
  const [key, setKey] = useState(createClientMutationId);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const open = (person: NonNullable<typeof list.data>["people"][number]) => {
    const p = person.pending ?? person.profile;
    setEditing(person.id);
    setPayType(p?.payType ?? "Daily");
    setBasic(p ? rupeeText(p.basicMinor) : "");
    setHra(p ? rupeeText(p.hraMinor) : "");
    setOther(p ? rupeeText(p.otherAllowanceMinor) : "");
    setPf(p?.pfMember ?? "No");
    setEsi(p?.esiMember ?? "Yes");
    setPt(p?.ptApplies ?? "No");
    setUan(p?.uan ?? "");
    setEsiNumber(p?.esiNumber ?? "");
    setError(null);
  };

  const submit = async (personId: string) => {
    setError(null);
    try {
      await save.mutateAsync({
        siteId,
        personId,
        payType,
        basicRupees: payType === "Monthly" ? basic : null,
        hraRupees: payType === "Monthly" ? hra : null,
        otherAllowanceRupees: payType === "Monthly" ? other : null,
        pfMember: pf === "Yes",
        esiMember: esi === "Yes",
        ptApplies: pt === "Yes",
        uan: uan.trim() || null,
        esiNumber: esiNumber.trim() || null,
        effectiveFrom: from,
        clientMutationId: key,
      });
      setKey(createClientMutationId());
      setEditing(null);
      setMessage(t("Saved. It waits for another person to approve it."));
      await utils.jp.payroll.invalidate();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Not saved.");
    }
  };

  const decide = async (profileId: string, action: "approve" | "reject") => {
    setError(null);
    try {
      await review.mutateAsync({
        siteId,
        profileId,
        action,
        reason: reason.trim() || null,
        clientMutationId: createClientMutationId(),
      });
      setReason("");
      await utils.jp.payroll.invalidate();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Not saved.");
    }
  };

  const describe = (p: {
    payType: string;
    basicMinor: string;
    hraMinor: string;
    otherAllowanceMinor: string;
    pfMember: string;
    esiMember: string;
    effectiveFrom: string;
  }) => {
    const pay =
      p.payType === "Monthly"
        ? t("Monthly {amount}", {
            amount: formatMinorAsRupees(
              (
                BigInt(p.basicMinor) +
                BigInt(p.hraMinor) +
                BigInt(p.otherAllowanceMinor)
              ).toString(),
            ),
          })
        : t("Daily wages from attendance");
    const flags = [p.pfMember === "Yes" ? "PF" : null, p.esiMember === "Yes" ? "ESI" : null]
      .filter(Boolean)
      .join(" + ");
    return `${pay}${flags ? ` · ${flags}` : ""} · ${t("from {date}", { date: String(p.effectiveFrom) })}`;
  };

  if (list.isLoading) return <LoadingBlock label="Loading people…" />;
  if (list.error)
    return <InlineError message={list.error.message} onRetry={() => void list.refetch()} />;
  if (!list.data?.people.length)
    return (
      <EmptyState
        icon="groups"
        title="Nobody on this site"
        detail="Add workers to the site team in Workforce first."
      />
    );
  return (
    <>
      {message ? <Text style={[styles.meta, { color: colors.success }]}>{message}</Text> : null}
      {error ? <InlineError message={error} /> : null}
      {list.data.people.map((person) => (
        <Card key={person.id}>
          <View style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.title, { color: colors.foreground }]}>{person.name}</Text>
              <Text style={[styles.meta, { color: colors.muted }]}>
                {person.profile
                  ? describe(person.profile)
                  : t("No pay details: daily wages, no PF or ESI")}
              </Text>
            </View>
          </View>
          {person.pending ? (
            <View style={{ marginTop: 6 }}>
              <StatusPill label={t("Waiting for approval")} tone="warning" compact />
              <Text style={[styles.meta, { color: colors.foreground }]}>
                {describe(person.pending)}
              </Text>
              {person.pending.canReview ? (
                <>
                  <Field label={t("Reason (to reject)")} value={reason} onChangeText={setReason} />
                  <PrimaryButton
                    icon="check-circle"
                    label={t("Approve pay details")}
                    loading={review.isPending}
                    onPress={() => void decide(person.pending!.id, "approve")}
                  />
                  <SecondaryButton
                    label={t("Reject")}
                    onPress={() => void decide(person.pending!.id, "reject")}
                  />
                </>
              ) : null}
            </View>
          ) : null}
          {list.data.can.prepare && editing !== person.id ? (
            <SecondaryButton
              icon="edit"
              label={t("Set pay details")}
              onPress={() => open(person)}
            />
          ) : null}
          {editing === person.id ? (
            <View style={{ marginTop: 8 }}>
              <ChipGroup
                label={t("Paid by")}
                options={["Daily", "Monthly"] as const}
                value={payType}
                onChange={setPayType}
                format={(value) =>
                  value === "Daily" ? t("Daily (attendance)") : t("Monthly salary")
                }
              />
              {payType === "Monthly" ? (
                <>
                  <Field
                    label={t("Basic + DA a month (₹)")}
                    value={basic}
                    onChangeText={setBasic}
                    keyboardType="decimal-pad"
                  />
                  <Field
                    label={t("HRA a month (₹)")}
                    value={hra}
                    onChangeText={setHra}
                    keyboardType="decimal-pad"
                  />
                  <Field
                    label={t("Other allowance a month (₹)")}
                    value={other}
                    onChangeText={setOther}
                    keyboardType="decimal-pad"
                  />
                </>
              ) : (
                <Text style={[styles.meta, { color: colors.muted }]}>
                  {t("Daily workers are paid for approved attendance at their approved rate.")}
                </Text>
              )}
              <ChipGroup
                label={t("PF member")}
                options={["Yes", "No"] as const}
                value={pf}
                onChange={setPf}
                format={(v) => t(v)}
              />
              <ChipGroup
                label={t("ESI member")}
                options={["Yes", "No"] as const}
                value={esi}
                onChange={setEsi}
                format={(v) => t(v)}
              />
              <ChipGroup
                label={t("Professional tax")}
                options={["Yes", "No"] as const}
                value={pt}
                onChange={setPt}
                format={(v) => t(v)}
              />
              <Field
                label={t("UAN (12 digits)")}
                value={uan}
                onChangeText={setUan}
                keyboardType="number-pad"
                maxLength={12}
              />
              <Field
                label={t("ESI IP number (10 digits)")}
                value={esiNumber}
                onChangeText={setEsiNumber}
                keyboardType="number-pad"
                maxLength={10}
              />
              <Field label={t("From date")} value={from} onChangeText={setFrom} hint="2026-11-01" />
              <PrimaryButton
                icon="save"
                label={t("Save pay details")}
                loading={save.isPending}
                onPress={() => void submit(person.id)}
              />
              <SecondaryButton label={t("Cancel")} onPress={() => setEditing(null)} />
            </View>
          ) : null}
        </Card>
      ))}
    </>
  );
}

function Rates({ siteId, colors }: { siteId: string; colors: Colors }) {
  const { t } = useT();
  const utils = trpc.useUtils();
  const settings = trpc.jp.payroll.settings.useQuery({ siteId });
  const save = trpc.jp.payroll.saveSettings.useMutation();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({});
  const [key, setKey] = useState(createClientMutationId);
  const [error, setError] = useState<string | null>(null);

  if (settings.isLoading) return <LoadingBlock label="Loading rates…" />;
  if (settings.error)
    return <InlineError message={settings.error.message} onRetry={() => void settings.refetch()} />;
  const current = settings.data!.current;

  const start = () => {
    setForm({
      effectiveFrom: todayText(),
      pfWageCeilingRupees: rupeeText(current.pfWageCeilingMinor),
      pfEmployeePercent: percentText(current.pfEmployeeBps),
      pfEmployerPercent: percentText(current.pfEmployerBps),
      epsPercent: percentText(current.epsBps),
      epsCeilingRupees: rupeeText(current.epsCeilingMinor),
      edliPercent: percentText(current.edliBps),
      pfAdminPercent: percentText(current.pfAdminBps),
      esiThresholdRupees: rupeeText(current.esiThresholdMinor),
      esiEmployeePercent: percentText(current.esiEmployeeBps),
      esiEmployerPercent: percentText(current.esiEmployerBps),
      overtimeTimes: String(current.overtimeMultiplierBps / 10_000),
      wageSharePercent: percentText(current.wageShareBps),
      ptSlabs: current.ptSlabs,
      note: "",
    });
    setEditing(true);
  };
  const set = (name: string) => (value: string) => setForm((prev) => ({ ...prev, [name]: value }));

  const submit = async () => {
    setError(null);
    try {
      await save.mutateAsync({
        effectiveFrom: form.effectiveFrom,
        pfWageCeilingRupees: form.pfWageCeilingRupees,
        pfEmployeePercent: form.pfEmployeePercent,
        pfEmployerPercent: form.pfEmployerPercent,
        epsPercent: form.epsPercent,
        epsCeilingRupees: form.epsCeilingRupees,
        edliPercent: form.edliPercent,
        pfAdminPercent: form.pfAdminPercent,
        esiThresholdRupees: form.esiThresholdRupees,
        esiEmployeePercent: form.esiEmployeePercent,
        esiEmployerPercent: form.esiEmployerPercent,
        overtimeTimes: form.overtimeTimes,
        wageSharePercent: form.wageSharePercent,
        ptSlabs: form.ptSlabs,
        note: form.note.trim() || null,
        clientMutationId: key,
      });
      setKey(createClientMutationId());
      setEditing(false);
      await utils.jp.payroll.invalidate();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Not saved.");
    }
  };

  const fields: [string, string][] = [
    ["effectiveFrom", "From date"],
    ["pfWageCeilingRupees", "PF wage ceiling (₹ a month)"],
    ["pfEmployeePercent", "PF employee %"],
    ["pfEmployerPercent", "PF employer %"],
    ["epsPercent", "EPS % (part of employer PF)"],
    ["epsCeilingRupees", "EPS wage ceiling (₹)"],
    ["edliPercent", "EDLI %"],
    ["pfAdminPercent", "PF admin charges %"],
    ["esiThresholdRupees", "ESI applies up to (₹ gross a month)"],
    ["esiEmployeePercent", "ESI employee %"],
    ["esiEmployerPercent", "ESI employer %"],
    ["overtimeTimes", "Overtime rate (times ordinary)"],
    ["wageSharePercent", "Wages at least % of pay (Code on Wages)"],
  ];

  return (
    <>
      <Card>
        {settings.data!.isDefault ? (
          <Text style={[styles.meta, { color: colors.warning }]}>
            {t(
              "These are the standard rates (EPF ceiling ₹25,000 from 17 Sep 2026; ESI up to ₹21,000; no Odisha professional tax from April 2026). Ask your CA to confirm them.",
            )}
          </Text>
        ) : (
          <Text style={[styles.meta, { color: colors.muted }]}>
            {t("In force from {date}", { date: current.effectiveFrom })}
          </Text>
        )}
        <TotalRow
          label={t("PF wage ceiling")}
          value={formatMinorAsRupees(current.pfWageCeilingMinor)}
        />
        <TotalRow
          label={t("PF employee / employer")}
          value={`${percentText(current.pfEmployeeBps)}% / ${percentText(current.pfEmployerBps)}%`}
        />
        <TotalRow label={t("EPS (in employer PF)")} value={`${percentText(current.epsBps)}%`} />
        <TotalRow
          label={t("EDLI + admin")}
          value={`${percentText(current.edliBps + current.pfAdminBps)}%`}
        />
        <TotalRow
          label={t("ESI applies up to")}
          value={formatMinorAsRupees(current.esiThresholdMinor)}
        />
        <TotalRow
          label={t("ESI employee / employer")}
          value={`${percentText(current.esiEmployeeBps)}% / ${percentText(current.esiEmployerBps)}%`}
        />
        <TotalRow label={t("Overtime rate")} value={`${current.overtimeMultiplierBps / 10_000}×`} />
        <TotalRow
          label={t("Professional tax")}
          value={current.ptSlabs ? current.ptSlabs.replaceAll("\n", "; ") : t("None")}
        />
        {settings.data!.canEdit && !editing ? (
          <SecondaryButton icon="edit" label={t("Change rates")} onPress={start} />
        ) : null}
      </Card>
      {editing ? (
        <Card>
          {fields.map(([name, label]) => (
            <Field
              key={name}
              label={t(label)}
              value={form[name] ?? ""}
              onChangeText={set(name)}
              keyboardType={name === "effectiveFrom" ? "default" : "decimal-pad"}
            />
          ))}
          <Field
            label={t("Professional tax slabs")}
            hint={t(
              'One per line: "monthly gross up to: tax", last line "above: tax". Empty for none.',
            )}
            value={form.ptSlabs ?? ""}
            onChangeText={set("ptSlabs")}
            multiline
          />
          <Field
            label={t("Note (notification or CA advice)")}
            value={form.note ?? ""}
            onChangeText={set("note")}
            multiline
          />
          {error ? <InlineError message={error} /> : null}
          <PrimaryButton
            icon="save"
            label={t("Save rates")}
            loading={save.isPending}
            onPress={() => void submit()}
          />
          <SecondaryButton label={t("Cancel")} onPress={() => setEditing(false)} />
        </Card>
      ) : null}
      {settings.data!.history.length ? (
        <>
          <SectionHeader title={t("Earlier rates")} />
          {settings.data!.history.map((row) => (
            <Card key={row.id}>
              <Text style={[styles.meta, { color: colors.foreground, fontWeight: "700" }]}>
                {t("From {date}", { date: row.effectiveFrom })}
              </Text>
              <Text style={[styles.meta, { color: colors.muted }]}>
                PF {formatMinorAsRupees(row.pfWageCeilingMinor)} · ESI{" "}
                {formatMinorAsRupees(row.esiThresholdMinor)}
                {row.note ? ` · ${row.note}` : ""}
              </Text>
            </Card>
          ))}
        </>
      ) : null}
    </>
  );
}

const MODES = ["Cash", "UPI", "Bank transfer", "Cheque"] as const;

/** Each person's money on the site: paid, still due, advance; give an advance or record a repayment. */
function Khaata({ siteId, colors }: { siteId: string; colors: Colors }) {
  const { t } = useT();
  const router = useRouter();
  const utils = trpc.useUtils();
  const list = trpc.jp.advances.list.useQuery({ siteId });
  const request = trpc.jp.advances.request.useMutation();
  const review = trpc.jp.advances.review.useMutation();
  const [form, setForm] = useState<{ personId: string; entryType: "Advance" | "Repayment" } | null>(
    null,
  );
  const [amount, setAmount] = useState("");
  const [installment, setInstallment] = useState("");
  const [entryDate, setEntryDate] = useState(todayText);
  const [mode, setMode] = useState<(typeof MODES)[number]>("Cash");
  const [reference, setReference] = useState("");
  const [why, setWhy] = useState("");
  const [reason, setReason] = useState("");
  const [key, setKey] = useState(createClientMutationId);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const open = (personId: string, entryType: "Advance" | "Repayment") => {
    setForm({ personId, entryType });
    setAmount("");
    setInstallment("");
    setWhy("");
    setReference("");
    setError(null);
  };
  const save = async () => {
    if (!form) return;
    setError(null);
    try {
      await request.mutateAsync({
        siteId,
        personId: form.personId,
        entryType: form.entryType,
        amountRupees: amount,
        installmentRupees: form.entryType === "Advance" ? installment : null,
        entryDate,
        mode,
        reference: reference.trim() || null,
        reason: why,
        clientMutationId: key,
      });
      setKey(createClientMutationId());
      setForm(null);
      setMessage(t("Saved. It waits for another person to approve it."));
      await utils.jp.advances.invalidate();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Not saved.");
    }
  };
  const decide = async (entryId: string, action: "approve" | "reject" | "cancel") => {
    setError(null);
    try {
      await review.mutateAsync({
        siteId,
        entryId,
        action,
        reason: reason.trim() || null,
        clientMutationId: createClientMutationId(),
      });
      setReason("");
      await utils.jp.advances.invalidate();
      await utils.jp.payroll.invalidate();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Not saved.");
    }
  };

  if (list.isLoading) return <LoadingBlock label="Loading khaata…" />;
  if (list.error)
    return <InlineError message={list.error.message} onRetry={() => void list.refetch()} />;
  const data = list.data!;
  return (
    <>
      <Card>
        {data.totals.paidMinor !== null ? (
          <TotalRow label={t("Paid so far")} value={formatMinorAsRupees(data.totals.paidMinor)} />
        ) : null}
        {data.totals.dueMinor !== null ? (
          <TotalRow
            label={t("Wages still to pay")}
            value={formatMinorAsRupees(data.totals.dueMinor)}
            strong
          />
        ) : null}
        <TotalRow
          label={t("Advance to recover")}
          value={formatMinorAsRupees(data.totals.advanceMinor)}
        />
      </Card>
      {message ? <Text style={[styles.meta, { color: colors.success }]}>{message}</Text> : null}
      {error ? <InlineError message={error} /> : null}
      {data.pending.length ? (
        <>
          <SectionHeader title={t("Waiting for approval")} />
          {data.pending.some((row) => row.canReview || row.canCancel) ? (
            <Field
              label={t("Reason (to reject or cancel)")}
              value={reason}
              onChangeText={setReason}
            />
          ) : null}
          {data.pending.map((row) => (
            <Card key={row.id} accent="warning">
              <Text style={[styles.title, { color: colors.foreground }]}>
                {row.personName} · {t(row.entryType)} {formatMinorAsRupees(row.amountMinor)}
              </Text>
              <Text style={[styles.meta, { color: colors.muted }]}>
                {String(row.entryDate)} · {t(row.mode)} · {row.reason}
                {row.entryType === "Advance" && row.installmentMinor !== "0"
                  ? ` · ${t("recover {amount} a month", { amount: formatMinorAsRupees(row.installmentMinor) })}`
                  : ""}
              </Text>
              {row.canReview ? (
                <>
                  <PrimaryButton
                    icon="check-circle"
                    label={t("Approve")}
                    loading={review.isPending}
                    onPress={() => void decide(row.id, "approve")}
                  />
                  <SecondaryButton
                    label={t("Reject")}
                    onPress={() => void decide(row.id, "reject")}
                  />
                </>
              ) : null}
              {row.canCancel ? (
                <SecondaryButton
                  label={t("Cancel")}
                  onPress={() => void decide(row.id, "cancel")}
                />
              ) : null}
            </Card>
          ))}
        </>
      ) : null}
      <SectionHeader title={t("People")} />
      {data.people.length === 0 ? (
        <EmptyState
          icon="groups"
          title="Nobody on this site"
          detail="Add workers to the site team in Workforce first."
        />
      ) : (
        data.people.map((person) => (
          <Card key={person.id}>
            <Text style={[styles.title, { color: colors.foreground }]}>{person.name}</Text>
            {person.dueMinor !== null ? (
              <TotalRow
                label={t("Still to pay")}
                value={formatMinorAsRupees(person.dueMinor)}
                strong
              />
            ) : null}
            {person.paidMinor !== null ? (
              <TotalRow label={t("Paid so far")} value={formatMinorAsRupees(person.paidMinor)} />
            ) : null}
            <TotalRow
              label={t("Advance to recover")}
              value={formatMinorAsRupees(person.advanceOutstandingMinor)}
            />
            {person.lastPaidOn ? (
              <Text style={[styles.meta, { color: colors.muted }]}>
                {t("Last paid on {date}", { date: person.lastPaidOn })}
              </Text>
            ) : null}
            <View style={[styles.row, { marginTop: 4 }]}>
              <Text
                style={[styles.link, { color: colors.primary }]}
                accessibilityRole="button"
                accessibilityLabel={`Open khaata of ${person.name}`}
                onPress={() =>
                  router.push(`/khaata?siteId=${siteId}&personId=${person.id}` as never)
                }
              >
                {t("Full khaata")}
              </Text>
            </View>
            {data.can.request && form?.personId !== person.id ? (
              <View style={[styles.row, { marginTop: 4 }]}>
                <Text
                  style={[styles.link, { color: colors.primary }]}
                  accessibilityRole="button"
                  accessibilityLabel={`Give advance to ${person.name}`}
                  onPress={() => open(person.id, "Advance")}
                >
                  {t("Give advance")}
                </Text>
                {person.advanceOutstandingMinor !== "0" ? (
                  <Text
                    style={[styles.link, { color: colors.primary, marginLeft: 16 }]}
                    accessibilityRole="button"
                    onPress={() => open(person.id, "Repayment")}
                  >
                    {t("Record repayment")}
                  </Text>
                ) : null}
              </View>
            ) : null}
            {form?.personId === person.id ? (
              <View style={{ marginTop: 8 }}>
                <Text style={[styles.title, { color: colors.foreground }]}>
                  {form.entryType === "Advance" ? t("Give advance") : t("Record repayment")}
                </Text>
                <Field
                  label={t("Amount (₹)")}
                  value={amount}
                  onChangeText={setAmount}
                  keyboardType="decimal-pad"
                />
                {form.entryType === "Advance" ? (
                  <Field
                    label={t("Recover each month (₹)")}
                    hint={t("Empty: recover all from the next pay run.")}
                    value={installment}
                    onChangeText={setInstallment}
                    keyboardType="decimal-pad"
                  />
                ) : null}
                <Field label={t("Date")} value={entryDate} onChangeText={setEntryDate} />
                <ChipGroup
                  label={t("Mode")}
                  options={MODES}
                  value={mode}
                  onChange={setMode}
                  format={(v) => t(v)}
                />
                {mode !== "Cash" ? (
                  <Field
                    label={t("Reference (bank, UPI or cheque)")}
                    value={reference}
                    onChangeText={setReference}
                  />
                ) : null}
                <Field label={t("What is it for")} value={why} onChangeText={setWhy} />
                <PrimaryButton
                  icon="save"
                  label={t("Save")}
                  loading={request.isPending}
                  onPress={() => void save()}
                />
                <SecondaryButton label={t("Cancel")} onPress={() => setForm(null)} />
              </View>
            ) : null}
          </Card>
        ))
      )}
    </>
  );
}
