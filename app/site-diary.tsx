import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { AuthGate } from "@/components/jp/auth-gate";
import {
  AppHeader,
  Card,
  ChipGroup,
  Field,
  InlineError,
  LoadingBlock,
  PrimaryButton,
  Screen,
  SecondaryButton,
  SectionHeader,
  StatusPill,
} from "@/components/jp/ui";
import { useColors } from "@/hooks/use-colors";
import { useT } from "@/lib/i18n";
import { addDays } from "@/lib/jp/analytics";
import { formatMinorAsRupees } from "@/lib/jp/finance-domain";
import { createClientMutationId } from "@/lib/jp/local-repository";
import { resolveSelectedId } from "@/lib/jp/selection";
import { trpc } from "@/lib/trpc";

const NOTE_KINDS = ["Visitor", "Instruction", "Meeting", "Weather", "General"] as const;
type NoteKind = (typeof NOTE_KINDS)[number];

function todayIst() {
  return new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
}

/** Site diary: everything that happened on one site on one day, on one page. */
export default function SiteDiaryScreen() {
  const { t } = useT();
  const colors = useColors();
  const router = useRouter();
  const params = useLocalSearchParams<{ siteId?: string; date?: string }>();
  const sites = trpc.jp.workspace.mySites.useQuery();
  const [chosen, setChosen] = useState(typeof params.siteId === "string" ? params.siteId : "");
  const siteId = resolveSelectedId(sites.data ?? [], chosen);
  const [date, setDate] = useState(typeof params.date === "string" ? params.date : todayIst());
  const day = trpc.jp.diary.day.useQuery(
    { siteId, date },
    { enabled: Boolean(siteId), retry: false },
  );
  const addNote = trpc.jp.diary.addNote.useMutation();
  const [kind, setKind] = useState<NoteKind>("Instruction");
  const [person, setPerson] = useState("");
  const [role, setRole] = useState("");
  const [text, setText] = useState("");
  const [noteKey, setNoteKey] = useState(() => createClientMutationId());
  const [error, setError] = useState<string | null>(null);
  const data = day.data;
  const today = todayIst();

  const saveNote = async () => {
    setError(null);
    try {
      await addNote.mutateAsync({
        siteId,
        date,
        kind,
        personName: person || undefined,
        personRole: role || undefined,
        text,
        clientMutationId: noteKey,
      });
      setText("");
      setPerson("");
      setRole("");
      setNoteKey(createClientMutationId());
      await day.refetch();
    } catch (cause) {
      setError(cause instanceof Error ? t(cause.message) : t("Could not save. Try again."));
    }
  };

  const report = (k: "DPR" | "DLR") => data?.reports?.find((row) => row.kind === k) ?? null;

  return (
    <AuthGate>
      <Screen>
        <ScrollView
          contentContainerStyle={{ paddingBottom: 40, gap: 12 }}
          keyboardShouldPersistTaps="handled"
          refreshControl={
            <RefreshControl refreshing={day.isRefetching} onRefresh={() => void day.refetch()} />
          }
        >
          <AppHeader
            eyebrow={t("Site diary")}
            title={data?.site.name ?? t("Site diary")}
            subtitle={t("Everything that happened on site on one page.")}
          />
          {(sites.data?.length ?? 0) > 1 ? (
            <ChipGroup
              options={(sites.data ?? []).map((site) => site.id)}
              value={siteId || null}
              onChange={setChosen}
              format={(id) => sites.data?.find((site) => site.id === id)?.name ?? id}
            />
          ) : null}
          <View
            style={[
              styles.dateBar,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("Previous day")}
              onPress={() => setDate(addDays(date, -1))}
              hitSlop={10}
              style={styles.arrow}
            >
              <MaterialIcons name="chevron-left" size={30} color={colors.primary} />
            </Pressable>
            <View style={{ alignItems: "center" }}>
              <Text style={[styles.date, { color: colors.foreground }]}>{date}</Text>
              <Text style={[styles.small, { color: colors.muted }]}>
                {date === today ? t("Today") : ""}
              </Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("Next day")}
              disabled={date >= today}
              onPress={() => setDate(addDays(date, 1))}
              hitSlop={10}
              style={[styles.arrow, { opacity: date >= today ? 0.3 : 1 }]}
            >
              <MaterialIcons name="chevron-right" size={30} color={colors.primary} />
            </Pressable>
          </View>
          {day.isLoading ? <LoadingBlock label={t("Loading…")} /> : null}
          {day.isError ? (
            <InlineError message={t(day.error.message)} onRetry={() => void day.refetch()} />
          ) : null}
          {data ? (
            <>
              {data.reports ? (
                <Card>
                  <Text style={[styles.title, { color: colors.foreground }]}>
                    {t("Daily reports")}
                  </Text>
                  {(["DPR", "DLR"] as const).map((k) => {
                    const row = report(k);
                    return (
                      <View key={k} style={styles.line}>
                        <Text style={[styles.body, { color: colors.foreground, flex: 1 }]}>
                          {k === "DPR" ? t("Progress report (DPR)") : t("Labour report (DLR)")}
                        </Text>
                        <StatusPill
                          compact
                          label={row ? t(row.status) : t("Not sent")}
                          tone={row && row.status !== "Draft" ? "success" : "warning"}
                        />
                        {data.can.writeReport ? (
                          <Pressable
                            accessibilityRole="button"
                            onPress={() =>
                              router.push(
                                (row
                                  ? `/report-editor?reportId=${row.id}`
                                  : `/report-editor?siteId=${siteId}&kind=${k}`) as never,
                              )
                            }
                            hitSlop={8}
                          >
                            <Text style={[styles.link, { color: colors.primary }]}>
                              {row ? t("Open") : t("Write")}
                            </Text>
                          </Pressable>
                        ) : null}
                      </View>
                    );
                  })}
                  {report("DPR")?.weather ? (
                    <Text style={[styles.small, { color: colors.muted }]}>
                      {t("Weather")}: {t(report("DPR")!.weather!)}
                    </Text>
                  ) : null}
                </Card>
              ) : null}

              {data.attendance ? (
                <Card>
                  <View style={styles.line}>
                    <Text style={[styles.title, { color: colors.foreground, flex: 1 }]}>
                      {t("Attendance")}
                    </Text>
                    {data.can.markAttendance ? (
                      <Pressable
                        accessibilityRole="button"
                        onPress={() => router.push(`/attendance?siteId=${siteId}` as never)}
                        hitSlop={8}
                      >
                        <Text style={[styles.link, { color: colors.primary }]}>{t("Mark")}</Text>
                      </Pressable>
                    ) : null}
                  </View>
                  <Text style={[styles.body, { color: colors.foreground }]}>
                    {t("{present} present · {half} half day · {absent} absent · {leave} on leave", {
                      present: data.attendance.present,
                      half: data.attendance.half,
                      absent: data.attendance.absent,
                      leave: data.attendance.leave,
                    })}
                  </Text>
                  {data.attendance.trades.length ? (
                    <Text style={[styles.small, { color: colors.muted }]}>
                      {data.attendance.trades
                        .map((row) => `${t(row.trade)} ${row.people}`)
                        .join(" · ")}
                    </Text>
                  ) : null}
                </Card>
              ) : null}

              {data.hindrances ? (
                <Card accent={data.hindrances.length ? "warning" : undefined}>
                  <View style={styles.line}>
                    <Text style={[styles.title, { color: colors.foreground, flex: 1 }]}>
                      {t("Hindrances")}
                    </Text>
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => router.push(`/hindrances?siteId=${siteId}` as never)}
                      hitSlop={8}
                    >
                      <Text style={[styles.link, { color: colors.primary }]}>{t("Register")}</Text>
                    </Pressable>
                  </View>
                  {data.hindrances.length ? (
                    data.hindrances.map((row) => (
                      <Text key={row.code} style={[styles.body, { color: colors.foreground }]}>
                        ⚠ {row.code} · {t(row.category)} · {t(row.affectsWork)} — {row.description}
                      </Text>
                    ))
                  ) : (
                    <Text style={[styles.small, { color: colors.muted }]}>
                      {t("No hindrance on this day.")}
                    </Text>
                  )}
                </Card>
              ) : null}

              {data.store?.length ? (
                <Card>
                  <Text style={[styles.title, { color: colors.foreground }]}>
                    {t("Store in / out")}
                  </Text>
                  {data.store.map((row, i) => (
                    <Text key={i} style={[styles.body, { color: colors.foreground }]}>
                      {row.direction === "Inbound" ? "⬇" : "⬆"} {row.item}: {row.quantity}{" "}
                      {row.unit} · {t(row.type)} ({t(row.status)})
                    </Text>
                  ))}
                </Card>
              ) : null}

              {data.pettyCash?.length ? (
                <Card>
                  <Text style={[styles.title, { color: colors.foreground }]}>
                    {t("Petty cash spent")}
                  </Text>
                  {data.pettyCash.map((row, i) => (
                    <Text key={i} style={[styles.body, { color: colors.foreground }]}>
                      {row.payee} {formatMinorAsRupees(row.amountMinor)} — {row.purpose} (
                      {t(row.status)})
                    </Text>
                  ))}
                </Card>
              ) : null}

              {data.issues?.length ? (
                <Card>
                  <Text style={[styles.title, { color: colors.foreground }]}>
                    {t("Issues raised")}
                  </Text>
                  {data.issues.map((row) => (
                    <Text key={row.code} style={[styles.body, { color: colors.foreground }]}>
                      {row.code} · {t(row.severity)} · {row.title} ({t(row.status)})
                    </Text>
                  ))}
                </Card>
              ) : null}

              {data.notes ? (
                <>
                  <SectionHeader
                    title={t("Diary notes")}
                    caption={t("Visitors, instructions, meetings")}
                  />
                  {data.notes.map((note) => (
                    <Card key={note.id}>
                      <View style={styles.line}>
                        <StatusPill compact label={t(note.kind)} tone="info" />
                        {note.personName ? (
                          <Text style={[styles.small, { color: colors.muted }]}>
                            {note.personName}
                            {note.personRole ? ` · ${note.personRole}` : ""}
                          </Text>
                        ) : null}
                      </View>
                      <Text style={[styles.body, { color: colors.foreground, marginTop: 6 }]}>
                        {note.text}
                      </Text>
                    </Card>
                  ))}
                  {!data.notes.length ? (
                    <Text style={[styles.small, { color: colors.muted }]}>
                      {t("No notes for this day yet.")}
                    </Text>
                  ) : null}
                  {data.can.addNote && data.site.status === "Active" && date <= today ? (
                    <Card>
                      <ChipGroup
                        label={t("Type")}
                        options={NOTE_KINDS}
                        value={kind}
                        onChange={setKind}
                        format={(value) => t(value)}
                      />
                      {kind === "Visitor" || kind === "Instruction" || kind === "Meeting" ? (
                        <View style={styles.two}>
                          <View style={{ flex: 1 }}>
                            <Field
                              label="Name"
                              value={person}
                              onChangeText={setPerson}
                              placeholder="e.g. AE, RWSS"
                            />
                          </View>
                          <View style={{ flex: 1 }}>
                            <Field
                              label="Designation"
                              value={role}
                              onChangeText={setRole}
                              placeholder="e.g. Assistant Engineer"
                            />
                          </View>
                        </View>
                      ) : null}
                      <Field
                        label="Note"
                        value={text}
                        onChangeText={setText}
                        multiline
                        placeholder="What was said or decided"
                      />
                      {error ? <Text style={{ color: colors.error }}>{error}</Text> : null}
                      <PrimaryButton
                        icon="note-add"
                        label={t("Add to diary")}
                        disabled={text.trim().length < 2 || addNote.isPending}
                        onPress={() => void saveNote()}
                      />
                    </Card>
                  ) : null}
                </>
              ) : null}
              <SecondaryButton
                icon="today"
                label={t("Go to today")}
                onPress={() => setDate(today)}
                disabled={date === today}
              />
            </>
          ) : null}
        </ScrollView>
      </Screen>
    </AuthGate>
  );
}

const styles = StyleSheet.create({
  dateBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderWidth: 1,
    borderRadius: 16,
    paddingVertical: 6,
    paddingHorizontal: 4,
  },
  arrow: { width: 48, height: 48, alignItems: "center", justifyContent: "center" },
  date: { fontSize: 18, fontWeight: "800" },
  title: { fontSize: 15, fontWeight: "800" },
  body: { fontSize: 14, lineHeight: 21, marginTop: 4 },
  small: { fontSize: 12, lineHeight: 18, marginTop: 4 },
  link: { fontSize: 14, fontWeight: "800" },
  line: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 4 },
  two: { flexDirection: "row", gap: 10, flexWrap: "wrap" },
});
