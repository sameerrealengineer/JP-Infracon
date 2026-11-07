import { StyleSheet, Text, View } from "react-native";

import { Card } from "@/components/jp/ui";
import { useColors } from "@/hooks/use-colors";
import type { LabourSummary } from "@/lib/jp/dlr-domain";

/** The day's attendance by trade, as recorded in Attendance (the DLR's source of truth). */
export function LabourSummaryCard({ summary }: { summary: LabourSummary }) {
  const colors = useColors();
  const { totals } = summary;
  if (totals.marked === 0)
    return (
      <Card accent="warning">
        <Text style={[styles.title, { color: colors.foreground }]}>No attendance marked yet</Text>
        <Text style={[styles.muted, { color: colors.muted }]}>
          Mark attendance for this day first. The labour report cannot be submitted without it.
        </Text>
      </Card>
    );
  return (
    <Card>
      <Text style={[styles.title, { color: colors.foreground }]}>
        {totals.onSite} on site · {totals.absentOrLeave} absent or on leave
      </Text>
      <Text style={[styles.muted, { color: colors.muted }]}>
        {totals.regularHours} h regular · {totals.overtimeHours} h overtime · {totals.approved}{" "}
        approved, {totals.pending} waiting for approval
      </Text>
      <View style={styles.table}>
        {summary.trades.map((line) => (
          <View key={line.trade} style={[styles.row, { borderTopColor: colors.border }]}>
            <Text style={[styles.trade, { color: colors.foreground }]}>{line.trade}</Text>
            <Text style={[styles.counts, { color: colors.muted }]}>
              {[
                line.fullDay ? `${line.fullDay} full` : null,
                line.halfDay ? `${line.halfDay} half` : null,
                line.hoursBased ? `${line.hoursBased} by hours` : null,
                line.absent ? `${line.absent} absent` : null,
                line.leave ? `${line.leave} leave` : null,
              ]
                .filter(Boolean)
                .join(" · ")}
              {line.overtimeHours !== "0" ? ` · OT ${line.overtimeHours} h` : ""}
            </Text>
          </View>
        ))}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 15, fontWeight: "800" },
  muted: { fontSize: 13, lineHeight: 19, marginTop: 4 },
  table: { marginTop: 10 },
  row: { borderTopWidth: 1, paddingVertical: 8, gap: 2 },
  trade: { fontSize: 14, fontWeight: "700" },
  counts: { fontSize: 13 },
});
