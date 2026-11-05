import { StyleSheet, Text, View } from "react-native";
import { useColors } from "@/hooks/use-colors";
import type { Tone } from "@/components/jp/ui";
import type { LeadStage } from "@/lib/jp/billing-domain";

/** Colours for CRM and billing statuses, shared by their screens. */
export const STAGE_TONE: Record<LeadStage, Tone> = {
  New: "info",
  Contacted: "info",
  "Site visit": "accent",
  "Quotation sent": "accent",
  Negotiation: "warning",
  Won: "success",
  Lost: "error",
};

export const QUOTE_TONE: Record<string, Tone> = {
  Draft: "info",
  Sent: "accent",
  Accepted: "success",
  Rejected: "error",
  Expired: "warning",
};

export const BILL_TONE: Record<string, Tone> = {
  Draft: "info",
  Submitted: "accent",
  Approved: "success",
  Rejected: "error",
  Cancelled: "warning",
  Unpaid: "error",
  "Part paid": "warning",
  Paid: "success",
};

export const PO_TONE: Record<string, Tone> = {
  Draft: "info",
  Submitted: "accent",
  Approved: "success",
  Rejected: "error",
  Cancelled: "warning",
  Closed: "info",
  "Not received": "warning",
  "Part received": "accent",
  Received: "success",
  Matches: "success",
  "Billed more than received": "error",
  "Billed less": "warning",
  "No bill yet": "info",
};

export const WO_TONE: Record<string, Tone> = {
  ...PO_TONE,
  Recorded: "warning",
  Checked: "success",
  Billed: "info",
};

export const commercialStyles = StyleSheet.create({
  content: { paddingBottom: 32, gap: 10 },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  title: { fontSize: 15, fontWeight: "800" },
  meta: { fontSize: 12, marginTop: 3, lineHeight: 17 },
  money: { fontSize: 16, fontWeight: "800", flex: 1 },
  link: { fontSize: 13, fontWeight: "800", marginTop: 10 },
  cancel: { textAlign: "center", marginTop: 12, fontWeight: "700", color: "#8A8F98" },
  totalRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 3 },
});

/** One line of a totals block (subtotal, GST, deductions, net). */
export function TotalRow({
  label,
  value,
  strong,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  const colors = useColors();
  return (
    <View style={commercialStyles.totalRow}>
      <Text
        style={[
          commercialStyles.meta,
          { color: strong ? colors.foreground : colors.muted, fontWeight: strong ? "800" : "400" },
        ]}
      >
        {label}
      </Text>
      <Text
        style={[
          commercialStyles.meta,
          {
            color: colors.foreground,
            fontWeight: strong ? "800" : "600",
            fontSize: strong ? 16 : 13,
          },
        ]}
      >
        {value}
      </Text>
    </View>
  );
}
