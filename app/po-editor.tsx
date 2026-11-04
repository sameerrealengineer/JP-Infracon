import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { AuthGate } from "@/components/jp/auth-gate";
import { TotalRow, commercialStyles as styles } from "@/components/jp/commercial-ui";
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
  SectionHeader,
} from "@/components/jp/ui";
import { useColors } from "@/hooks/use-colors";
import { parsePercentBps, parseQuantity } from "@/lib/jp/billing-domain";
import { formatMinorAsRupees, parseRupeesToMinor } from "@/lib/jp/finance-domain";
import { createClientMutationId } from "@/lib/jp/local-repository";
import { poTotals } from "@/lib/jp/purchase-domain";
import { useT } from "@/lib/i18n";
import { trpc } from "@/lib/trpc";

type Line = {
  key: number;
  materialItemId: string | null;
  description: string;
  unitCode: string;
  quantity: string;
  rateRupees: string;
  gstPercent: string;
};
type Quote = { key: number; vendorName: string; totalRupees: string; deliveryDays: string };

/** Exact paise to "1234.50" (no floating point). */
function minorToRupeeText(minor: bigint) {
  return `${minor / 100n}.${(minor % 100n).toString().padStart(2, "0")}`;
}

function money(value: string) {
  try {
    return BigInt(parseRupeesToMinor(value));
  } catch {
    return null;
  }
}

/** A new purchase order: supplier, items (from a material request or the catalogue), quotes. */
export default function PoEditorScreen() {
  const { t } = useT();
  const colors = useColors();
  const router = useRouter();
  const params = useLocalSearchParams<{ siteId?: string }>();
  const siteId = typeof params.siteId === "string" ? params.siteId : "";
  const utils = trpc.useUtils();
  const options = trpc.jp.purchase.options.useQuery({ siteId }, { enabled: Boolean(siteId) });
  const create = trpc.jp.purchase.create.useMutation();
  const [key] = useState(createClientMutationId);
  const [vendorId, setVendorId] = useState<string | null>(null);
  const [requestId, setRequestId] = useState<string | null>(null);
  const [orderDate, setOrderDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [expectedDate, setExpectedDate] = useState("");
  const [terms, setTerms] = useState(
    "Delivery at site. Payment 30 days after bill and goods receipt.",
  );
  const [lines, setLines] = useState<Line[]>([
    {
      key: 1,
      materialItemId: null,
      description: "",
      unitCode: "bag",
      quantity: "",
      rateRupees: "",
      gstPercent: "18",
    },
  ]);
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [error, setError] = useState<string | null>(null);
  const data = options.data;

  const update = (lineKey: number, change: Partial<Line>) =>
    setLines((prev) => prev.map((line) => (line.key === lineKey ? { ...line, ...change } : line)));
  const nextKey = () => Math.max(0, ...lines.map((line) => line.key)) + 1;

  const applyRequest = (id: string) => {
    setRequestId(id);
    const request = data?.requests.find((row) => row.id === id);
    if (!request) return;
    setLines(
      request.items.map((item, index) => ({
        key: index + 1,
        materialItemId: item.materialItemId,
        description: item.name,
        unitCode: item.unitCode,
        quantity: item.quantity.replace(/\.?0+$/, ""),
        rateRupees: "",
        gstPercent: "18",
      })),
    );
  };

  const parsed = lines.map((line) => ({
    quantity: parseQuantity(line.quantity),
    rate: money(line.rateRupees),
    gst: parsePercentBps(line.gstPercent),
  }));
  const ready = parsed.every(
    (line) => line.quantity !== null && line.rate !== null && line.gst !== null,
  );
  const totals = ready
    ? poTotals(
        parsed.map((line) => ({
          quantityThousandths: line.quantity!,
          rateMinor: line.rate!,
          gstBps: line.gst!,
        })),
      )
    : null;

  const save = async () => {
    if (!vendorId) return;
    setError(null);
    try {
      const vendorName = data?.vendors.find((v) => v.id === vendorId)?.name ?? "";
      const result = await create.mutateAsync({
        siteId,
        vendorId,
        materialRequestId: requestId,
        orderDate,
        expectedDate: expectedDate.trim() || null,
        terms: terms.trim() || null,
        lines: lines.map(
          ({ materialItemId, description, unitCode, quantity, rateRupees, gstPercent }) => ({
            materialItemId,
            description: description.trim(),
            unitCode: unitCode.trim(),
            quantity,
            rateRupees,
            gstPercent,
          }),
        ),
        quotes: [
          ...(totals && quotes.length
            ? [{ vendorId, vendorName, totalRupees: minorToRupeeText(totals.totalMinor) }]
            : []),
          ...quotes
            .filter((quote) => quote.vendorName.trim() && quote.totalRupees.trim())
            .map((quote) => ({
              vendorName: quote.vendorName.trim(),
              totalRupees: quote.totalRupees.trim(),
              deliveryDays: quote.deliveryDays ? Number(quote.deliveryDays) : null,
            })),
        ],
        clientMutationId: key,
      });
      await utils.jp.purchase.list.invalidate();
      router.replace(`/po?siteId=${siteId}&id=${result.id}` as never);
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
            eyebrow={t("New purchase order")}
            title={t("Purchase order")}
            subtitle={t("Saved as a draft; submit it for approval from the order page.")}
          />
          {options.isLoading ? (
            <LoadingBlock />
          ) : !data ? (
            <InlineError message={options.error?.message ?? "Not available."} />
          ) : data.vendors.length === 0 ? (
            <EmptyState
              icon="store"
              title="No suppliers yet"
              detail="Add the supplier in Finance → Suppliers first."
            />
          ) : (
            <>
              <Card>
                <ChipGroup
                  label={t("Supplier")}
                  options={data.vendors.map((v) => v.id)}
                  value={vendorId}
                  onChange={setVendorId}
                  format={(id) => data.vendors.find((v) => v.id === id)?.name ?? id}
                />
                {data.requests.length ? (
                  <ChipGroup
                    label={t("From approved material request (optional)")}
                    options={data.requests.map((r) => r.id)}
                    value={requestId}
                    onChange={applyRequest}
                    format={(id) => {
                      const request = data.requests.find((r) => r.id === id);
                      return (
                        request?.purpose?.slice(0, 40) || String(request?.at ?? id).slice(0, 10)
                      );
                    }}
                  />
                ) : null}
                <View style={styles.row}>
                  <View style={{ flex: 1 }}>
                    <Field label={t("Order date")} value={orderDate} onChangeText={setOrderDate} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Field
                      label={t("Delivery by")}
                      value={expectedDate}
                      onChangeText={setExpectedDate}
                      placeholder="YYYY-MM-DD"
                    />
                  </View>
                </View>
              </Card>

              <SectionHeader
                title={t("Items")}
                action={t("Add item")}
                onPress={() =>
                  setLines((prev) => [
                    ...prev,
                    {
                      key: nextKey(),
                      materialItemId: null,
                      description: "",
                      unitCode: prev.at(-1)?.unitCode ?? "nos",
                      quantity: "",
                      rateRupees: "",
                      gstPercent: "18",
                    },
                  ])
                }
              />
              {lines.map((line, index) => (
                <Card key={line.key}>
                  <View style={styles.row}>
                    <Text style={[styles.title, { color: colors.foreground, flex: 1 }]}>
                      {t("Item {n}", { n: index + 1 })}
                    </Text>
                    {lines.length > 1 ? (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={t("Remove item {n}", { n: index + 1 })}
                        onPress={() =>
                          setLines((prev) => prev.filter((row) => row.key !== line.key))
                        }
                        hitSlop={8}
                      >
                        <MaterialIcons name="delete-outline" size={22} color={colors.error} />
                      </Pressable>
                    ) : null}
                  </View>
                  {data.items.length ? (
                    <ChipGroup
                      label={t("Catalogue item (adds to stock on receipt)")}
                      options={["", ...data.items.map((item) => item.id)]}
                      value={line.materialItemId ?? ""}
                      onChange={(id) => {
                        const item = data.items.find((row) => row.id === id);
                        update(line.key, {
                          materialItemId: id || null,
                          ...(item ? { description: item.name, unitCode: item.unitCode } : {}),
                        });
                      }}
                      format={(id) =>
                        id
                          ? (data.items.find((row) => row.id === id)?.name ?? id)
                          : t("Not in catalogue")
                      }
                    />
                  ) : null}
                  <Field
                    label={t("Description")}
                    value={line.description}
                    onChangeText={(v) => update(line.key, { description: v })}
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
                    <View style={{ width: 70 }}>
                      <Field
                        label={t("Unit")}
                        value={line.unitCode}
                        onChangeText={(v) => update(line.key, { unitCode: v })}
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
                    <View style={{ width: 64 }}>
                      <Field
                        label="GST %"
                        value={line.gstPercent}
                        onChangeText={(v) => update(line.key, { gstPercent: v })}
                        keyboardType="decimal-pad"
                      />
                    </View>
                  </View>
                </Card>
              ))}

              <SectionHeader
                title={t("Other quotes (compare)")}
                caption={t("Record what other suppliers quoted, so the approver can compare.")}
                action={quotes.length < 4 ? t("Add quote") : undefined}
                onPress={() =>
                  setQuotes((prev) => [
                    ...prev,
                    { key: Date.now(), vendorName: "", totalRupees: "", deliveryDays: "" },
                  ])
                }
              />
              {quotes.map((quote) => (
                <Card key={quote.key}>
                  <Field
                    label={t("Supplier name")}
                    value={quote.vendorName}
                    onChangeText={(v) =>
                      setQuotes((prev) =>
                        prev.map((q) => (q.key === quote.key ? { ...q, vendorName: v } : q)),
                      )
                    }
                  />
                  <View style={styles.row}>
                    <View style={{ flex: 1 }}>
                      <Field
                        label={t("Their total ₹ (with GST)")}
                        value={quote.totalRupees}
                        keyboardType="decimal-pad"
                        onChangeText={(v) =>
                          setQuotes((prev) =>
                            prev.map((q) => (q.key === quote.key ? { ...q, totalRupees: v } : q)),
                          )
                        }
                      />
                    </View>
                    <View style={{ width: 110 }}>
                      <Field
                        label={t("Delivery days")}
                        value={quote.deliveryDays}
                        keyboardType="number-pad"
                        onChangeText={(v) =>
                          setQuotes((prev) =>
                            prev.map((q) => (q.key === quote.key ? { ...q, deliveryDays: v } : q)),
                          )
                        }
                      />
                    </View>
                  </View>
                </Card>
              ))}

              <Card>
                <Field label={t("Terms")} value={terms} onChangeText={setTerms} multiline />
                {totals ? (
                  <>
                    <TotalRow
                      label={t("Subtotal")}
                      value={formatMinorAsRupees(totals.subtotalMinor)}
                    />
                    <TotalRow label="GST" value={formatMinorAsRupees(totals.gstMinor)} />
                    <TotalRow
                      label={t("Total")}
                      value={formatMinorAsRupees(totals.totalMinor)}
                      strong
                    />
                  </>
                ) : (
                  <Text style={[styles.meta, { color: colors.muted }]}>
                    {t("Fill quantity, rate and GST on every item to see the total.")}
                  </Text>
                )}
              </Card>
              {error ? <InlineError message={error} /> : null}
              <PrimaryButton
                icon="save"
                label={t("Save purchase order")}
                loading={create.isPending}
                disabled={
                  !vendorId || !totals || lines.some((line) => line.description.trim().length < 2)
                }
                onPress={() => void save()}
              />
            </>
          )}
        </ScrollView>
      </Screen>
    </AuthGate>
  );
}
