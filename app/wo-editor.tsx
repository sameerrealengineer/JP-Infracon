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
import { lineAmountMinor, parseQuantity } from "@/lib/jp/billing-domain";
import { formatMinorAsRupees, parseRupeesToMinor } from "@/lib/jp/finance-domain";
import { createClientMutationId } from "@/lib/jp/local-repository";
import { useT } from "@/lib/i18n";
import { trpc } from "@/lib/trpc";

type Item = {
  key: number;
  itemCode: string;
  description: string;
  unit: string;
  quantity: string;
  rateRupees: string;
};

function money(value: string) {
  try {
    return BigInt(parseRupeesToMinor(value));
  } catch {
    return null;
  }
}

/** A new work order for a subcontractor: items with quantity and rate, terms, advance. */
export default function WorkOrderEditorScreen() {
  const { t } = useT();
  const colors = useColors();
  const router = useRouter();
  const params = useLocalSearchParams<{ siteId?: string }>();
  const siteId = typeof params.siteId === "string" ? params.siteId : "";
  const utils = trpc.useUtils();
  const options = trpc.jp.subcontract.options.useQuery({ siteId }, { enabled: Boolean(siteId) });
  const create = trpc.jp.subcontract.create.useMutation();
  const [key] = useState(createClientMutationId);
  const [vendorId, setVendorId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [scope, setScope] = useState("");
  const [startDate, setStartDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [endDate, setEndDate] = useState("");
  const [gst, setGst] = useState("18");
  const [retention, setRetention] = useState("5");
  const [tds, setTds] = useState("1");
  const [advance, setAdvance] = useState("");
  const [recovery, setRecovery] = useState("");
  const [items, setItems] = useState<Item[]>([
    { key: 1, itemCode: "1", description: "", unit: "cum", quantity: "", rateRupees: "" },
  ]);
  const [error, setError] = useState<string | null>(null);

  const update = (itemKey: number, change: Partial<Item>) =>
    setItems((prev) => prev.map((item) => (item.key === itemKey ? { ...item, ...change } : item)));
  const nextKey = () => Math.max(0, ...items.map((item) => item.key)) + 1;

  const amounts = items.map((item) => {
    const quantity = parseQuantity(item.quantity);
    const rate = money(item.rateRupees);
    return quantity !== null && rate !== null ? lineAmountMinor(quantity, rate) : null;
  });
  const ready = amounts.every((amount) => amount !== null);
  const value = ready ? amounts.reduce<bigint>((sum, amount) => sum + amount!, 0n) : null;

  const save = async () => {
    if (!vendorId) return;
    setError(null);
    try {
      const result = await create.mutateAsync({
        siteId,
        vendorId,
        title: title.trim(),
        scope: scope.trim() || null,
        startDate,
        endDate: endDate.trim() || null,
        gstPercent: gst,
        retentionPercent: retention,
        tdsPercent: tds,
        advanceRupees: advance.trim() || null,
        advanceRecoveryPercent: recovery.trim() || null,
        items: items.map(({ itemCode, description, unit, quantity, rateRupees }) => ({
          itemCode: itemCode.trim() || null,
          description: description.trim(),
          unit: unit.trim(),
          quantity,
          rateRupees,
        })),
        clientMutationId: key,
      });
      await utils.jp.subcontract.list.invalidate();
      router.replace(`/work-order?siteId=${siteId}&id=${result.id}` as never);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Not saved.");
    }
  };

  const data = options.data;
  return (
    <AuthGate>
      <Screen>
        <ScrollView
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.content}
        >
          <AppHeader
            eyebrow={t("New work order")}
            title={t("Work order")}
            subtitle={t("Saved as a draft; submit it for approval from the work order page.")}
          />
          {options.isLoading ? (
            <LoadingBlock />
          ) : !data ? (
            <InlineError message={options.error?.message ?? "Not available."} />
          ) : data.length === 0 ? (
            <EmptyState
              icon="engineering"
              title="No subcontractors yet"
              detail="Add the firm in Finance → Suppliers with type Subcontractor first."
            />
          ) : (
            <>
              <Card>
                <ChipGroup
                  label={t("Subcontractor")}
                  options={data.map((v) => v.id)}
                  value={vendorId}
                  onChange={setVendorId}
                  format={(id) => data.find((v) => v.id === id)?.name ?? id}
                />
                <Field
                  label={t("Work")}
                  value={title}
                  onChangeText={setTitle}
                  placeholder={t("Brickwork and plaster, Block 1")}
                />
                <Field
                  label={t("Scope and terms")}
                  value={scope}
                  onChangeText={setScope}
                  multiline
                  placeholder={t("Labour only; materials by JP Infracon")}
                />
                <View style={styles.row}>
                  <View style={{ flex: 1 }}>
                    <Field label={t("Start")} value={startDate} onChangeText={setStartDate} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Field
                      label={t("Finish by")}
                      value={endDate}
                      onChangeText={setEndDate}
                      placeholder="YYYY-MM-DD"
                    />
                  </View>
                </View>
                <View style={styles.row}>
                  <View style={{ flex: 1 }}>
                    <Field
                      label="GST %"
                      value={gst}
                      onChangeText={setGst}
                      keyboardType="decimal-pad"
                    />
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
                    <Field
                      label="TDS %"
                      value={tds}
                      onChangeText={setTds}
                      keyboardType="decimal-pad"
                    />
                  </View>
                </View>
                <View style={styles.row}>
                  <View style={{ flex: 1 }}>
                    <Field
                      label={t("Advance ₹ (optional)")}
                      value={advance}
                      onChangeText={setAdvance}
                      keyboardType="decimal-pad"
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Field
                      label={t("Recover % per bill")}
                      value={recovery}
                      onChangeText={setRecovery}
                      keyboardType="decimal-pad"
                    />
                  </View>
                </View>
              </Card>

              <SectionHeader
                title={t("Items (subcontractor BOQ)")}
                action={t("Add item")}
                onPress={() =>
                  setItems((prev) => [
                    ...prev,
                    {
                      key: nextKey(),
                      itemCode: String(prev.length + 1),
                      description: "",
                      unit: prev.at(-1)?.unit ?? "sqm",
                      quantity: "",
                      rateRupees: "",
                    },
                  ])
                }
              />
              {items.map((item, index) => (
                <Card key={item.key}>
                  <View style={styles.row}>
                    <Text style={[styles.title, { color: colors.foreground, flex: 1 }]}>
                      {t("Item {n}", { n: index + 1 })}
                    </Text>
                    {amounts[index] !== null ? (
                      <Text style={[styles.meta, { color: colors.foreground, fontWeight: "700" }]}>
                        {formatMinorAsRupees(amounts[index]!)}
                      </Text>
                    ) : null}
                    {items.length > 1 ? (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={t("Remove item {n}", { n: index + 1 })}
                        onPress={() =>
                          setItems((prev) => prev.filter((row) => row.key !== item.key))
                        }
                        hitSlop={8}
                      >
                        <MaterialIcons name="delete-outline" size={22} color={colors.error} />
                      </Pressable>
                    ) : null}
                  </View>
                  <View style={styles.row}>
                    <View style={{ width: 70 }}>
                      <Field
                        label={t("Code")}
                        value={item.itemCode}
                        onChangeText={(v) => update(item.key, { itemCode: v })}
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Field
                        label={t("Description")}
                        value={item.description}
                        onChangeText={(v) => update(item.key, { description: v })}
                      />
                    </View>
                  </View>
                  <View style={styles.row}>
                    <View style={{ flex: 1 }}>
                      <Field
                        label={t("Qty")}
                        value={item.quantity}
                        onChangeText={(v) => update(item.key, { quantity: v })}
                        keyboardType="decimal-pad"
                      />
                    </View>
                    <View style={{ width: 70 }}>
                      <Field
                        label={t("Unit")}
                        value={item.unit}
                        onChangeText={(v) => update(item.key, { unit: v })}
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Field
                        label={t("Rate ₹")}
                        value={item.rateRupees}
                        onChangeText={(v) => update(item.key, { rateRupees: v })}
                        keyboardType="decimal-pad"
                      />
                    </View>
                  </View>
                </Card>
              ))}

              <Card>
                {value !== null ? (
                  <TotalRow
                    label={t("Work order value (before GST)")}
                    value={formatMinorAsRupees(value)}
                    strong
                  />
                ) : (
                  <Text style={[styles.meta, { color: colors.muted }]}>
                    {t("Fill quantity and rate on every item to see the value.")}
                  </Text>
                )}
              </Card>
              {error ? <InlineError message={error} /> : null}
              <PrimaryButton
                icon="save"
                label={t("Save work order")}
                loading={create.isPending}
                disabled={
                  !vendorId ||
                  value === null ||
                  title.trim().length < 3 ||
                  items.some((item) => item.description.trim().length < 2)
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
