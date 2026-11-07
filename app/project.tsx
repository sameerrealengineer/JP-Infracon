import { useLocalSearchParams, useRouter } from "expo-router";
import { RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { AuthGate } from "@/components/jp/auth-gate";
import { CoverPhoto, ProgressBar, ProgressCard, percentText } from "@/components/jp/place-visual";
import {
  AppHeader,
  Card,
  EmptyState,
  InlineError,
  isAccessDenied,
  ListRow,
  LoadingBlock,
  ModuleTile,
  Screen,
  SectionHeader,
  StatusPill,
  type IconName,
  type Tone,
} from "@/components/jp/ui";
import { useColors } from "@/hooks/use-colors";
import { useWorkspace } from "@/hooks/use-workspace";
import { formatTenths } from "@/lib/jp/budget-domain";
import { getSiteStatusTone, type SiteStatus } from "@/lib/jp/domain";
import { formatMinorAsRupees } from "@/lib/jp/finance-domain";
import { summarizeBills } from "@/lib/jp/project-hub";
import { useT } from "@/lib/i18n";
import { trpc } from "@/lib/trpc";

/**
 * One project in one place: progress, its sites, budget against spend, client billing and
 * documents. Each part loads on its own and is left out when the person's role does not cover it.
 */
export default function ProjectScreen() {
  const { t } = useT();
  const colors = useColors();
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string }>();
  const projectId = typeof params.id === "string" ? params.id : "";
  const { can } = useWorkspace();
  const sites = trpc.jp.workspace.mySites.useQuery();
  const cards = trpc.jp.places.cards.useQuery(undefined, { staleTime: 60_000 });
  const projectSites = (sites.data ?? []).filter((site) => site.projectId === projectId);
  const firstSite = projectSites[0]?.id ?? "";
  const detail = trpc.jp.sitesAdmin.siteDetail.useQuery(
    { siteId: firstSite },
    { enabled: Boolean(firstSite) },
  );
  const budget = trpc.jp.budgets.overview.useQuery(
    { projectId },
    { enabled: Boolean(projectId) && can("budget.view"), retry: false },
  );
  const contract = trpc.jp.billing.contract.get.useQuery(
    { projectId },
    { enabled: Boolean(projectId) && can("billing.view"), retry: false },
  );
  const bills = trpc.jp.billing.bills.list.useQuery(
    { projectId },
    { enabled: Boolean(projectId) && can("billing.view"), retry: false },
  );
  const documents = trpc.jp.documents.list.useQuery(
    { projectId, limit: 5 },
    { enabled: Boolean(projectId) && can("document.view"), retry: false },
  );

  const card = cards.data?.projects.find((row) => row.projectId === projectId);
  const project = detail.data?.project;
  const refresh = () =>
    Promise.all([
      sites.refetch(),
      cards.refetch(),
      detail.refetch(),
      budget.refetch(),
      contract.refetch(),
      bills.refetch(),
      documents.refetch(),
    ]);
  const billing =
    bills.data && contract.data
      ? summarizeBills(bills.data, contract.data.contract ? contract.data.contractValueMinor : null)
      : null;
  const links: { icon: IconName; title: string; tone: Tone; route: string; show: boolean }[] = [
    {
      icon: "event-note",
      title: "Schedule",
      tone: "info",
      route: "/schedule",
      show: can("task.view"),
    },
    {
      icon: "insights",
      title: "Team tracking",
      tone: "accent",
      route: "/tracking",
      show: can("workforce.review"),
    },
    {
      icon: "account-balance",
      title: "Budget",
      tone: "success",
      route: "/project-budget",
      show: can("budget.view"),
    },
    {
      icon: "receipt-long",
      title: "Client billing",
      tone: "warning",
      route: `/billing?projectId=${projectId}`,
      show: can("billing.view"),
    },
    {
      icon: "folder-copy",
      title: "Documents",
      tone: "info",
      route: "/documents",
      show: can("document.view"),
    },
  ];

  return (
    <AuthGate>
      <Screen>
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.content}
          refreshControl={
            <RefreshControl
              refreshing={sites.isRefetching}
              onRefresh={() => void refresh()}
              tintColor={colors.primary}
            />
          }
        >
          <AppHeader
            eyebrow={project ? `${t("Project")} · ${project.code}` : t("Project")}
            title={project?.name ?? card?.name ?? t("Project")}
            subtitle={project?.clientDepartment ?? undefined}
          />
          {sites.error ? (
            <InlineError message={sites.error.message} onRetry={() => void sites.refetch()} />
          ) : null}
          {sites.isLoading ? <LoadingBlock label={t("Loading project…")} /> : null}
          {sites.data && projectSites.length === 0 ? (
            <EmptyState
              icon="lock-outline"
              title={t("This project is not on your sites")}
              detail={t("You see a project once you are assigned to one of its sites.")}
            />
          ) : null}

          {projectSites.length > 0 ? (
            <>
              {card?.coverUrl ? (
                <View style={{ marginBottom: 14 }}>
                  <CoverPhoto uri={card.coverUrl} height={170} label={card.name} />
                </View>
              ) : null}
              {project ? (
                <View style={styles.pills}>
                  <StatusPill label={t(project.status)} tone="info" />
                  {project.startDate ? (
                    <StatusPill
                      label={`${t("Start")} ${String(project.startDate)}`}
                      tone="accent"
                    />
                  ) : null}
                  {project.targetEndDate ? (
                    <StatusPill
                      label={`${t("Target")} ${String(project.targetEndDate)}`}
                      tone="warning"
                    />
                  ) : null}
                </View>
              ) : null}
              {card ? <ProgressCard summary={card.progress} title="Project progress" /> : null}

              <SectionHeader
                title={t("Sites")}
                caption={t("{count} sites in this project", { count: projectSites.length })}
              />
              <View style={{ gap: 8, marginBottom: 18 }}>
                {projectSites.map((site) => {
                  const progress = cards.data?.sites.find(
                    (row) => row.siteId === site.id,
                  )?.progress;
                  return (
                    <Card
                      key={site.id}
                      accent={getSiteStatusTone(site.status as SiteStatus)}
                      onPress={() => router.push(`/site/${site.id}` as never)}
                      accessibilityLabel={t("Open {name}", { name: site.name })}
                    >
                      <View style={styles.row}>
                        <View style={{ flex: 1 }}>
                          <Text style={[styles.name, { color: colors.foreground }]}>
                            {site.name}
                          </Text>
                          <Text style={[styles.meta, { color: colors.muted }]}>
                            {[site.code, site.location].filter(Boolean).join(" · ")}
                          </Text>
                        </View>
                        <Text style={[styles.percent, { color: colors.foreground }]}>
                          {progress && progress.total > 0
                            ? percentText(progress.actualTenths)
                            : "—"}
                        </Text>
                      </View>
                      {progress && progress.total > 0 ? (
                        <View style={{ marginTop: 8 }}>
                          <ProgressBar
                            actualTenths={progress.actualTenths}
                            expectedTenths={progress.expectedTenths}
                            tone={progress.health === "behind" ? "warning" : "success"}
                            height={6}
                          />
                        </View>
                      ) : null}
                    </Card>
                  );
                })}
              </View>

              {can("budget.view") ? (
                <>
                  <SectionHeader title={t("Budget and spend")} />
                  <Card style={{ marginBottom: 18 }}>
                    {budget.isLoading ? <LoadingBlock /> : null}
                    {budget.error && !isAccessDenied(budget.error) ? (
                      <InlineError message={budget.error.message} />
                    ) : null}
                    {budget.data ? (
                      budget.data.current ? (
                        <>
                          <Amount
                            label={t("Contract value")}
                            value={budget.data.current.contractValueMinor}
                          />
                          <Amount
                            label={t("Approved budget")}
                            value={budget.data.comparison.totals.budgetMinor}
                          />
                          <Amount
                            label={t("Spent (approved)")}
                            value={budget.data.comparison.totals.actualMinor}
                          />
                          <Amount
                            label={t("Waiting for approval")}
                            value={budget.data.comparison.totals.pendingMinor}
                          />
                          <View style={{ marginTop: 10 }}>
                            <ProgressBar
                              actualTenths={budget.data.comparison.totals.usedTenths}
                              tone={
                                budget.data.comparison.totals.state === "over"
                                  ? "error"
                                  : budget.data.comparison.totals.state === "near"
                                    ? "warning"
                                    : "success"
                              }
                              height={8}
                            />
                          </View>
                          <Text style={[styles.meta, { color: colors.muted, marginTop: 6 }]}>
                            {t("{used} of the budget used", {
                              used: formatTenths(budget.data.comparison.totals.usedTenths),
                            })}
                          </Text>
                        </>
                      ) : (
                        <Text style={[styles.meta, { color: colors.muted }]}>
                          {t("No approved budget yet. Propose one in Budget.")}
                        </Text>
                      )
                    ) : null}
                  </Card>
                </>
              ) : null}

              {can("billing.view") ? (
                <>
                  <SectionHeader title={t("Client billing")} />
                  <Card style={{ marginBottom: 18 }}>
                    {contract.isLoading || bills.isLoading ? <LoadingBlock /> : null}
                    {(contract.error && !isAccessDenied(contract.error)) ||
                    (bills.error && !isAccessDenied(bills.error)) ? (
                      <InlineError message={(contract.error ?? bills.error)!.message} />
                    ) : null}
                    {contract.data && !contract.data.contract ? (
                      <Text style={[styles.meta, { color: colors.muted }]}>
                        {t("No client contract set up for this project yet.")}
                      </Text>
                    ) : null}
                    {contract.data?.contract && billing ? (
                      <>
                        <Text style={[styles.name, { color: colors.foreground, marginBottom: 6 }]}>
                          {contract.data.contract.clientName}
                        </Text>
                        <Amount
                          label={t("Contract value")}
                          value={contract.data.contractValueMinor}
                        />
                        <Amount label={t("Billed (approved)")} value={billing.billedMinor} />
                        <Amount label={t("Received")} value={billing.receivedMinor} />
                        <Amount label={t("Outstanding")} value={billing.outstandingMinor} />
                        {billing.billedTenths !== null ? (
                          <View style={{ marginTop: 10 }}>
                            <ProgressBar
                              actualTenths={billing.billedTenths}
                              tone="info"
                              height={8}
                            />
                            <Text style={[styles.meta, { color: colors.muted, marginTop: 6 }]}>
                              {t("{share} of the contract billed", {
                                share: formatTenths(billing.billedTenths),
                              })}
                            </Text>
                          </View>
                        ) : null}
                        {billing.waitingForApproval + billing.drafts > 0 ? (
                          <Text style={[styles.meta, { color: colors.muted, marginTop: 6 }]}>
                            {t("{waiting} bills waiting for approval · {drafts} drafts", {
                              waiting: billing.waitingForApproval,
                              drafts: billing.drafts,
                            })}
                          </Text>
                        ) : null}
                      </>
                    ) : null}
                  </Card>
                </>
              ) : null}

              {can("document.view") ? (
                <>
                  <SectionHeader title={t("Latest documents")} />
                  <Card style={{ marginBottom: 18 }}>
                    {documents.isLoading ? <LoadingBlock /> : null}
                    {documents.data && documents.data.length === 0 ? (
                      <Text style={[styles.meta, { color: colors.muted }]}>
                        {t("No documents for this project yet.")}
                      </Text>
                    ) : null}
                    {documents.data?.map((doc) => (
                      <ListRow
                        key={doc.id}
                        icon="description"
                        title={doc.title}
                        detail={[doc.category, doc.siteName, `v${doc.currentVersion}`]
                          .filter(Boolean)
                          .join(" · ")}
                        onPress={() =>
                          router.push(`/document-detail?documentId=${doc.id}` as never)
                        }
                      />
                    ))}
                  </Card>
                </>
              ) : null}

              <SectionHeader title={t("Go to")} />
              <View style={styles.grid}>
                {links
                  .filter((link) => link.show)
                  .map((link) => (
                    <ModuleTile
                      key={link.title}
                      icon={link.icon}
                      title={t(link.title)}
                      tone={link.tone}
                      onPress={() => router.push(link.route as never)}
                    />
                  ))}
              </View>
            </>
          ) : null}
        </ScrollView>
      </Screen>
    </AuthGate>
  );
}

function Amount({ label, value }: { label: string; value: string | null }) {
  const colors = useColors();
  return (
    <View style={styles.amount}>
      <Text style={[styles.amountLabel, { color: colors.muted }]}>{label}</Text>
      <Text style={[styles.amountValue, { color: colors.foreground }]}>
        {value === null ? "—" : formatMinorAsRupees(value)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 16, paddingBottom: 40 },
  pills: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 14 },
  row: { flexDirection: "row", alignItems: "center", gap: 10 },
  name: { fontSize: 15, fontWeight: "800" },
  meta: { fontSize: 12, lineHeight: 17 },
  percent: { fontSize: 16, fontWeight: "800" },
  amount: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 4 },
  amountLabel: { fontSize: 13 },
  amountValue: { fontSize: 13, fontWeight: "800" },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
});
