import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useMemo, useState } from "react";
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
import { AuthGate } from "@/components/jp/auth-gate";
import {
  AppHeader,
  EmptyState,
  InlineError,
  OfflineBanner,
  PrimaryButton,
  Screen,
  SectionHeader,
  styles as uiStyles,
} from "@/components/jp/ui";
import { useColors } from "@/hooks/use-colors";
import { createClientMutationId } from "@/lib/jp/local-repository";
import { type InventoryMovementType, isAtOrBelowReorderThreshold } from "@/lib/jp/inventory-domain";
import { clampPageIndex, resolveSelectedId } from "@/lib/jp/selection";
import { trpc } from "@/lib/trpc";

const MOVEMENT_TYPES: { value: InventoryMovementType; label: string; description: string }[] = [
  {
    value: "Receipt/Inward",
    label: "Receipt / inward",
    description: "Accepted quantity only; it will not affect stock until posted.",
  },
  {
    value: "Issue/Consumption",
    label: "Issue / consumption",
    description: "Outbound use; posting is blocked if it would make stock negative.",
  },
  {
    value: "Return to Store",
    label: "Return to store",
    description: "Inbound return in the selected item's base unit.",
  },
  {
    value: "Wastage",
    label: "Wastage",
    description: "Outbound loss; a reason and reviewer post are required.",
  },
  {
    value: "Damage",
    label: "Damage",
    description: "Outbound damaged quantity; a reason and reviewer post are required.",
  },
];
const CATALOGUE_PAGE_SIZE = 100;

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
function formatTime(value: string | Date | null | undefined) {
  if (!value) return "Time not recorded";
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime())
    ? "Time unavailable"
    : new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}
function errorText(error: unknown) {
  return error instanceof Error
    ? error.message
    : "The server did not confirm this inventory action.";
}
function statusText(status: string) {
  if (status === "Submitted") return "Pending review · not in stock";
  if (status === "Posted") return "Posted to site ledger";
  if (status === "Rejected") return "Rejected · no stock effect";
  return status;
}

export default function InventoryScreen() {
  const colors = useColors();
  const me = trpc.auth.me.useQuery(undefined, { retry: false });
  const sitesQuery = trpc.jp.workspace.mySites.useQuery();
  const capabilitiesQuery = trpc.jp.workspace.myCapabilities.useQuery();
  const utils = trpc.useUtils();
  const [chosenSiteId, setSiteId] = useState("");
  const [cataloguePage, setCataloguePage] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const [catalogueModalVisible, setCatalogueModalVisible] = useState(false);
  const [movementModalVisible, setMovementModalVisible] = useState(false);
  const [reviewTarget, setReviewTarget] = useState<{
    id: string;
    itemName: string;
    movementType: string;
    quantity: string;
    unitCode: string;
  } | null>(null);
  const [reviewDecision, setReviewDecision] = useState<"Post" | "Reject">("Post");
  const [reviewReason, setReviewReason] = useState("");
  const [reviewMutationId, setReviewMutationId] = useState<string | null>(null);

  const [itemCode, setItemCode] = useState("");
  const [itemName, setItemName] = useState("");
  const [category, setCategory] = useState("");
  const [specification, setSpecification] = useState("");
  const [baseUnitCode, setBaseUnitCode] = useState("");
  const [reorderThreshold, setReorderThreshold] = useState("");
  const [itemMutationId, setItemMutationId] = useState(() => createClientMutationId());

  const [movementType, setMovementType] = useState<InventoryMovementType>("Receipt/Inward");
  const [movementItemId, setMovementItemId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [sourceReference, setSourceReference] = useState("");
  const [reason, setReason] = useState("");
  const [movementMutationId, setMovementMutationId] = useState(() => createClientMutationId());

  const sites = sitesQuery.data ?? [];
  const capabilityRows = capabilitiesQuery.data ?? [];
  const siteOptions = useMemo(
    () =>
      sites.filter((site) =>
        capabilityRows.some(
          (capability) => capability.siteId === site.id && capability["inventory.view"],
        ),
      ),
    [sites, capabilityRows],
  );
  const siteId = resolveSelectedId(siteOptions, chosenSiteId);
  const [catalogueSiteId, setCatalogueSiteId] = useState(siteId);
  if (catalogueSiteId !== siteId) {
    setCatalogueSiteId(siteId);
    setCataloguePage(0);
  }

  const selectedSiteCapability = capabilityRows.find((capability) => capability.siteId === siteId);
  const canManageCatalogue = Boolean(selectedSiteCapability?.["inventory.catalog.manage"]);
  const canTransact = Boolean(selectedSiteCapability?.["inventory.transact"]);
  const canReview = Boolean(selectedSiteCapability?.["inventory.review"]);
  const inventoryQuery = trpc.jp.inventory.list.useQuery(
    {
      siteId: siteId || "00000000-0000-0000-0000-000000000000",
      catalogueOffset: cataloguePage * CATALOGUE_PAGE_SIZE,
    },
    { enabled: Boolean(siteId && selectedSiteCapability?.["inventory.view"]) },
  );
  const createItemMutation = trpc.jp.inventory.createItem.useMutation();
  const movementMutation = trpc.jp.inventory.submitMovement.useMutation();
  const reviewMutation = trpc.jp.inventory.reviewMovement.useMutation();
  const catalogue = inventoryQuery.data?.catalogue ?? [];
  const catalogueTotal = inventoryQuery.data?.catalogueTotal ?? 0;
  const cataloguePageCount = Math.max(1, Math.ceil(catalogueTotal / CATALOGUE_PAGE_SIZE));
  if (
    inventoryQuery.data &&
    cataloguePage !== clampPageIndex(cataloguePage, catalogueTotal, CATALOGUE_PAGE_SIZE)
  ) {
    setCataloguePage(clampPageIndex(cataloguePage, catalogueTotal, CATALOGUE_PAGE_SIZE));
  }
  const activeItems = catalogue.filter((item) => item.status === "Active");
  const movements = inventoryQuery.data?.movements ?? [];
  const pendingReviewCount = inventoryQuery.data?.pendingReviewCount ?? 0;
  const lastRefresh = inventoryQuery.dataUpdatedAt
    ? formatTime(new Date(inventoryQuery.dataUpdatedAt))
    : null;

  const refresh = async () => {
    await Promise.all([
      inventoryQuery.refetch(),
      sitesQuery.refetch(),
      capabilitiesQuery.refetch(),
    ]);
  };

  const resetItemForm = () => {
    setItemCode("");
    setItemName("");
    setCategory("");
    setSpecification("");
    setBaseUnitCode("");
    setReorderThreshold("");
    setItemMutationId(createClientMutationId());
  };
  const saveItem = async () => {
    if (
      !siteId ||
      itemCode.trim().length < 2 ||
      itemName.trim().length < 2 ||
      baseUnitCode.trim().length < 1
    ) {
      setMessage("Enter a material code, name, base unit, and accessible site.");
      return;
    }
    if (reorderThreshold.trim() && !/^\d{1,11}(?:\.\d{1,3})?$/.test(reorderThreshold.trim())) {
      setMessage("Reorder threshold must use up to 3 decimal places in the configured base unit.");
      return;
    }
    try {
      await createItemMutation.mutateAsync({
        siteId,
        itemCode: itemCode.trim(),
        name: itemName.trim(),
        category: category.trim() || undefined,
        specification: specification.trim() || undefined,
        baseUnitCode: baseUnitCode.trim(),
        reorderThreshold: reorderThreshold.trim() || undefined,
        clientMutationId: itemMutationId,
      });
      setCataloguePage(0);
      await utils.jp.inventory.list.invalidate();
      setCatalogueModalVisible(false);
      resetItemForm();
      setMessage("Material catalogue item saved. No stock was created or changed.");
    } catch (error) {
      setMessage(
        `Catalogue save is unconfirmed. Retry without changing this form to safely reuse its mutation key. ${errorText(error)}`,
      );
    }
  };

  const openMovementForm = () => {
    setMovementItemId(activeItems[0]?.id ?? "");
    setMovementType("Receipt/Inward");
    setQuantity("");
    setSourceReference("");
    setReason("");
    setMovementMutationId(createClientMutationId());
    setMovementModalVisible(true);
  };
  const submitMovement = async () => {
    if (
      !siteId ||
      !movementItemId ||
      !/^\d{1,11}(?:\.\d{1,3})?$/.test(quantity.trim()) ||
      Number(quantity) <= 0 ||
      reason.trim().length < 3
    ) {
      setMessage(
        "Select an active material, enter a positive quantity to 3 decimal places, and add a reason.",
      );
      return;
    }
    try {
      await movementMutation.mutateAsync({
        siteId,
        materialItemId: movementItemId,
        movementType,
        quantity: quantity.trim(),
        sourceReference: sourceReference.trim() || undefined,
        reason: reason.trim(),
        clientMutationId: movementMutationId,
      });
      await inventoryQuery.refetch();
      setMovementModalVisible(false);
      setMessage(
        "Movement submitted to a different authorised reviewer. It is not included in stock until posted.",
      );
      setMovementMutationId(createClientMutationId());
    } catch (error) {
      setMessage(
        `Movement submission is unconfirmed. Retry without changing the form to safely reuse its mutation key. ${errorText(error)}`,
      );
    }
  };

  const openReview = (movement: (typeof movements)[number], decision: "Post" | "Reject") => {
    setReviewTarget({
      id: movement.id,
      itemName: movement.itemName,
      movementType: movement.movementType,
      quantity: String(movement.quantity),
      unitCode: movement.unitCode,
    });
    setReviewDecision(decision);
    setReviewReason("");
    setReviewMutationId(createClientMutationId());
  };
  const confirmReview = async () => {
    if (!reviewTarget || (reviewDecision === "Reject" && reviewReason.trim().length < 3)) {
      setMessage("A short reason is required when rejecting a movement.");
      return;
    }
    const clientMutationId = reviewMutationId ?? createClientMutationId();
    setReviewMutationId(clientMutationId);
    try {
      const result = await reviewMutation.mutateAsync({
        movementId: reviewTarget.id,
        decision: reviewDecision,
        reason: reviewReason.trim() || undefined,
        clientMutationId,
      });
      await inventoryQuery.refetch();
      setReviewTarget(null);
      setReviewMutationId(null);
      setReviewReason("");
      setMessage(
        result.status === "Posted"
          ? "Movement posted to the official in-app stock ledger."
          : "Movement rejected; it has no effect on available stock.",
      );
    } catch (error) {
      setMessage(
        `Review result is unconfirmed. Retry this review with the same form key. ${errorText(error)}`,
      );
    }
  };

  return (
    <AuthGate>
      <Screen>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
          <AppHeader
            eyebrow="Stock control"
            title="Inventory"
            subtitle="Site quantities are calculated from posted movement records."
            userInitials={initials(me.data?.name)}
          />
          <OfflineBanner
            pendingCount={0}
            connected={inventoryQuery.isSuccess && sitesQuery.isSuccess}
            lastSyncedAt={lastRefresh}
            onRetry={() => {
              void refresh();
            }}
            retrying={inventoryQuery.isFetching}
          />
          {sitesQuery.isError ? (
            <InlineError
              message={sitesQuery.error.message}
              onRetry={() => {
                void sitesQuery.refetch();
              }}
            />
          ) : null}
          {capabilitiesQuery.isError ? (
            <InlineError
              message={capabilitiesQuery.error.message}
              onRetry={() => {
                void capabilitiesQuery.refetch();
              }}
            />
          ) : null}
          {message ? (
            <View
              style={[
                styles.messageBox,
                { backgroundColor: `${colors.warning}13`, borderColor: `${colors.warning}45` },
              ]}
            >
              <MaterialIcons name="info-outline" size={17} color={colors.warning} />
              <Text style={[styles.messageText, { color: colors.foreground }]}>{message}</Text>
            </View>
          ) : null}

          <SectionHeader title="Assigned site" />
          {sitesQuery.isLoading || capabilitiesQuery.isLoading ? (
            <View style={styles.loading}>
              <ActivityIndicator color={colors.primary} />
              <Text style={[styles.loadingText, { color: colors.muted }]}>
                Resolving inventory access…
              </Text>
            </View>
          ) : siteOptions.length === 0 ? (
            <EmptyState
              icon="lock-outline"
              title="No site with inventory visibility"
              detail="Inventory data is available only to an account with server-authorised access to a site."
            />
          ) : (
            <View style={styles.siteStrip}>
              {siteOptions.map((site) => (
                <Pressable
                  key={site.id}
                  accessibilityRole="button"
                  accessibilityState={{ selected: site.id === siteId }}
                  onPress={() => {
                    setSiteId(site.id);
                    setMessage(null);
                  }}
                  style={[
                    styles.siteChip,
                    {
                      backgroundColor: site.id === siteId ? colors.primary : colors.surface,
                      borderColor: site.id === siteId ? colors.primary : colors.border,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.siteChipText,
                      { color: site.id === siteId ? colors.background : colors.foreground },
                    ]}
                  >
                    {site.name}
                  </Text>
                  <Text
                    style={[
                      styles.siteChipMeta,
                      { color: site.id === siteId ? colors.background : colors.muted },
                    ]}
                  >
                    {site.project}
                  </Text>
                </Pressable>
              ))}
            </View>
          )}

          {siteId && selectedSiteCapability?.["inventory.view"] ? (
            <>
              <View
                style={[
                  styles.policyCard,
                  { backgroundColor: colors.surface, borderColor: colors.border },
                ]}
              >
                <View style={[styles.policyIcon, { backgroundColor: `${colors.primary}15` }]}>
                  <MaterialIcons name="rule" size={20} color={colors.primary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.policyTitle, { color: colors.foreground }]}>
                    Posted entries only
                  </Text>
                  <Text style={[styles.policyDetail, { color: colors.muted }]}>
                    There is no editable stock total. Submitted or rejected movements do not change
                    the balance. Quantities use the catalogue base unit; no conversions are assumed.
                  </Text>
                </View>
              </View>
              <View style={styles.actionRow}>
                {canManageCatalogue ? (
                  <ActionButton
                    icon="add-box"
                    label="Add material"
                    color={colors.primary}
                    onPress={() => {
                      setMessage(null);
                      setCatalogueModalVisible(true);
                    }}
                  />
                ) : null}
                {canTransact && activeItems.length > 0 ? (
                  <ActionButton
                    icon="swap-vert"
                    label="Record movement"
                    color={colors.warning}
                    onPress={openMovementForm}
                  />
                ) : null}
              </View>
              {canTransact && activeItems.length === 0 && !inventoryQuery.isLoading ? (
                <Text style={[styles.hint, { color: colors.muted }]}>
                  An authorised catalogue manager must add an active material before site movements
                  can be recorded.
                </Text>
              ) : null}

              {inventoryQuery.isError ? (
                <InlineError
                  message={inventoryQuery.error.message}
                  onRetry={() => {
                    void inventoryQuery.refetch();
                  }}
                />
              ) : null}
              {inventoryQuery.isLoading ? (
                <View style={styles.loading}>
                  <ActivityIndicator color={colors.primary} />
                  <Text style={[styles.loadingText, { color: colors.muted }]}>
                    Loading site stock and ledger…
                  </Text>
                </View>
              ) : inventoryQuery.isError ? null : (
                <>
                  <SectionHeader
                    title={`Material catalogue · ${catalogueTotal}`}
                    action="Refresh"
                    onPress={() => {
                      void refresh();
                    }}
                  />
                  {cataloguePageCount > 1 ? (
                    <View
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        justifyContent: "space-between",
                        marginBottom: 12,
                      }}
                    >
                      <Pressable
                        accessibilityRole="button"
                        accessibilityState={{ disabled: cataloguePage === 0 }}
                        disabled={cataloguePage === 0}
                        onPress={() => setCataloguePage((page) => Math.max(0, page - 1))}
                        style={[
                          styles.reviewButton,
                          { borderColor: colors.border, opacity: cataloguePage === 0 ? 0.45 : 1 },
                        ]}
                      >
                        <Text style={[styles.reviewButtonText, { color: colors.foreground }]}>
                          Previous
                        </Text>
                      </Pressable>
                      <Text style={[styles.movementDate, { color: colors.muted }]}>
                        Page {cataloguePage + 1} of {cataloguePageCount}
                      </Text>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityState={{ disabled: cataloguePage + 1 >= cataloguePageCount }}
                        disabled={cataloguePage + 1 >= cataloguePageCount}
                        onPress={() =>
                          setCataloguePage((page) => Math.min(cataloguePageCount - 1, page + 1))
                        }
                        style={[
                          styles.reviewButton,
                          {
                            borderColor: colors.border,
                            opacity: cataloguePage + 1 >= cataloguePageCount ? 0.45 : 1,
                          },
                        ]}
                      >
                        <Text style={[styles.reviewButtonText, { color: colors.foreground }]}>
                          Next
                        </Text>
                      </Pressable>
                    </View>
                  ) : null}
                  {catalogueTotal > CATALOGUE_PAGE_SIZE ? (
                    <Text style={[styles.hint, { color: colors.muted }]}>
                      The movement form uses active materials on this catalogue page. Page to an
                      item&apos;s entry before recording its movement.
                    </Text>
                  ) : null}
                  {catalogue.length === 0 ? (
                    <EmptyState
                      icon="inventory-2"
                      title="Catalogue is empty"
                      detail="Add a material with its configured base unit. Creating a catalogue item does not create an opening balance."
                    />
                  ) : (
                    <View style={styles.itemStack}>
                      {catalogue.map((item) => (
                        <View
                          key={item.id}
                          style={[
                            styles.itemCard,
                            { backgroundColor: colors.surface, borderColor: colors.border },
                          ]}
                        >
                          <View style={styles.itemTop}>
                            <View
                              style={[styles.itemIcon, { backgroundColor: `${colors.primary}14` }]}
                            >
                              <MaterialIcons name="inventory-2" size={18} color={colors.primary} />
                            </View>
                            <View style={styles.itemCopy}>
                              <Text style={[styles.itemName, { color: colors.foreground }]}>
                                {item.name}
                              </Text>
                              <Text style={[styles.itemMeta, { color: colors.muted }]}>
                                {item.itemCode}
                                {item.category ? ` · ${item.category}` : ""}
                                {item.specification ? ` · ${item.specification}` : ""}
                              </Text>
                            </View>
                            <View
                              style={[
                                styles.statusBadge,
                                {
                                  backgroundColor:
                                    item.status === "Active"
                                      ? `${colors.success}15`
                                      : `${colors.border}70`,
                                },
                              ]}
                            >
                              <Text
                                style={[
                                  styles.statusBadgeText,
                                  {
                                    color: item.status === "Active" ? colors.success : colors.muted,
                                  },
                                ]}
                              >
                                {item.status}
                              </Text>
                            </View>
                          </View>
                          <View style={[styles.balanceRow, { borderTopColor: colors.border }]}>
                            <View>
                              <Text style={[styles.balanceLabel, { color: colors.muted }]}>
                                SERVER-CALCULATED AVAILABLE
                              </Text>
                              <Text style={[styles.balanceValue, { color: colors.foreground }]}>
                                {item.onHand}{" "}
                                <Text style={[styles.balanceUnit, { color: colors.muted }]}>
                                  {item.baseUnitCode}
                                </Text>
                              </Text>
                            </View>
                            {isAtOrBelowReorderThreshold(item.onHand, item.reorderThreshold) &&
                            item.status === "Active" ? (
                              <View
                                style={[
                                  styles.lowBadge,
                                  { backgroundColor: `${colors.warning}18` },
                                ]}
                              >
                                <MaterialIcons
                                  name="warning-amber"
                                  size={14}
                                  color={colors.warning}
                                />
                                <Text style={[styles.lowText, { color: colors.warning }]}>
                                  At/below threshold
                                </Text>
                              </View>
                            ) : null}
                          </View>
                          {item.reorderThreshold !== null ? (
                            <Text style={[styles.thresholdText, { color: colors.muted }]}>
                              Configured reorder threshold: {item.reorderThreshold}{" "}
                              {item.baseUnitCode}
                            </Text>
                          ) : null}
                        </View>
                      ))}
                    </View>
                  )}

                  <SectionHeader
                    title="Pending queue + recent history"
                    action={
                      canReview && pendingReviewCount > 0
                        ? `${pendingReviewCount} pending`
                        : undefined
                    }
                  />
                  <View
                    style={[
                      styles.ledgerNotice,
                      {
                        backgroundColor: `${colors.warning}12`,
                        borderColor: `${colors.warning}35`,
                      },
                    ]}
                  >
                    <MaterialIcons name="info-outline" size={17} color={colors.warning} />
                    <Text style={[styles.ledgerNoticeText, { color: colors.foreground }]}>
                      This slice records accepted inward quantity, issue/consumption, return,
                      wastage, and damage. Up to 200 oldest pending entries are shown first; review
                      and refresh to advance a larger queue. Only the latest 100 posted/rejected
                      entries are shown, with full history export/pagination not yet available.
                      Rejected delivery quantity, supplier documents/photos, purchase orders, site
                      transfers, physical counts, adjustments, and linked corrections are not yet
                      captured.
                    </Text>
                  </View>
                  {movements.length === 0 ? (
                    <EmptyState
                      icon="receipt-long"
                      title="No stock movement records"
                      detail="Submitting a movement does not change stock. A different authorised reviewer must post it first."
                    />
                  ) : (
                    <View style={styles.movementStack}>
                      {movements.map((movement) => (
                        <View
                          key={movement.id}
                          style={[
                            styles.movementCard,
                            { backgroundColor: colors.surface, borderColor: colors.border },
                          ]}
                        >
                          <View style={styles.movementHeader}>
                            <View style={{ flex: 1 }}>
                              <Text style={[styles.movementTitle, { color: colors.foreground }]}>
                                {movement.movementType}
                              </Text>
                              <Text style={[styles.movementItem, { color: colors.muted }]}>
                                {movement.itemCode} · {movement.itemName}
                              </Text>
                            </View>
                            <View
                              style={[
                                styles.movementStatus,
                                {
                                  backgroundColor:
                                    movement.status === "Posted"
                                      ? `${colors.success}15`
                                      : movement.status === "Rejected"
                                        ? `${colors.warning}15`
                                        : `${colors.warning}15`,
                                },
                              ]}
                            >
                              <Text
                                style={[
                                  styles.movementStatusText,
                                  {
                                    color:
                                      movement.status === "Posted"
                                        ? colors.success
                                        : movement.status === "Rejected"
                                          ? colors.warning
                                          : colors.warning,
                                  },
                                ]}
                              >
                                {movement.status}
                              </Text>
                            </View>
                          </View>
                          <View style={styles.movementQuantityRow}>
                            <Text
                              style={[
                                styles.movementQuantity,
                                {
                                  color:
                                    movement.direction === "Inbound"
                                      ? colors.success
                                      : colors.foreground,
                                },
                              ]}
                            >
                              {movement.direction === "Inbound" ? "+" : "−"}
                              {movement.quantity} {movement.unitCode}
                            </Text>
                            <Text style={[styles.movementDate, { color: colors.muted }]}>
                              {formatTime(movement.createdAt)}
                            </Text>
                          </View>
                          <Text style={[styles.movementState, { color: colors.muted }]}>
                            {statusText(movement.status)} · by{" "}
                            {movement.creatorName || "Staff user"}
                          </Text>
                          <Text style={[styles.movementReason, { color: colors.foreground }]}>
                            {movement.reason}
                          </Text>
                          {movement.sourceReference ? (
                            <Text style={[styles.movementSource, { color: colors.muted }]}>
                              Reference: {movement.sourceReference} · reference text only, no
                              evidence file
                            </Text>
                          ) : null}
                          {movement.reviewNote ? (
                            <Text style={[styles.movementSource, { color: colors.muted }]}>
                              Reviewer note: {movement.reviewNote}
                            </Text>
                          ) : null}
                          {canReview && movement.status === "Submitted" ? (
                            <View style={styles.reviewActions}>
                              <Pressable
                                accessibilityRole="button"
                                onPress={() => openReview(movement, "Reject")}
                                style={[styles.reviewButton, { borderColor: colors.warning }]}
                              >
                                <Text style={[styles.reviewButtonText, { color: colors.warning }]}>
                                  Reject
                                </Text>
                              </Pressable>
                              <Pressable
                                accessibilityRole="button"
                                onPress={() => openReview(movement, "Post")}
                                style={[
                                  styles.reviewButton,
                                  { backgroundColor: colors.primary, borderColor: colors.primary },
                                ]}
                              >
                                <Text
                                  style={[styles.reviewButtonText, { color: colors.background }]}
                                >
                                  Review & post
                                </Text>
                              </Pressable>
                            </View>
                          ) : null}
                        </View>
                      ))}
                    </View>
                  )}
                </>
              )}
            </>
          ) : null}
        </ScrollView>

        <Modal
          visible={catalogueModalVisible}
          transparent
          animationType="slide"
          onRequestClose={() => setCatalogueModalVisible(false)}
        >
          <View style={styles.backdrop}>
            <View
              style={[
                styles.modalCard,
                { backgroundColor: colors.background, borderColor: colors.border },
              ]}
            >
              <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
                <ModalHeader
                  eyebrow="MATERIAL CATALOGUE"
                  title="Add a material"
                  onClose={() => setCatalogueModalVisible(false)}
                />
                <Text style={[styles.inputLabel, { color: colors.muted }]}>Item code</Text>
                <TextInput
                  value={itemCode}
                  onChangeText={setItemCode}
                  autoCapitalize="characters"
                  placeholder="CEM-OPC53"
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
                <Text style={[styles.inputLabel, { color: colors.muted }]}>Material name</Text>
                <TextInput
                  value={itemName}
                  onChangeText={setItemName}
                  placeholder="OPC 53 grade cement"
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
                <Text style={[styles.inputLabel, { color: colors.muted }]}>Base unit</Text>
                <TextInput
                  value={baseUnitCode}
                  onChangeText={setBaseUnitCode}
                  autoCapitalize="none"
                  placeholder="bag, kg, m3, metre"
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
                <Text style={[styles.helper, { color: colors.muted }]}>
                  Choose the organisation&apos;s explicit stock unit. This slice does not convert
                  bags, truckloads, tonnes, or other units.
                </Text>
                <Text style={[styles.inputLabel, { color: colors.muted }]}>
                  Category (optional)
                </Text>
                <TextInput
                  value={category}
                  onChangeText={setCategory}
                  placeholder="Cement"
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
                <Text style={[styles.inputLabel, { color: colors.muted }]}>
                  Specification / grade (optional)
                </Text>
                <TextInput
                  value={specification}
                  onChangeText={setSpecification}
                  placeholder="OPC 53 grade"
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
                <Text style={[styles.inputLabel, { color: colors.muted }]}>
                  Reorder threshold (optional, base unit)
                </Text>
                <TextInput
                  value={reorderThreshold}
                  onChangeText={setReorderThreshold}
                  keyboardType="decimal-pad"
                  placeholder="0"
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
                <View
                  style={[
                    styles.formCallout,
                    { backgroundColor: `${colors.warning}12`, borderColor: `${colors.warning}35` },
                  ]}
                >
                  <MaterialIcons name="info-outline" size={17} color={colors.warning} />
                  <Text style={[styles.formCalloutText, { color: colors.foreground }]}>
                    Saving a catalogue item creates no opening balance and does not change available
                    stock.
                  </Text>
                </View>
                <PrimaryButton
                  icon="save"
                  label={createItemMutation.isPending ? "Saving…" : "Save catalogue item"}
                  disabled={createItemMutation.isPending}
                  onPress={() => {
                    void saveItem();
                  }}
                />
              </ScrollView>
            </View>
          </View>
        </Modal>

        <Modal
          visible={movementModalVisible}
          transparent
          animationType="slide"
          onRequestClose={() => setMovementModalVisible(false)}
        >
          <View style={styles.backdrop}>
            <View
              style={[
                styles.modalCard,
                { backgroundColor: colors.background, borderColor: colors.border },
              ]}
            >
              <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
                <ModalHeader
                  eyebrow="SITE MOVEMENT"
                  title="Submit for review"
                  onClose={() => setMovementModalVisible(false)}
                />
                <Text style={[styles.inputLabel, { color: colors.muted }]}>Movement type</Text>
                <View style={styles.typeStack}>
                  {MOVEMENT_TYPES.map((type) => (
                    <Pressable
                      key={type.value}
                      accessibilityRole="button"
                      accessibilityState={{ selected: movementType === type.value }}
                      onPress={() => setMovementType(type.value)}
                      style={[
                        styles.typeChoice,
                        {
                          borderColor: movementType === type.value ? colors.primary : colors.border,
                          backgroundColor:
                            movementType === type.value ? `${colors.primary}12` : colors.surface,
                        },
                      ]}
                    >
                      <Text style={[styles.typeLabel, { color: colors.foreground }]}>
                        {type.label}
                      </Text>
                    </Pressable>
                  ))}
                </View>
                <Text style={[styles.helper, { color: colors.muted }]}>
                  {MOVEMENT_TYPES.find((type) => type.value === movementType)?.description}
                </Text>
                <Text style={[styles.inputLabel, { color: colors.muted }]}>
                  Material / base unit
                </Text>
                <View style={styles.typeStack}>
                  {activeItems.map((item) => (
                    <Pressable
                      key={item.id}
                      accessibilityRole="button"
                      accessibilityState={{ selected: movementItemId === item.id }}
                      onPress={() => setMovementItemId(item.id)}
                      style={[
                        styles.typeChoice,
                        {
                          borderColor: movementItemId === item.id ? colors.primary : colors.border,
                          backgroundColor:
                            movementItemId === item.id ? `${colors.primary}12` : colors.surface,
                        },
                      ]}
                    >
                      <Text style={[styles.typeLabel, { color: colors.foreground }]}>
                        {item.itemCode} · {item.name} ({item.baseUnitCode})
                      </Text>
                    </Pressable>
                  ))}
                </View>
                <Text style={[styles.inputLabel, { color: colors.muted }]}>
                  Quantity (
                  {activeItems.find((item) => item.id === movementItemId)?.baseUnitCode ||
                    "base unit"}
                  )
                </Text>
                <TextInput
                  value={quantity}
                  onChangeText={setQuantity}
                  keyboardType="decimal-pad"
                  placeholder="Positive quantity, up to 3 decimals"
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
                {movementType === "Receipt/Inward" ? (
                  <>
                    <Text style={[styles.inputLabel, { color: colors.muted }]}>
                      Delivery note / challan reference (optional)
                    </Text>
                    <TextInput
                      value={sourceReference}
                      onChangeText={setSourceReference}
                      placeholder="Reference number only"
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
                    <Text style={[styles.helper, { color: colors.muted }]}>
                      Only the accepted quantity is recorded here. Supplier, rejected quantity,
                      purchase order, and delivery evidence are not captured in this slice.
                    </Text>
                  </>
                ) : null}
                <Text style={[styles.inputLabel, { color: colors.muted }]}>Reason (required)</Text>
                <TextInput
                  value={reason}
                  onChangeText={setReason}
                  multiline
                  placeholder="Explain why this movement is needed"
                  placeholderTextColor={colors.muted}
                  style={[
                    styles.input,
                    styles.multiline,
                    {
                      color: colors.foreground,
                      backgroundColor: colors.surface,
                      borderColor: colors.border,
                    },
                  ]}
                />
                <View
                  style={[
                    styles.formCallout,
                    { backgroundColor: `${colors.warning}12`, borderColor: `${colors.warning}35` },
                  ]}
                >
                  <MaterialIcons name="info-outline" size={17} color={colors.warning} />
                  <Text style={[styles.formCalloutText, { color: colors.foreground }]}>
                    Online submission only. No stock changes until another authorised user posts
                    this movement; the server rechecks available stock for outbound movements.
                  </Text>
                </View>
                <PrimaryButton
                  icon="send"
                  label={movementMutation.isPending ? "Submitting…" : "Submit movement"}
                  disabled={movementMutation.isPending || activeItems.length === 0}
                  onPress={() => {
                    void submitMovement();
                  }}
                />
              </ScrollView>
            </View>
          </View>
        </Modal>

        <Modal
          visible={Boolean(reviewTarget)}
          transparent
          animationType="fade"
          onRequestClose={() => setReviewTarget(null)}
        >
          <View style={styles.backdrop}>
            <View
              style={[
                styles.reviewModal,
                { backgroundColor: colors.background, borderColor: colors.border },
              ]}
            >
              <Text style={[styles.modalEyebrow, { color: colors.primary }]}>
                {reviewDecision === "Post" ? "POST MOVEMENT" : "REJECT MOVEMENT"}
              </Text>
              <Text style={[styles.modalTitle, { color: colors.foreground }]}>
                {reviewTarget?.itemName || "Movement review"}
              </Text>
              <Text style={[styles.helper, { color: colors.muted }]}>
                {reviewTarget
                  ? `${reviewTarget.movementType} · ${reviewTarget.quantity} ${reviewTarget.unitCode}`
                  : ""}
              </Text>
              <Text style={[styles.inputLabel, { color: colors.muted }]}>
                {reviewDecision === "Reject" ? "Reason (required)" : "Reviewer note (optional)"}
              </Text>
              <TextInput
                value={reviewReason}
                onChangeText={setReviewReason}
                multiline
                placeholder={
                  reviewDecision === "Reject"
                    ? "Why is this movement rejected?"
                    : "Optional posting note"
                }
                placeholderTextColor={colors.muted}
                style={[
                  styles.input,
                  styles.multiline,
                  {
                    color: colors.foreground,
                    backgroundColor: colors.surface,
                    borderColor: colors.border,
                  },
                ]}
              />
              <View
                style={[
                  styles.formCallout,
                  { backgroundColor: `${colors.warning}12`, borderColor: `${colors.warning}35` },
                ]}
              >
                <MaterialIcons name="lock-outline" size={17} color={colors.warning} />
                <Text style={[styles.formCalloutText, { color: colors.foreground }]}>
                  {reviewDecision === "Post"
                    ? "Posting adds this movement to the official in-app ledger. Outbound movements that exceed posted stock will be blocked."
                    : "Rejecting leaves the movement visible for audit and has no stock effect."}
                </Text>
              </View>
              <PrimaryButton
                icon={reviewDecision === "Post" ? "check" : "block"}
                label={
                  reviewMutation.isPending
                    ? "Saving review…"
                    : reviewDecision === "Post"
                      ? "Confirm and post"
                      : "Confirm rejection"
                }
                disabled={
                  reviewMutation.isPending ||
                  (reviewDecision === "Reject" && reviewReason.trim().length < 3)
                }
                onPress={() => {
                  void confirmReview();
                }}
              />
              <Pressable
                accessibilityRole="button"
                onPress={() => setReviewTarget(null)}
                style={styles.cancelReview}
              >
                <Text style={[styles.cancelReviewText, { color: colors.muted }]}>Cancel</Text>
              </Pressable>
            </View>
          </View>
        </Modal>
      </Screen>
    </AuthGate>
  );
}

function ActionButton({
  icon,
  label,
  color,
  onPress,
}: {
  icon: keyof typeof MaterialIcons.glyphMap;
  label: string;
  color: string;
  onPress: () => void;
}) {
  const colors = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.actionButton,
        { backgroundColor: `${color}16`, borderColor: `${color}55` },
        pressed && uiStyles.pressed,
      ]}
    >
      <MaterialIcons name={icon} size={18} color={color} />
      <Text style={[styles.actionText, { color: colors.foreground }]}>{label}</Text>
    </Pressable>
  );
}

function ModalHeader({
  eyebrow,
  title,
  onClose,
}: {
  eyebrow: string;
  title: string;
  onClose: () => void;
}) {
  const colors = useColors();
  return (
    <View style={styles.modalHeader}>
      <View>
        <Text style={[styles.modalEyebrow, { color: colors.primary }]}>{eyebrow}</Text>
        <Text style={[styles.modalTitle, { color: colors.foreground }]}>{title}</Text>
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={onClose}>
        <MaterialIcons name="close" size={24} color={colors.foreground} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { paddingBottom: 36 },
  loading: {
    minHeight: 78,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  loadingText: { fontSize: 12 },
  messageBox: {
    flexDirection: "row",
    gap: 8,
    alignItems: "flex-start",
    borderWidth: 1,
    borderRadius: 12,
    padding: 11,
    marginBottom: 14,
  },
  messageText: { flex: 1, fontSize: 11, lineHeight: 16 },
  siteStrip: { flexDirection: "row", gap: 8, paddingBottom: 13, marginBottom: 8 },
  siteChip: {
    borderWidth: 1,
    borderRadius: 13,
    paddingVertical: 9,
    paddingHorizontal: 12,
    minWidth: 120,
    maxWidth: 220,
  },
  siteChipText: { fontSize: 12, fontWeight: "800" },
  siteChipMeta: { fontSize: 10, marginTop: 3 },
  policyCard: {
    borderWidth: 1,
    borderRadius: 16,
    padding: 13,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    marginBottom: 15,
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
  actionRow: { flexDirection: "row", gap: 9, flexWrap: "wrap", marginBottom: 8 },
  actionButton: {
    minHeight: 43,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },
  actionText: { fontSize: 11, fontWeight: "800" },
  hint: { fontSize: 11, lineHeight: 17, marginBottom: 12 },
  itemStack: { gap: 10, marginBottom: 22 },
  itemCard: { borderWidth: 1, borderRadius: 15, padding: 13 },
  itemTop: { flexDirection: "row", alignItems: "center", gap: 9 },
  itemIcon: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  itemCopy: { flex: 1 },
  itemName: { fontSize: 13, fontWeight: "800" },
  itemMeta: { fontSize: 10, marginTop: 3 },
  statusBadge: { borderRadius: 99, paddingHorizontal: 8, paddingVertical: 5 },
  statusBadgeText: { fontSize: 9, fontWeight: "800" },
  balanceRow: {
    borderTopWidth: 1,
    marginTop: 12,
    paddingTop: 11,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  balanceLabel: { fontSize: 8, letterSpacing: 0.8, fontWeight: "800" },
  balanceValue: { fontSize: 22, fontWeight: "900", marginTop: 3 },
  balanceUnit: { fontSize: 12, fontWeight: "700" },
  lowBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 99,
  },
  lowText: { fontSize: 9, fontWeight: "800" },
  thresholdText: { fontSize: 10, marginTop: 7 },
  ledgerNotice: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 10,
    flexDirection: "row",
    gap: 7,
    alignItems: "flex-start",
    marginBottom: 12,
  },
  ledgerNoticeText: { flex: 1, fontSize: 10, lineHeight: 15 },
  movementStack: { gap: 9, marginBottom: 18 },
  movementCard: { borderWidth: 1, borderRadius: 14, padding: 12 },
  movementHeader: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  movementTitle: { fontSize: 12, fontWeight: "900" },
  movementItem: { fontSize: 10, marginTop: 3 },
  movementStatus: { borderRadius: 99, paddingHorizontal: 8, paddingVertical: 5 },
  movementStatusText: { fontSize: 9, fontWeight: "800" },
  movementQuantityRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    marginTop: 10,
  },
  movementQuantity: { fontSize: 14, fontWeight: "900" },
  movementDate: { fontSize: 9 },
  movementState: { fontSize: 9, marginTop: 4 },
  movementReason: { fontSize: 11, lineHeight: 16, marginTop: 7 },
  movementSource: { fontSize: 9, lineHeight: 14, marginTop: 5 },
  reviewActions: { flexDirection: "row", justifyContent: "flex-end", gap: 8, marginTop: 11 },
  reviewButton: {
    minHeight: 36,
    justifyContent: "center",
    paddingHorizontal: 12,
    borderWidth: 1,
    borderRadius: 10,
  },
  reviewButtonText: { fontSize: 10, fontWeight: "900" },
  backdrop: { flex: 1, backgroundColor: "rgba(10,18,22,0.7)", justifyContent: "flex-end" },
  modalCard: {
    maxHeight: "92%",
    borderTopLeftRadius: 21,
    borderTopRightRadius: 21,
    borderWidth: 1,
    padding: 17,
    paddingBottom: 26,
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  modalEyebrow: { fontSize: 9, letterSpacing: 1, fontWeight: "900" },
  modalTitle: { fontSize: 20, fontWeight: "900", marginTop: 3 },
  inputLabel: { fontSize: 10, fontWeight: "800", marginTop: 9, marginBottom: 5 },
  input: {
    borderWidth: 1,
    borderRadius: 11,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 13,
    minHeight: 43,
  },
  multiline: { minHeight: 76, textAlignVertical: "top" },
  helper: { fontSize: 10, lineHeight: 15, marginTop: 5, marginBottom: 5 },
  formCallout: {
    borderWidth: 1,
    borderRadius: 11,
    padding: 10,
    flexDirection: "row",
    gap: 7,
    alignItems: "flex-start",
    marginTop: 12,
    marginBottom: 13,
  },
  formCalloutText: { flex: 1, fontSize: 10, lineHeight: 15 },
  typeStack: { gap: 6, marginTop: 2 },
  typeChoice: { borderWidth: 1, borderRadius: 10, padding: 9 },
  typeLabel: { fontSize: 11, fontWeight: "700" },
  reviewModal: { borderWidth: 1, borderRadius: 18, padding: 16, marginHorizontal: 18 },
  cancelReview: { minHeight: 40, alignItems: "center", justifyContent: "center", marginTop: 3 },
  cancelReviewText: { fontSize: 12, fontWeight: "700" },
});
