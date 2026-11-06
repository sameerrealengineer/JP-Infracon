import { MaterialIcons } from "@expo/vector-icons";
import { HelpButton } from "@/components/jp/help";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@/server/routers";
import { useRouter } from "expo-router";
import { useState } from "react";
import { RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { AuthGate } from "@/components/jp/auth-gate";
import { ProgressBar } from "@/components/jp/place-visual";
import {
  AppHeader,
  Card,
  ChipGroup,
  EmptyState,
  HeroCard,
  HeroStat,
  InlineError,
  isAccessDenied,
  LoadingBlock,
  NoAccess,
  Screen,
  SecondaryButton,
  SectionHeader,
  StatusPill,
  formatDateTime,
} from "@/components/jp/ui";
import { useColors } from "@/hooks/use-colors";
import { formatHours } from "@/lib/jp/attendance-domain";
import { formatMinorAsRupees } from "@/lib/jp/finance-domain";
import { istClock } from "@/lib/jp/presence-rules";
import { prettyRole } from "@/lib/jp/site-admin-policy";
import { resolveChoice } from "@/lib/jp/selection";
import {
  attendancePercent,
  emptyAttendance,
  formatHalfDays,
  istDate,
  shiftMonth,
} from "@/lib/jp/tracking-domain";
import { useT } from "@/lib/i18n";
import { trpc } from "@/lib/trpc";

type Overview = inferRouterOutputs<AppRouter>["jp"]["tracking"]["overview"];
type Presence = Overview["workers"][number]["presence"];

const ALL = "all";
const TABS = ["Workers", "Staff"] as const;

/** Team tracking: a month of attendance, site presence, reports and money per person. */
export default function TrackingScreen() {
  const { t } = useT();
  const colors = useColors();
  const router = useRouter();
  const thisMonth = istDate(new Date()).slice(0, 7);
  const [month, setMonth] = useState(thisMonth);
  const [siteChoice, setSiteChoice] = useState<string>(ALL);
  const [tab, setTab] = useState<(typeof TABS)[number]>("Workers");
  const overview = trpc.jp.tracking.overview.useQuery({
    siteId: siteChoice === ALL ? null : siteChoice,
    month,
  });
  const data = overview.data;
  const siteOptions = [ALL, ...(data?.sites.map((site) => site.id) ?? [])];
  const site = resolveChoice(siteOptions, siteChoice);

  if (isAccessDenied(overview.error))
    return (
      <AuthGate>
        <Screen>
          <ScrollView contentContainerStyle={styles.content}>
            <AppHeader
              right={<HelpButton topicKey="tracking" />}
              eyebrow={t("People")}
              title={t("Team tracking")}
            />
            <NoAccess area={t("Team tracking")} message={overview.error?.message} />
          </ScrollView>
        </Screen>
      </AuthGate>
    );

  const totals = data?.totals;
  const percent =
    totals && totals.markedDays > 0
      ? Math.round((totals.presentHalfDays * 50) / totals.markedDays)
      : null;
  return (
    <AuthGate>
      <Screen>
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.content}
          refreshControl={
            <RefreshControl
              refreshing={overview.isRefetching}
              onRefresh={() => void overview.refetch()}
              tintColor={colors.primary}
            />
          }
        >
          <AppHeader
            right={<HelpButton topicKey="tracking" />}
            eyebrow={t("People")}
            title={t("Team tracking")}
            subtitle={t(
              "Attendance, hours, site presence, reports and pay for each person, from saved records.",
            )}
          />

          <View style={styles.monthRow}>
            <SecondaryButton
              icon="chevron-left"
              label={t("Previous")}
              onPress={() => setMonth(shiftMonth(month, -1))}
            />
            <Text style={[styles.monthText, { color: colors.foreground }]}>
              {monthLabel(month)}
            </Text>
            <SecondaryButton
              icon="chevron-right"
              label={t("Next")}
              disabled={month >= thisMonth}
              onPress={() => setMonth(shiftMonth(month, 1))}
            />
          </View>
          {data && data.sites.length > 1 ? (
            <ChipGroup
              label={t("Site")}
              options={siteOptions}
              value={site}
              onChange={setSiteChoice}
              format={(id) =>
                id === ALL ? t("All sites") : (data.sites.find((s) => s.id === id)?.name ?? id)
              }
            />
          ) : null}

          {overview.error ? (
            <InlineError message={overview.error.message} onRetry={() => void overview.refetch()} />
          ) : null}
          {overview.isLoading ? <LoadingBlock label={t("Loading team…")} /> : null}

          {data && totals ? (
            <>
              <HeroCard>
                <Text style={styles.heroKicker}>{t("THIS MONTH")}</Text>
                <Text style={styles.heroValue}>{percent === null ? "—" : `${percent}%`}</Text>
                <Text style={styles.heroLabel}>{t("Attendance on marked days")}</Text>
                <View style={styles.heroStats}>
                  <HeroStat value={String(totals.workers)} label={t("Workers")} />
                  <HeroStat value={String(totals.staff)} label={t("Staff")} />
                  <HeroStat value={String(totals.onSiteNow)} label={t("On site now")} />
                  <HeroStat
                    value={formatHours(BigInt(totals.overtimeHundredths))}
                    label={t("OT hours")}
                  />
                </View>
              </HeroCard>

              <View style={styles.alerts}>
                {totals.pendingRows > 0 ? (
                  <StatusPill
                    label={t("{count} attendance marks waiting for approval", {
                      count: totals.pendingRows,
                    })}
                    tone="warning"
                  />
                ) : null}
                <StatusPill
                  label={t("{count} daily reports sent", { count: totals.reportsSubmitted })}
                  tone="info"
                />
              </View>

              {data.canSeeMoney && totals.dueMinor !== null ? (
                <Card style={{ marginBottom: 14 }}>
                  <Text style={[styles.cardTitle, { color: colors.foreground }]}>{t("Wages")}</Text>
                  <MoneyRow
                    label={t("Earned this month (approved)")}
                    value={totals.earnedMonthMinor}
                  />
                  <MoneyRow label={t("Still to pay (all months)")} value={totals.dueMinor} />
                  <MoneyRow
                    label={t("Advance outstanding")}
                    value={totals.advanceOutstandingMinor}
                  />
                  <Text style={[styles.note, { color: colors.muted }]}>
                    {t("Paid means recorded as paid in a pay run; it is not a bank transfer.")}
                  </Text>
                </Card>
              ) : null}

              <ChipGroup options={TABS} value={tab} onChange={setTab} format={(v) => t(v)} />

              {tab === "Workers" ? (
                data.workers.length === 0 ? (
                  <EmptyState
                    icon="engineering"
                    title={t("No workers on these sites")}
                    detail={t("Add workers and assign them to a site in Workforce.")}
                    action={t("Open Workforce")}
                    onPress={() => router.push("/workforce" as never)}
                  />
                ) : (
                  <View style={{ gap: 10 }}>
                    {data.workers.map((worker) => (
                      <WorkerCard
                        key={worker.personId}
                        worker={worker}
                        money={data.canSeeMoney}
                        onPress={() => router.push(`/person?id=${worker.personId}` as never)}
                      />
                    ))}
                  </View>
                )
              ) : data.staff.length === 0 ? (
                <EmptyState
                  icon="badge"
                  title={t("No staff assigned")}
                  detail={t("Assign supervisors and engineers to a site from the site page.")}
                />
              ) : (
                <View style={{ gap: 10 }}>
                  {data.staff.map((person) => (
                    <StaffCard key={person.userId} person={person} />
                  ))}
                </View>
              )}

              <SectionHeader title={t("How these numbers are made")} />
              <Text style={[styles.note, { color: colors.muted }]}>
                {t(
                  "Days and hours come from attendance marks; marks waiting for approval are shown apart. Site presence comes from phones with location on, so people without the app show no presence. Updated {time}.",
                  { time: formatDateTime(data.generatedAt) },
                )}
              </Text>
            </>
          ) : null}
        </ScrollView>
      </Screen>
    </AuthGate>
  );
}

function monthLabel(month: string) {
  const [year, m] = month.split("-").map(Number);
  return new Date(Date.UTC(year, m - 1, 1)).toLocaleDateString("en-IN", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

function MoneyRow({ label, value }: { label: string; value: string | null }) {
  const colors = useColors();
  return (
    <View style={styles.moneyRow}>
      <Text style={[styles.moneyLabel, { color: colors.muted }]}>{label}</Text>
      <Text style={[styles.moneyValue, { color: colors.foreground }]}>
        {value === null ? "—" : formatMinorAsRupees(value)}
      </Text>
    </View>
  );
}

function PresenceLine({ presence, hasLogin }: { presence: Presence; hasLogin: boolean }) {
  const { t } = useT();
  const colors = useColors();
  if (!hasLogin)
    return (
      <Text style={[styles.meta, { color: colors.muted }]}>
        {t("No app login: no GPS presence")}
      </Text>
    );
  if (!presence || !presence.lastAt)
    return (
      <Text style={[styles.meta, { color: colors.muted }]}>{t("Not seen on site this month")}</Text>
    );
  const last = new Date(presence.lastAt);
  const today = istDate(new Date()) === istDate(last);
  return (
    <View style={styles.presence}>
      <View
        style={[
          styles.dot,
          { backgroundColor: presence.onSiteNow ? colors.success : colors.muted },
        ]}
      />
      <Text style={[styles.meta, { color: colors.foreground }]}>
        {presence.onSiteNow
          ? t("On site since {time}", {
              time: istClock(new Date(presence.arrivedTodayAt ?? last)).text,
            })
          : presence.lastEvent === "Left" && today
            ? t("Left site at {time}", { time: istClock(last).text })
            : t("Last on site {date}", { date: formatDateTime(last) })}
        {" · "}
        {t("{count} days on site", { count: presence.daysOnSite })}
      </Text>
    </View>
  );
}

function WorkerCard({
  worker,
  money,
  onPress,
}: {
  worker: Overview["workers"][number];
  money: boolean;
  onPress: () => void;
}) {
  const { t } = useT();
  const colors = useColors();
  const sum = { ...emptyAttendance(), ...worker };
  const percent = attendancePercent({
    ...sum,
    regularHundredths: 0n,
    overtimeHundredths: 0n,
    overtimePendingHundredths: 0n,
  });
  return (
    <Card onPress={onPress} accessibilityLabel={t("Open {name}", { name: worker.name })}>
      <View style={styles.cardTop}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.name, { color: colors.foreground }]}>{worker.name}</Text>
          <Text style={[styles.meta, { color: colors.muted }]} numberOfLines={1}>
            {[worker.trade, worker.skill, worker.sites.join(", ")].filter(Boolean).join(" · ")}
          </Text>
        </View>
        {worker.pendingRows > 0 ? (
          <StatusPill
            label={t("{count} to approve", { count: worker.pendingRows })}
            tone="warning"
            compact
          />
        ) : null}
      </View>
      <View style={{ marginTop: 10 }}>
        <ProgressBar
          actualTenths={percent === null ? 0 : percent * 10}
          tone={percent !== null && percent < 70 ? "warning" : "success"}
          height={6}
        />
      </View>
      <View style={styles.stats}>
        <Stat value={formatHalfDays(worker.presentHalfDays)} label={t("Days present")} />
        <Stat value={String(worker.absentDays)} label={t("Absent")} />
        <Stat value={formatHours(BigInt(worker.regularHundredths))} label={t("Hours")} />
        <Stat
          value={formatHours(BigInt(worker.overtimeHundredths))}
          label={
            BigInt(worker.overtimePendingHundredths) > 0n ? t("OT (some pending)") : t("OT hours")
          }
        />
      </View>
      <PresenceLine presence={worker.presence} hasLogin={worker.hasPhoneLogin} />
      {money && worker.dueMinor !== null ? (
        <View style={[styles.moneyStrip, { borderColor: colors.border }]}>
          <MaterialIcons name="account-balance-wallet" size={14} color={colors.muted} />
          <Text style={[styles.meta, { color: colors.foreground, flex: 1 }]}>
            {t("Earned {earned} · To pay {due} · Advance {advance}", {
              earned: formatMinorAsRupees(worker.earnedMonthMinor ?? "0"),
              due: formatMinorAsRupees(worker.dueMinor),
              advance: formatMinorAsRupees(worker.advanceOutstandingMinor ?? "0"),
            })}
          </Text>
        </View>
      ) : null}
    </Card>
  );
}

function StaffCard({ person }: { person: Overview["staff"][number] }) {
  const { t } = useT();
  const colors = useColors();
  return (
    <Card>
      <View style={styles.cardTop}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.name, { color: colors.foreground }]}>{person.name}</Text>
          <Text style={[styles.meta, { color: colors.muted }]} numberOfLines={1}>
            {[
              person.roles.map((role: string) => prettyRole(role)).join(", "),
              person.sites.join(", "),
            ]
              .filter(Boolean)
              .join(" · ")}
          </Text>
        </View>
        {person.reportsReturned > 0 ? (
          <StatusPill
            label={t("{count} returned", { count: person.reportsReturned })}
            tone="error"
            compact
          />
        ) : null}
      </View>
      <View style={styles.stats}>
        <Stat value={String(person.reportsSubmitted)} label={t("Reports sent")} />
        <Stat value={String(person.reportsApproved)} label={t("Approved")} />
        <Stat value={String(person.reportDrafts)} label={t("Drafts")} />
        <Stat value={String(person.presence?.daysOnSite ?? 0)} label={t("Days on site")} />
      </View>
      {person.tasks.open + person.tasks.done > 0 ? (
        <View style={styles.stats}>
          <Stat value={String(person.tasks.done)} label={t("Tasks done")} />
          <Stat value={String(person.tasks.open)} label={t("Tasks open")} />
          <Stat value={String(person.tasks.overdue)} label={t("Tasks late")} />
          <View style={styles.stat} />
        </View>
      ) : null}
      <PresenceLine presence={person.presence} hasLogin />
    </Card>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  const colors = useColors();
  return (
    <View style={styles.stat}>
      <Text style={[styles.statValue, { color: colors.foreground }]}>{value}</Text>
      <Text style={[styles.statLabel, { color: colors.muted }]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 16, paddingBottom: 40 },
  monthRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 12 },
  monthText: { flex: 1, textAlign: "center", fontSize: 15, fontWeight: "800" },
  heroKicker: { color: "#D9B76A", fontSize: 11, fontWeight: "800", letterSpacing: 1.6 },
  heroValue: { color: "#FFFFFF", fontSize: 34, fontWeight: "800", marginTop: 6 },
  heroLabel: { color: "rgba(246,241,230,0.78)", fontSize: 12 },
  heroStats: { flexDirection: "row", marginTop: 14, gap: 6 },
  alerts: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginVertical: 12 },
  cardTitle: { fontSize: 14, fontWeight: "800", marginBottom: 6 },
  moneyRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 4 },
  moneyLabel: { fontSize: 13 },
  moneyValue: { fontSize: 13, fontWeight: "800" },
  note: { fontSize: 11, lineHeight: 16, marginTop: 6 },
  cardTop: { flexDirection: "row", alignItems: "center", gap: 8 },
  name: { fontSize: 15, fontWeight: "800" },
  meta: { fontSize: 12, lineHeight: 17 },
  stats: { flexDirection: "row", marginTop: 10, marginBottom: 8 },
  stat: { flex: 1 },
  statValue: { fontSize: 16, fontWeight: "800" },
  statLabel: { fontSize: 10, marginTop: 1 },
  presence: { flexDirection: "row", alignItems: "center", gap: 6 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  moneyStrip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderTopWidth: StyleSheet.hairlineWidth,
    marginTop: 8,
    paddingTop: 8,
  },
});
