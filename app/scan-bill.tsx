import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import * as ImagePicker from "expo-image-picker";
import { useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { Platform, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { AuthGate } from "@/components/jp/auth-gate";
import {
  AppHeader,
  Card,
  ChipGroup,
  EmptyState,
  Field,
  HeroCard,
  InlineError,
  LoadingBlock,
  PrimaryButton,
  Screen,
  SecondaryButton,
  SectionHeader,
} from "@/components/jp/ui";
import { useColors } from "@/hooks/use-colors";
import { useWorkspace } from "@/hooks/use-workspace";
import { compressPhoto, deliverTextFile } from "@/lib/device-files";
import { billToCsvRows, type BillDraft } from "@/lib/jp/ai-extraction";
import { buildCsv } from "@/lib/jp/csv";
import { createClientMutationId } from "@/lib/jp/local-repository";
import { resolveSelectedId } from "@/lib/jp/selection";
import { trpc } from "@/lib/trpc";

function similar(a: string, b: string) {
  const clean = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");
  const x = clean(a);
  const y = clean(b);
  return Boolean(x && y && (x.includes(y) || y.includes(x)));
}

export default function ScanBillScreen() {
  const colors = useColors();
  const router = useRouter();
  const { sitesWith } = useWorkspace();
  const sites = trpc.jp.workspace.mySites.useQuery();
  const status = trpc.jp.ai.status.useQuery();
  const siteOptions = (sites.data ?? []).filter(
    (site) => sitesWith("finance.invoice.create").includes(site.id) && site.status === "Active",
  );
  const [chosenSite, setChosenSite] = useState<string | null>(null);
  const siteId = resolveSelectedId(siteOptions, chosenSite);
  const scan = trpc.jp.ai.scanBill.useMutation();
  const createInvoice = trpc.jp.finance.createInvoice.useMutation();
  const vendors = trpc.jp.finance.listVendors.useQuery(
    { siteId, offset: 0, limit: 100 },
    { enabled: Boolean(siteId) },
  );
  const [bill, setBill] = useState<BillDraft | null>(null);
  const [vendorId, setVendorId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [mutationId, setMutationId] = useState(createClientMutationId);

  const vendorRows = useMemo(() => vendors.data?.rows ?? [], [vendors.data]);
  const matchedVendor =
    vendorId ??
    (bill
      ? vendorRows.find(
          (row) =>
            similar(row.legalName, bill.supplierName) ||
            similar(row.tradeName ?? "", bill.supplierName),
        )?.id
      : undefined) ??
    null;

  const pick = async (camera: boolean) => {
    setError(null);
    setSaved(false);
    try {
      if (camera) {
        const permission = await ImagePicker.requestCameraPermissionsAsync();
        if (!permission.granted) throw new Error("Camera permission was not given.");
      }
      const result = camera
        ? await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 0.95 })
        : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.95 });
      if (result.canceled || !result.assets[0]) return;
      const base64 = await compressPhoto(result.assets[0].uri, 2000);
      const draft = await scan.mutateAsync({ siteId, imageBase64: base64 });
      setBill(draft);
      setVendorId(null);
      setMutationId(createClientMutationId());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The bill could not be read.");
    }
  };

  const update = (patch: Partial<BillDraft>) =>
    setBill((current) => (current ? { ...current, ...patch } : current));
  const updateLine = (index: number, patch: Partial<BillDraft["lines"][number]>) =>
    setBill((current) =>
      current
        ? {
            ...current,
            lines: current.lines.map((line, i) => (i === index ? { ...line, ...patch } : line)),
          }
        : current,
    );

  const saveDraft = async () => {
    if (!bill || !matchedVendor) return;
    setError(null);
    try {
      await createInvoice.mutateAsync({
        siteId,
        vendorId: matchedVendor,
        invoiceNumber: bill.invoiceNumber,
        invoiceDate: bill.invoiceDate,
        dueDate: bill.dueDate || undefined,
        taxRupees: bill.taxRupees || "0",
        chargesRupees: bill.chargesRupees || "0",
        items: bill.lines.map((line) => ({
          description: line.description,
          quantity: line.quantity,
          unitCode: line.unitCode,
          lineTotalRupees: line.lineTotalRupees,
        })),
        action: "Draft",
        clientMutationId: mutationId,
      });
      setSaved(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The invoice draft was not saved.");
    }
  };

  const exportCsv = () =>
    bill
      ? deliverTextFile(
          `bill-${bill.invoiceNumber || "scan"}.csv`,
          buildCsv(
            { Source: "JP Infracon bill scan (check against the original)" },
            [],
            billToCsvRows(bill),
          ),
          "text/csv",
        )
      : undefined;

  const canSave =
    bill &&
    matchedVendor &&
    bill.invoiceNumber &&
    bill.invoiceDate &&
    bill.lines.length > 0 &&
    bill.lines.every((line) => line.quantity && line.lineTotalRupees);

  return (
    <AuthGate>
      <Screen>
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 40 }}
          keyboardShouldPersistTaps="handled"
        >
          <AppHeader
            eyebrow="AI assistant"
            title="Scan a bill"
            subtitle="Photograph a supplier bill. The AI reads supplier, items, tax and total — you check it, then save an invoice draft or download Excel/CSV."
          />
          {status.data && !status.data.billScan ? (
            <InlineError
              title="AI not set up yet"
              message="Ask the administrator to add a Gemini API key on the server."
            />
          ) : null}
          {sites.isSuccess && !siteOptions.length ? (
            <EmptyState
              icon="lock-outline"
              title="No invoice access"
              detail="Your role cannot record supplier bills on any active site."
            />
          ) : null}
          {siteOptions.length > 1 ? (
            <ChipGroup
              label="Site"
              options={siteOptions.map((site) => site.id)}
              value={siteId}
              onChange={setChosenSite}
              format={(id) => siteOptions.find((site) => site.id === id)?.name ?? id}
            />
          ) : null}
          {siteId ? (
            <HeroCard>
              <Text style={styles.heroKicker}>STEP 1 · CAPTURE</Text>
              <Text style={styles.heroTitle}>
                Lay the bill flat, in good light, whole page in frame.
              </Text>
              <View style={styles.heroButtons}>
                {Platform.OS !== "web" ? (
                  <View style={{ flex: 1 }}>
                    <PrimaryButton
                      icon="photo-camera"
                      tone="gold"
                      label="Camera"
                      loading={scan.isPending}
                      onPress={() => void pick(true)}
                    />
                  </View>
                ) : null}
                <View style={{ flex: 1 }}>
                  <PrimaryButton
                    icon="collections"
                    tone="gold"
                    label="Gallery"
                    loading={scan.isPending}
                    onPress={() => void pick(false)}
                  />
                </View>
              </View>
            </HeroCard>
          ) : null}
          {scan.isPending ? (
            <LoadingBlock label="Reading the bill… this takes a few seconds" />
          ) : null}
          {error ? <InlineError message={error} title="Not done" /> : null}

          {bill ? (
            <>
              <SectionHeader title="Step 2 · Check" caption="Correct anything the AI misread" />
              {bill.warnings.length ? (
                <Card accent="warning" style={{ marginBottom: 12 }}>
                  <View style={{ flex: 1, gap: 4 }}>
                    {bill.warnings.map((warning) => (
                      <Text key={warning} style={[styles.meta, { color: colors.foreground }]}>
                        • {warning}
                      </Text>
                    ))}
                  </View>
                </Card>
              ) : null}
              <Field
                label="Supplier (as printed)"
                value={bill.supplierName}
                onChangeText={(supplierName) => update({ supplierName })}
              />
              {bill.supplierGstin ? (
                <Text
                  style={[styles.meta, { color: colors.muted, marginTop: -8, marginBottom: 10 }]}
                >
                  GSTIN {bill.supplierGstin}
                </Text>
              ) : null}
              <ChipGroup
                label="Match to a supplier record"
                options={vendorRows.map((row) => row.id)}
                value={matchedVendor}
                onChange={setVendorId}
                format={(id) => vendorRows.find((row) => row.id === id)?.legalName ?? id}
              />
              {!vendorRows.length && vendors.isSuccess ? (
                <Text style={[styles.meta, { color: colors.warning, marginBottom: 10 }]}>
                  Add this supplier in Finance first to save an invoice draft.
                </Text>
              ) : null}
              <View style={styles.row}>
                <View style={{ flex: 1 }}>
                  <Field
                    label="Invoice no."
                    value={bill.invoiceNumber}
                    onChangeText={(invoiceNumber) => update({ invoiceNumber })}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Field
                    label="Invoice date"
                    value={bill.invoiceDate}
                    onChangeText={(invoiceDate) => update({ invoiceDate })}
                    placeholder="YYYY-MM-DD"
                  />
                </View>
              </View>
              <Card style={{ paddingVertical: 6, marginBottom: 12 }}>
                <View style={{ flex: 1 }}>
                  {bill.lines.map((line, index) => (
                    <View
                      key={index}
                      style={[
                        styles.line,
                        index > 0 && {
                          borderTopWidth: StyleSheet.hairlineWidth,
                          borderTopColor: colors.border,
                        },
                      ]}
                    >
                      <Text style={[styles.lineTitle, { color: colors.foreground }]}>
                        {line.description}
                      </Text>
                      <View style={styles.row}>
                        <TextInput
                          value={line.quantity}
                          onChangeText={(quantity) => updateLine(index, { quantity })}
                          keyboardType="decimal-pad"
                          accessibilityLabel={`Line ${index + 1} quantity`}
                          style={[
                            styles.cell,
                            {
                              color: colors.foreground,
                              borderColor: line.quantity ? colors.border : colors.error,
                            },
                          ]}
                        />
                        <TextInput
                          value={line.unitCode}
                          onChangeText={(unitCode) => updateLine(index, { unitCode })}
                          accessibilityLabel={`Line ${index + 1} unit`}
                          style={[
                            styles.cell,
                            { color: colors.foreground, borderColor: colors.border },
                          ]}
                        />
                        <TextInput
                          value={line.lineTotalRupees}
                          onChangeText={(lineTotalRupees) => updateLine(index, { lineTotalRupees })}
                          keyboardType="decimal-pad"
                          accessibilityLabel={`Line ${index + 1} amount`}
                          style={[
                            styles.cell,
                            styles.amount,
                            {
                              color: colors.foreground,
                              borderColor: line.lineTotalRupees ? colors.border : colors.error,
                            },
                          ]}
                        />
                      </View>
                    </View>
                  ))}
                </View>
              </Card>
              <View style={styles.row}>
                <View style={{ flex: 1 }}>
                  <Field
                    label="Tax ₹"
                    value={bill.taxRupees}
                    onChangeText={(taxRupees) => update({ taxRupees })}
                    keyboardType="decimal-pad"
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Field
                    label="Other charges ₹"
                    value={bill.chargesRupees}
                    onChangeText={(chargesRupees) => update({ chargesRupees })}
                    keyboardType="decimal-pad"
                  />
                </View>
              </View>
              <Text style={[styles.meta, { color: colors.muted, marginBottom: 14 }]}>
                Printed total ₹{bill.grandTotalRupees || "—"}
              </Text>
              <SectionHeader title="Step 3 · Use it" />
              {saved ? (
                <Card accent="success" style={{ marginBottom: 12 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.lineTitle, { color: colors.foreground }]}>
                      Invoice draft saved
                    </Text>
                    <Text style={[styles.meta, { color: colors.muted }]}>
                      Open Finance to attach the bill photo and submit it for review.
                    </Text>
                  </View>
                </Card>
              ) : null}
              <View style={{ gap: 10 }}>
                <PrimaryButton
                  icon="save"
                  label="Save as invoice draft"
                  disabled={!canSave || saved}
                  loading={createInvoice.isPending}
                  onPress={() => void saveDraft()}
                />
                <SecondaryButton
                  icon="table-view"
                  label="Download Excel / CSV"
                  onPress={() => void exportCsv()}
                />
                {saved ? (
                  <SecondaryButton
                    icon="receipt-long"
                    label="Open Finance"
                    onPress={() => router.push("/finance" as never)}
                  />
                ) : null}
              </View>
            </>
          ) : null}
          <View style={styles.noteRow}>
            <MaterialIcons name="auto-awesome" size={14} color={colors.accent} />
            <Text style={[styles.note, { color: colors.muted }]}>
              Powered by Google Gemini on the server. AI can misread — always compare with the paper
              bill. Nothing is saved until you press Save.
            </Text>
          </View>
        </ScrollView>
      </Screen>
    </AuthGate>
  );
}

const styles = StyleSheet.create({
  heroKicker: {
    color: "#D9B76A",
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1.4,
    marginTop: 6,
  },
  heroTitle: { color: "#FFFFFF", fontSize: 17, fontWeight: "800", marginTop: 8, lineHeight: 23 },
  heroButtons: { flexDirection: "row", gap: 10, marginTop: 16 },
  meta: { fontSize: 12, lineHeight: 17 },
  row: { flexDirection: "row", gap: 10 },
  line: { paddingVertical: 10, gap: 8 },
  lineTitle: { fontSize: 14, fontWeight: "800" },
  cell: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 14,
    minWidth: 70,
    flex: 1,
  },
  amount: { flex: 1.4 },
  noteRow: { flexDirection: "row", gap: 6, alignItems: "flex-start", marginTop: 16 },
  note: { fontSize: 11, lineHeight: 16, flex: 1 },
});
