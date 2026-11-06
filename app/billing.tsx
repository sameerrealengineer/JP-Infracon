import { useLocalSearchParams, useRouter } from "expo-router";
import { HelpButton } from "@/components/jp/help";
import { useState } from "react";
import { RefreshControl, ScrollView, Text, View } from "react-native";
import { AuthGate } from "@/components/jp/auth-gate";
import { BILL_TONE, TotalRow, commercialStyles as styles } from "@/components/jp/commercial-ui";
import {
  AppHeader,
  Card,
  ChipGroup,
  EmptyState,
  Field,
  HeroCard,
  InlineError,
  isAccessDenied,
  LoadingBlock,
  NoAccess,
  PrimaryButton,
  Screen,
  SectionHeader,
  StatusPill,
} from "@/components/jp/ui";
import { useColors } from "@/hooks/use-colors";
import { formatPercent, formatQuantity } from "@/lib/jp/billing-domain";
import { formatMinorAsRupees } from "@/lib/jp/finance-domain";
import { createClientMutationId } from "@/lib/jp/local-repository";
import { resolveSelectedId } from "@/lib/jp/selection";
import { useT } from "@/lib/i18n";
import { trpc } from "@/lib/trpc";

/** Client billing: what clients owe, each project's contract, and its RA bills. */
export default function BillingScreen() {
  const { t } = useT();
  const colors = useColors();
  const router = useRouter();
  const params = useLocalSearchParams<{ quotationId?: string; projectId?: string }>();
  const quotationId = typeof params.quotationId === "string" ? params.quotationId : null;
  const utils = trpc.useUtils();
  const projects = trpc.jp.billing.projects.useQuery();
  const receivables = trpc.jp.billing.receivables.useQuery();
  const [chosen, setChosen] = useState<string | null>(
    typeof params.projectId === "string" ? params.projectId : null,
  );
  const projectId = resolveSelectedId(projects.data?.projects ?? [], chosen) || null;
  const contract = trpc.jp.billing.contract.get.useQuery(
    { projectId: projectId ?? "" },
    { enabled: Boolean(projectId) },
  );
  const bills = trpc.jp.billing.bills.list.useQuery(
    { projectId: projectId ?? null },
    { enabled: Boolean(projectId) },
  );
  const can = projects.data?.can;
  const error = projects.error ?? receivables.error ?? contract.error ?? bills.error;
  const refresh = () => utils.jp.billing.invalidate();

  if (isAccessDenied(projects.error) || isAccessDenied(receivables.error))
    return (
      <AuthGate>
        <Screen>
          <ScrollView contentContainerStyle={styles.content}>
            <AppHeader
              right={<HelpButton topicKey="billing" />}
              eyebrow={t("Business")}
              title={t("Client billing")}
            />
            <NoAccess
              area={t("Client billing")}
              message={(projects.error ?? receivables.error)?.message}
            />
          </ScrollView>
        </Screen>
      </AuthGate>
    );

  return (
    <AuthGate>
      <Screen>
        <ScrollView
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.content}
          refreshControl={
            <RefreshControl
              refreshing={receivables.isRefetching}
              onRefresh={() => void refresh()}
              tintColor={colors.primary}
            />
          }
        >
          <AppHeader
            right={<HelpButton topicKey="billing" />}
            eyebrow={t("Business")}
            title={t("Client billing")}
            subtitle={t(
              "RA bills with GST, retention and TDS, money received, and what each client owes.",
            )}
          />
          {error ? <InlineError message={error.message} onRetry={() => void refresh()} /> : null}

          {receivables.data ? (
            <HeroCard>
              <Text style={heroKicker}>{t("RECEIVABLES")}</Text>
              <Text style={heroValue}>
                {formatMinorAsRupees(receivables.data.totals.outstandingMinor)}
              </Text>
              <Text style={heroLabel}>{t("Outstanding from clients on approved bills")}</Text>
              <View style={[styles.row, { marginTop: 14 }]}>
                <HeroMini
                  label={t("Billed")}
                  value={formatMinorAsRupees(receivables.data.totals.billedMinor)}
                />
                <HeroMini
                  label={t("Received")}
                  value={formatMinorAsRupees(receivables.data.totals.receivedMinor)}
                />
                <HeroMini
                  label={t("Retention held")}
                  value={formatMinorAsRupees(receivables.data.totals.retentionMinor)}
                />
              </View>
            </HeroCard>
          ) : receivables.isLoading ? (
            <LoadingBlock label="Loading receivables…" />
          ) : null}

          {receivables.data?.clients.length ? (
            <>
              <SectionHeader title={t("By client")} />
              {receivables.data.clients.map((client) => (
                <Card key={client.clientId}>
                  <View style={styles.row}>
                    <Text style={[styles.title, { color: colors.foreground, flex: 1 }]}>
                      {client.clientName}
                    </Text>
                    <Text style={[styles.title, { color: colors.error }]}>
                      {formatMinorAsRupees(client.outstandingMinor)}
                    </Text>
                  </View>
                  <Text style={[styles.meta, { color: colors.muted }]}>
                    {Object.entries(client.ageing)
                      .map(([bucket, amount]) => `${t(bucket)}: ${formatMinorAsRupees(amount)}`)
                      .join(" · ") || t("Nothing overdue")}
                  </Text>
                </Card>
              ))}
            </>
          ) : null}

          <SectionHeader title={t("Project")} />
          {projects.isLoading ? (
            <LoadingBlock />
          ) : (projects.data?.projects.length ?? 0) === 0 ? (
            <EmptyState
              icon="apartment"
              title="No projects"
              detail="Projects you can see appear here for billing."
            />
          ) : (
            <ChipGroup
              options={(projects.data?.projects ?? []).map((p) => p.id)}
              value={projectId}
              onChange={setChosen}
              format={(id) => projects.data?.projects.find((p) => p.id === id)?.name ?? id}
            />
          )}

          {projectId && quotationId && can?.create ? (
            <FromQuotation
              projectId={projectId}
              quotationId={quotationId}
              projectName={contract.data?.project.name ?? ""}
              onDone={() => {
                router.setParams({ quotationId: undefined } as never);
                void refresh();
              }}
            />
          ) : null}

          {projectId && contract.data ? (
            <>
              <SectionHeader
                title={t("Contract")}
                caption={
                  contract.data.contract
                    ? `${contract.data.contract.clientName} · GST ${formatPercent(contract.data.contract.gstBps)} · ${t("retention")} ${formatPercent(contract.data.contract.retentionBps)} · TDS ${formatPercent(contract.data.contract.tdsBps)}`
                    : t("Not set up yet")
                }
              />
              {!contract.data.contract ? (
                can?.create ? (
                  <ContractSetup projectId={projectId} onDone={() => void refresh()} />
                ) : (
                  <EmptyState
                    icon="description"
                    title="No contract yet"
                    detail="Ask accounts or a director to set up this project's client contract."
                  />
                )
              ) : (
                <Card>
                  <TotalRow
                    label={t("Contract value (before GST)")}
                    value={formatMinorAsRupees(contract.data.contractValueMinor)}
                    strong
                  />
                  {contract.data.items.map((item) => (
                    <View key={item.id} style={{ paddingVertical: 5 }}>
                      <Text style={[styles.meta, { color: colors.foreground, fontWeight: "700" }]}>
                        {item.itemCode} · {item.description}
                      </Text>
                      <Text style={[styles.meta, { color: colors.muted, marginTop: 1 }]}>
                        {t("Billed {done} of {total} {unit} · balance {left}", {
                          done: formatQuantity(item.billedThousandths),
                          total: formatQuantity(item.contractQuantityThousandths),
                          unit: item.unit,
                          left: formatQuantity(item.balanceThousandths),
                        })}{" "}
                        · {formatMinorAsRupees(item.rateMinor)}/{item.unit}
                      </Text>
                    </View>
                  ))}
                  {contract.data.items.length === 0 ? (
                    <Text style={[styles.meta, { color: colors.muted }]}>
                      {t("No contract items yet. Add them below or from an accepted quotation.")}
                    </Text>
                  ) : null}
                  {can?.create ? (
                    <AddItem projectId={projectId} onDone={() => void refresh()} />
                  ) : null}
                </Card>
              )}

              <SectionHeader
                title={t("RA bills")}
                action={
                  can?.create && contract.data.contract && contract.data.items.length
                    ? t("New RA bill")
                    : undefined
                }
                onPress={() => router.push(`/bill-editor?projectId=${projectId}` as never)}
              />
              {(bills.data?.length ?? 0) === 0 ? (
                <EmptyState
                  icon="receipt-long"
                  title="No bills yet"
                  detail="Running-account bills for this project appear here."
                />
              ) : (
                bills.data?.map((bill) => (
                  <Card
                    key={bill.id}
                    accent={BILL_TONE[bill.paymentStatus ?? bill.status] ?? "info"}
                    onPress={() => router.push(`/bill?id=${bill.id}` as never)}
                    accessibilityLabel={`Open ${bill.billNumber}`}
                  >
                    <View style={styles.row}>
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.title, { color: colors.foreground }]}>
                          {bill.billNumber}
                        </Text>
                        <Text style={[styles.meta, { color: colors.muted }]}>
                          {bill.clientName} · {String(bill.billDate)}
                        </Text>
                      </View>
                      <StatusPill
                        label={t(bill.paymentStatus ?? bill.status)}
                        tone={BILL_TONE[bill.paymentStatus ?? bill.status] ?? "info"}
                        compact
                      />
                    </View>
                    <View style={[styles.row, { marginTop: 8 }]}>
                      <Text style={[styles.money, { color: colors.foreground }]}>
                        {formatMinorAsRupees(bill.netReceivableMinor)}
                      </Text>
                      {bill.paymentStatus && bill.paymentStatus !== "Paid" ? (
                        <Text style={[styles.meta, { color: colors.error, marginTop: 0 }]}>
                          {t("Due")} {formatMinorAsRupees(bill.outstandingMinor)}
                        </Text>
                      ) : null}
                    </View>
                  </Card>
                ))
              )}
            </>
          ) : projectId && contract.isLoading ? (
            <LoadingBlock />
          ) : null}
          <Text style={[styles.meta, { color: colors.muted, textAlign: "center" }]}>
            {t(
              "Internal billing records. File GST returns and e-invoices through your accountant.",
            )}
          </Text>
        </ScrollView>
      </Screen>
    </AuthGate>
  );
}

const heroKicker = {
  color: "#D9B76A",
  fontSize: 11,
  fontWeight: "800" as const,
  letterSpacing: 1.8,
  marginTop: 6,
};
const heroValue = { color: "#FFFFFF", fontSize: 28, fontWeight: "800" as const, marginTop: 8 };
const heroLabel = { color: "rgba(255,255,255,0.7)", fontSize: 12, marginTop: 2 };

function HeroMini({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flex: 1 }}>
      <Text style={{ color: "#FFFFFF", fontSize: 13, fontWeight: "800" }} numberOfLines={1}>
        {value}
      </Text>
      <Text style={{ color: "rgba(255,255,255,0.65)", fontSize: 11 }}>{label}</Text>
    </View>
  );
}

function ContractSetup({ projectId, onDone }: { projectId: string; onDone: () => void }) {
  const { t } = useT();
  const clients = trpc.jp.crm.clients.list.useQuery({ query: "" });
  const save = trpc.jp.billing.contract.save.useMutation();
  const [clientId, setClientId] = useState<string | null>(null);
  const [contractNumber, setContractNumber] = useState("");
  const [gst, setGst] = useState("18");
  const [retention, setRetention] = useState("5");
  const [tds, setTds] = useState("2");
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    if (!clientId) return;
    setError(null);
    try {
      await save.mutateAsync({
        projectId,
        clientId,
        contractNumber: contractNumber.trim() || null,
        gstPercent: gst,
        retentionPercent: retention,
        tdsPercent: tds,
      });
      onDone();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Not saved.");
    }
  };
  return (
    <Card>
      {(clients.data?.length ?? 0) === 0 ? (
        <InlineError message={t("Add the client in Clients & leads first.")} />
      ) : (
        <ChipGroup
          label={t("Client")}
          options={(clients.data ?? []).map((c) => c.id)}
          value={clientId}
          onChange={setClientId}
          format={(id) => clients.data?.find((c) => c.id === id)?.name ?? id}
        />
      )}
      <Field
        label={t("Contract / work order no.")}
        value={contractNumber}
        onChangeText={setContractNumber}
      />
      <View style={styles.row}>
        <View style={{ flex: 1 }}>
          <Field label="GST %" value={gst} onChangeText={setGst} keyboardType="decimal-pad" />
        </View>
        <View style={{ flex: 1 }}>
          <Field
            label={t("Retention %")}
            value={retention}
            onChangeText={setRetention}
            keyboardType="decimal-pad"
          />
        </View>
        <View style={{ flex: 1 }}>
          <Field label="TDS %" value={tds} onChangeText={setTds} keyboardType="decimal-pad" />
        </View>
      </View>
      {error ? <InlineError message={error} /> : null}
      <PrimaryButton
        icon="save"
        label={t("Save contract")}
        loading={save.isPending}
        disabled={!clientId}
        onPress={() => void submit()}
      />
    </Card>
  );
}

function AddItem({ projectId, onDone }: { projectId: string; onDone: () => void }) {
  const { t } = useT();
  const add = trpc.jp.billing.contract.addItems.useMutation();
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState(createClientMutationId);
  const [item, setItem] = useState({
    itemCode: "",
    description: "",
    unit: "cum",
    quantity: "",
    rateRupees: "",
  });
  const [error, setError] = useState<string | null>(null);
  if (!open)
    return (
      <Text
        accessibilityRole="button"
        onPress={() => setOpen(true)}
        style={[styles.link, { color: "#1E3E60" }]}
      >
        + {t("Add contract item")}
      </Text>
    );
  const submit = async () => {
    setError(null);
    try {
      await add.mutateAsync({ projectId, items: [item], clientMutationId: key });
      setKey(createClientMutationId());
      setItem({ itemCode: "", description: "", unit: item.unit, quantity: "", rateRupees: "" });
      onDone();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Not saved.");
    }
  };
  return (
    <View style={{ marginTop: 10 }}>
      <Field
        label={t("Item code")}
        value={item.itemCode}
        onChangeText={(v) => setItem({ ...item, itemCode: v })}
      />
      <Field
        label={t("Description")}
        value={item.description}
        onChangeText={(v) => setItem({ ...item, description: v })}
      />
      <View style={styles.row}>
        <View style={{ flex: 1 }}>
          <Field
            label={t("Contract qty")}
            value={item.quantity}
            onChangeText={(v) => setItem({ ...item, quantity: v })}
            keyboardType="decimal-pad"
          />
        </View>
        <View style={{ width: 80 }}>
          <Field
            label={t("Unit")}
            value={item.unit}
            onChangeText={(v) => setItem({ ...item, unit: v })}
          />
        </View>
        <View style={{ flex: 1 }}>
          <Field
            label={t("Rate ₹")}
            value={item.rateRupees}
            onChangeText={(v) => setItem({ ...item, rateRupees: v })}
            keyboardType="decimal-pad"
          />
        </View>
      </View>
      {error ? <InlineError message={error} /> : null}
      <PrimaryButton
        icon="add"
        label={t("Add item")}
        loading={add.isPending}
        onPress={() => void submit()}
      />
    </View>
  );
}

function FromQuotation({
  projectId,
  quotationId,
  projectName,
  onDone,
}: {
  projectId: string;
  quotationId: string;
  projectName: string;
  onDone: () => void;
}) {
  const { t } = useT();
  const convert = trpc.jp.billing.contract.fromQuotation.useMutation();
  const [key] = useState(createClientMutationId);
  const [retention, setRetention] = useState("5");
  const [tds, setTds] = useState("2");
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    setError(null);
    try {
      await convert.mutateAsync({
        projectId,
        quotationId,
        retentionPercent: retention,
        tdsPercent: tds,
        clientMutationId: key,
      });
      onDone();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Not saved.");
    }
  };
  return (
    <Card accent="accent">
      <Text style={styles.title}>
        {t("Use the accepted quotation as the contract for {project}?", { project: projectName })}
      </Text>
      <Text style={styles.meta}>
        {t(
          "Its items and rates become this project's contract items. GST comes from the quotation.",
        )}
      </Text>
      <View style={styles.row}>
        <View style={{ flex: 1 }}>
          <Field
            label={t("Retention %")}
            value={retention}
            onChangeText={setRetention}
            keyboardType="decimal-pad"
          />
        </View>
        <View style={{ flex: 1 }}>
          <Field label="TDS %" value={tds} onChangeText={setTds} keyboardType="decimal-pad" />
        </View>
      </View>
      {error ? <InlineError message={error} /> : null}
      <PrimaryButton
        icon="check"
        tone="gold"
        label={t("Create contract from quotation")}
        loading={convert.isPending}
        onPress={() => void submit()}
      />
    </Card>
  );
}
