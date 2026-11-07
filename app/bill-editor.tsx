import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { AuthGate } from "@/components/jp/auth-gate";
import { TotalRow, commercialStyles as styles } from "@/components/jp/commercial-ui";
import {
  AppHeader,
  Card,
  EmptyState,
  Field,
  InlineError,
  LoadingBlock,
  PrimaryButton,
  Screen,
  SectionHeader,
} from "@/components/jp/ui";
import { useColors } from "@/hooks/use-colors";
import { billTotals, formatPercent, formatQuantity, parseQuantity } from "@/lib/jp/billing-domain";
import { formatMinorAsRupees, parseRupeesToMinor } from "@/lib/jp/finance-domain";
import { createClientMutationId } from "@/lib/jp/local-repository";
import { useT } from "@/lib/i18n";
import { trpc } from "@/lib/trpc";

/**
 * A new running-account bill: quantity done this period per contract item. The preview uses
 * the same rules as the server, which checks the contract balance and computes the saved totals.
 */
export default function BillEditorScreen() {
  const { t } = useT();
  const colors = useColors();
  const router = useRouter();
  const params = useLocalSearchParams<{ projectId?: string }>();
  const projectId = typeof params.projectId === "string" ? params.projectId : "";
  const utils = trpc.useUtils();
  const contract = trpc.jp.billing.contract.get.useQuery(
    { projectId },
    { enabled: Boolean(projectId) },
  );
  const create = trpc.jp.billing.bills.create.useMutation();
  const [key] = useState(createClientMutationId);
  const [billDate, setBillDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [periodFrom, setPeriodFrom] = useState("");
  const [periodTo, setPeriodTo] = useState("");
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [other, setOther] = useState("0");
  const [otherNote, setOtherNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const data = contract.data;

  const entered = (data?.items ?? [])
    .map((item) => ({ item, raw: quantities[item.id]?.trim() ?? "" }))
    .filter((row) => row.raw);
  const parsed = entered.map((row) => ({ ...row, quantity: parseQuantity(row.raw) }));
  const invalid = parsed.filter(
    (row) => row.quantity === null || row.quantity > BigInt(row.item.balanceThousandths),
  );
  let otherMinor: bigint | null = 0n;
  try {
    otherMinor = BigInt(parseRupeesToMinor(other.trim() || "0", true));
  } catch {
    otherMinor = null;
  }
  const preview =
    data?.contract && parsed.length && !invalid.length && otherMinor !== null
      ? billTotals({
          lines: parsed.map((row) => ({
            quantityThousandths: row.quantity!,
            rateMinor: BigInt(row.item.rateMinor),
          })),
          gstBps: data.contract.gstBps,
          retentionBps: data.contract.retentionBps,
          tdsBps: data.contract.tdsBps,
          otherDeductionMinor: otherMinor,
        })
      : null;

  const save = async () => {
    setError(null);
    try {
      const result = await create.mutateAsync({
        projectId,
        billDate,
        periodFrom: periodFrom.trim() || null,
        periodTo: periodTo.trim() || null,
        lines: entered.map((row) => ({ contractItemId: row.item.id, quantity: row.raw })),
        otherDeductionRupees: other.trim() || "0",
        otherDeductionNote: otherNote.trim() || null,
        clientMutationId: key,
      });
      await utils.jp.billing.invalidate();
      router.replace(`/bill?id=${result.id}` as never);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Not saved.");
    }
  };

  return (
    <AuthGate>
      <Screen>
        <ScrollView
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.content}
        >
          <AppHeader
            eyebrow={t("New RA bill")}
            title={data?.project.name ?? t("Running bill")}
            subtitle={
              data?.contract
                ? `${data.contract.clientName} · GST ${formatPercent(data.contract.gstBps)} · ${t("retention")} ${formatPercent(data.contract.retentionBps)} · TDS ${formatPercent(data.contract.tdsBps)}`
                : undefined
            }
          />
          {contract.isLoading ? (
            <LoadingBlock />
          ) : !data?.contract ? (
            <EmptyState
              icon="description"
              title="No contract"
              detail="Set up the client contract for this project in Client billing first."
            />
          ) : (
            <>
              <Card>
                <Field
                  label={t("Bill date (YYYY-MM-DD)")}
                  value={billDate}
                  onChangeText={setBillDate}
                />
                <View style={styles.row}>
                  <View style={{ flex: 1 }}>
                    <Field label={t("Work from")} value={periodFrom} onChangeText={setPeriodFrom} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Field label={t("Work to")} value={periodTo} onChangeText={setPeriodTo} />
                  </View>
                </View>
              </Card>
              <SectionHeader
                title={t("Quantity done this bill")}
                caption={t("Leave blank for items not billed now")}
              />
              {data.items.map((item) => {
                const raw = quantities[item.id] ?? "";
                const quantity = raw.trim() ? parseQuantity(raw) : null;
                const over = quantity !== null && quantity > BigInt(item.balanceThousandths);
                return (
                  <Card key={item.id}>
                    <Text style={[styles.title, { color: colors.foreground, fontSize: 14 }]}>
                      {item.itemCode} · {item.description}
                    </Text>
                    <Text style={[styles.meta, { color: colors.muted }]}>
                      {t("Balance {left} of {total} {unit}", {
                        left: formatQuantity(item.balanceThousandths),
                        total: formatQuantity(item.contractQuantityThousandths),
                        unit: item.unit,
                      })}{" "}
                      · {formatMinorAsRupees(item.rateMinor)}/{item.unit}
                    </Text>
                    <Field
                      label={`${t("Qty")} (${item.unit})`}
                      value={raw}
                      onChangeText={(v) => setQuantities((prev) => ({ ...prev, [item.id]: v }))}
                      keyboardType="decimal-pad"
                      error={
                        raw.trim() && quantity === null
                          ? t("Enter a number above 0, up to 3 decimals.")
                          : over
                            ? t("More than the contract balance.")
                            : null
                      }
                    />
                  </Card>
                );
              })}
              <Card>
                <Field
                  label={t("Other deduction ₹ (water, electricity, penalty)")}
                  value={other}
                  onChangeText={setOther}
                  keyboardType="decimal-pad"
                />
                <Field label={t("Deduction note")} value={otherNote} onChangeText={setOtherNote} />
                {preview ? (
                  <>
                    <TotalRow
                      label={t("Work value")}
                      value={formatMinorAsRupees(preview.workValueMinor)}
                    />
                    <TotalRow label={t("GST")} value={formatMinorAsRupees(preview.gstMinor)} />
                    <TotalRow
                      label={t("Retention")}
                      value={`− ${formatMinorAsRupees(preview.retentionMinor)}`}
                    />
                    <TotalRow label="TDS" value={`− ${formatMinorAsRupees(preview.tdsMinor)}`} />
                    <TotalRow
                      label={t("Other deduction")}
                      value={`− ${formatMinorAsRupees(preview.otherDeductionMinor)}`}
                    />
                    <TotalRow
                      label={t("Net receivable")}
                      value={formatMinorAsRupees(preview.netReceivableMinor)}
                      strong
                    />
                  </>
                ) : (
                  <Text style={[styles.meta, { color: colors.muted }]}>
                    {t("Enter quantities to see the bill.")}
                  </Text>
                )}
              </Card>
              {error ? <InlineError message={error} /> : null}
              <PrimaryButton
                icon="save"
                label={t("Save draft bill")}
                loading={create.isPending}
                disabled={!preview}
                onPress={() => void save()}
              />
              <Text style={[styles.meta, { color: colors.muted, textAlign: "center" }]}>
                {t("Saved as a draft. Submit it from the bill page for approval.")}
              </Text>
            </>
          )}
        </ScrollView>
      </Screen>
    </AuthGate>
  );
}
