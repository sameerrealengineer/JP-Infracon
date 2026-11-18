import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useRouter } from "expo-router";
import { RefreshControl, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { KpiGrid } from "@/components/jp/charts";
import { AppHeader, EmptyState, Screen, SectionHeader, type IconName } from "@/components/jp/ui";
import { useColors } from "@/hooks/use-colors";
import { useWorkspace } from "@/hooks/use-workspace";
import { useT } from "@/lib/i18n";
import { shortRupees } from "@/lib/jp/analytics";
import { trpc } from "@/lib/trpc";

const MONEY_LINKS: {
  title: string;
  detail: string;
  icon: IconName;
  route: string;
  anyOf: string[];
}[] = [
  {
    title: "Supplier bills & payments",
    detail: "Bills, payments, what is due",
    icon: "receipt-long",
    route: "/finance",
    anyOf: ["finance.invoice.view", "finance.payment.view"],
  },
  {
    title: "Petty cash",
    detail: "Site cash in hand and expenses",
    icon: "payments",
    route: "/finance",
    anyOf: ["finance.cash.view"],
  },
  {
    title: "Payroll",
    detail: "Monthly wages and salaries",
    icon: "badge",
    route: "/payroll",
    anyOf: ["payroll.view"],
  },
  {
    title: "Worker khaata",
    detail: "Advances, paid and due per person",
    icon: "account-balance-wallet",
    route: "/khaata",
    anyOf: ["payroll.view", "payroll.advance"],
  },
  {
    title: "Subcontractor bills",
    detail: "Work orders, measurement, RA bills",
    icon: "engineering",
    route: "/subcontract",
    anyOf: ["subcontract.view"],
  },
  {
    title: "Purchase orders",
    detail: "Orders, receipts, bill matching",
    icon: "shopping-cart",
    route: "/purchase",
    anyOf: ["purchase.view"],
  },
  {
    title: "Cash-flow forecast",
    detail: "Money in and out by week, where cash runs short",
    icon: "waterfall-chart",
    route: "/cashflow",
    anyOf: ["contract.view"],
  },
  {
    title: "Tenders & contracts",
    detail: "EMD, bank guarantees, deposits, extensions",
    icon: "gavel",
    route: "/contracts",
    anyOf: ["contract.view"],
  },
  {
    title: "Department MB",
    detail: "Measurements signed by the department",
    icon: "straighten",
    route: "/department-mb",
    anyOf: ["billing.view"],
  },
  {
    title: "Client billing",
    detail: "RA bills to the department, receipts",
    icon: "request-quote",
    route: "/billing",
    anyOf: ["billing.view"],
  },
  {
    title: "Project budget",
    detail: "Budget against spend",
    icon: "savings",
    route: "/project-budget",
    anyOf: ["budget.view"],
  },
  {
    title: "Accounts",
    detail: "GST, TDS, PF, ESI, project profit",
    icon: "account-balance",
    route: "/accounts",
    anyOf: ["accounts.view"],
  },
  {
    title: "Analytics",
    detail: "Money charts and trends",
    icon: "insights",
    route: "/analytics",
    anyOf: [],
  },
];

/** Money: this month's headline numbers and every money screen the person may open. */
export default function MoneyScreen() {
  const { t } = useT();
  const colors = useColors();
  const router = useRouter();
  const { can } = useWorkspace();
  const overview = trpc.jp.analytics.overview.useQuery({ days: 30 }, { retry: false });
  const data = overview.data;
  const links = MONEY_LINKS.filter(
    (link) => !link.anyOf.length || link.anyOf.some((key) => can(key as never)),
  );
  const items = [
    ...(data?.moneyOut
      ? [{ label: t("Money out (30 days)"), value: shortRupees(data.moneyOut.totalMinor) }]
      : []),
    ...(data?.moneyIn
      ? [
          {
            label: t("Received (30 days)"),
            value: shortRupees(data.moneyIn.totalMinor),
            tone: "good" as const,
          },
        ]
      : []),
    ...(data?.payables
      ? [
          {
            label: t("Suppliers to pay"),
            value: shortRupees(data.payables.totalMinor),
            sub: t("{amount} overdue", {
              amount: shortRupees(
                data.payables.ageing
                  .filter((row) => row.bucket !== "Not due")
                  .reduce((sum, row) => sum + BigInt(row.amountMinor), 0n),
              ),
            }),
            tone: data.payables.ageing.some(
              (row) => row.bucket !== "Not due" && row.amountMinor !== "0",
            )
              ? ("bad" as const)
              : ("good" as const),
          },
        ]
      : []),
    ...(data?.advancesOutstanding
      ? [{ label: t("Advances out"), value: shortRupees(data.advancesOutstanding.totalMinor) }]
      : []),
    ...(data?.pettyCash?.length
      ? [
          {
            label: t("Petty cash in hand"),
            value: shortRupees(
              data.pettyCash.reduce((sum, row) => sum + BigInt(row.balanceMinor), 0n),
            ),
          },
        ]
      : []),
  ];
  return (
    <Screen inTabs>
      <ScrollView
        contentContainerStyle={{ paddingBottom: 32, gap: 12 }}
        refreshControl={
          <RefreshControl
            refreshing={overview.isRefetching}
            onRefresh={() => void overview.refetch()}
          />
        }
      >
        <AppHeader
          eyebrow={t("Money")}
          title={t("Money")}
          subtitle={t(
            "What went out, what came in, and what is due. Records only — no money is sent from the app.",
          )}
        />
        {items.length ? <KpiGrid items={items} /> : null}
        <SectionHeader title={t("Open")} />
        {links.length ? (
          <View style={{ gap: 10 }}>
            {links.map((link) => (
              <Pressable
                key={link.title}
                accessibilityRole="button"
                onPress={() => router.push(link.route as never)}
                style={({ pressed }) => [
                  styles.row,
                  {
                    backgroundColor: colors.surface,
                    borderColor: colors.border,
                    opacity: pressed ? 0.8 : 1,
                  },
                ]}
              >
                <View style={[styles.icon, { backgroundColor: colors.background }]}>
                  <MaterialIcons name={link.icon} size={22} color={colors.primary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.title, { color: colors.foreground }]}>{t(link.title)}</Text>
                  <Text style={[styles.detail, { color: colors.muted }]}>{t(link.detail)}</Text>
                </View>
                <MaterialIcons name="chevron-right" size={22} color={colors.muted} />
              </Pressable>
            ))}
          </View>
        ) : (
          <EmptyState
            icon="lock"
            title={t("No money screens for your role")}
            detail={t("Ask your administrator if you need them.")}
          />
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderWidth: 1,
    borderRadius: 16,
    padding: 14,
    minHeight: 64,
  },
  icon: { width: 42, height: 42, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 15, fontWeight: "800" },
  detail: { fontSize: 12, marginTop: 2 },
});
