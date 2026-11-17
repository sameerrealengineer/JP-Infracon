import { useState } from "react";
import { ScrollView, Share, StyleSheet, Text, View } from "react-native";
import { AuthGate } from "@/components/jp/auth-gate";
import { DataTable } from "@/components/jp/charts";
import {
  AppHeader,
  Card,
  Field,
  PrimaryButton,
  Screen,
  SecondaryButton,
  SectionHeader,
} from "@/components/jp/ui";
import { useColors } from "@/hooks/use-colors";
import { useT } from "@/lib/i18n";
import { formatMinorAsRupees } from "@/lib/jp/finance-domain";
import { analyseRate, estimateAbstract, type EstimateItem } from "@/lib/jp/rate-analysis";

const BLANK: EstimateItem = {
  description: "RCC M20 in slab",
  unit: "m³",
  quantity: "10",
  rate: { material: "5200", labour: "1500", plant: "300", waterPct: "1", overheadProfitPct: "15" },
};

/** Rate analysis per item (CPWD / SOR style) and the estimate abstract. */
export default function RateAnalysisScreen() {
  const { t } = useT();
  const colors = useColors();
  const [draft, setDraft] = useState<EstimateItem>(BLANK);
  const [items, setItems] = useState<EstimateItem[]>([]);
  const [contingency, setContingency] = useState("3");
  const [gst, setGst] = useState("18");
  let preview: ReturnType<typeof analyseRate> | null = null;
  let previewError: string | null = null;
  try {
    preview = analyseRate(draft.rate);
  } catch (error) {
    previewError = error instanceof Error ? error.message : "Check the values.";
  }
  let abstract: ReturnType<typeof estimateAbstract> | null = null;
  let abstractError: string | null = null;
  try {
    abstract = items.length ? estimateAbstract(items, contingency, gst) : null;
  } catch (error) {
    abstractError = error instanceof Error ? error.message : "Check the values.";
  }
  const setRate = (key: keyof EstimateItem["rate"], value: string) =>
    setDraft({ ...draft, rate: { ...draft.rate, [key]: value } });
  const share = () => {
    if (!abstract) return;
    void Share.share({
      message: [
        t("Estimate abstract — JP Infracon"),
        ...abstract.lines.map(
          (line, i) =>
            `${i + 1}. ${line.description}: ${line.quantity} ${line.unit} × ${formatMinorAsRupees(line.analysis.rate)} = ${formatMinorAsRupees(line.amount)}`,
        ),
        `${t("Sub-total")}: ${formatMinorAsRupees(abstract.subtotal)}`,
        `${t("Contingency")} ${contingency}%: ${formatMinorAsRupees(abstract.contingency)}`,
        `GST ${gst}%: ${formatMinorAsRupees(abstract.gst)}`,
        `${t("Total")}: ${formatMinorAsRupees(abstract.total)}`,
      ].join("\n"),
    });
  };
  return (
    <AuthGate>
      <Screen>
        <ScrollView
          contentContainerStyle={{ paddingBottom: 40, gap: 12 }}
          keyboardShouldPersistTaps="handled"
        >
          <AppHeader
            eyebrow={t("Estimate & bills")}
            title={t("Rate analysis & estimate")}
            subtitle={t(
              "Rate = material + labour + tools & plant, + water charges, + overhead & profit. Use your SOR / DSR figures.",
            )}
          />
          <Card>
            <Field
              label="Item description"
              value={draft.description}
              onChangeText={(description) => setDraft({ ...draft, description })}
            />
            <View style={styles.two}>
              <View style={{ flex: 1 }}>
                <Field
                  label="Unit"
                  value={draft.unit}
                  onChangeText={(unit) => setDraft({ ...draft, unit })}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Field
                  label="Quantity"
                  value={draft.quantity}
                  onChangeText={(quantity) => setDraft({ ...draft, quantity })}
                  keyboardType="decimal-pad"
                />
              </View>
            </View>
            <Text style={[styles.sub, { color: colors.muted }]}>{t("Cost for one unit (₹)")}</Text>
            <View style={styles.two}>
              <View style={{ flex: 1 }}>
                <Field
                  label="Material"
                  value={draft.rate.material}
                  onChangeText={(v) => setRate("material", v)}
                  keyboardType="decimal-pad"
                />
              </View>
              <View style={{ flex: 1 }}>
                <Field
                  label="Labour"
                  value={draft.rate.labour}
                  onChangeText={(v) => setRate("labour", v)}
                  keyboardType="decimal-pad"
                />
              </View>
              <View style={{ flex: 1 }}>
                <Field
                  label="Tools & plant"
                  value={draft.rate.plant}
                  onChangeText={(v) => setRate("plant", v)}
                  keyboardType="decimal-pad"
                />
              </View>
            </View>
            <View style={styles.two}>
              <View style={{ flex: 1 }}>
                <Field
                  label="Water charges (%)"
                  value={draft.rate.waterPct}
                  onChangeText={(v) => setRate("waterPct", v)}
                  keyboardType="decimal-pad"
                />
              </View>
              <View style={{ flex: 1 }}>
                <Field
                  label="Overhead & profit (%)"
                  value={draft.rate.overheadProfitPct}
                  onChangeText={(v) => setRate("overheadProfitPct", v)}
                  keyboardType="decimal-pad"
                />
              </View>
            </View>
            {preview ? (
              <DataTable
                head={[t("Rate build-up"), "₹"]}
                rows={[
                  [t("Material + labour + plant"), formatMinorAsRupees(preview.base)],
                  [t("Water charges"), formatMinorAsRupees(preview.water)],
                  [t("Overhead & profit"), formatMinorAsRupees(preview.overhead)],
                  [`${t("Rate per")} ${draft.unit}`, formatMinorAsRupees(preview.rate)],
                ]}
              />
            ) : (
              <Text style={{ color: colors.error }}>{previewError ? t(previewError) : ""}</Text>
            )}
            <PrimaryButton
              icon="add"
              label={t("Add item to estimate")}
              disabled={!preview || !draft.description.trim()}
              onPress={() => setItems((all) => [...all, draft])}
            />
          </Card>
          {items.length ? (
            <>
              <SectionHeader
                title={t("Abstract of cost")}
                caption={t("{count} items", { count: items.length })}
              />
              <Card accent="info">
                {abstract ? (
                  <>
                    <DataTable
                      head={[t("Item"), t("Qty"), t("Rate"), t("Amount")]}
                      rows={abstract.lines.map((line) => [
                        line.description,
                        `${line.quantity} ${line.unit}`,
                        formatMinorAsRupees(line.analysis.rate),
                        formatMinorAsRupees(line.amount),
                      ])}
                    />
                    <View style={styles.two}>
                      <View style={{ flex: 1 }}>
                        <Field
                          label="Contingency (%)"
                          value={contingency}
                          onChangeText={setContingency}
                          keyboardType="decimal-pad"
                        />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Field
                          label="GST (%)"
                          value={gst}
                          onChangeText={setGst}
                          keyboardType="decimal-pad"
                        />
                      </View>
                    </View>
                    <DataTable
                      head={["", "₹"]}
                      rows={[
                        [t("Sub-total"), formatMinorAsRupees(abstract.subtotal)],
                        [t("Contingency"), formatMinorAsRupees(abstract.contingency)],
                        ["GST", formatMinorAsRupees(abstract.gst)],
                        [t("Total estimate"), formatMinorAsRupees(abstract.total)],
                      ]}
                    />
                  </>
                ) : (
                  <Text style={{ color: colors.error }}>
                    {abstractError ? t(abstractError) : ""}
                  </Text>
                )}
              </Card>
              <View style={styles.two}>
                <View style={{ flex: 1 }}>
                  <SecondaryButton
                    icon="undo"
                    label={t("Remove last")}
                    onPress={() => setItems((all) => all.slice(0, -1))}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <SecondaryButton icon="share" label={t("Share estimate")} onPress={share} />
                </View>
              </View>
            </>
          ) : null}
        </ScrollView>
      </Screen>
    </AuthGate>
  );
}

const styles = StyleSheet.create({
  two: { flexDirection: "row", gap: 10, flexWrap: "wrap" },
  sub: { fontSize: 12, fontWeight: "700", marginTop: 4 },
});
