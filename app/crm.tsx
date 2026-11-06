import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { HelpButton } from "@/components/jp/help";
import { useRouter } from "expo-router";
import { useState } from "react";
import { RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { AuthGate } from "@/components/jp/auth-gate";
import {
  AppHeader,
  Card,
  ChipGroup,
  EmptyState,
  Field,
  InlineError,
  isAccessDenied,
  LoadingBlock,
  NoAccess,
  PrimaryButton,
  Screen,
  StatusPill,
} from "@/components/jp/ui";
import { QUOTE_TONE, STAGE_TONE, commercialStyles } from "@/components/jp/commercial-ui";
import { useColors } from "@/hooks/use-colors";
import { CLIENT_TYPES, LEAD_SOURCES, type LeadStage } from "@/lib/jp/billing-domain";
import { formatMinorAsRupees } from "@/lib/jp/finance-domain";
import { createClientMutationId } from "@/lib/jp/local-repository";
import { useT } from "@/lib/i18n";
import { trpc } from "@/lib/trpc";

const TABS = ["Pipeline", "Clients", "Quotations"] as const;
type Tab = (typeof TABS)[number];

/** Clients, enquiries (leads) and quotations for the company. */
export default function CrmScreen() {
  const { t } = useT();
  const colors = useColors();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("Pipeline");
  const [stage, setStage] = useState<LeadStage | "All" | "Due">("All");
  const [query, setQuery] = useState("");
  const [form, setForm] = useState<"lead" | "client" | null>(null);
  const lookups = trpc.jp.crm.lookups.useQuery();
  const leads = trpc.jp.crm.leads.list.useQuery(
    {
      stage: stage === "All" || stage === "Due" ? null : stage,
      dueOnly: stage === "Due",
    },
    { enabled: tab === "Pipeline" },
  );
  const clients = trpc.jp.crm.clients.list.useQuery(
    { query: query.trim() },
    { placeholderData: (previous) => previous },
  );
  const quotes = trpc.jp.crm.quotations.list.useQuery({}, { enabled: tab === "Quotations" });
  const canManage = lookups.data?.canManage ?? false;
  const error = lookups.error ?? leads.error ?? clients.error ?? quotes.error;

  const refresh = () =>
    Promise.all([lookups.refetch(), leads.refetch(), clients.refetch(), quotes.refetch()]);

  if (isAccessDenied(error))
    return (
      <AuthGate>
        <Screen>
          <ScrollView contentContainerStyle={styles.content}>
            <AppHeader
              right={<HelpButton topicKey="crm" />}
              eyebrow={t("Business")}
              title={t("Clients & leads")}
            />
            <NoAccess area={t("Clients & leads")} message={error?.message} />
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
              refreshing={leads.isRefetching || clients.isRefetching}
              onRefresh={() => void refresh()}
              tintColor={colors.primary}
            />
          }
        >
          <AppHeader
            right={<HelpButton topicKey="crm" />}
            eyebrow={t("Business")}
            title={t("Clients & leads")}
            subtitle={t("Enquiries, follow-ups, quotations and clients in one place.")}
          />
          {error ? <InlineError message={error.message} onRetry={() => void refresh()} /> : null}
          <ChipGroup options={TABS} value={tab} onChange={setTab} format={(v) => t(v)} />

          {tab === "Pipeline" ? (
            <>
              {leads.data ? (
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  <View style={styles.pipeline}>
                    {leads.data.pipeline
                      .filter((row) => row.stage !== "Lost")
                      .map((row) => (
                        <View
                          key={row.stage}
                          style={[
                            styles.stageBox,
                            { borderColor: colors.border, backgroundColor: colors.surface },
                          ]}
                        >
                          <Text style={[styles.stageCount, { color: colors.foreground }]}>
                            {row.count}
                          </Text>
                          <Text style={[styles.meta, { color: colors.muted }]}>{t(row.stage)}</Text>
                          <Text style={[styles.meta, { color: colors.foreground }]}>
                            {formatMinorAsRupees(row.valueMinor).replace(/\.00$/, "")}
                          </Text>
                        </View>
                      ))}
                  </View>
                </ScrollView>
              ) : null}
              <ChipGroup
                options={["All", "Due", ...(lookups.data?.stages ?? [])] as const}
                value={stage}
                onChange={(value) => setStage(value as typeof stage)}
                format={(v) =>
                  v === "Due" ? `${t("Follow-up due")} · ${leads.data?.due ?? 0}` : t(v)
                }
              />
              {canManage ? (
                form === "lead" ? (
                  <LeadForm
                    clients={clients.data ?? []}
                    onDone={(id) => {
                      setForm(null);
                      if (id) router.push(`/lead?id=${id}` as never);
                    }}
                  />
                ) : (
                  <PrimaryButton
                    icon="add"
                    label={t("New enquiry")}
                    onPress={() => setForm("lead")}
                  />
                )
              ) : null}
              {leads.isLoading ? (
                <LoadingBlock label="Loading enquiries…" />
              ) : (leads.data?.leads.length ?? 0) === 0 ? (
                <EmptyState
                  icon="trending-up"
                  title="No enquiries here"
                  detail="Add every new enquiry, tender or referral so nothing is forgotten."
                />
              ) : (
                leads.data?.leads.map((lead) => (
                  <Card
                    key={lead.id}
                    accent={STAGE_TONE[lead.stage as LeadStage] ?? "info"}
                    onPress={() => router.push(`/lead?id=${lead.id}` as never)}
                    accessibilityLabel={`Open ${lead.title}`}
                  >
                    <View style={styles.row}>
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.title, { color: colors.foreground }]}>
                          {lead.title}
                        </Text>
                        <Text style={[styles.meta, { color: colors.muted }]}>
                          {[lead.clientName ?? lead.contactName, t(lead.source), lead.ownerName]
                            .filter(Boolean)
                            .join(" · ")}
                        </Text>
                      </View>
                      <StatusPill
                        label={t(lead.stage)}
                        tone={STAGE_TONE[lead.stage as LeadStage] ?? "info"}
                        compact
                      />
                    </View>
                    <View style={[styles.row, { marginTop: 8 }]}>
                      <Text style={[styles.money, { color: colors.foreground }]}>
                        {lead.estimatedValueMinor
                          ? formatMinorAsRupees(lead.estimatedValueMinor)
                          : "—"}
                      </Text>
                      {lead.nextFollowUpOn ? (
                        <View style={styles.row}>
                          <MaterialIcons
                            name="event"
                            size={14}
                            color={lead.followUpDue ? colors.error : colors.muted}
                          />
                          <Text
                            style={[
                              styles.meta,
                              {
                                marginTop: 0,
                                color: lead.followUpDue ? colors.error : colors.muted,
                                fontWeight: lead.followUpDue ? "800" : "400",
                              },
                            ]}
                          >
                            {lead.followUpDue ? t("Follow up now") : String(lead.nextFollowUpOn)}
                          </Text>
                        </View>
                      ) : null}
                    </View>
                  </Card>
                ))
              )}
            </>
          ) : null}

          {tab === "Clients" ? (
            <>
              <View
                style={[
                  styles.search,
                  { borderColor: colors.border, backgroundColor: colors.surface },
                ]}
              >
                <MaterialIcons name="search" size={20} color={colors.muted} />
                <TextInput
                  value={query}
                  onChangeText={setQuery}
                  placeholder={t("Client name or phone")}
                  placeholderTextColor={colors.muted}
                  accessibilityLabel={t("Search clients")}
                  style={[styles.searchInput, { color: colors.foreground }]}
                />
              </View>
              {canManage ? (
                form === "client" ? (
                  <ClientForm onDone={() => setForm(null)} />
                ) : (
                  <PrimaryButton
                    icon="person-add"
                    label={t("New client")}
                    onPress={() => setForm("client")}
                  />
                )
              ) : null}
              {(clients.data?.length ?? 0) === 0 ? (
                <EmptyState
                  icon="business"
                  title="No clients yet"
                  detail="Clients you quote or bill appear here."
                />
              ) : (
                clients.data?.map((client) => (
                  <Card key={client.id}>
                    <View style={styles.row}>
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.title, { color: colors.foreground }]}>
                          {client.name}
                        </Text>
                        <Text style={[styles.meta, { color: colors.muted }]}>
                          {[t(client.clientType), client.contactPerson, client.phone, client.gstin]
                            .filter(Boolean)
                            .join(" · ")}
                        </Text>
                      </View>
                      <StatusPill
                        label={t(client.status)}
                        tone={client.status === "Active" ? "success" : "warning"}
                        compact
                      />
                    </View>
                    {canManage ? (
                      <Text
                        accessibilityRole="link"
                        onPress={() =>
                          router.push(`/quotation-editor?clientId=${client.id}` as never)
                        }
                        style={[styles.link, { color: colors.primary }]}
                      >
                        {t("New quotation")} →
                      </Text>
                    ) : null}
                  </Card>
                ))
              )}
            </>
          ) : null}

          {tab === "Quotations" ? (
            quotes.isLoading ? (
              <LoadingBlock label="Loading quotations…" />
            ) : (quotes.data?.length ?? 0) === 0 ? (
              <EmptyState
                icon="request-quote"
                title="No quotations yet"
                detail="Make a quotation from a client or an enquiry."
              />
            ) : (
              quotes.data?.map((quote) => (
                <Card
                  key={quote.id}
                  onPress={() => router.push(`/quotation?id=${quote.id}` as never)}
                  accessibilityLabel={`Open ${quote.quotationNumber}`}
                >
                  <View style={styles.row}>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.title, { color: colors.foreground }]}>
                        {quote.quotationNumber} · {quote.title}
                      </Text>
                      <Text style={[styles.meta, { color: colors.muted }]}>
                        {quote.clientName} · {String(quote.quotationDate)}
                      </Text>
                    </View>
                    <StatusPill
                      label={t(quote.status)}
                      tone={QUOTE_TONE[quote.status] ?? "info"}
                      compact
                    />
                  </View>
                  <Text style={[styles.money, { color: colors.foreground, marginTop: 8 }]}>
                    {formatMinorAsRupees(quote.totalMinor)}
                  </Text>
                </Card>
              ))
            )
          ) : null}
        </ScrollView>
      </Screen>
    </AuthGate>
  );
}

function ClientForm({ onDone }: { onDone: () => void }) {
  const { t } = useT();
  const utils = trpc.useUtils();
  const create = trpc.jp.crm.clients.create.useMutation();
  const [key] = useState(createClientMutationId);
  const [name, setName] = useState("");
  const [clientType, setClientType] = useState<(typeof CLIENT_TYPES)[number]>("Private company");
  const [contactPerson, setContactPerson] = useState("");
  const [phone, setPhone] = useState("");
  const [gstin, setGstin] = useState("");
  const [address, setAddress] = useState("");
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    setError(null);
    try {
      await create.mutateAsync({
        name: name.trim(),
        clientType,
        contactPerson: contactPerson.trim() || null,
        phone: phone.trim() || null,
        gstin: gstin.trim() || null,
        address: address.trim() || null,
        clientMutationId: key,
      });
      await utils.jp.crm.clients.list.invalidate();
      onDone();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Not saved.");
    }
  };
  return (
    <Card>
      <Field label={t("Client name")} value={name} onChangeText={setName} />
      <ChipGroup
        label={t("Type")}
        options={CLIENT_TYPES}
        value={clientType}
        onChange={setClientType}
        format={(v) => t(v)}
      />
      <Field label={t("Contact person")} value={contactPerson} onChangeText={setContactPerson} />
      <Field label={t("Mobile")} value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
      <Field
        label={t("GSTIN (optional)")}
        value={gstin}
        onChangeText={setGstin}
        autoCapitalize="characters"
        maxLength={15}
      />
      <Field label={t("Address")} value={address} onChangeText={setAddress} multiline />
      {error ? <InlineError message={error} /> : null}
      <PrimaryButton
        icon="save"
        label={t("Save client")}
        loading={create.isPending}
        disabled={name.trim().length < 2}
        onPress={() => void save()}
      />
      <Text accessibilityRole="button" onPress={onDone} style={styles.cancel}>
        {t("Cancel")}
      </Text>
    </Card>
  );
}

function LeadForm({
  clients,
  onDone,
}: {
  clients: { id: string; name: string }[];
  onDone: (id: string | null) => void;
}) {
  const { t } = useT();
  const utils = trpc.useUtils();
  const create = trpc.jp.crm.leads.create.useMutation();
  const [key] = useState(createClientMutationId);
  const [title, setTitle] = useState("");
  const [clientId, setClientId] = useState<string | null>(null);
  const [contactName, setContactName] = useState("");
  const [phone, setPhone] = useState("");
  const [location, setLocation] = useState("");
  const [source, setSource] = useState<(typeof LEAD_SOURCES)[number]>("Referral");
  const [value, setValue] = useState("");
  const [followUp, setFollowUp] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    setError(null);
    try {
      const result = await create.mutateAsync({
        title: title.trim(),
        clientId,
        contactName: contactName.trim() || null,
        phone: phone.trim() || null,
        location: location.trim() || null,
        source,
        estimatedValueRupees: value.trim() || null,
        nextFollowUpOn: followUp.trim() || null,
        note: note.trim() || null,
        clientMutationId: key,
      });
      await utils.jp.crm.leads.list.invalidate();
      onDone(result.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Not saved.");
    }
  };
  return (
    <Card>
      <Field
        label={t("What is the work?")}
        value={title}
        onChangeText={setTitle}
        placeholder="G+3 residential building, Patia"
      />
      {clients.length ? (
        <ChipGroup
          label={t("Client (optional)")}
          options={["", ...clients.map((c) => c.id)]}
          value={clientId ?? ""}
          onChange={(v) => setClientId(v || null)}
          format={(v) => (v ? (clients.find((c) => c.id === v)?.name ?? v) : t("New / not yet"))}
        />
      ) : null}
      {!clientId ? (
        <>
          <Field label={t("Contact name")} value={contactName} onChangeText={setContactName} />
          <Field
            label={t("Mobile")}
            value={phone}
            onChangeText={setPhone}
            keyboardType="phone-pad"
          />
        </>
      ) : null}
      <Field label={t("Location")} value={location} onChangeText={setLocation} />
      <ChipGroup
        label={t("Source")}
        options={LEAD_SOURCES}
        value={source}
        onChange={setSource}
        format={(v) => t(v)}
      />
      <Field
        label={t("Estimated value (₹)")}
        value={value}
        onChangeText={setValue}
        keyboardType="decimal-pad"
      />
      <Field
        label={t("Next follow-up (YYYY-MM-DD)")}
        value={followUp}
        onChangeText={setFollowUp}
        placeholder="2026-11-10"
      />
      <Field label={t("Notes")} value={note} onChangeText={setNote} multiline />
      {error ? <InlineError message={error} /> : null}
      <PrimaryButton
        icon="save"
        label={t("Save enquiry")}
        loading={create.isPending}
        disabled={title.trim().length < 3}
        onPress={() => void save()}
      />
      <Text accessibilityRole="button" onPress={() => onDone(null)} style={styles.cancel}>
        {t("Cancel")}
      </Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  ...commercialStyles,
  pipeline: { flexDirection: "row", gap: 8, paddingVertical: 2 },
  stageBox: { borderWidth: 1, borderRadius: 14, padding: 10, minWidth: 104 },
  stageCount: { fontSize: 22, fontWeight: "800" },
  search: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 14,
    height: 50,
  },
  searchInput: { flex: 1, fontSize: 15 },
});
