import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useLocalSearchParams } from "expo-router";
import { useState } from "react";
import {
  Linking,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { AuthGate } from "@/components/jp/auth-gate";
import { Avatar } from "@/components/jp/avatar";
import {
  AppHeader,
  Card,
  ChipGroup,
  EmptyState,
  Field,
  InlineError,
  LoadingBlock,
  PrimaryButton,
  Screen,
  SectionHeader,
  StatusPill,
  formatDateTime,
} from "@/components/jp/ui";
import { useColors } from "@/hooks/use-colors";
import { formatHours } from "@/lib/jp/attendance-domain";
import { formatMinorAsRupees } from "@/lib/jp/finance-domain";
import { createClientMutationId } from "@/lib/jp/local-repository";
import { FEEDBACK_KINDS, validateFeedback, type FeedbackKind } from "@/lib/jp/person-history";
import { useT } from "@/lib/i18n";
import { trpc } from "@/lib/trpc";

const KIND_TONE = {
  Quality: "info",
  Default: "error",
  Safety: "warning",
  Praise: "success",
  "Payment dispute": "accent",
} as const;

/** One person's record across all sites the viewer may see. */
export default function PersonScreen() {
  const { t } = useT();
  const colors = useColors();
  const params = useLocalSearchParams<{ id?: string }>();
  const personId = typeof params.id === "string" ? params.id : "";
  const utils = trpc.useUtils();
  const history = trpc.jp.people.history.useQuery({ personId }, { enabled: Boolean(personId) });
  const addFeedback = trpc.jp.people.addFeedback.useMutation();
  const saveDetails = trpc.jp.people.saveDetails.useMutation();
  const [formOpen, setFormOpen] = useState(false);
  const [kind, setKind] = useState<FeedbackKind>("Quality");
  const [rating, setRating] = useState(4);
  const [note, setNote] = useState("");
  const [feedbackSite, setFeedbackSite] = useState<string | null>(null);
  const [feedbackKey, setFeedbackKey] = useState(createClientMutationId);
  const [editing, setEditing] = useState(false);
  const [address, setAddress] = useState({
    addressLine: "",
    city: "",
    district: "",
    pincode: "",
    alternatePhone: "",
    notes: "",
  });
  const [detailsKey, setDetailsKey] = useState(createClientMutationId);
  const [error, setError] = useState<string | null>(null);

  const data = history.data;
  const editableSites = data?.sites.filter((site) => data.canEdit.includes(site.siteId)) ?? [];
  // Keep the chosen site valid as data changes (derived, not corrected in an effect).
  const chosenSite =
    editableSites.find((site) => site.siteId === feedbackSite)?.siteId ??
    editableSites[0]?.siteId ??
    null;

  const submitFeedback = async () => {
    if (!chosenSite) return;
    const problem = validateFeedback({ kind, rating: kind === "Quality" ? rating : null, note });
    if (problem) {
      setError(problem.message);
      return;
    }
    setError(null);
    try {
      await addFeedback.mutateAsync({
        personId,
        siteId: chosenSite,
        kind,
        rating: kind === "Quality" ? rating : null,
        note: note.trim(),
        clientMutationId: feedbackKey,
      });
      setNote("");
      setFormOpen(false);
      setFeedbackKey(createClientMutationId());
      await Promise.all([
        utils.jp.people.history.invalidate(),
        utils.jp.people.search.invalidate(),
      ]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Not saved.");
    }
  };

  const startEdit = () => {
    const contact = data?.contact;
    setAddress({
      addressLine: contact?.addressLine ?? "",
      city: contact?.city ?? "",
      district: contact?.district ?? "",
      pincode: contact?.pincode ?? "",
      alternatePhone: contact?.alternatePhone ?? "",
      notes: contact?.notes ?? "",
    });
    setEditing(true);
  };

  const submitDetails = async () => {
    if (!chosenSite) return;
    setError(null);
    try {
      await saveDetails.mutateAsync({
        personId,
        siteId: chosenSite,
        ...address,
        vendorId: data?.contact?.vendorId ?? null,
        clientMutationId: detailsKey,
      });
      setEditing(false);
      setDetailsKey(createClientMutationId());
      await utils.jp.people.history.invalidate();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Not saved.");
    }
  };

  return (
    <AuthGate>
      <Screen>
        <ScrollView
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.content}
          refreshControl={
            <RefreshControl
              refreshing={history.isRefetching}
              onRefresh={() => void history.refetch()}
              tintColor={colors.primary}
            />
          }
        >
          {history.isLoading ? (
            <LoadingBlock label="Loading profile…" />
          ) : history.error || !data ? (
            <>
              <AppHeader eyebrow={t("People directory")} title={t("Profile")} />
              <InlineError
                message={history.error?.message ?? "This profile could not be opened."}
                onRetry={() => void history.refetch()}
              />
            </>
          ) : (
            <>
              <AppHeader eyebrow={t("People directory")} title={data.person.fullName} />
              <Card>
                <View style={styles.headRow}>
                  <Avatar name={data.person.fullName} size={58} tone="gold" />
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.meta, { color: colors.muted }]}>
                      {[data.person.tradeType, t(data.person.skillCategory)]
                        .filter(Boolean)
                        .join(" · ")}
                    </Text>
                    <View style={styles.pills}>
                      <StatusPill
                        label={t(data.person.status)}
                        tone={data.person.status === "Active" ? "success" : "warning"}
                        compact
                      />
                      {data.person.kycStatus ? (
                        <StatusPill label={data.person.kycStatus} tone="info" compact />
                      ) : null}
                    </View>
                  </View>
                  <View style={styles.ratingBox}>
                    <Text style={[styles.ratingValue, { color: colors.foreground }]}>
                      {data.feedbackSummary.averageRating?.toFixed(1) ?? "—"}
                    </Text>
                    <View style={styles.badge}>
                      <MaterialIcons name="star" size={13} color={colors.accent} />
                      <Text style={[styles.meta, { color: colors.muted, marginTop: 0 }]}>
                        {t("{count} ratings", { count: data.feedbackSummary.ratedCount })}
                      </Text>
                    </View>
                  </View>
                </View>
                <View style={styles.statRow}>
                  <Stat value={String(data.sites.length)} label={t("Sites")} />
                  <Stat
                    value={String(
                      data.sites.reduce((sum, site) => sum + (site.work?.daysPresent ?? 0), 0),
                    )}
                    label={t("Days worked")}
                  />
                  <Stat
                    value={String(data.feedbackSummary.counts.Default)}
                    label={t("Defaults")}
                    alert={data.feedbackSummary.counts.Default > 0}
                  />
                </View>
              </Card>

              <SectionHeader
                title={t("Contact")}
                action={data.contact && chosenSite && !editing ? t("Edit") : undefined}
                onPress={startEdit}
              />
              {!data.contact ? (
                <Card>
                  <Text style={[styles.meta, { color: colors.muted }]}>
                    {t("Contact details are shown to people who manage the workforce.")}
                  </Text>
                </Card>
              ) : editing ? (
                <Card>
                  <Field
                    label={t("Address")}
                    value={address.addressLine}
                    onChangeText={(v) => setAddress({ ...address, addressLine: v })}
                  />
                  <Field
                    label={t("City / village")}
                    value={address.city}
                    onChangeText={(v) => setAddress({ ...address, city: v })}
                  />
                  <Field
                    label={t("District")}
                    value={address.district}
                    onChangeText={(v) => setAddress({ ...address, district: v })}
                  />
                  <Field
                    label={t("PIN code")}
                    value={address.pincode}
                    keyboardType="number-pad"
                    maxLength={6}
                    onChangeText={(v) => setAddress({ ...address, pincode: v })}
                  />
                  <Field
                    label={t("Second phone")}
                    value={address.alternatePhone}
                    keyboardType="phone-pad"
                    onChangeText={(v) => setAddress({ ...address, alternatePhone: v })}
                  />
                  <Field
                    label={t("Notes")}
                    value={address.notes}
                    multiline
                    onChangeText={(v) => setAddress({ ...address, notes: v })}
                  />
                  <PrimaryButton
                    label={t("Save details")}
                    icon="save"
                    loading={saveDetails.isPending}
                    onPress={() => void submitDetails()}
                  />
                </Card>
              ) : (
                <Card>
                  {data.person.phone ? (
                    <Pressable
                      accessibilityRole="link"
                      onPress={() => void Linking.openURL(`tel:${data.person.phone}`)}
                      style={styles.contactRow}
                    >
                      <MaterialIcons name="call" size={18} color={colors.primary} />
                      <Text style={[styles.body, { color: colors.primary }]}>
                        {data.person.phone}
                      </Text>
                    </Pressable>
                  ) : null}
                  {data.contact.alternatePhone ? (
                    <View style={styles.contactRow}>
                      <MaterialIcons name="phone" size={18} color={colors.muted} />
                      <Text style={[styles.body, { color: colors.foreground }]}>
                        {data.contact.alternatePhone}
                      </Text>
                    </View>
                  ) : null}
                  <View style={styles.contactRow}>
                    <MaterialIcons name="place" size={18} color={colors.muted} />
                    <Text style={[styles.body, { color: colors.foreground, flex: 1 }]}>
                      {[
                        data.contact.addressLine,
                        data.contact.city,
                        data.contact.district,
                        data.contact.pincode,
                      ]
                        .filter(Boolean)
                        .join(", ") || t("Address not recorded")}
                    </Text>
                  </View>
                  {data.contact.notes ? (
                    <Text style={[styles.meta, { color: colors.muted }]}>{data.contact.notes}</Text>
                  ) : null}
                </Card>
              )}

              <SectionHeader title={t("Work by site")} />
              {data.sites.length === 0 ? (
                <EmptyState
                  icon="location-off"
                  title="No site work yet"
                  detail="Sites appear once this person is assigned or given a rate."
                />
              ) : (
                data.sites.map((site) => (
                  <Card key={site.siteId}>
                    <Text style={[styles.title, { color: colors.foreground }]}>
                      {site.siteName}
                    </Text>
                    {site.work ? (
                      <Text style={[styles.meta, { color: colors.muted }]}>
                        {t("{days} days present · {hours} h", {
                          days: site.work.daysPresent,
                          hours: formatHours(BigInt(site.work.regularHundredths)),
                        })}
                        {site.work.firstDate
                          ? ` · ${site.work.firstDate} → ${site.work.lastDate}`
                          : ""}
                      </Text>
                    ) : (
                      <Text style={[styles.meta, { color: colors.muted }]}>
                        {t("No attendance recorded")}
                      </Text>
                    )}
                    {site.work?.estimatedEarningsMinor ? (
                      <Text style={[styles.money, { color: colors.foreground }]}>
                        {t("Estimated earnings {amount}", {
                          amount: formatMinorAsRupees(site.work.estimatedEarningsMinor),
                        })}
                      </Text>
                    ) : null}
                    {site.rates?.slice(0, 3).map((rate) => (
                      <Text
                        key={`${rate.effectiveFrom}-${rate.engagementType}`}
                        style={[styles.meta, { color: colors.muted }]}
                      >
                        {rate.engagementType}: {formatMinorAsRupees(rate.rateMinor)} /{" "}
                        {rate.rateType} · {t("from")} {rate.effectiveFrom} · {t(rate.status)}
                      </Text>
                    ))}
                    {site.rates === null ? (
                      <Text style={[styles.meta, { color: colors.muted }]}>
                        {t("Pay details need the compensation permission.")}
                      </Text>
                    ) : null}
                  </Card>
                ))
              )}

              {data.firm ? (
                <>
                  <SectionHeader title={t("Subcontractor firm")} caption={data.firm.name} />
                  <Card>
                    {data.firm.sites.length === 0 ? (
                      <Text style={[styles.meta, { color: colors.muted }]}>
                        {t("No approved bills or posted payments you can see.")}
                      </Text>
                    ) : (
                      data.firm.sites.map((site) => (
                        <View key={site.siteId} style={styles.firmRow}>
                          <Text style={[styles.body, { color: colors.foreground, flex: 1 }]}>
                            {site.siteName}
                          </Text>
                          <Text style={[styles.meta, { color: colors.muted }]}>
                            {site.billedMinor !== null
                              ? `${t("Billed")} ${formatMinorAsRupees(site.billedMinor)}`
                              : ""}
                            {site.paidMinor !== null
                              ? ` · ${t("Paid")} ${formatMinorAsRupees(site.paidMinor)}`
                              : ""}
                          </Text>
                        </View>
                      ))
                    )}
                    <Text style={[styles.meta, { color: colors.muted }]}>
                      {t("Internal ledger records, not bank-verified.")}
                    </Text>
                  </Card>
                </>
              ) : null}

              <SectionHeader
                title={t("Quality, defaults & notes")}
                action={chosenSite && !formOpen ? t("Add") : undefined}
                onPress={() => setFormOpen(true)}
              />
              {formOpen && chosenSite ? (
                <Card>
                  {editableSites.length > 1 ? (
                    <ChipGroup
                      label={t("Site")}
                      options={editableSites.map((site) => site.siteId)}
                      value={chosenSite}
                      onChange={setFeedbackSite}
                      format={(id) => editableSites.find((s) => s.siteId === id)?.siteName ?? id}
                    />
                  ) : null}
                  <ChipGroup
                    label={t("Type")}
                    options={FEEDBACK_KINDS}
                    value={kind}
                    onChange={setKind}
                    format={(value) => t(value)}
                  />
                  {kind === "Quality" ? (
                    <View style={styles.stars}>
                      {[1, 2, 3, 4, 5].map((star) => (
                        <Pressable
                          key={star}
                          accessibilityRole="radio"
                          accessibilityLabel={t("{count} stars", { count: star })}
                          accessibilityState={{ selected: star === rating }}
                          onPress={() => setRating(star)}
                          hitSlop={6}
                        >
                          <MaterialIcons
                            name={star <= rating ? "star" : "star-border"}
                            size={34}
                            color={colors.accent}
                          />
                        </Pressable>
                      ))}
                    </View>
                  ) : null}
                  <Field
                    label={t("What happened")}
                    value={note}
                    onChangeText={setNote}
                    multiline
                    maxLength={1000}
                    hint={t(
                      "Saved permanently with your name. Correct a mistake with a new entry.",
                    )}
                  />
                  <PrimaryButton
                    label={t("Save entry")}
                    icon="save"
                    loading={addFeedback.isPending}
                    onPress={() => void submitFeedback()}
                  />
                </Card>
              ) : null}
              {error ? <InlineError message={error} /> : null}
              {data.feedback.length === 0 ? (
                <EmptyState
                  icon="rate-review"
                  title="No entries yet"
                  detail="Quality ratings, defaults, safety notes and praise appear here."
                />
              ) : (
                data.feedback.map((entry) => (
                  <Card key={entry.id} accent={KIND_TONE[entry.kind]}>
                    <View style={styles.feedbackHead}>
                      <StatusPill label={t(entry.kind)} tone={KIND_TONE[entry.kind]} compact />
                      {entry.rating ? (
                        <Text style={[styles.meta, { color: colors.accent, marginTop: 0 }]}>
                          {"★".repeat(entry.rating)}
                          {"☆".repeat(5 - entry.rating)}
                        </Text>
                      ) : null}
                    </View>
                    <Text style={[styles.body, { color: colors.foreground }]}>{entry.note}</Text>
                    <Text style={[styles.meta, { color: colors.muted }]}>
                      {entry.siteName} · {entry.recordedByName ?? "—"} ·{" "}
                      {formatDateTime(entry.createdAt)}
                    </Text>
                  </Card>
                ))
              )}
            </>
          )}
        </ScrollView>
      </Screen>
    </AuthGate>
  );
}

function Stat({ value, label, alert }: { value: string; label: string; alert?: boolean }) {
  const colors = useColors();
  return (
    <View style={{ flex: 1 }}>
      <Text style={[styles.statValue, { color: alert ? colors.error : colors.foreground }]}>
        {value}
      </Text>
      <Text style={[styles.meta, { color: colors.muted }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { paddingBottom: 32, gap: 10 },
  headRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  pills: { flexDirection: "row", gap: 6, marginTop: 6, flexWrap: "wrap" },
  ratingBox: { alignItems: "flex-end" },
  ratingValue: { fontSize: 26, fontWeight: "800" },
  badge: { flexDirection: "row", alignItems: "center", gap: 3 },
  statRow: { flexDirection: "row", marginTop: 16 },
  statValue: { fontSize: 20, fontWeight: "800" },
  title: { fontSize: 16, fontWeight: "800" },
  meta: { fontSize: 12, marginTop: 4, lineHeight: 17 },
  body: { fontSize: 14, lineHeight: 20 },
  money: { fontSize: 15, fontWeight: "800", marginTop: 6 },
  contactRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 4 },
  firmRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 4 },
  stars: { flexDirection: "row", gap: 4, marginBottom: 10 },
  feedbackHead: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 6 },
});
