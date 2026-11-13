import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { AuthGate } from "@/components/jp/auth-gate";
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
  Sheet,
  StatusPill,
  type Tone,
} from "@/components/jp/ui";
import { useColors } from "@/hooks/use-colors";
import { useT } from "@/lib/i18n";
import { WARRANTY_CATEGORIES, endAfter, type WarrantyState } from "@/lib/jp/warranty-domain";
import { resolveSelectedId } from "@/lib/jp/selection";
import { createClientMutationId } from "@/lib/jp/local-repository";
import { trpc } from "@/lib/trpc";

type Filter = "All" | "Expiring" | "Expired" | "Active";
const STATE_TONE: Record<WarrantyState, Tone> = {
  Active: "success",
  Expiring: "warning",
  Expired: "error",
  Closed: "info",
};
const today = () => new Date().toISOString().slice(0, 10);

/** Warranty tracker: what is covered, until when, by whom; claims; expiring soon first. */
export default function WarrantiesScreen() {
  const { t } = useT();
  const colors = useColors();
  const list = trpc.jp.warranties.list.useQuery({});
  const [filter, setFilter] = useState<Filter>("All");
  const [adding, setAdding] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const rows = (list.data?.rows ?? []).filter((row) => filter === "All" || row.state === filter);
  const open = list.data?.rows.find((row) => row.id === openId) ?? null;

  return (
    <AuthGate>
      <Screen>
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 32 }}
        >
          <AppHeader
            eyebrow={t("Handover and after")}
            title={t("Warranties")}
            subtitle={t("What is covered, by whom and until when; claims in one place.")}
          />
          {list.isLoading ? (
            <LoadingBlock label={t("Loading…")} />
          ) : list.isError ? (
            <InlineError message={t(list.error.message)} onRetry={() => void list.refetch()} />
          ) : (
            <View style={{ gap: 10 }}>
              <View style={styles.counts}>
                {(
                  [
                    ["Active", list.data?.counts.active ?? 0, "success"],
                    ["Expiring", list.data?.counts.expiring ?? 0, "warning"],
                    ["Expired", list.data?.counts.expired ?? 0, "error"],
                  ] as const
                ).map(([label, count, tone]) => (
                  <Card key={label} style={{ flex: 1 }}>
                    <Text style={[styles.count, { color: colors.foreground }]}>{count}</Text>
                    <StatusPill compact label={t(label)} tone={tone} />
                  </Card>
                ))}
              </View>
              <ChipGroup
                options={["All", "Expiring", "Expired", "Active"] as const}
                value={filter}
                onChange={setFilter}
                format={(value) => t(value)}
              />
              <PrimaryButton icon="add" label={t("Add warranty")} onPress={() => setAdding(true)} />
              {rows.length === 0 ? (
                <EmptyState
                  icon="verified"
                  title={t("No warranties here")}
                  detail={t(
                    "Add the warranty cards of equipment, doors, pumps and your defect liability.",
                  )}
                />
              ) : (
                rows.map((row) => (
                  <Card
                    key={row.id}
                    onPress={() => setOpenId(row.id)}
                    accent={STATE_TONE[row.state]}
                  >
                    <View style={styles.rowTop}>
                      <Text style={[styles.title, { color: colors.foreground }]}>
                        {row.itemName}
                      </Text>
                      <StatusPill compact label={t(row.state)} tone={STATE_TONE[row.state]} />
                    </View>
                    <Text style={[styles.meta, { color: colors.muted }]}>
                      {t(row.direction === "Received" ? "From supplier" : "Given to client")} ·{" "}
                      {row.vendorName ?? row.partyName ?? "—"} · {row.siteName}
                    </Text>
                    <Text style={[styles.meta, { color: colors.foreground }]}>
                      {row.startDate} → {row.endDate} ·{" "}
                      {row.daysLeft >= 0
                        ? t("{days} days left", { days: row.daysLeft })
                        : t("ended {days} days ago", { days: -row.daysLeft })}
                      {row.openClaims
                        ? ` · ${t("{count} open claims", { count: row.openClaims })}`
                        : ""}
                    </Text>
                  </Card>
                ))
              )}
            </View>
          )}
        </ScrollView>
        {adding ? (
          <AddWarranty onClose={() => setAdding(false)} onSaved={() => void list.refetch()} />
        ) : null}
        {open ? (
          <WarrantyDetail
            warranty={open}
            onClose={() => setOpenId(null)}
            onChanged={() => void list.refetch()}
          />
        ) : null}
      </Screen>
    </AuthGate>
  );
}

function AddWarranty({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { t } = useT();
  const sites = trpc.jp.workspace.mySites.useQuery();
  const [chosenSite, setSite] = useState("");
  const siteId = resolveSelectedId(sites.data ?? [], chosenSite);
  const vendors = trpc.jp.finance.listVendors.useQuery(
    { siteId },
    { enabled: Boolean(siteId), retry: false },
  );
  const create = trpc.jp.warranties.create.useMutation();
  const [direction, setDirection] = useState<"Received" | "Given">("Received");
  const [category, setCategory] = useState<(typeof WARRANTY_CATEGORIES)[number]>("Equipment");
  const [itemName, setItemName] = useState("");
  const [vendorId, setVendorId] = useState<string | null>(null);
  const [partyName, setPartyName] = useState("");
  const [reference, setReference] = useState("");
  const [startDate, setStartDate] = useState(today());
  const [years, setYears] = useState<"1" | "2" | "5" | "10">("1");
  const [terms, setTerms] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState<string | null>(null);
  const endDate = /^\d{4}-\d{2}-\d{2}$/.test(startDate) ? endAfter(startDate, Number(years)) : "";
  const vendorRows = vendors.data?.rows ?? [];
  const save = async () => {
    setError(null);
    try {
      await create.mutateAsync({
        siteId,
        direction,
        itemName,
        category,
        vendorId: direction === "Received" ? vendorId : null,
        partyName: partyName || null,
        reference: reference || null,
        startDate,
        endDate,
        terms: terms || null,
        contactPhone: phone || null,
        clientMutationId: createClientMutationId(),
      });
      onSaved();
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? t(cause.message) : t("Could not save."));
    }
  };
  return (
    <Sheet
      visible
      title={t("Add warranty")}
      onClose={onClose}
      footer={
        <PrimaryButton
          icon="save"
          label={create.isPending ? t("Saving…") : t("Save")}
          disabled={create.isPending || !siteId || itemName.trim().length < 2 || !endDate}
          onPress={() => void save()}
        />
      }
    >
      <ChipGroup
        label={t("Site")}
        options={(sites.data ?? []).map((site) => site.id)}
        value={siteId || null}
        onChange={setSite}
        format={(id) => sites.data?.find((site) => site.id === id)?.name ?? id}
      />
      <ChipGroup
        label={t("Type")}
        options={["Received", "Given"] as const}
        value={direction}
        onChange={setDirection}
        format={(value) => t(value === "Received" ? "From supplier" : "Given to client")}
      />
      <ChipGroup
        label={t("Category")}
        options={WARRANTY_CATEGORIES}
        value={category}
        onChange={setCategory}
        format={(value) => t(value)}
      />
      <Field
        label={t("Item")}
        value={itemName}
        onChangeText={setItemName}
        placeholder={t("For example: submersible pump 1.5 HP")}
      />
      {direction === "Received" && vendorRows.length ? (
        <ChipGroup
          label={t("Supplier")}
          options={vendorRows.map((row: { id: string }) => row.id)}
          value={vendorId}
          onChange={setVendorId}
          format={(id) => vendorRows.find((row: { id: string }) => row.id === id)?.legalName ?? id}
        />
      ) : null}
      <Field
        label={t(direction === "Received" ? "Other party (optional)" : "Client")}
        value={partyName}
        onChangeText={setPartyName}
      />
      <Field label={t("Bill, serial or model")} value={reference} onChangeText={setReference} />
      <Field
        label={t("Start date")}
        value={startDate}
        onChangeText={setStartDate}
        placeholder="2026-11-14"
      />
      <ChipGroup
        label={t("Years")}
        options={["1", "2", "5", "10"] as const}
        value={years}
        onChange={setYears}
      />
      <Text style={{ marginBottom: 10 }}>{t("Ends on {date}", { date: endDate || "—" })}</Text>
      <Field label={t("What is covered")} value={terms} onChangeText={setTerms} multiline />
      <Field
        label={t("Service phone")}
        value={phone}
        onChangeText={setPhone}
        keyboardType="phone-pad"
      />
      {error ? <InlineError message={error} onRetry={() => setError(null)} /> : null}
    </Sheet>
  );
}

function WarrantyDetail({
  warranty,
  onClose,
  onChanged,
}: {
  warranty: {
    id: string;
    itemName: string;
    terms: string | null;
    contactPhone: string | null;
    status: string;
    endDate: string;
  };
  onClose: () => void;
  onChanged: () => void;
}) {
  const { t } = useT();
  const colors = useColors();
  const claims = trpc.jp.warranties.claims.useQuery({ warrantyId: warranty.id });
  const addClaim = trpc.jp.warranties.addClaim.useMutation();
  const resolve = trpc.jp.warranties.resolveClaim.useMutation();
  const close = trpc.jp.warranties.close.useMutation();
  const [problem, setProblem] = useState("");
  const [error, setError] = useState<string | null>(null);
  const run = async (work: () => Promise<unknown>) => {
    setError(null);
    try {
      await work();
      await claims.refetch();
      onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? t(cause.message) : t("Could not save."));
    }
  };
  return (
    <Sheet
      visible
      title={warranty.itemName}
      subtitle={t("Until {date}", { date: warranty.endDate })}
      onClose={onClose}
    >
      {warranty.terms ? (
        <Text style={[styles.meta, { color: colors.foreground }]}>{warranty.terms}</Text>
      ) : null}
      {warranty.contactPhone ? (
        <Text style={[styles.meta, { color: colors.primary }]}>📞 {warranty.contactPhone}</Text>
      ) : null}
      <Text style={[styles.section, { color: colors.foreground }]}>{t("Claims")}</Text>
      {(claims.data ?? []).length === 0 ? (
        <Text style={[styles.meta, { color: colors.muted }]}>{t("No claims yet.")}</Text>
      ) : (
        (claims.data ?? []).map((claim) => (
          <Card key={claim.id}>
            <Text style={[styles.meta, { color: colors.foreground }]}>
              {claim.claimDate} · {claim.problem}
            </Text>
            <StatusPill
              compact
              label={t(claim.status)}
              tone={
                claim.status === "Open"
                  ? "warning"
                  : claim.status === "Resolved"
                    ? "success"
                    : "error"
              }
            />
            {claim.resolution ? (
              <Text style={[styles.meta, { color: colors.muted }]}>{claim.resolution}</Text>
            ) : null}
            {claim.status === "Open" ? (
              <Pressable
                accessibilityRole="button"
                onPress={() =>
                  void run(() =>
                    resolve.mutateAsync({
                      claimId: claim.id,
                      status: "Resolved",
                      resolution: "Repaired or replaced by the supplier.",
                    }),
                  )
                }
              >
                <Text style={[styles.link, { color: colors.primary }]}>{t("Mark resolved")}</Text>
              </Pressable>
            ) : null}
          </Card>
        ))
      )}
      {warranty.status !== "Closed" ? (
        <>
          <Field
            label={t("New claim: what went wrong?")}
            value={problem}
            onChangeText={setProblem}
            multiline
          />
          <PrimaryButton
            icon="report-problem"
            label={t("Raise claim")}
            disabled={problem.trim().length < 3 || addClaim.isPending}
            onPress={() =>
              void run(async () => {
                await addClaim.mutateAsync({
                  warrantyId: warranty.id,
                  claimDate: today(),
                  problem,
                });
                setProblem("");
              })
            }
          />
          <SecondaryButton
            label={t("Close warranty")}
            onPress={() =>
              void run(() =>
                close.mutateAsync({ warrantyId: warranty.id, reason: "Closed by user" }),
              )
            }
          />
        </>
      ) : null}
      {error ? <InlineError message={error} onRetry={() => setError(null)} /> : null}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  counts: { flexDirection: "row", gap: 8 },
  count: { fontSize: 26, fontWeight: "900" },
  rowTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 },
  title: { fontSize: 15, fontWeight: "800", flexShrink: 1 },
  meta: { fontSize: 12, lineHeight: 18, marginTop: 3 },
  section: { fontSize: 14, fontWeight: "800", marginTop: 12, marginBottom: 6 },
  link: { fontSize: 13, fontWeight: "700", marginTop: 6 },
});
