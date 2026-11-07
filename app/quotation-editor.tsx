import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { AuthGate } from "@/components/jp/auth-gate";
import { TotalRow, commercialStyles as styles } from "@/components/jp/commercial-ui";
import {
  AppHeader,
  Card,
  Field,
  InlineError,
  PrimaryButton,
  Screen,
  SectionHeader,
} from "@/components/jp/ui";
import { useColors } from "@/hooks/use-colors";
import {
  lineAmountMinor,
  parsePercentBps,
  parseQuantity,
  quotationTotals,
} from "@/lib/jp/billing-domain";
import { formatMinorAsRupees, parseRupeesToMinor } from "@/lib/jp/finance-domain";
import { createClientMutationId } from "@/lib/jp/local-repository";
import { useT } from "@/lib/i18n";
import { trpc } from "@/lib/trpc";

type Line = {
  key: number;
  itemCode: string;
  description: string;
  unit: string;
  quantity: string;
  rateRupees: string;
};

function rateMinor(value: string) {
  try {
    return BigInt(parseRupeesToMinor(value));
  } catch {
    return null;
  }
}

/** A new quotation. The preview total is only a guide; the server computes the saved amounts. */
export default function QuotationEditorScreen() {
  const { t } = useT();
  const colors = useColors();
  const router = useRouter();
  const params = useLocalSearchParams<{ clientId?: string; leadId?: string }>();
  const clientId = typeof params.clientId === "string" ? params.clientId : "";
  const leadId = typeof params.leadId === "string" ? params.leadId : null;
  const utils = trpc.useUtils();
  const create = trpc.jp.crm.quotations.create.useMutation();
  const clients = trpc.jp.crm.clients.list.useQuery({ query: "" });
  const client = clients.data?.find((row) => row.id === clientId);
  const [key] = useState(createClientMutationId);
  const [title, setTitle] = useState("");
  const [quotationDate, setQuotationDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [validUntil, setValidUntil] = useState("");
  const [gst, setGst] = useState("18");
  const [terms, setTerms] = useState(
    "Rates are for the work described. Payment: running bills monthly, due in 30 days. Prices valid for 30 days.",
  );
  const [lines, setLines] = useState<Line[]>([
    { key: 1, itemCode: "1", description: "", unit: "cum", quantity: "", rateRupees: "" },
  ]);
  const [error, setError] = useState<string | null>(null);

  const update = (lineKey: number, change: Partial<Line>) =>
    setLines((prev) => prev.map((line) => (line.key === lineKey ? { ...line, ...change } : line)));
  const addLine = () =>
    setLines((prev) => [
      ...prev,
      {
        key: (prev.at(-1)?.key ?? 0) + 1,
        itemCode: String(prev.length + 1),
        description: "",
        unit: prev.at(-1)?.unit ?? "cum",
        quantity: "",
        rateRupees: "",
      },
    ]);

  const priced = lines.map((line) => ({
    quantity: parseQuantity(line.quantity),
    rate: rateMinor(line.rateRupees),
  }));
  const gstBps = parsePercentBps(gst);
  const ready = priced.every((line) => line.quantity !== null && line.rate !== null);
  const totals =
    ready && gstBps !== null
      ? quotationTotals(
          priced.map((line) => ({ quantityThousandths: line.quantity!, rateMinor: line.rate! })),
          gstBps,
        )
      : null;

  const save = async () => {
    setError(null);
    try {
      const result = await create.mutateAsync({
        clientId,
        leadId,
        title: title.trim(),
        quotationDate,
        validUntil: validUntil.trim() || null,
        gstPercent: gst,
        terms: terms.trim() || null,
        lines: lines.map(({ itemCode, description, unit, quantity, rateRupees }) => ({
          itemCode: itemCode.trim() || null,
          description: description.trim(),
          unit: unit.trim(),
          quantity,
          rateRupees,
        })),
        clientMutationId: key,
      });
      await Promise.all([
        utils.jp.crm.quotations.list.invalidate(),
        utils.jp.crm.leads.detail.invalidate(),
      ]);
      router.replace(`/quotation?id=${result.id}` as never);
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
            eyebrow={t("New quotation")}
            title={client?.name ?? t("Quotation")}
            subtitle={t("Item-wise rates with GST. The number and totals are set when you save.")}
          />
          {!clientId ? <InlineError message="Open this from a client or an enquiry." /> : null}
          <Card>
            <Field label={t("Title")} value={title} onChangeText={setTitle} />
            <Field
              label={t("Date (YYYY-MM-DD)")}
              value={quotationDate}
              onChangeText={setQuotationDate}
            />
            <Field
              label={t("Valid until (YYYY-MM-DD)")}
              value={validUntil}
              onChangeText={setValidUntil}
            />
            <Field
              label={t("GST %")}
              value={gst}
              onChangeText={setGst}
              keyboardType="decimal-pad"
            />
          </Card>

          <SectionHeader title={t("Items")} action={t("Add item")} onPress={addLine} />
          {lines.map((line, index) => {
            const amount =
              priced[index].quantity !== null && priced[index].rate !== null
                ? lineAmountMinor(priced[index].quantity!, priced[index].rate!)
                : null;
            return (
              <Card key={line.key}>
                <View style={styles.row}>
                  <Text style={[styles.title, { color: colors.foreground, flex: 1 }]}>
                    {t("Item {n}", { n: index + 1 })}
                  </Text>
                  {lines.length > 1 ? (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={t("Remove item {n}", { n: index + 1 })}
                      onPress={() => setLines((prev) => prev.filter((row) => row.key !== line.key))}
                      hitSlop={8}
                    >
                      <MaterialIcons name="delete-outline" size={22} color={colors.error} />
                    </Pressable>
                  ) : null}
                </View>
                <Field
                  label={t("Item code")}
                  value={line.itemCode}
                  onChangeText={(v) => update(line.key, { itemCode: v })}
                />
                <Field
                  label={t("Description")}
                  value={line.description}
                  onChangeText={(v) => update(line.key, { description: v })}
                  multiline
                />
                <View style={styles.row}>
                  <View style={{ flex: 1 }}>
                    <Field
                      label={t("Qty")}
                      value={line.quantity}
                      onChangeText={(v) => update(line.key, { quantity: v })}
                      keyboardType="decimal-pad"
                    />
                  </View>
                  <View style={{ width: 80 }}>
                    <Field
                      label={t("Unit")}
                      value={line.unit}
                      onChangeText={(v) => update(line.key, { unit: v })}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Field
                      label={t("Rate ₹")}
                      value={line.rateRupees}
                      onChangeText={(v) => update(line.key, { rateRupees: v })}
                      keyboardType="decimal-pad"
                    />
                  </View>
                </View>
                <Text style={[styles.meta, { color: colors.foreground, textAlign: "right" }]}>
                  {amount !== null ? formatMinorAsRupees(amount) : "—"}
                </Text>
              </Card>
            );
          })}

          <Card>
            <Field label={t("Terms")} value={terms} onChangeText={setTerms} multiline />
            {totals ? (
              <>
                <TotalRow label={t("Subtotal")} value={formatMinorAsRupees(totals.subtotalMinor)} />
                <TotalRow
                  label={`${t("GST")} ${gst}%`}
                  value={formatMinorAsRupees(totals.gstMinor)}
                />
                <TotalRow
                  label={t("Total")}
                  value={formatMinorAsRupees(totals.totalMinor)}
                  strong
                />
              </>
            ) : (
              <Text style={[styles.meta, { color: colors.muted }]}>
                {t("Fill quantity and rate on every item to see the total.")}
              </Text>
            )}
          </Card>
          {error ? <InlineError message={error} /> : null}
          <PrimaryButton
            icon="save"
            label={t("Save quotation")}
            loading={create.isPending}
            disabled={!clientId || title.trim().length < 3 || !totals}
            onPress={() => void save()}
          />
        </ScrollView>
      </Screen>
    </AuthGate>
  );
}
