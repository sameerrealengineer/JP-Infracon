import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { AttachmentStrip } from "@/components/jp/attachment-strip";
import { useWorkspace } from "@/hooks/use-workspace";
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Modal,
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
  OfflineBanner,
  PrimaryButton,
  Screen,
  SectionHeader,
  SecondaryButton,
  SyncPill,
  WorkflowPill,
  styles as uiStyles,
} from "@/components/jp/ui";
import { useColors } from "@/hooks/use-colors";
import { resolveSelectedId } from "@/lib/jp/selection";
import { useSiteParam } from "@/hooks/use-site-param";
import { trpc } from "@/lib/trpc";
import {
  createClientMutationId,
  readDraftStore,
  removeLocalDraft,
  saveMaterialRequest,
} from "@/lib/jp/local-repository";
import type { MaterialRequest, WorkflowStatus } from "@/lib/jp/domain";

function initials(name: string | null | undefined) {
  return (
    name
      ?.trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0])
      .join("") || "?"
  );
}
function formatTime(value: string | Date) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime())
    ? "Time unavailable"
    : new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}
function statusLabel(status: string): WorkflowStatus {
  if (status === "Submitted") return "Pending approval";
  if (status === "Partially Approved") return "Partially Approved";
  return status as WorkflowStatus;
}
function errorText(error: unknown) {
  return error instanceof Error ? error.message : "The server did not confirm this action.";
}

export default function RequestsScreenTab() {
  return <RequestsScreen inTabs />;
}

export function RequestsScreen({ inTabs = false }: { inTabs?: boolean }) {
  const colors = useColors();
  const me = trpc.auth.me.useQuery(undefined, { retry: false });
  const utils = trpc.useUtils();
  const sitesQuery = trpc.jp.workspace.mySites.useQuery();
  const capabilitiesQuery = trpc.jp.workspace.myCapabilities.useQuery();
  const requestsQuery = trpc.jp.materialRequests.list.useQuery(undefined);
  const createMutation = trpc.jp.materialRequests.create.useMutation();
  const [localRequests, setLocalRequests] = useState<MaterialRequest[]>([]);
  const [filter, setFilter] = useState<"All" | "Waiting" | "Returned">("All");
  const [composerVisible, setComposerVisible] = useState(false);
  const [title, setTitle] = useState("");
  const [quantity, setQuantity] = useState("");
  const [unitCode, setUnitCode] = useState("");
  const [purpose, setPurpose] = useState("");
  const siteParam = useSiteParam();
  const [chosenSiteId, setSiteId] = useState(siteParam);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);
  const [pendingSync, setPendingSync] = useState(false);

  useEffect(() => {
    let mounted = true;
    readDraftStore().then((store) => {
      if (mounted) setLocalRequests(store.requests);
    });
    return () => {
      mounted = false;
    };
  }, []);
  const siteOptions = useMemo(
    () =>
      (sitesQuery.data ?? []).filter((site) =>
        capabilitiesQuery.data?.some(
          (capability) => capability.siteId === site.id && capability["material.request"],
        ),
      ),
    [sitesQuery.data, capabilitiesQuery.data],
  );
  const siteId = resolveSelectedId(siteOptions, chosenSiteId);

  const serverRequests: MaterialRequest[] = (requestsQuery.data ?? []).map((request) => {
    const items = request.items ?? [];
    const title = items.map((item) => item.itemNameSnapshot).join(", ") || "Material request";
    const quantity = items.map((item) => `${item.requestedQuantity} ${item.unitCode}`).join(" · ");
    return {
      id: request.id,
      siteId: request.siteId,
      siteName: request.siteName,
      title,
      quantity: quantity || "Quantity not recorded",
      unitCode: items[0]?.unitCode,
      purpose: request.purpose || undefined,
      requestedBy: request.requesterName || "Staff user",
      requestedAt: formatTime(request.createdAt),
      status: statusLabel(request.status),
      approvalNote:
        request.approvalNote ||
        (request.status === "Submitted"
          ? "Submitted and awaiting an authorised reviewer."
          : "No review note recorded."),
      syncStatus: "Synced",
    };
  });
  const requests = useMemo(
    () => [...localRequests, ...serverRequests],
    [localRequests, requestsQuery.data],
  );
  const visibleRequests = useMemo(() => {
    if (filter === "Waiting")
      return requests.filter((request) => request.status === "Pending approval");
    if (filter === "Returned") return requests.filter((request) => request.status === "Returned");
    return requests;
  }, [filter, requests]);
  const localPendingCount = localRequests.filter(
    (request) => request.syncStatus !== "Synced",
  ).length;
  const lastServerResponse = requestsQuery.dataUpdatedAt
    ? formatTime(new Date(requestsQuery.dataUpdatedAt))
    : null;

  const refresh = async () => {
    await Promise.all([requestsQuery.refetch(), sitesQuery.refetch()]);
    const store = await readDraftStore();
    setLocalRequests(store.requests);
  };
  const syncOne = async (draft: MaterialRequest) => {
    const response = await createMutation.mutateAsync({
      siteId: draft.siteId,
      itemName: draft.title,
      quantity: draft.quantity,
      unitCode: draft.unitCode || "unit",
      purpose: draft.purpose,
      clientMutationId: draft.clientMutationId || draft.id,
    });
    await removeLocalDraft("request", draft.id);
    setLocalRequests((current) => current.filter((item) => item.id !== draft.id));
    await requestsQuery.refetch();
    await utils.jp.workspace.dashboard.invalidate();
    return response;
  };
  const retrySync = async () => {
    setPendingSync(true);
    try {
      let lastError: unknown = null;
      for (const draft of localRequests) {
        try {
          await syncOne(draft);
        } catch (error) {
          lastError = error;
        }
      }
      setSavedMessage(
        lastError
          ? `Some local requests remain unconfirmed: ${errorText(lastError)}`
          : "All local material request drafts were sent to the server for review. They are not approved or purchases.",
      );
      await refresh();
    } finally {
      setPendingSync(false);
    }
  };

  const createRequest = async () => {
    const selectedSite = siteOptions.find((item) => item.id === siteId);
    const validQuantity = /^\d{1,11}(?:\.\d{1,3})?$/.test(quantity.trim()) && Number(quantity) > 0;
    if (
      !selectedSite ||
      title.trim().length < 2 ||
      !validQuantity ||
      unitCode.trim().length === 0
    ) {
      setSavedMessage("Enter an assigned site, a material name, a positive quantity, and a unit.");
      return;
    }
    const id = createClientMutationId();
    const draft: MaterialRequest = {
      id,
      clientMutationId: id,
      siteId: selectedSite.id,
      siteName: selectedSite.name,
      title: title.trim(),
      quantity: quantity.trim(),
      unitCode: unitCode.trim(),
      purpose: purpose.trim() || undefined,
      requestedBy: me.data?.name || "Signed-in staff user",
      requestedAt: new Date().toISOString(),
      status: "Queued offline",
      approvalNote: "Saved locally. Not submitted, approved, or ordered.",
      syncStatus: "Pending Sync",
    };
    setLocalRequests((current) => [draft, ...current]);
    await saveMaterialRequest(draft);
    setComposerVisible(false);
    setTitle("");
    setQuantity("");
    setUnitCode("");
    setPurpose("");
    try {
      await syncOne(draft);
      setSavedMessage(
        "Request submitted to the authorised review queue. It is not approved or a purchase.",
      );
    } catch (error) {
      setSavedMessage(`Saved on this device; server sync is not confirmed. ${errorText(error)}`);
    }
  };

  return (
    <Screen inTabs={inTabs}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        <AppHeader
          eyebrow="Material control"
          title="Requests"
          subtitle="Raise material needs from site and track every decision."
          userInitials={initials(me.data?.name)}
        />
        <OfflineBanner
          pendingCount={localPendingCount}
          connected={requestsQuery.isSuccess && sitesQuery.isSuccess}
          lastSyncedAt={lastServerResponse}
          onRetry={retrySync}
          retrying={pendingSync}
        />
        {requestsQuery.isError ? (
          <InlineError
            message={requestsQuery.error.message}
            onRetry={() => {
              void refresh();
            }}
          />
        ) : null}
        {savedMessage ? (
          <View
            style={[
              styles.savedBanner,
              { backgroundColor: `${colors.warning}15`, borderColor: `${colors.warning}45` },
            ]}
          >
            <MaterialIcons name="info-outline" size={17} color={colors.warning} />
            <Text style={[styles.savedText, { color: colors.foreground }]}>{savedMessage}</Text>
          </View>
        ) : null}
        <View style={styles.topAction}>
          <View style={styles.actionCopy}>
            <Text style={[styles.kicker, { color: colors.muted }]}>REQUEST REGISTER</Text>
            <Text style={[styles.subheading, { color: colors.foreground }]}>Material workflow</Text>
          </View>
          <Pressable
            accessibilityRole="button"
            disabled={siteOptions.length === 0}
            onPress={() => setComposerVisible(true)}
            style={({ pressed }) => [
              styles.addButton,
              { backgroundColor: siteOptions.length ? colors.primary : colors.border },
              pressed && uiStyles.pressed,
            ]}
          >
            <MaterialIcons name="add" size={18} color={colors.background} />
            <Text style={[styles.addText, { color: colors.background }]}>
              {siteOptions.length ? "New request" : "No create permission"}
            </Text>
          </Pressable>
        </View>
        <View
          style={[
            styles.policyCard,
            { backgroundColor: colors.surface, borderColor: colors.border },
          ]}
        >
          <View style={[styles.policyIcon, { backgroundColor: `${colors.primary}14` }]}>
            <MaterialIcons name="rule" size={19} color={colors.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.policyTitle, { color: colors.foreground }]}>
              Request ≠ purchase
            </Text>
            <Text style={[styles.policyDetail, { color: colors.muted }]}>
              Approval, supplier evidence, receipt, and stock posting are separate controlled steps.
              This build does not place orders.
            </Text>
          </View>
        </View>
        <View style={styles.filterRow}>
          {(["All", "Waiting", "Returned"] as const).map((item) => (
            <Pressable
              key={item}
              accessibilityRole="button"
              onPress={() => setFilter(item)}
              style={[
                styles.filterChip,
                {
                  backgroundColor: filter === item ? colors.primary : colors.surface,
                  borderColor: filter === item ? colors.primary : colors.border,
                },
              ]}
            >
              <Text
                style={[
                  styles.filterText,
                  { color: filter === item ? colors.background : colors.muted },
                ]}
              >
                {item}
              </Text>
            </Pressable>
          ))}
        </View>
        <SectionHeader title={`${visibleRequests.length} requests`} />
        {requestsQuery.isLoading ? (
          <View style={styles.loading}>
            <ActivityIndicator color={colors.primary} />
            <Text style={[styles.loadingText, { color: colors.muted }]}>
              Loading authorised requests…
            </Text>
          </View>
        ) : requestsQuery.isError ? null : visibleRequests.length === 0 ? (
          <EmptyState
            icon="inventory-2"
            title="No requests in this view"
            detail="No material request record matches this filter in your current assigned-site scope."
          />
        ) : (
          <View style={styles.requestStack}>
            {visibleRequests.map((request) => (
              <RequestCard
                key={request.id}
                request={request}
                localDraft={!serverRequests.some((row) => row.id === request.id)}
                onSync={() => {
                  void syncOne(request)
                    .then(() =>
                      setSavedMessage(
                        "Request sent to the authorised review queue; approval is still pending.",
                      ),
                    )
                    .catch((error) =>
                      setSavedMessage(`Sync is still unconfirmed: ${errorText(error)}`),
                    );
                }}
              />
            ))}
          </View>
        )}
        <View style={styles.auditNote}>
          <MaterialIcons name="lock-outline" size={16} color={colors.primary} />
          <Text style={[styles.auditText, { color: colors.muted }]}>
            Only an authorised reviewer may approve, return, or reject a submitted request.
          </Text>
        </View>
      </ScrollView>

      <Modal
        visible={composerVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setComposerVisible(false)}
      >
        <View style={styles.modalBackdrop}>
          <View
            style={[
              styles.modalCard,
              { backgroundColor: colors.background, borderColor: colors.border },
            ]}
          >
            <View style={styles.modalHeader}>
              <View>
                <Text style={[styles.modalKicker, { color: colors.primary }]}>
                  NEW MATERIAL REQUEST
                </Text>
                <Text style={[styles.modalTitle, { color: colors.foreground }]}>
                  Request for review
                </Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close"
                onPress={() => setComposerVisible(false)}
              >
                <MaterialIcons name="close" size={23} color={colors.foreground} />
              </Pressable>
            </View>
            <Text style={[styles.inputLabel, { color: colors.muted }]}>Material</Text>
            <TextInput
              value={title}
              onChangeText={setTitle}
              placeholder="Material or item description"
              placeholderTextColor={colors.muted}
              style={[
                styles.input,
                {
                  color: colors.foreground,
                  backgroundColor: colors.surface,
                  borderColor: colors.border,
                },
              ]}
            />
            <Text style={[styles.inputLabel, { color: colors.muted }]}>Quantity</Text>
            <TextInput
              value={quantity}
              onChangeText={setQuantity}
              keyboardType="decimal-pad"
              placeholder="Positive quantity"
              placeholderTextColor={colors.muted}
              style={[
                styles.input,
                {
                  color: colors.foreground,
                  backgroundColor: colors.surface,
                  borderColor: colors.border,
                },
              ]}
            />
            <Text style={[styles.inputLabel, { color: colors.muted }]}>Unit</Text>
            <TextInput
              value={unitCode}
              onChangeText={setUnitCode}
              placeholder="e.g. bag, m³, kg"
              placeholderTextColor={colors.muted}
              style={[
                styles.input,
                {
                  color: colors.foreground,
                  backgroundColor: colors.surface,
                  borderColor: colors.border,
                },
              ]}
            />
            <Text style={[styles.inputLabel, { color: colors.muted }]}>Site</Text>
            <ScrollView style={styles.siteChoiceScroll} nestedScrollEnabled>
              {siteOptions.map((site) => (
                <Pressable
                  key={site.id}
                  accessibilityRole="button"
                  onPress={() => setSiteId(site.id)}
                  style={[
                    styles.siteChoice,
                    {
                      backgroundColor: siteId === site.id ? `${colors.primary}16` : colors.surface,
                      borderColor: siteId === site.id ? colors.primary : colors.border,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.siteChoiceText,
                      { color: siteId === site.id ? colors.primary : colors.foreground },
                    ]}
                  >
                    {site.name} · {site.project}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
            <Text style={[styles.inputLabel, { color: colors.muted }]}>
              Purpose / note (optional)
            </Text>
            <TextInput
              value={purpose}
              onChangeText={setPurpose}
              multiline
              placeholder="Why this material is needed"
              placeholderTextColor={colors.muted}
              style={[
                styles.input,
                styles.notesInput,
                {
                  color: colors.foreground,
                  backgroundColor: colors.surface,
                  borderColor: colors.border,
                },
              ]}
            />
            <View
              style={[
                styles.draftCallout,
                { backgroundColor: `${colors.warning}12`, borderColor: `${colors.warning}35` },
              ]}
            >
              <MaterialIcons name="info-outline" size={18} color={colors.warning} />
              <Text style={[styles.draftCalloutText, { color: colors.foreground }]}>
                Online, the request is submitted for review. Offline, it stays on this device.
                Neither state is an approval or an order.
              </Text>
            </View>
            <PrimaryButton
              icon="send"
              label={createMutation.isPending ? "Submitting…" : "Submit request"}
              disabled={createMutation.isPending}
              onPress={createRequest}
            />
          </View>
        </View>
      </Modal>
    </Screen>
  );
}

function RequestCard({
  request,
  localDraft,
  onSync,
}: {
  request: MaterialRequest;
  localDraft: boolean;
  onSync: () => void;
}) {
  const colors = useColors();
  const { sitesWith } = useWorkspace();
  const [showFiles, setShowFiles] = useState(false);
  const canUpload =
    sitesWith("material.request").includes(request.siteId) ||
    sitesWith("material.review").includes(request.siteId);
  return (
    <View
      style={[styles.requestCard, { backgroundColor: colors.surface, borderColor: colors.border }]}
    >
      <View style={styles.requestTop}>
        <View style={[styles.requestIcon, { backgroundColor: `${colors.primary}14` }]}>
          <MaterialIcons name="inventory-2" size={18} color={colors.primary} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.requestTitle, { color: colors.foreground }]}>{request.title}</Text>
          <Text style={[styles.requestSite, { color: colors.muted }]}>
            {request.siteName} · {request.requestedAt}
          </Text>
        </View>
        <WorkflowPill status={request.status} />
      </View>
      <View style={styles.requestMeta}>
        <View>
          <Text style={[styles.metaLabel, { color: colors.muted }]}>Requested quantity</Text>
          <Text style={[styles.metaValue, { color: colors.foreground }]}>{request.quantity}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.metaLabel, { color: colors.muted }]}>Control note</Text>
          <Text style={[styles.metaValue, { color: colors.foreground }]}>
            {request.approvalNote}
          </Text>
        </View>
      </View>
      <View style={styles.requestBottom}>
        <Text style={[styles.requestBy, { color: colors.muted }]}>
          Requested by {request.requestedBy}
        </Text>
        <SyncPill status={request.syncStatus} />
      </View>
      {localDraft ? (
        <View style={styles.cardAction}>
          <SecondaryButton icon="sync" label="Sync request" onPress={onSync} />
        </View>
      ) : (
        <View style={styles.cardAction}>
          <SecondaryButton
            icon={showFiles ? "expand-less" : "photo-library"}
            label={showFiles ? "Hide photos" : "Photos & quotes"}
            onPress={() => setShowFiles((open) => !open)}
          />
          {showFiles ? (
            <View style={{ marginTop: 10 }}>
              <AttachmentStrip
                entityType="material_request"
                entityId={request.id}
                title="Photos, quotations and challans"
                canUpload={canUpload}
              />
            </View>
          ) : null}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  content: { paddingBottom: 30 },
  savedBanner: {
    borderWidth: 1,
    borderRadius: 13,
    padding: 11,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 15,
  },
  savedText: { fontSize: 12, fontWeight: "700", flex: 1, lineHeight: 17 },
  topAction: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    marginBottom: 14,
  },
  actionCopy: { flex: 1 },
  kicker: { fontSize: 10, letterSpacing: 1.35, fontWeight: "800" },
  subheading: { fontSize: 17, fontWeight: "800", marginTop: 4 },
  addButton: {
    borderRadius: 13,
    minHeight: 42,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  addText: { fontSize: 12, fontWeight: "800" },
  policyCard: {
    borderWidth: 1,
    borderRadius: 17,
    padding: 14,
    flexDirection: "row",
    gap: 10,
    alignItems: "flex-start",
    marginBottom: 20,
  },
  policyIcon: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  policyTitle: { fontSize: 13, fontWeight: "800" },
  policyDetail: { fontSize: 11, lineHeight: 17, marginTop: 3 },
  filterRow: { flexDirection: "row", gap: 8, marginBottom: 22 },
  filterChip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8 },
  filterText: { fontSize: 11, fontWeight: "800" },
  requestStack: { gap: 11 },
  requestCard: { borderWidth: 1, borderRadius: 18, padding: 15 },
  requestTop: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  requestIcon: {
    width: 36,
    height: 36,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
  },
  requestTitle: { fontSize: 15, fontWeight: "800" },
  requestSite: { fontSize: 11, marginTop: 3 },
  requestMeta: {
    flexDirection: "row",
    gap: 20,
    marginTop: 16,
    paddingTop: 13,
    borderTopWidth: 1,
    borderTopColor: "rgba(120, 140, 130, 0.18)",
  },
  metaLabel: { fontSize: 10, marginBottom: 4 },
  metaValue: { fontSize: 12, lineHeight: 17, fontWeight: "700" },
  requestBottom: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 14,
    gap: 8,
  },
  requestBy: { fontSize: 10, flex: 1 },
  cardAction: { marginTop: 12 },
  auditNote: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    justifyContent: "center",
    marginTop: 20,
    paddingHorizontal: 6,
  },
  auditText: { fontSize: 11, textAlign: "center", flex: 1, lineHeight: 16 },
  loading: { minHeight: 90, alignItems: "center", justifyContent: "center", gap: 8 },
  loadingText: { fontSize: 12 },
  modalBackdrop: { flex: 1, backgroundColor: "rgba(10, 20, 18, 0.52)", justifyContent: "flex-end" },
  modalCard: {
    maxHeight: "94%",
    borderTopLeftRadius: 25,
    borderTopRightRadius: 25,
    borderWidth: 1,
    padding: 21,
    paddingBottom: 30,
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    marginBottom: 20,
  },
  modalKicker: { fontSize: 10, letterSpacing: 1.4, fontWeight: "800" },
  modalTitle: { fontSize: 22, fontWeight: "800", marginTop: 4 },
  inputLabel: { fontSize: 11, fontWeight: "800", marginBottom: 7, marginTop: 2 },
  input: {
    minHeight: 46,
    borderWidth: 1,
    borderRadius: 13,
    paddingHorizontal: 13,
    fontSize: 14,
    marginBottom: 14,
  },
  notesInput: { minHeight: 62, paddingTop: 11, textAlignVertical: "top" },
  siteChoiceScroll: { maxHeight: 96, marginBottom: 14 },
  siteChoice: { borderWidth: 1, borderRadius: 12, padding: 11, marginBottom: 6 },
  siteChoiceText: { fontSize: 12, fontWeight: "700" },
  draftCallout: {
    borderWidth: 1,
    borderRadius: 13,
    padding: 12,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 9,
    marginBottom: 17,
  },
  draftCalloutText: { fontSize: 12, lineHeight: 18, flex: 1 },
});
