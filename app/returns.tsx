import { useLocalSearchParams } from "expo-router";
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
import { formatMinorAsRupees } from "@/lib/jp/finance-domain";
import { createClientMutationId } from "@/lib/jp/local-repository";
import { RETURN_SETTLEMENTS, type ReturnSettlement } from "@/lib/jp/return-domain";
import { resolveSelectedId } from "@/lib/jp/selection";
import { trpc } from "@/lib/trpc";

const TONE: Record<string, Tone> = {
  Submitted: "warning",
  Approved: "info",
  Rejected: "error",
  Settled: "success",
  Cancelled: "info",
};
const today = () => new Date().toISOString().slice(0, 10);

/** Goods sent back to suppliers, approval, and refund / credit note / replacement. */
export default function ReturnsScreen() {
  const { t } = useT();
  const colors = useColors();
  const params = useLocalSearchParams<{ siteId?: string }>();
  const sites = trpc.jp.workspace.mySites.useQuery();
  const capabilities = trpc.jp.workspace.myCapabilities.useQuery();
  const [chosenSite, setSite] = useState(params.siteId ?? "");
  const siteId = resolveSelectedId(sites.data ?? [], chosenSite);
  const can = (key: string) =>
    (capabilities.data ?? []).some(
      (row) => row.siteId === siteId && (row as Record<string, unknown>)[key] === true,
    );
  const list = trpc.jp.purchaseReturns.list.useQuery(
    { siteId },
    { enabled: Boolean(siteId) && can("purchase.view") },
  );
  const review = trpc.jp.purchaseReturns.review.useMutation();
  const cancel = trpc.jp.purchaseReturns.cancel.useMutation();
  const [creating, setCreating] = useState(false);
  const [settling, setSettling] = useState<{ id: string; totalMinor: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = async (work: () => Promise<unknown>) => {
    setError(null);
    try {
      await work();
      await list.refetch();
    } catch (cause) {
      setError(cause instanceof Error ? t(cause.message) : t("Could not save."));
    }
  };
  return (
    <AuthGate>
      <Screen>
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 32 }}
        >
          <AppHeader
            eyebrow={t("Purchase")}
            title={t("Returns and refunds")}
            subtitle={t("Send damaged, wrong or extra goods back and record the refund or credit.")}
          />
          <View style={{ gap: 10 }}>
            <ChipGroup
              label={t("Site")}
              options={(sites.data ?? []).map((site) => site.id)}
              value={siteId || null}
              onChange={setSite}
              format={(id) => sites.data?.find((site) => site.id === id)?.name ?? id}
            />
            {siteId && !can("purchase.view") ? (
              <EmptyState
                icon="lock-outline"
                title={t("No access")}
                detail={t("Your role cannot see purchases on this site.")}
              />
            ) : (
              <>
                {can("purchase.create") ? (
                  <PrimaryButton
                    icon="assignment-return"
                    label={t("New return")}
                    onPress={() => setCreating(true)}
                  />
                ) : null}
                {error ? <InlineError message={error} onRetry={() => setError(null)} /> : null}
                {list.isLoading ? (
                  <LoadingBlock label={t("Loading…")} />
                ) : list.isError ? (
                  <InlineError
                    message={t(list.error.message)}
                    onRetry={() => void list.refetch()}
                  />
                ) : !list.data?.length ? (
                  <EmptyState
                    icon="assignment-return"
                    title={t("No returns yet")}
                    detail={t("Returns to suppliers appear here with their refund or credit.")}
                  />
                ) : (
                  list.data.map((row) => (
                    <Card key={row.id} accent={TONE[row.status]}>
                      <View style={styles.top}>
                        <Text style={[styles.title, { color: colors.foreground }]}>
                          {row.returnNumber}
                        </Text>
                        <StatusPill
                          compact
                          label={t(row.status)}
                          tone={TONE[row.status] ?? "info"}
                        />
                      </View>
                      <Text style={[styles.meta, { color: colors.muted }]}>
                        {row.vendorName} · {row.returnDate} · {formatMinorAsRupees(row.totalMinor)}
                      </Text>
                      <Text style={[styles.meta, { color: colors.foreground }]}>{row.reason}</Text>
                      {row.settlement ? (
                        <Text style={[styles.meta, { color: colors.success }]}>
                          {t(row.settlement)} · {formatMinorAsRupees(row.settledMinor ?? "0")}
                          {row.settlementReference ? ` · ${row.settlementReference}` : ""}
                        </Text>
                      ) : null}
                      {row.status === "Submitted" && can("purchase.approve") ? (
                        <View style={styles.actions}>
                          <PrimaryButton
                            icon="check"
                            label={t("Approve")}
                            onPress={() =>
                              void run(() =>
                                review.mutateAsync({ returnId: row.id, decision: "Approve" }),
                              )
                            }
                          />
                          <SecondaryButton
                            label={t("Reject")}
                            onPress={() =>
                              void run(() =>
                                review.mutateAsync({
                                  returnId: row.id,
                                  decision: "Reject",
                                  reason: "Supplier will not take it back",
                                }),
                              )
                            }
                          />
                        </View>
                      ) : null}
                      {row.status === "Approved" && can("purchase.create") ? (
                        <PrimaryButton
                          icon="payments"
                          label={t("Record refund or credit")}
                          onPress={() => setSettling({ id: row.id, totalMinor: row.totalMinor })}
                        />
                      ) : null}
                      {row.status === "Submitted" ? (
                        <SecondaryButton
                          label={t("Cancel return")}
                          onPress={() =>
                            void run(() =>
                              cancel.mutateAsync({ returnId: row.id, reason: "Made by mistake" }),
                            )
                          }
                        />
                      ) : null}
                    </Card>
                  ))
                )}
              </>
            )}
          </View>
        </ScrollView>
        {creating && siteId ? (
          <NewReturn
            siteId={siteId}
            onClose={() => setCreating(false)}
            onSaved={() => void list.refetch()}
          />
        ) : null}
        {settling ? (
          <Settle
            target={settling}
            onClose={() => setSettling(null)}
            onSaved={() => void list.refetch()}
          />
        ) : null}
      </Screen>
    </AuthGate>
  );
}

type Line = {
  materialItemId: string | null;
  description: string;
  unitCode: string;
  quantity: string;
  rateRupees: string;
};

function NewReturn({
  siteId,
  onClose,
  onSaved,
}: {
  siteId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useT();
  const colors = useColors();
  const vendors = trpc.jp.finance.listVendors.useQuery({ siteId });
  const stock = trpc.jp.inventory.list.useQuery({ siteId });
  const create = trpc.jp.purchaseReturns.create.useMutation();
  const [vendorId, setVendorId] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [returnDate, setDate] = useState(today());
  const [lines, setLines] = useState<Line[]>([
    { materialItemId: null, description: "", unitCode: "nos", quantity: "1", rateRupees: "" },
  ]);
  const [error, setError] = useState<string | null>(null);
  const items = stock.data?.catalogue ?? [];
  const setLine = (index: number, patch: Partial<Line>) =>
    setLines((all) => all.map((line, i) => (i === index ? { ...line, ...patch } : line)));
  const save = async () => {
    setError(null);
    try {
      await create.mutateAsync({
        siteId,
        vendorId: vendorId!,
        returnDate,
        reason,
        lines,
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
      title={t("New return")}
      onClose={onClose}
      footer={
        <PrimaryButton
          icon="send"
          label={create.isPending ? t("Saving…") : t("Send for approval")}
          disabled={
            create.isPending ||
            !vendorId ||
            reason.trim().length < 3 ||
            lines.some((line) => !line.description || !line.rateRupees)
          }
          onPress={() => void save()}
        />
      }
    >
      <ChipGroup
        label={t("Supplier")}
        options={(vendors.data?.rows ?? []).map((row: { id: string }) => row.id)}
        value={vendorId}
        onChange={setVendorId}
        format={(id) =>
          vendors.data?.rows.find((row: { id: string }) => row.id === id)?.legalName ?? id
        }
      />
      <Field label={t("Return date")} value={returnDate} onChangeText={setDate} />
      <Field
        label={t("Why is it going back?")}
        value={reason}
        onChangeText={setReason}
        placeholder={t("For example: 4 bags torn, wrong size of valve")}
        multiline
      />
      {lines.map((line, index) => (
        <Card key={index}>
          <Text style={[styles.title, { color: colors.foreground }]}>
            {t("Item {n}", { n: index + 1 })}
          </Text>
          {items.length ? (
            <ChipGroup
              label={t("Store item (optional)")}
              options={items.map((item: { id: string }) => item.id)}
              value={line.materialItemId}
              onChange={(id) => {
                const item = items.find((row: { id: string }) => row.id === id) as
                  | { name: string; baseUnitCode: string }
                  | undefined;
                setLine(index, {
                  materialItemId: id,
                  description: item?.name ?? line.description,
                  unitCode: item?.baseUnitCode ?? line.unitCode,
                });
              }}
              format={(id) =>
                (items.find((row: { id: string }) => row.id === id) as { name: string } | undefined)
                  ?.name ?? id
              }
            />
          ) : null}
          <Field
            label={t("Description")}
            value={line.description}
            onChangeText={(value) => setLine(index, { description: value })}
          />
          <Field
            label={t("Unit")}
            value={line.unitCode}
            onChangeText={(value) => setLine(index, { unitCode: value })}
          />
          <Field
            label={t("Quantity")}
            value={line.quantity}
            onChangeText={(value) => setLine(index, { quantity: value })}
            keyboardType="decimal-pad"
          />
          <Field
            label={t("Rate (₹)")}
            value={line.rateRupees}
            onChangeText={(value) => setLine(index, { rateRupees: value })}
            keyboardType="decimal-pad"
          />
        </Card>
      ))}
      <Pressable
        accessibilityRole="button"
        onPress={() =>
          setLines((all) => [
            ...all,
            {
              materialItemId: null,
              description: "",
              unitCode: "nos",
              quantity: "1",
              rateRupees: "",
            },
          ])
        }
      >
        <Text style={[styles.link, { color: colors.primary }]}>+ {t("Add another item")}</Text>
      </Pressable>
      {error ? <InlineError message={error} onRetry={() => setError(null)} /> : null}
    </Sheet>
  );
}

function Settle({
  target,
  onClose,
  onSaved,
}: {
  target: { id: string; totalMinor: string };
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useT();
  const settle = trpc.jp.purchaseReturns.settle.useMutation();
  const [settlement, setSettlement] = useState<ReturnSettlement>("Refund");
  const [amount, setAmount] = useState((Number(target.totalMinor) / 100).toFixed(2));
  const [reference, setReference] = useState("");
  const [settledOn, setSettledOn] = useState(today());
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    setError(null);
    try {
      await settle.mutateAsync({
        returnId: target.id,
        settlement,
        amountRupees: settlement === "Replacement" ? "0" : amount,
        reference: reference || undefined,
        settledOn,
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
      title={t("Record refund or credit")}
      onClose={onClose}
      footer={
        <PrimaryButton
          icon="save"
          label={settle.isPending ? t("Saving…") : t("Save")}
          disabled={settle.isPending}
          onPress={() => void save()}
        />
      }
    >
      <ChipGroup
        label={t("How did the supplier settle?")}
        options={RETURN_SETTLEMENTS}
        value={settlement}
        onChange={setSettlement}
        format={(value) => t(value)}
      />
      {settlement !== "Replacement" ? (
        <Field
          label={t("Amount (₹)")}
          value={amount}
          onChangeText={setAmount}
          keyboardType="decimal-pad"
        />
      ) : null}
      <Field
        label={t("Reference (UTR, credit note no.)")}
        value={reference}
        onChangeText={setReference}
      />
      <Field label={t("Date")} value={settledOn} onChangeText={setSettledOn} />
      {error ? <InlineError message={error} onRetry={() => setError(null)} /> : null}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  top: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 },
  title: { fontSize: 15, fontWeight: "800", flexShrink: 1 },
  meta: { fontSize: 12, lineHeight: 18, marginTop: 3 },
  actions: { gap: 6, marginTop: 8 },
  link: { fontSize: 14, fontWeight: "700", marginVertical: 8 },
});
