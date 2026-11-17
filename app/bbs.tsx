import { useState } from "react";
import { Platform, ScrollView, Share, StyleSheet, Text, View } from "react-native";
import { AuthGate } from "@/components/jp/auth-gate";
import { DataTable } from "@/components/jp/charts";
import {
  AppHeader,
  Card,
  ChipGroup,
  Field,
  PrimaryButton,
  Screen,
  SecondaryButton,
  SectionHeader,
} from "@/components/jp/ui";
import { useColors } from "@/hooks/use-colors";
import { useT } from "@/lib/i18n";
import {
  BBS_DIAS,
  BBS_SHAPES,
  bbsCsv,
  bbsLine,
  bbsProblem,
  bbsTotals,
  type BbsRow,
  type BbsShape,
} from "@/lib/jp/bbs";

const START: BbsRow = {
  mark: "B1",
  member: "Beam",
  dia: 16,
  shape: "Straight",
  a: 6000,
  b: 0,
  bars: 4,
  members: 1,
};

/** Bar bending schedule: add bars by shape, see cutting length and weight, export CSV. */
export default function BbsScreen() {
  const { t } = useT();
  const colors = useColors();
  const [rows, setRows] = useState<BbsRow[]>([]);
  const [draft, setDraft] = useState<BbsRow>(START);
  const [text, setText] = useState({ a: "6000", b: "0", bars: "4", members: "1" });
  const [waste, setWaste] = useState("3");
  const candidate: BbsRow = {
    ...draft,
    a: Number(text.a) || 0,
    b: Number(text.b) || 0,
    bars: Number(text.bars) || 0,
    members: Number(text.members) || 0,
  };
  const problem = bbsProblem(candidate);
  const preview = problem ? null : bbsLine(candidate);
  const totals = bbsTotals(rows, Number(waste) || 0);
  const needsB = ["L-bar", "Crank (bent-up)", "Stirrup (rectangular)"].includes(draft.shape);
  const aLabel =
    draft.shape === "Stirrup (rectangular)"
      ? "Inner width A (mm)"
      : draft.shape === "Ring (circular tie)"
        ? "Inner diameter A (mm)"
        : draft.shape === "L-bar"
          ? "Leg 1 A (mm)"
          : "Length A (mm)";
  const bLabel =
    draft.shape === "Crank (bent-up)"
      ? "Crank height B (mm)"
      : draft.shape === "L-bar"
        ? "Leg 2 B (mm)"
        : "Inner depth B (mm)";

  const exportCsv = () => {
    const csv = bbsCsv(rows, Number(waste) || 0);
    if (Platform.OS === "web") {
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = `bbs-${new Date().toISOString().slice(0, 10)}.csv`;
      link.click();
    } else void Share.share({ message: csv });
  };

  return (
    <AuthGate>
      <Screen>
        <ScrollView
          contentContainerStyle={{ paddingBottom: 40, gap: 12 }}
          keyboardShouldPersistTaps="handled"
        >
          <AppHeader
            eyebrow={t("Steel")}
            title={t("Bar bending schedule (BBS)")}
            subtitle={t(
              "Bends: 45° = 1d, 90° = 2d, 135° = 3d; stirrup hooks 10d; weight d²/162 kg/m.",
            )}
          />
          <Card>
            <View style={styles.two}>
              <View style={{ flex: 1 }}>
                <Field
                  label="Bar mark"
                  value={draft.mark}
                  onChangeText={(mark) => setDraft({ ...draft, mark })}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Field
                  label="Member"
                  value={draft.member}
                  onChangeText={(member) => setDraft({ ...draft, member })}
                  placeholder="Beam B1, Column C2…"
                />
              </View>
            </View>
            <ChipGroup
              label={t("Diameter (mm)")}
              options={BBS_DIAS.map(String)}
              value={String(draft.dia)}
              onChange={(dia) => setDraft({ ...draft, dia: Number(dia) })}
            />
            <ChipGroup
              label={t("Shape")}
              options={BBS_SHAPES}
              value={draft.shape}
              onChange={(shape: BbsShape) => setDraft({ ...draft, shape })}
              format={(value) => t(value)}
            />
            <View style={styles.two}>
              <View style={{ flex: 1 }}>
                <Field
                  label={aLabel}
                  value={text.a}
                  onChangeText={(a) => setText({ ...text, a })}
                  keyboardType="number-pad"
                />
              </View>
              {needsB ? (
                <View style={{ flex: 1 }}>
                  <Field
                    label={bLabel}
                    value={text.b}
                    onChangeText={(b) => setText({ ...text, b })}
                    keyboardType="number-pad"
                  />
                </View>
              ) : null}
            </View>
            <View style={styles.two}>
              <View style={{ flex: 1 }}>
                <Field
                  label="Bars per member"
                  value={text.bars}
                  onChangeText={(bars) => setText({ ...text, bars })}
                  keyboardType="number-pad"
                />
              </View>
              <View style={{ flex: 1 }}>
                <Field
                  label="Number of members"
                  value={text.members}
                  onChangeText={(members) => setText({ ...text, members })}
                  keyboardType="number-pad"
                />
              </View>
            </View>
            {preview ? (
              <Text style={[styles.preview, { color: colors.foreground }]}>
                {t("Cutting length")}: {preview.cuttingMm} mm · {preview.totalBars} {t("bars")} ·{" "}
                {preview.kg.toFixed(2)} kg
              </Text>
            ) : (
              <Text style={{ color: colors.error }}>{t(problem!)}</Text>
            )}
            <PrimaryButton
              icon="add"
              label={t("Add to schedule")}
              disabled={!!problem}
              onPress={() => {
                setRows((all) => [...all, candidate]);
                const next = /^(\D*)(\d+)$/.exec(draft.mark);
                setDraft({
                  ...draft,
                  mark: next ? `${next[1]}${Number(next[2]) + 1}` : draft.mark,
                });
              }}
            />
          </Card>

          {rows.length ? (
            <>
              <SectionHeader
                title={t("Schedule")}
                caption={t("{count} bar marks", { count: rows.length })}
              />
              <Card>
                <DataTable
                  head={[t("Mark"), t("Dia"), t("Cut (mm)"), t("Bars"), "kg"]}
                  rows={totals.lines.map((line) => [
                    `${line.mark} ${line.member}`,
                    String(line.dia),
                    String(line.cuttingMm),
                    String(line.totalBars),
                    line.kg.toFixed(2),
                  ])}
                />
                <SecondaryButton
                  icon="undo"
                  label={t("Remove last")}
                  onPress={() => setRows((all) => all.slice(0, -1))}
                />
              </Card>
              <Card accent="info">
                <Field
                  label="Wastage (%)"
                  value={waste}
                  onChangeText={setWaste}
                  keyboardType="decimal-pad"
                />
                <DataTable
                  head={[t("Dia"), "kg", t("12 m bars")]}
                  rows={totals.byDia.map((row) => [
                    `${row.dia} mm`,
                    row.kg.toFixed(2),
                    String(row.bars12m),
                  ])}
                />
                <Text style={[styles.total, { color: colors.foreground }]}>
                  {t("Total steel")}: {totals.kg.toFixed(2)} kg · {t("with wastage")}{" "}
                  {totals.kgWithWaste.toFixed(2)} kg ({(totals.kgWithWaste / 1000).toFixed(3)} t)
                </Text>
              </Card>
              <PrimaryButton icon="download" label={t("Export CSV (Excel)")} onPress={exportCsv} />
            </>
          ) : null}
        </ScrollView>
      </Screen>
    </AuthGate>
  );
}

const styles = StyleSheet.create({
  two: { flexDirection: "row", gap: 10, flexWrap: "wrap" },
  preview: { fontSize: 14, fontWeight: "700", marginVertical: 6 },
  total: { fontSize: 15, fontWeight: "800", marginTop: 8 },
});
