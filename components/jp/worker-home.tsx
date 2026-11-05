import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import type { inferRouterOutputs } from "@trpc/server";
import { useColors } from "@/hooks/use-colors";
import { useAuth } from "@/hooks/use-auth";
import { formatMinorAsRupees } from "@/lib/jp/finance-domain";
import { attendanceSign } from "@/lib/jp/worker-app";
import { siteAlertsEnabled, startSiteAlerts, stopSiteAlerts } from "@/lib/geofence-task";
import { languageNames, useT, type Language } from "@/lib/i18n";
import { trpc } from "@/lib/trpc";
import type { AppRouter } from "@/server/routers";

type Bundle = inferRouterOutputs<AppRouter>["jp"]["worker"]["me"];
type Section = "money" | "attendance" | "drawings" | "call";

const TILES: { key: Section; emoji: string; label: string }[] = [
  { key: "money", emoji: "💰", label: "My money" },
  { key: "attendance", emoji: "📅", label: "My attendance" },
  { key: "drawings", emoji: "📐", label: "Drawings" },
  { key: "call", emoji: "📞", label: "Call supervisor" },
];

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const shortDate = (date: string) =>
  `${Number(date.slice(8, 10))} ${MONTHS[Number(date.slice(5, 7)) - 1]}`;

/**
 * The worker's own screen, made for people who read little: big pictures and numbers, few
 * words, their language, one thing at a time. Shows only what an authorised person switched on.
 */
export function WorkerHome({
  data,
  openDrawing,
  selfMode,
}: {
  data: Bundle;
  openDrawing: (documentId: string) => Promise<{ url: string }>;
  /** The worker's own phone (sign out and site tracking); false when a supervisor shows it. */
  selfMode: boolean;
}) {
  const colors = useColors();
  const { t, language, setLanguage } = useT();
  const tiles = TILES.filter((tile) => data.features.includes(tile.key));
  const [open, setOpen] = useState<Section | null>(tiles[0]?.key ?? null);
  const [error, setError] = useState<string | null>(null);
  const totalDue = (data.money ?? []).reduce((sum, row) => sum + BigInt(row.dueMinor), 0n);

  const showDrawing = async (id: string) => {
    setError(null);
    try {
      const { url } = await openDrawing(id);
      await Linking.openURL(url);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("Could not open."));
    }
  };

  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.langRow}>
        {(Object.keys(languageNames) as Language[]).map((code) => (
          <Pressable
            key={code}
            accessibilityRole="radio"
            accessibilityState={{ selected: language === code }}
            onPress={() => setLanguage(code)}
            style={[
              styles.lang,
              {
                backgroundColor: language === code ? colors.primary : colors.surface,
                borderColor: colors.border,
              },
            ]}
          >
            <Text
              style={[
                styles.langText,
                { color: language === code ? colors.background : colors.foreground },
              ]}
            >
              {languageNames[code]}
            </Text>
          </Pressable>
        ))}
      </View>
      <Text style={[styles.hello, { color: colors.foreground }]}>🙏 {data.person.name}</Text>
      <Text style={[styles.sub, { color: colors.muted }]}>
        {[data.person.trade, data.sites.map((site) => site.name).join(", ")]
          .filter(Boolean)
          .join(" · ")}
      </Text>
      {data.money ? (
        <View style={[styles.hero, { backgroundColor: colors.success }]}>
          <Text style={styles.heroLabel}>{t("Still to get")}</Text>
          <Text
            style={styles.heroValue}
            accessibilityLabel={`${t("Still to get")} ${formatMinorAsRupees(totalDue)}`}
          >
            {formatMinorAsRupees(totalDue)}
          </Text>
        </View>
      ) : null}
      <View style={styles.grid}>
        {tiles.map((tile) => (
          <Pressable
            key={tile.key}
            accessibilityRole="button"
            accessibilityLabel={t(tile.label)}
            accessibilityState={{ selected: open === tile.key }}
            onPress={() => setOpen(tile.key)}
            style={[
              styles.tile,
              {
                backgroundColor: open === tile.key ? colors.primary : colors.surface,
                borderColor: open === tile.key ? colors.primary : colors.border,
              },
            ]}
          >
            <Text style={styles.tileEmoji}>{tile.emoji}</Text>
            <Text
              style={[
                styles.tileText,
                { color: open === tile.key ? colors.background : colors.foreground },
              ]}
            >
              {t(tile.label)}
            </Text>
          </Pressable>
        ))}
      </View>
      {error ? <Text style={[styles.error, { color: colors.error }]}>{error}</Text> : null}

      {open === "money" && data.money
        ? data.money.map((row) => (
            <View
              key={row.siteId}
              style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}
            >
              {data.money!.length > 1 ? (
                <Text style={[styles.cardTitle, { color: colors.foreground }]}>{row.siteName}</Text>
              ) : null}
              <BigRow
                emoji="🟢"
                label={t("Still to get")}
                value={formatMinorAsRupees(row.dueMinor)}
                color={colors.success}
              />
              <BigRow
                emoji="✅"
                label={t("Already got")}
                value={formatMinorAsRupees(row.paidMinor)}
                color={colors.foreground}
              />
              <BigRow
                emoji="🔻"
                label={t("Advance to return")}
                value={formatMinorAsRupees(row.advanceOutstandingMinor)}
                color={colors.warning}
              />
              {row.lastPaidOn ? (
                <Text style={[styles.sub, { color: colors.muted }]}>
                  {t("Last paid on {date}", { date: shortDate(row.lastPaidOn) })}
                </Text>
              ) : null}
            </View>
          ))
        : null}

      {open === "attendance" && data.attendance ? (
        <View
          style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}
        >
          <Text style={[styles.sub, { color: colors.muted }]}>
            ✓ {t("Full day")} ½ {t("Half day")} ✗ {t("Absent")} ⏳ {t("Not checked yet")}
          </Text>
          {data.attendance.length === 0 ? (
            <Text style={[styles.cardTitle, { color: colors.muted }]}>
              {t("No attendance yet")}
            </Text>
          ) : (
            data.attendance.map((row) => {
              const sign = attendanceSign(row);
              const tone =
                sign === "✓" ? colors.success : sign === "½" ? colors.warning : colors.error;
              return (
                <View key={`${row.date}-${row.siteName}`} style={styles.dayRow}>
                  <Text style={[styles.dayDate, { color: colors.foreground }]}>
                    {shortDate(row.date)}
                  </Text>
                  <Text style={[styles.daySign, { color: tone }]}>{sign}</Text>
                  <Text style={[styles.sub, { color: colors.muted, flex: 1 }]}>
                    {row.overtimeHours !== "0" && row.overtimeHours !== "0.00"
                      ? `⏱ ${row.overtimeHours}h  `
                      : ""}
                    {row.approved ? "" : "⏳"}
                  </Text>
                </View>
              );
            })
          )}
        </View>
      ) : null}

      {open === "drawings" && data.drawings ? (
        <View style={{ gap: 10 }}>
          {data.drawings.length === 0 ? (
            <Text style={[styles.cardTitle, { color: colors.muted }]}>
              {t("No drawings shared yet")}
            </Text>
          ) : (
            data.drawings.map((doc) => (
              <Pressable
                key={doc.id}
                accessibilityRole="button"
                accessibilityLabel={`${t("Open drawing")} ${doc.title}`}
                onPress={() => void showDrawing(doc.id)}
                style={[
                  styles.card,
                  styles.drawing,
                  { backgroundColor: colors.surface, borderColor: colors.border },
                ]}
              >
                <Text style={styles.tileEmoji}>📄</Text>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.cardTitle, { color: colors.foreground }]}>{doc.title}</Text>
                  <Text style={[styles.sub, { color: colors.muted }]}>
                    {doc.siteName ?? ""} · v{doc.version}
                  </Text>
                </View>
              </Pressable>
            ))
          )}
        </View>
      ) : null}

      {open === "call" && data.contacts ? (
        <View style={{ gap: 10 }}>
          {data.contacts.length === 0 ? (
            <Text style={[styles.cardTitle, { color: colors.muted }]}>
              {t("No phone number saved yet")}
            </Text>
          ) : (
            data.contacts.map((contact) => (
              <Pressable
                key={contact.phone}
                accessibilityRole="button"
                accessibilityLabel={`${t("Call")} ${contact.name ?? ""}`}
                onPress={() => void Linking.openURL(`tel:${contact.phone}`)}
                style={[styles.call, { backgroundColor: colors.success }]}
              >
                <Text style={styles.callText}>📞 {contact.name ?? contact.phone}</Text>
                <Text style={styles.callSub}>{t(contact.role)}</Text>
              </Pressable>
            ))
          )}
        </View>
      ) : null}

      {selfMode ? <WorkerFooter /> : null}
    </ScrollView>
  );
}

function BigRow({
  emoji,
  label,
  value,
  color,
}: {
  emoji: string;
  label: string;
  value: string;
  color: string;
}) {
  const colors = useColors();
  return (
    <View style={styles.bigRow}>
      <Text style={styles.bigEmoji}>{emoji}</Text>
      <Text style={[styles.bigLabel, { color: colors.muted }]}>{label}</Text>
      <Text style={[styles.bigValue, { color }]}>{value}</Text>
    </View>
  );
}

/** Site tracking (with consent) and sign out, on the worker's own phone. */
function WorkerFooter() {
  const colors = useColors();
  const { t } = useT();
  const auth = useAuth({ autoFetch: false });
  const queryClient = useQueryClient();
  const utils = trpc.useUtils();
  const router = useRouter();
  const serverLogout = trpc.auth.logout.useMutation();
  const fences = trpc.jp.presence.myFences.useQuery(undefined, { enabled: Platform.OS !== "web" });
  const [tracking, setTracking] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    void siteAlertsEnabled().then((value) => {
      if (active) setTracking(value);
    });
    return () => {
      active = false;
    };
  }, []);
  const toggle = async () => {
    setBusy(true);
    setMessage(null);
    try {
      if (tracking) {
        await stopSiteAlerts();
        setTracking(false);
      } else {
        await startSiteAlerts(fences.data ?? []);
        setTracking(true);
      }
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : t("Could not change it."));
    } finally {
      setBusy(false);
    }
  };
  return (
    <View style={{ gap: 12, marginTop: 8 }}>
      {Platform.OS !== "web" ? (
        <Pressable
          accessibilityRole="switch"
          accessibilityState={{ checked: Boolean(tracking), disabled: busy }}
          onPress={() => void toggle()}
          style={[
            styles.card,
            {
              backgroundColor: colors.surface,
              borderColor: tracking ? colors.success : colors.border,
            },
          ]}
        >
          <Text style={[styles.cardTitle, { color: colors.foreground }]}>
            📍 {tracking ? t("Site arrival/leaving: ON") : t("Site arrival/leaving: OFF")}
          </Text>
          <Text style={[styles.sub, { color: colors.muted }]}>
            {t(
              "Your phone tells the supervisor only when you reach or leave the site, during working hours.",
            )}
          </Text>
          {busy ? <ActivityIndicator color={colors.primary} /> : null}
          {message ? <Text style={[styles.error, { color: colors.error }]}>{message}</Text> : null}
        </Pressable>
      ) : null}
      <Pressable
        accessibilityRole="button"
        onPress={() => {
          void (async () => {
            await stopSiteAlerts().catch(() => null);
            // Revoke the session on the server (also clears the web cookie), then on the phone.
            await serverLogout.mutateAsync().catch(() => null);
            await auth.logout();
            // Nothing of this worker stays cached for the next person on the phone.
            queryClient.clear();
            await utils.auth.me.invalidate();
            router.replace("/" as never);
          })();
        }}
        style={[styles.signOut, { borderColor: colors.border }]}
      >
        <Text style={[styles.cardTitle, { color: colors.error }]}>🚪 {t("Sign out")}</Text>
      </Pressable>
    </View>
  );
}

/** The signed-in worker's screen, used by AuthGate for worker logins. */
export function WorkerSelf() {
  const colors = useColors();
  const { t } = useT();
  const me = trpc.jp.worker.me.useQuery();
  const open = trpc.jp.worker.openDrawing.useMutation();
  if (me.isLoading)
    return (
      <View style={[styles.state, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  if (!me.data)
    return (
      <View style={[styles.state, { backgroundColor: colors.background }]}>
        <Text style={[styles.cardTitle, { color: colors.error }]}>
          {me.error?.message ?? t("Could not open.")}
        </Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => void me.refetch()}
          style={[styles.signOut, { borderColor: colors.border }]}
        >
          <Text style={[styles.cardTitle, { color: colors.primary }]}>🔄 {t("Try again")}</Text>
        </Pressable>
        <WorkerFooter />
      </View>
    );
  return (
    <WorkerHome
      data={me.data}
      selfMode
      openDrawing={(documentId) => open.mutateAsync({ documentId })}
    />
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, paddingTop: 48, paddingBottom: 48, gap: 14 },
  state: { flex: 1, justifyContent: "center", padding: 24, gap: 16 },
  langRow: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  lang: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 22, borderWidth: 1 },
  langText: { fontSize: 17, fontWeight: "800" },
  hello: { fontSize: 30, fontWeight: "900" },
  sub: { fontSize: 15, lineHeight: 21 },
  hero: { borderRadius: 22, padding: 20, alignItems: "center" },
  heroLabel: { color: "#fff", fontSize: 18, fontWeight: "800" },
  heroValue: { color: "#fff", fontSize: 40, fontWeight: "900", marginTop: 4 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  tile: {
    width: "47%",
    minHeight: 130,
    borderRadius: 22,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
    padding: 12,
    gap: 6,
  },
  tileEmoji: { fontSize: 44 },
  tileText: { fontSize: 18, fontWeight: "900", textAlign: "center" },
  card: { borderRadius: 20, borderWidth: 1, padding: 16, gap: 10 },
  cardTitle: { fontSize: 19, fontWeight: "800" },
  bigRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  bigEmoji: { fontSize: 26 },
  bigLabel: { fontSize: 17, fontWeight: "700", flex: 1 },
  bigValue: { fontSize: 24, fontWeight: "900" },
  dayRow: { flexDirection: "row", alignItems: "center", gap: 14, paddingVertical: 4 },
  dayDate: { fontSize: 18, fontWeight: "800", width: 72 },
  daySign: { fontSize: 30, fontWeight: "900", width: 40, textAlign: "center" },
  drawing: { flexDirection: "row", alignItems: "center" },
  call: { borderRadius: 22, padding: 20, alignItems: "center" },
  callText: { color: "#fff", fontSize: 24, fontWeight: "900" },
  callSub: { color: "#fff", fontSize: 15, fontWeight: "700" },
  signOut: { borderRadius: 20, borderWidth: 1, padding: 16, alignItems: "center" },
  error: { fontSize: 16, fontWeight: "700" },
});
