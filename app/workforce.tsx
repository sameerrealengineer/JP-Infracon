import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { HelpButton } from "@/components/jp/help";
import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import {
  AppHeader,
  EmptyState,
  InlineError,
  PrimaryButton,
  Screen,
  SectionHeader,
} from "@/components/jp/ui";
import { AuthGate } from "@/components/jp/auth-gate";
import { useColors } from "@/hooks/use-colors";
import { resolveSelectedId } from "@/lib/jp/selection";
import { useSiteParam } from "@/hooks/use-site-param";
import { trpc } from "@/lib/trpc";
import { createClientMutationId } from "@/lib/jp/local-repository";
import { formatPaiseAsRupees } from "@/lib/jp/workforce-domain";

const EMPTY_ID = "00000000-0000-4000-8000-000000000000";
const PERSON_TYPES = [
  ["worker", "Worker"],
  ["technician", "Technician"],
  ["subcontractor_contact", "Subcontractor contact"],
] as const;
const SKILL_CATEGORIES = ["Skilled", "Semi-skilled", "Unskilled", "Not specified"] as const;
const RATE_TYPES = [
  ["daily", "Daily"],
  ["hourly", "Hourly"],
  ["shift", "Shift"],
  ["piece", "Piece"],
  ["per_connection", "Per connection"],
  ["per_measurement", "Per measurement"],
  ["contract", "Contract"],
] as const;
const KYC_STATUSES = [
  "Not Required",
  "Pending",
  "Verified by authorised reviewer",
  "Rejected",
] as const;

type PersonType = (typeof PERSON_TYPES)[number][0];
type RateType = (typeof RATE_TYPES)[number][0];
type KycStatus = (typeof KYC_STATUSES)[number];

function todayString() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}
function errorText(error: unknown) {
  return error instanceof Error ? error.message : "The server did not confirm this action.";
}
function titleCase(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (part) => part.toUpperCase());
}
function rateBasis(value: string) {
  return RATE_TYPES.find(([type]) => type === value)?.[1]?.toLowerCase() ?? value;
}

export default function WorkforceScreen() {
  const colors = useColors();
  const sitesQuery = trpc.jp.workspace.mySites.useQuery();
  const capabilitiesQuery = trpc.jp.workspace.myCapabilities.useQuery();
  const siteParam = useSiteParam();
  const [chosenSiteId, setSiteId] = useState(siteParam);
  const [message, setMessage] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [createKey, setCreateKey] = useState<string | null>(null);
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [personType, setPersonType] = useState<PersonType>("worker");
  const [skillCategory, setSkillCategory] =
    useState<(typeof SKILL_CATEGORIES)[number]>("Not specified");
  const [tradeType, setTradeType] = useState("");
  const [initialKycStatus, setInitialKycStatus] = useState<
    "Not Required" | "Pending" | "unchanged"
  >("unchanged");
  const [reviewPersonId, setReviewPersonId] = useState<string | null>(null);
  const [reviewPersonStatus, setReviewPersonStatus] = useState<"Active" | "Inactive">("Active");
  const [reviewKycStatus, setReviewKycStatus] = useState<KycStatus | "unchanged">("unchanged");
  const [personReviewReason, setPersonReviewReason] = useState("");
  const [personReviewKey, setPersonReviewKey] = useState<string | null>(null);
  const [ratePersonId, setRatePersonId] = useState<string | null>(null);
  const [rateCreateKey, setRateCreateKey] = useState<string | null>(null);
  const [engagementType, setEngagementType] = useState("");
  const [rateType, setRateType] = useState<RateType>("daily");
  const [rateRupees, setRateRupees] = useState("");
  const [effectiveFrom, setEffectiveFrom] = useState(todayString());
  const [effectiveTo, setEffectiveTo] = useState("");
  const [reviewRateId, setReviewRateId] = useState<string | null>(null);
  const [rateDecision, setRateDecision] = useState<"Approve" | "Reject">("Approve");
  const [rateReviewReason, setRateReviewReason] = useState("");
  const [rateReviewKey, setRateReviewKey] = useState<string | null>(null);

  const capabilityRows = capabilitiesQuery.data ?? [];
  const siteOptions = useMemo(
    () =>
      (sitesQuery.data ?? []).filter((site) =>
        capabilityRows.some(
          (capability) => capability.siteId === site.id && capability["workforce.view"],
        ),
      ),
    [sitesQuery.data, capabilityRows],
  );
  const siteId = resolveSelectedId(siteOptions, chosenSiteId);
  const activeSite = siteOptions.find((site) => site.id === siteId);
  const siteCapabilities = capabilityRows.find((capability) => capability.siteId === siteId);
  const canCreate = Boolean(siteCapabilities?.["workforce.manage"]);
  const canReview = Boolean(siteCapabilities?.["workforce.review"]);
  const canViewKyc = Boolean(siteCapabilities?.["workforce.kyc.view"]);
  const canReviewKyc = Boolean(
    canReview && canViewKyc && siteCapabilities?.["workforce.kyc.review"],
  );
  const canViewCompensation = Boolean(siteCapabilities?.["compensation.view"]);
  const canProposeRate = Boolean(
    siteCapabilities?.["compensation.manage"] && siteCapabilities?.["compensation.view"],
  );
  const canReviewRate = Boolean(
    siteCapabilities?.["compensation.review"] && siteCapabilities?.["compensation.view"],
  );
  const peopleQuery = trpc.jp.workforce.list.useQuery(
    { siteId: siteId || EMPTY_ID },
    { enabled: Boolean(siteId) },
  );
  const ratesQuery = trpc.jp.workforce.rates.useQuery(
    { siteId: siteId || EMPTY_ID },
    { enabled: Boolean(siteId && canViewCompensation) },
  );
  const createPersonMutation = trpc.jp.workforce.createPerson.useMutation();
  const reviewPersonMutation = trpc.jp.workforce.reviewPerson.useMutation();
  const proposeRateMutation = trpc.jp.workforce.proposeRate.useMutation();
  const reviewRateMutation = trpc.jp.workforce.reviewRate.useMutation();
  const people = peopleQuery.data ?? [];
  const rates = ratesQuery.data ?? [];

  const refresh = () => {
    void Promise.all([
      sitesQuery.refetch(),
      capabilitiesQuery.refetch(),
      peopleQuery.refetch(),
      ...(canViewCompensation ? [ratesQuery.refetch()] : []),
    ]);
  };
  const resetCreateKey = () => setCreateKey(null);
  const createPerson = async () => {
    if (!siteId || fullName.trim().length < 2) {
      setMessage("Choose an assigned site and enter the worker’s name.");
      return;
    }
    const clientMutationId = createKey ?? createClientMutationId();
    const requestedInitialKycStatus =
      canReviewKyc && initialKycStatus !== "unchanged" ? initialKycStatus : undefined;
    setCreateKey(clientMutationId);
    try {
      await createPersonMutation.mutateAsync({
        siteId,
        fullName: fullName.trim(),
        personType,
        phone: phone.trim() || undefined,
        skillCategory,
        tradeType: tradeType.trim() || undefined,
        ...(requestedInitialKycStatus ? { initialKycStatus: requestedInitialKycStatus } : {}),
        clientMutationId,
      });
      setShowCreate(false);
      setFullName("");
      setPhone("");
      setTradeType("");
      setInitialKycStatus("unchanged");
      setCreateKey(null);
      setMessage(
        `Worker profile saved as Draft and assigned to this site. It is not active until review. Initial KYC state: ${requestedInitialKycStatus ?? "Pending"}.`,
      );
      await peopleQuery.refetch();
    } catch (error) {
      setMessage(
        `Profile was not confirmed: ${errorText(error)} The same retry key is retained while this form remains unchanged.`,
      );
    }
  };

  const openPersonReview = (person: (typeof people)[number]) => {
    setReviewPersonId(person.id);
    setReviewPersonStatus(person.status === "Inactive" ? "Inactive" : "Active");
    setReviewKycStatus("unchanged");
    setPersonReviewReason("");
    setPersonReviewKey(null);
  };
  const reviewPerson = async () => {
    if (!reviewPersonId || personReviewReason.trim().length < 3) {
      setMessage("Add a short reason before applying a workforce review.");
      return;
    }
    const clientMutationId = personReviewKey ?? createClientMutationId();
    setPersonReviewKey(clientMutationId);
    try {
      await reviewPersonMutation.mutateAsync({
        siteId,
        personId: reviewPersonId,
        status: reviewPersonStatus,
        kycStatus: reviewKycStatus === "unchanged" ? undefined : reviewKycStatus,
        reason: personReviewReason.trim(),
        clientMutationId,
      });
      const kycMessage =
        reviewKycStatus === "Verified by authorised reviewer"
          ? " KYC status records a manual reviewer decision only; no automated verification is performed."
          : "";
      setMessage(`Workforce profile review saved.${kycMessage}`);
      setReviewPersonId(null);
      setPersonReviewReason("");
      setPersonReviewKey(null);
      await peopleQuery.refetch();
    } catch (error) {
      setMessage(`Review was not confirmed: ${errorText(error)}`);
    }
  };

  const openRateProposal = (personId: string) => {
    setRatePersonId(personId);
    setRateCreateKey(null);
    setEngagementType("");
    setRateType("daily");
    setRateRupees("");
    setEffectiveFrom(todayString());
    setEffectiveTo("");
  };
  const proposeRate = async () => {
    if (
      !ratePersonId ||
      engagementType.trim().length < 2 ||
      !rateRupees.trim() ||
      !/^\d{4}-\d{2}-\d{2}$/.test(effectiveFrom)
    ) {
      setMessage(
        "Enter a work type, positive rate, and effective start date in YYYY-MM-DD format.",
      );
      return;
    }
    const clientMutationId = rateCreateKey ?? createClientMutationId();
    setRateCreateKey(clientMutationId);
    try {
      await proposeRateMutation.mutateAsync({
        siteId,
        personId: ratePersonId,
        engagementType: engagementType.trim(),
        rateType,
        rateRupees: rateRupees.trim(),
        effectiveFrom,
        effectiveTo: effectiveTo.trim() || undefined,
        clientMutationId,
      });
      setMessage(
        "Rate proposal saved as Draft. It is not an active rate or a payable until reviewed and applied to an approved attendance workflow.",
      );
      setRatePersonId(null);
      setRateCreateKey(null);
      await ratesQuery.refetch();
    } catch (error) {
      setMessage(`Rate proposal was not confirmed: ${errorText(error)}`);
    }
  };

  const openRateReview = (rateId: string, decision: "Approve" | "Reject") => {
    setReviewRateId(rateId);
    setRateDecision(decision);
    setRateReviewReason("");
    setRateReviewKey(null);
  };
  const reviewRate = async () => {
    if (!reviewRateId || rateReviewReason.trim().length < 3) {
      setMessage("Add a reason before reviewing this rate proposal.");
      return;
    }
    const clientMutationId = rateReviewKey ?? createClientMutationId();
    setRateReviewKey(clientMutationId);
    try {
      await reviewRateMutation.mutateAsync({
        siteId,
        engagementId: reviewRateId,
        decision: rateDecision,
        reason: rateReviewReason.trim(),
        clientMutationId,
      });
      setMessage(
        rateDecision === "Approve"
          ? "Rate activated for its effective period. Any overlapping prior active rate was retained in history and closed the day before the new rate begins."
          : "Rate proposal rejected; the decision remains in audit history.",
      );
      setReviewRateId(null);
      setRateReviewKey(null);
      setRateReviewReason("");
      await ratesQuery.refetch();
    } catch (error) {
      setMessage(`Rate decision was not confirmed: ${errorText(error)}`);
    }
  };

  return (
    <AuthGate>
      <Screen>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
          <AppHeader
            right={<HelpButton topicKey="workforce" />}
            eyebrow="People & compensation"
            title="Workforce"
            subtitle="Workers, technicians and contacts with KYC status and approved rates."
          />
          {sitesQuery.isError ? (
            <InlineError message={sitesQuery.error.message} onRetry={refresh} />
          ) : null}
          {capabilitiesQuery.isError ? (
            <InlineError message={capabilitiesQuery.error.message} onRetry={refresh} />
          ) : null}
          {message ? (
            <View
              style={[
                styles.message,
                { backgroundColor: `${colors.primary}12`, borderColor: `${colors.primary}40` },
              ]}
            >
              <MaterialIcons name="info-outline" size={17} color={colors.primary} />
              <Text style={[styles.messageText, { color: colors.foreground }]}>{message}</Text>
            </View>
          ) : null}

          <SectionHeader title="Assigned sites" />
          {siteOptions.length ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.siteRow}
            >
              {siteOptions.map((site) => (
                <Pressable
                  key={site.id}
                  accessibilityRole="button"
                  accessibilityState={{ selected: site.id === siteId }}
                  onPress={() => {
                    setSiteId(site.id);
                    setReviewPersonId(null);
                    setRatePersonId(null);
                    setReviewRateId(null);
                    setCreateKey(null);
                    setMessage(null);
                  }}
                  style={[
                    styles.siteChip,
                    {
                      backgroundColor: site.id === siteId ? `${colors.primary}16` : colors.surface,
                      borderColor: site.id === siteId ? colors.primary : colors.border,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.siteName,
                      { color: site.id === siteId ? colors.primary : colors.foreground },
                    ]}
                  >
                    {site.name}
                  </Text>
                  <Text style={[styles.siteProject, { color: colors.muted }]}>{site.project}</Text>
                </Pressable>
              ))}
            </ScrollView>
          ) : sitesQuery.isLoading || capabilitiesQuery.isLoading ? (
            <LoadingLine label="Loading authorised sites…" />
          ) : (
            <EmptyState
              icon="people-outline"
              title="No workforce access"
              detail="No active site with workforce-view permission is available to this account."
            />
          )}

          {activeSite ? (
            <>
              <View
                style={[
                  styles.scopeNote,
                  { backgroundColor: colors.surface, borderColor: colors.border },
                ]}
              >
                <MaterialIcons name="privacy-tip" size={18} color={colors.primary} />
                <Text style={[styles.scopeText, { color: colors.muted }]}>
                  {activeSite.project} · {activeSite.name}. Capture only necessary contact details.
                  A subcontractor-contact record is not a vendor/subcontract account. This screen
                  does not collect DOB, Aadhaar numbers, or identity-document images, and does not
                  execute payroll.
                </Text>
              </View>
              <View style={styles.registerHeader}>
                <View>
                  <Text style={[styles.kicker, { color: colors.muted }]}>SITE WORKFORCE</Text>
                  <Text style={[styles.heading, { color: colors.foreground }]}>
                    {peopleQuery.isSuccess
                      ? `${people.length} profile${people.length === 1 ? "" : "s"}`
                      : peopleQuery.isError
                        ? "Register unavailable"
                        : "Loading workforce…"}
                  </Text>
                </View>
                {canCreate ? (
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => {
                      setShowCreate((value) => !value);
                      setMessage(null);
                    }}
                    style={[styles.addButton, { backgroundColor: colors.primary }]}
                  >
                    <MaterialIcons
                      name={showCreate ? "close" : "person-add-alt-1"}
                      size={18}
                      color={colors.background}
                    />
                    <Text style={[styles.addText, { color: colors.background }]}>
                      {showCreate ? "Close" : "Add person"}
                    </Text>
                  </Pressable>
                ) : null}
              </View>

              {showCreate && canCreate ? (
                <View
                  style={[
                    styles.card,
                    { backgroundColor: colors.surface, borderColor: colors.border },
                  ]}
                >
                  <Text style={[styles.cardTitle, { color: colors.foreground }]}>
                    Capture a workforce profile
                  </Text>
                  <Field
                    label="Full name"
                    value={fullName}
                    onChangeText={(value) => {
                      setFullName(value);
                      resetCreateKey();
                    }}
                    placeholder="Worker or contact name"
                  />
                  <Text style={[styles.label, { color: colors.muted }]}>Record type</Text>
                  <View style={styles.choiceWrap}>
                    {PERSON_TYPES.map(([value, label]) => (
                      <Choice
                        key={value}
                        label={label}
                        selected={personType === value}
                        onPress={() => {
                          setPersonType(value);
                          resetCreateKey();
                        }}
                      />
                    ))}
                  </View>
                  <Field
                    label="Phone · optional"
                    value={phone}
                    onChangeText={(value) => {
                      setPhone(value);
                      resetCreateKey();
                    }}
                    placeholder="Only if operationally needed"
                    keyboardType="phone-pad"
                  />
                  <Text style={[styles.label, { color: colors.muted }]}>Skill category</Text>
                  <View style={styles.choiceWrap}>
                    {SKILL_CATEGORIES.map((value) => (
                      <Choice
                        key={value}
                        label={value}
                        selected={skillCategory === value}
                        onPress={() => {
                          setSkillCategory(value);
                          resetCreateKey();
                        }}
                      />
                    ))}
                  </View>
                  <Field
                    label="Trade / role · optional"
                    value={tradeType}
                    onChangeText={(value) => {
                      setTradeType(value);
                      resetCreateKey();
                    }}
                    placeholder="e.g. Mason, electrician, surveyor"
                  />
                  {canReviewKyc ? (
                    <>
                      <Text style={[styles.label, { color: colors.muted }]}>
                        Initial KYC state · authorised review
                      </Text>
                      <View style={styles.choiceWrap}>
                        <Choice
                          label="Use default · Pending"
                          selected={initialKycStatus === "unchanged"}
                          onPress={() => {
                            setInitialKycStatus("unchanged");
                            resetCreateKey();
                          }}
                        />
                        {(["Not Required", "Pending"] as const).map((value) => (
                          <Choice
                            key={value}
                            label={value}
                            selected={initialKycStatus === value}
                            onPress={() => {
                              setInitialKycStatus(value);
                              resetCreateKey();
                            }}
                          />
                        ))}
                      </View>
                    </>
                  ) : (
                    <Text style={[styles.finePrint, { color: colors.muted }]}>
                      New profiles default to Pending. Only an authorised KYC reviewer may choose or
                      change a different initial status.
                    </Text>
                  )}
                  <PrimaryButton
                    icon="save"
                    label={createPersonMutation.isPending ? "Saving profile…" : "Save as Draft"}
                    disabled={createPersonMutation.isPending}
                    onPress={() => {
                      void createPerson();
                    }}
                  />
                  <Text style={[styles.finePrint, { color: colors.muted }]}>
                    New profiles are inactive Drafts. A reviewer must explicitly activate them.
                    Profile capture is online-only; failed server confirmation retains the same
                    mutation key for a safe retry.
                  </Text>
                </View>
              ) : null}

              {peopleQuery.isLoading ? (
                <LoadingLine label="Loading site workforce from the server…" />
              ) : peopleQuery.isError ? (
                <InlineError
                  message={peopleQuery.error.message}
                  onRetry={() => {
                    void peopleQuery.refetch();
                  }}
                />
              ) : people.length === 0 ? (
                <EmptyState
                  icon="person-search"
                  title="No workforce profiles"
                  detail="No worker or technician profile is assigned to this site yet."
                />
              ) : (
                <View style={styles.stack}>
                  {people.map((person) => (
                    <View
                      key={person.id}
                      style={[
                        styles.personCard,
                        { backgroundColor: colors.surface, borderColor: colors.border },
                      ]}
                    >
                      <View style={styles.personTop}>
                        <View style={[styles.avatar, { backgroundColor: `${colors.primary}16` }]}>
                          <MaterialIcons
                            name={
                              person.personType === "technician"
                                ? "engineering"
                                : person.personType === "subcontractor_contact"
                                  ? "handshake"
                                  : "construction"
                            }
                            size={20}
                            color={colors.primary}
                          />
                        </View>
                        <View style={styles.personMain}>
                          <Text style={[styles.personName, { color: colors.foreground }]}>
                            {person.fullName}
                          </Text>
                          <Text style={[styles.personMeta, { color: colors.muted }]}>
                            {titleCase(person.personType)} ·{" "}
                            {person.tradeType || person.skillCategory}
                          </Text>
                          {person.phone ? (
                            <Text style={[styles.personMeta, { color: colors.muted }]}>
                              {person.phone}
                            </Text>
                          ) : null}
                        </View>
                        <StatusTag label={person.status} good={person.status === "Active"} />
                      </View>
                      <View style={[styles.personFoot, { borderTopColor: colors.border }]}>
                        <Text style={[styles.kycLabel, { color: colors.muted }]}>
                          {canViewKyc
                            ? `KYC · ${person.kycStatus ?? "Unavailable"}`
                            : "KYC · Restricted"}
                        </Text>
                        {canReview ? (
                          <Pressable
                            accessibilityRole="button"
                            onPress={() => openPersonReview(person)}
                          >
                            <Text style={[styles.actionText, { color: colors.primary }]}>
                              {reviewPersonId === person.id ? "Close review" : "Review profile"}
                            </Text>
                          </Pressable>
                        ) : null}
                        {canProposeRate ? (
                          <Pressable
                            accessibilityRole="button"
                            onPress={() => openRateProposal(person.id)}
                          >
                            <Text style={[styles.actionText, { color: colors.primary }]}>
                              Propose rate
                            </Text>
                          </Pressable>
                        ) : null}
                      </View>
                      {reviewPersonId === person.id ? (
                        <View style={[styles.inlinePanel, { borderTopColor: colors.border }]}>
                          <Text style={[styles.label, { color: colors.muted }]}>
                            Profile status
                          </Text>
                          <View style={styles.choiceWrap}>
                            {(["Active", "Inactive"] as const).map((value) => (
                              <Choice
                                key={value}
                                label={value}
                                selected={reviewPersonStatus === value}
                                onPress={() => {
                                  setReviewPersonStatus(value);
                                  setPersonReviewKey(null);
                                }}
                              />
                            ))}
                          </View>
                          {canReviewKyc ? (
                            <>
                              <Text style={[styles.label, { color: colors.muted }]}>
                                Manual KYC decision
                              </Text>
                              <View style={styles.choiceWrap}>
                                <Choice
                                  label="Leave unchanged"
                                  selected={reviewKycStatus === "unchanged"}
                                  onPress={() => {
                                    setReviewKycStatus("unchanged");
                                    setPersonReviewKey(null);
                                  }}
                                />
                                {KYC_STATUSES.map((value) => (
                                  <Choice
                                    key={value}
                                    label={
                                      value === "Verified by authorised reviewer"
                                        ? "Verified · reviewer"
                                        : value
                                    }
                                    selected={reviewKycStatus === value}
                                    onPress={() => {
                                      setReviewKycStatus(value);
                                      setPersonReviewKey(null);
                                    }}
                                  />
                                ))}
                              </View>
                              <Text style={[styles.finePrint, { color: colors.muted }]}>
                                This records a human reviewer’s status only. The app does not
                                authenticate identity documents or perform automated KYC.
                              </Text>
                            </>
                          ) : canViewKyc ? (
                            <Text style={[styles.finePrint, { color: colors.muted }]}>
                              KYC status is read-only for this account; a separate authorised
                              reviewer is required.
                            </Text>
                          ) : null}
                          <Field
                            label="Review reason · required"
                            value={personReviewReason}
                            onChangeText={(value) => {
                              setPersonReviewReason(value);
                              setPersonReviewKey(null);
                            }}
                            placeholder="Reason for activation/status decision"
                            multiline
                          />
                          <PrimaryButton
                            icon="fact-check"
                            label={
                              reviewPersonMutation.isPending ? "Saving review…" : "Confirm review"
                            }
                            disabled={reviewPersonMutation.isPending}
                            onPress={() => {
                              void reviewPerson();
                            }}
                          />
                        </View>
                      ) : null}
                      {ratePersonId === person.id ? (
                        <View style={[styles.inlinePanel, { borderTopColor: colors.border }]}>
                          <Text style={[styles.cardTitle, { color: colors.foreground }]}>
                            Propose an effective-dated rate
                          </Text>
                          <Field
                            label="Engagement / work type"
                            value={engagementType}
                            onChangeText={(value) => {
                              setEngagementType(value);
                              setRateCreateKey(null);
                            }}
                            placeholder="e.g. Masonry, electrical work"
                          />
                          <Text style={[styles.label, { color: colors.muted }]}>Rate basis</Text>
                          <View style={styles.choiceWrap}>
                            {RATE_TYPES.map(([value, label]) => (
                              <Choice
                                key={value}
                                label={label}
                                selected={rateType === value}
                                onPress={() => {
                                  setRateType(value);
                                  setRateCreateKey(null);
                                }}
                              />
                            ))}
                          </View>
                          <Field
                            label="Amount · INR per selected basis"
                            value={rateRupees}
                            onChangeText={(value) => {
                              setRateRupees(value);
                              setRateCreateKey(null);
                            }}
                            placeholder="e.g. 850.00"
                            keyboardType="decimal-pad"
                          />
                          <Field
                            label="Effective from · YYYY-MM-DD"
                            value={effectiveFrom}
                            onChangeText={(value) => {
                              setEffectiveFrom(value);
                              setRateCreateKey(null);
                            }}
                            placeholder="2026-10-27"
                          />
                          <Field
                            label="Effective to · optional, inclusive"
                            value={effectiveTo}
                            onChangeText={(value) => {
                              setEffectiveTo(value);
                              setRateCreateKey(null);
                            }}
                            placeholder="Leave blank for open end"
                          />
                          <View
                            style={[
                              styles.notice,
                              {
                                backgroundColor: `${colors.warning}12`,
                                borderColor: `${colors.warning}35`,
                              },
                            ]}
                          >
                            <MaterialIcons name="info-outline" size={17} color={colors.warning} />
                            <Text style={[styles.noticeText, { color: colors.foreground }]}>
                              This saves a Draft proposal, not a payable. On approval, an
                              overlapping earlier active rate is closed the day before this start;
                              conflicting future rates are rejected rather than overwritten.
                            </Text>
                          </View>
                          <PrimaryButton
                            icon="request-quote"
                            label={
                              proposeRateMutation.isPending
                                ? "Saving proposal…"
                                : "Save rate proposal"
                            }
                            disabled={proposeRateMutation.isPending}
                            onPress={() => {
                              void proposeRate();
                            }}
                          />
                        </View>
                      ) : null}
                    </View>
                  ))}
                </View>
              )}

              {canViewCompensation ? (
                <>
                  <SectionHeader title="Effective-dated rate history" />
                  {ratesQuery.isError ? (
                    <InlineError
                      message={ratesQuery.error.message}
                      onRetry={() => {
                        void ratesQuery.refetch();
                      }}
                    />
                  ) : ratesQuery.isLoading ? (
                    <LoadingLine label="Loading restricted compensation records…" />
                  ) : rates.length === 0 ? (
                    <EmptyState
                      icon="payments"
                      title="No rate records"
                      detail="No rate proposal or active effective-dated engagement is recorded for this site."
                    />
                  ) : (
                    <View style={styles.stack}>
                      {rates.map((rate) => (
                        <View
                          key={rate.id}
                          style={[
                            styles.rateCard,
                            { backgroundColor: colors.surface, borderColor: colors.border },
                          ]}
                        >
                          <View style={styles.rateTop}>
                            <View style={{ flex: 1 }}>
                              <Text style={[styles.rateName, { color: colors.foreground }]}>
                                {rate.personName}
                              </Text>
                              <Text style={[styles.personMeta, { color: colors.muted }]}>
                                {rate.engagementType} · {titleCase(rate.rateType)}
                              </Text>
                            </View>
                            <StatusTag label={rate.status} good={rate.status === "Active"} />
                          </View>
                          <Text style={[styles.rateAmount, { color: colors.primary }]}>
                            {formatPaiseAsRupees(rate.rateMinor)}{" "}
                            <Text style={[styles.rateUnit, { color: colors.muted }]}>
                              / {rateBasis(rate.rateType)}
                            </Text>
                          </Text>
                          <Text style={[styles.personMeta, { color: colors.muted }]}>
                            {rate.currency} · {rate.effectiveFrom}
                            {rate.effectiveTo ? ` to ${rate.effectiveTo}` : " onward"} · dates
                            inclusive
                          </Text>
                          {rate.reviewReason ? (
                            <Text style={[styles.personMeta, { color: colors.muted }]}>
                              Review note: {rate.reviewReason}
                            </Text>
                          ) : null}
                          {canReviewRate && rate.status === "Draft" ? (
                            <View style={styles.reviewActionRow}>
                              <ActionButton
                                label="Activate"
                                onPress={() => openRateReview(rate.id, "Approve")}
                              />
                              <ActionButton
                                label="Reject"
                                destructive
                                onPress={() => openRateReview(rate.id, "Reject")}
                              />
                            </View>
                          ) : null}
                          {reviewRateId === rate.id ? (
                            <View style={[styles.inlinePanel, { borderTopColor: colors.border }]}>
                              <Text style={[styles.cardTitle, { color: colors.foreground }]}>
                                {rateDecision === "Approve"
                                  ? "Confirm rate activation"
                                  : "Reject rate proposal"}
                              </Text>
                              <Field
                                label="Decision reason · required"
                                value={rateReviewReason}
                                onChangeText={(value) => {
                                  setRateReviewReason(value);
                                  setRateReviewKey(null);
                                }}
                                placeholder="Why is this rate approved or rejected?"
                                multiline
                              />
                              <PrimaryButton
                                icon={rateDecision === "Approve" ? "check" : "block"}
                                label={
                                  reviewRateMutation.isPending
                                    ? "Saving decision…"
                                    : `Confirm ${rateDecision.toLowerCase()}`
                                }
                                disabled={reviewRateMutation.isPending}
                                onPress={() => {
                                  void reviewRate();
                                }}
                              />
                              <Pressable
                                accessibilityRole="button"
                                onPress={() => setReviewRateId(null)}
                                style={styles.cancelAction}
                              >
                                <Text style={[styles.actionText, { color: colors.muted }]}>
                                  Cancel
                                </Text>
                              </Pressable>
                            </View>
                          ) : null}
                        </View>
                      ))}
                    </View>
                  )}
                </>
              ) : null}
              <View
                style={[
                  styles.notice,
                  { backgroundColor: colors.surface, borderColor: colors.border },
                ]}
              >
                <MaterialIcons name="info-outline" size={17} color={colors.primary} />
                <Text style={[styles.noticeText, { color: colors.muted }]}>
                  Rates take effect only after a different authorised person approves them. A rate
                  on its own is not a payment due.
                </Text>
              </View>
            </>
          ) : null}
        </ScrollView>
      </Screen>
    </AuthGate>
  );
}

function Field({
  label,
  value,
  onChangeText,
  placeholder,
  keyboardType,
  multiline = false,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
  keyboardType?: "default" | "phone-pad" | "decimal-pad";
  multiline?: boolean;
}) {
  const colors = useColors();
  return (
    <View style={styles.field}>
      <Text style={[styles.label, { color: colors.muted }]}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.muted}
        keyboardType={keyboardType}
        multiline={multiline}
        accessibilityLabel={label}
        style={[
          styles.input,
          multiline && styles.multiline,
          {
            color: colors.foreground,
            backgroundColor: colors.background,
            borderColor: colors.border,
          },
        ]}
      />
    </View>
  );
}

function Choice({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  const colors = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[
        styles.choice,
        {
          backgroundColor: selected ? `${colors.primary}16` : colors.background,
          borderColor: selected ? colors.primary : colors.border,
        },
      ]}
    >
      <Text style={[styles.choiceText, { color: selected ? colors.primary : colors.foreground }]}>
        {label}
      </Text>
    </Pressable>
  );
}

function StatusTag({ label, good }: { label: string; good: boolean }) {
  const colors = useColors();
  return (
    <View
      style={[
        styles.statusTag,
        { backgroundColor: good ? `${colors.success}15` : `${colors.warning}15` },
      ]}
    >
      <Text style={[styles.statusText, { color: good ? colors.success : colors.warning }]}>
        {label}
      </Text>
    </View>
  );
}

function ActionButton({
  label,
  onPress,
  destructive = false,
}: {
  label: string;
  onPress: () => void;
  destructive?: boolean;
}) {
  const colors = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={[styles.actionButton, { borderColor: destructive ? colors.error : colors.primary }]}
    >
      <Text style={[styles.actionText, { color: destructive ? colors.error : colors.primary }]}>
        {label}
      </Text>
    </Pressable>
  );
}

function LoadingLine({ label }: { label: string }) {
  const colors = useColors();
  return (
    <View style={styles.loading}>
      <ActivityIndicator color={colors.primary} />
      <Text style={[styles.loadingText, { color: colors.muted }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { paddingBottom: 34 },
  message: {
    borderWidth: 1,
    borderRadius: 13,
    padding: 12,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    marginBottom: 18,
  },
  messageText: { flex: 1, fontSize: 12, lineHeight: 18 },
  siteRow: { gap: 9, paddingBottom: 12 },
  siteChip: {
    minWidth: 150,
    maxWidth: 235,
    borderWidth: 1,
    borderRadius: 14,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  siteName: { fontSize: 12, fontWeight: "800" },
  siteProject: { fontSize: 10, marginTop: 3 },
  scopeNote: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
    flexDirection: "row",
    gap: 9,
    alignItems: "flex-start",
    marginTop: 8,
    marginBottom: 20,
  },
  scopeText: { flex: 1, fontSize: 11, lineHeight: 16 },
  registerHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    marginBottom: 13,
  },
  kicker: { fontSize: 9, letterSpacing: 1.2, fontWeight: "800" },
  heading: { fontSize: 19, fontWeight: "800", marginTop: 3 },
  addButton: {
    minHeight: 42,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    borderRadius: 12,
    paddingHorizontal: 12,
  },
  addText: { fontSize: 12, fontWeight: "800" },
  card: { borderWidth: 1, borderRadius: 16, padding: 14, marginBottom: 15 },
  cardTitle: { fontSize: 15, fontWeight: "800", marginBottom: 11 },
  field: { marginBottom: 9 },
  label: { fontSize: 10, fontWeight: "800", marginBottom: 5, letterSpacing: 0.35 },
  input: {
    minHeight: 43,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 11,
    paddingVertical: 9,
    fontSize: 13,
  },
  multiline: { minHeight: 68, textAlignVertical: "top" },
  choiceWrap: { flexDirection: "row", flexWrap: "wrap", gap: 7, marginBottom: 10 },
  choice: {
    minHeight: 34,
    borderWidth: 1,
    borderRadius: 17,
    paddingHorizontal: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  choiceText: { fontSize: 10, fontWeight: "700" },
  finePrint: { fontSize: 10, lineHeight: 15, marginTop: 9 },
  stack: { gap: 11 },
  personCard: { borderWidth: 1, borderRadius: 15, padding: 13 },
  personTop: { flexDirection: "row", alignItems: "center", gap: 10 },
  avatar: {
    width: 39,
    height: 39,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
  },
  personMain: { flex: 1 },
  personName: { fontSize: 14, fontWeight: "800" },
  personMeta: { fontSize: 10, lineHeight: 15, marginTop: 3 },
  statusTag: { paddingHorizontal: 8, paddingVertical: 5, borderRadius: 10 },
  statusText: { fontSize: 9, fontWeight: "800" },
  personFoot: {
    borderTopWidth: 1,
    marginTop: 11,
    paddingTop: 9,
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  kycLabel: { fontSize: 10, fontWeight: "700" },
  actionText: { fontSize: 11, fontWeight: "800" },
  inlinePanel: { borderTopWidth: 1, marginTop: 12, paddingTop: 12 },
  notice: {
    borderWidth: 1,
    borderRadius: 13,
    padding: 11,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    marginTop: 13,
    marginBottom: 12,
  },
  noticeText: { fontSize: 10, lineHeight: 15, flex: 1 },
  rateCard: { borderWidth: 1, borderRadius: 14, padding: 13 },
  rateTop: { flexDirection: "row", alignItems: "flex-start", gap: 9 },
  rateName: { fontSize: 13, fontWeight: "800" },
  rateAmount: { fontSize: 18, fontWeight: "900", marginTop: 10 },
  rateUnit: { fontSize: 10, fontWeight: "600" },
  reviewActionRow: { flexDirection: "row", gap: 8, marginTop: 12 },
  actionButton: {
    minHeight: 37,
    paddingHorizontal: 13,
    borderWidth: 1,
    borderRadius: 10,
    justifyContent: "center",
  },
  cancelAction: { minHeight: 36, alignItems: "center", justifyContent: "center", marginTop: 4 },
  loading: { paddingVertical: 22, alignItems: "center", gap: 7 },
  loadingText: { fontSize: 11 },
});
