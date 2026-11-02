import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useRef, useState } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View, type TextInputProps } from "react-native";
import { EmptyState, InlineError, PrimaryButton, SecondaryButton, SectionHeader } from "@/components/jp/ui";
import { useColors } from "@/hooks/use-colors";
import { createClientMutationId } from "@/lib/jp/local-repository";
import { formatMinorAsRupees, parseRupeesToMinor } from "@/lib/jp/finance-domain";
import { clampPageIndex, resolveSelectedId } from "@/lib/jp/selection";
import { trpc } from "@/lib/trpc";

const EMPTY_ID = "00000000-0000-4000-8000-000000000000";
const PAGE_SIZE = 25;
const MOVEMENT_TYPES = ["Funding", "Expense", "Cash Return"] as const;
const PAYMENT_MODES = ["Cash", "UPI", "Bank Transfer", "Cheque", "Card", "Other"] as const;
const FUNDING_SOURCES = ["Company cash issue", "Approved bank/cash withdrawal", "Other approved source"] as const;
const RECONCILIATION_PERIODS = ["Weekly", "Fortnightly", "Monthly", "Quarterly"] as const;
type MovementType = (typeof MOVEMENT_TYPES)[number];
type PaymentMode = (typeof PAYMENT_MODES)[number];
type FundingSource = (typeof FUNDING_SOURCES)[number];
type ReconciliationPeriod = (typeof RECONCILIATION_PERIODS)[number];
type PendingAction = { movementId: string; action: "review" | "post" | "cancel" };

type Props = {
  siteId: string;
  currentUserId: number;
  currentUserName: string;
  canManageFund: boolean;
  canCreateMovement: boolean;
  canSubmit: boolean;
  canReview: boolean;
  canPost: boolean;
  canCancel: boolean;
};

function todayString() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}
function validDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
function errorText(error: unknown) { return error instanceof Error ? error.message : "The server did not confirm this petty-cash action."; }
function formatTime(value: string | Date | null | undefined) {
  if (!value) return "Not recorded";
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? "Time unavailable" : new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}
function shortId(value: string | null | undefined) { return value ? value.slice(0, 8) : ""; }

export function PettyCashLedger(props: Props) {
  const colors = useColors();
  const utils = trpc.useUtils();
  const [message, setMessage] = useState<string | null>(null);
  const [chosenFundId, setSelectedFundId] = useState("");
  const [page, setPage] = useState(0);
  const [fundModalVisible, setFundModalVisible] = useState(false);
  const [fundName, setFundName] = useState("");
  const [custodianUserId, setCustodianUserId] = useState(0);
  const [fundLimitRupees, setFundLimitRupees] = useState("");
  const [reconciliationPeriod, setReconciliationPeriod] = useState<ReconciliationPeriod>("Monthly");
  const [fundMutationId, setFundMutationId] = useState(() => createClientMutationId());
  const [movementModalVisible, setMovementModalVisible] = useState(false);
  const [movementType, setMovementType] = useState<MovementType>("Expense");
  const [amountRupees, setAmountRupees] = useState("");
  const [movementDate, setMovementDate] = useState(todayString());
  const [paymentMode, setPaymentMode] = useState<PaymentMode>("Cash");
  const [payeeName, setPayeeName] = useState("");
  const [paidByName, setPaidByName] = useState(props.currentUserName);
  const [fundingSource, setFundingSource] = useState<FundingSource>("Approved bank/cash withdrawal");
  const [fundSourceConfirmed, setFundSourceConfirmed] = useState(false);
  const [category, setCategory] = useState("Site expense");
  const [purpose, setPurpose] = useState("");
  const [taskId, setTaskId] = useState("");
  const [relatedMovementId, setRelatedMovementId] = useState("");
  const [receiptReference, setReceiptReference] = useState("");
  const [receiptMissingReason, setReceiptMissingReason] = useState("");
  const [movementMutationId, setMovementMutationId] = useState(() => createClientMutationId());
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [actionDecision, setActionDecision] = useState<"Approved" | "Rejected">("Approved");
  const [actionReason, setActionReason] = useState("");
  const [actionMutationId, setActionMutationId] = useState("");
  const actionKeys = useRef(new Map<string, string>());

  const fundsQuery = trpc.jp.finance.pettyCash.listFunds.useQuery({ siteId: props.siteId || EMPTY_ID, offset: 0, limit: 50 }, { enabled: Boolean(props.siteId) });
  const funds = fundsQuery.data?.items ?? [];
  // The choice stays in state, so a newly created fund becomes selected once the refetched list includes it.
  const selectedFundId = resolveSelectedId(funds, chosenFundId);
  const selectedFund = funds.find((fund) => fund.id === selectedFundId);
  const custodiansQuery = trpc.jp.finance.pettyCash.listCustodianCandidates.useQuery({ siteId: props.siteId || EMPTY_ID }, { enabled: Boolean(fundModalVisible && props.canManageFund) });
  const tasksQuery = trpc.jp.finance.pettyCash.listTaskOptions.useQuery({ siteId: props.siteId || EMPTY_ID }, { enabled: Boolean(props.siteId) });
  const movementsQuery = trpc.jp.finance.pettyCash.listMovements.useQuery({
    siteId: props.siteId || EMPTY_ID,
    fundId: selectedFundId || EMPTY_ID,
    offset: page * PAGE_SIZE,
    limit: PAGE_SIZE,
  }, { enabled: Boolean(props.siteId && selectedFundId) });
  const returnCandidatesQuery = trpc.jp.finance.pettyCash.listReturnCandidates.useQuery({
    siteId: props.siteId || EMPTY_ID,
    fundId: selectedFundId || EMPTY_ID,
    offset: 0,
    limit: 50,
  }, { enabled: Boolean(movementModalVisible && movementType === "Cash Return" && selectedFundId) });

  const createFundMutation = trpc.jp.finance.pettyCash.createFund.useMutation();
  const acknowledgeFundMutation = trpc.jp.finance.pettyCash.acknowledgeFund.useMutation();
  const createMovementMutation = trpc.jp.finance.pettyCash.createMovement.useMutation();
  const submitMovementMutation = trpc.jp.finance.pettyCash.submitMovement.useMutation();
  const reviewMovementMutation = trpc.jp.finance.pettyCash.reviewMovement.useMutation();
  const postMovementMutation = trpc.jp.finance.pettyCash.postMovement.useMutation();
  const cancelMovementMutation = trpc.jp.finance.pettyCash.cancelMovement.useMutation();

  const rows = movementsQuery.data?.items ?? [];
  const total = movementsQuery.data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  if (movementsQuery.data && page !== clampPageIndex(page, total, PAGE_SIZE)) setPage(clampPageIndex(page, total, PAGE_SIZE));

  const changeFund = (setter: (value: string) => void, value: string) => { setter(value); setFundMutationId(createClientMutationId()); };
  const changeMovement = (setter: (value: string) => void, value: string) => { setter(value); setMovementMutationId(createClientMutationId()); };
  const resetFundForm = () => {
    setFundName(""); setCustodianUserId(0); setFundLimitRupees(""); setReconciliationPeriod("Monthly"); setFundMutationId(createClientMutationId());
  };
  const openFundForm = () => { resetFundForm(); setMessage(null); setFundModalVisible(true); };
  const resetMovementForm = () => {
    setMovementType("Expense"); setAmountRupees(""); setMovementDate(todayString()); setPaymentMode("Cash"); setPayeeName("");
    setPaidByName(props.currentUserName); setFundingSource("Approved bank/cash withdrawal"); setFundSourceConfirmed(false); setCategory("Site expense"); setPurpose("");
    setTaskId(""); setRelatedMovementId(""); setReceiptReference(""); setReceiptMissingReason(""); setMovementMutationId(createClientMutationId());
  };
  const openMovementForm = () => { resetMovementForm(); setMessage(null); setMovementModalVisible(true); };
  const closeMovementForm = () => setMovementModalVisible(false);
  const setType = (type: MovementType) => {
    setMovementType(type); setRelatedMovementId(""); setTaskId(""); setFundSourceConfirmed(false);
    setCategory(type === "Funding" ? "Fund top-up" : type === "Cash Return" ? "Cash return" : "Site expense");
    setPaymentMode(type === "Cash Return" ? "Cash" : type === "Funding" ? "Bank Transfer" : "Cash");
    setMovementMutationId(createClientMutationId());
  };
  const refreshLedger = async () => {
    await Promise.all([fundsQuery.refetch(), ...(selectedFundId ? [movementsQuery.refetch()] : [])]);
  };

  const saveFund = async () => {
    if (!props.canManageFund || !props.siteId || fundName.trim().length < 2 || !custodianUserId) {
      setMessage("Enter a fund name, choose an active assigned custodian, and enter an authorised limit."); return;
    }
    try {
      parseRupeesToMinor(fundLimitRupees);
      const saved = await createFundMutation.mutateAsync({
        siteId: props.siteId,
        name: fundName.trim(),
        custodianUserId,
        authorizedLimitRupees: fundLimitRupees.trim(),
        reconciliationPeriod,
        clientMutationId: fundMutationId,
      });
      setFundModalVisible(false); resetFundForm(); setSelectedFundId(saved.id);
      setMessage("Fund recorded as Pending Custodian. The named custodian must acknowledge responsibility before any movement is recorded.");
      await fundsQuery.refetch();
    } catch (error) { setMessage(`Fund creation was not confirmed. Retry the unchanged details with the same key. ${errorText(error)}`); }
  };

  const actionKey = (name: string) => {
    const existing = actionKeys.current.get(name);
    if (existing) return existing;
    const created = createClientMutationId(); actionKeys.current.set(name, created); return created;
  };
  const clearActionKey = (name: string) => actionKeys.current.delete(name);
  const acknowledgeFund = async (fundId: string) => {
    const keyName = `${fundId}:acknowledge`;
    try {
      await acknowledgeFundMutation.mutateAsync({ siteId: props.siteId, fundId, clientMutationId: actionKey(keyName) });
      clearActionKey(keyName); setMessage("Custodian acknowledgement recorded; the fund is Active. This is not a cash receipt or bank confirmation.");
      await fundsQuery.refetch();
    } catch (error) { setMessage(`Acknowledgement was not confirmed. Retry the same action. ${errorText(error)}`); }
  };

  const saveMovement = async () => {
    if (!props.canCreateMovement || !props.siteId || !selectedFund || selectedFund.status !== "Active" || !validDate(movementDate)) {
      setMessage("Choose an Active fund and enter a valid date; a pending custodian acknowledgement blocks movements."); return;
    }
    try { parseRupeesToMinor(amountRupees); }
    catch (error) { setMessage(errorText(error)); return; }
    if (paidByName.trim().length < 2 || category.trim().length < 2 || purpose.trim().length < 4
      || (movementType !== "Funding" && payeeName.trim().length < 2)
      || (movementType === "Cash Return" && !relatedMovementId)
      || (movementType === "Expense" && (!fundSourceConfirmed || (!receiptReference.trim() && receiptMissingReason.trim().length < 3)))) {
      setMessage("Confirm the expense was paid from the selected site fund, complete the movement details, and enter either a receipt reference or a reason explaining its absence."); return;
    }
    try {
      await createMovementMutation.mutateAsync({
        siteId: props.siteId,
        fundId: selectedFund.id,
        movementType,
        amountRupees: amountRupees.trim(),
        movementDate,
        paymentMode: movementType === "Cash Return" ? "Cash" : paymentMode,
        payeeName: movementType === "Funding" ? selectedFund.custodianNameSnapshot : payeeName.trim(),
        paidByName: paidByName.trim(),
        ...(movementType === "Funding" ? { fundingSource } : {}),
        ...(movementType === "Expense" ? { expenseFundingSource: "Site Petty Cash" as const, fundSourceAttested: fundSourceConfirmed } : {}),
        category: category.trim(),
        purpose: purpose.trim(),
        ...(movementType === "Expense" && taskId ? { taskId } : {}),
        ...(movementType === "Cash Return" ? { relatedMovementId } : {}),
        ...(receiptReference.trim() ? { receiptReference: receiptReference.trim() } : {}),
        ...(receiptMissingReason.trim() ? { receiptMissingReason: receiptMissingReason.trim() } : {}),
        clientMutationId: movementMutationId,
      });
      closeMovementForm(); resetMovementForm(); setMessage("Movement saved as Draft. Only a separately authorised Posted entry changes the derived fund balance; this record does not execute a transfer.");
      await Promise.all([fundsQuery.refetch(), movementsQuery.refetch()]);
    } catch (error) { setMessage(`Movement save was not confirmed. Retry unchanged details with the same key. ${errorText(error)}`); }
  };

  const submitMovement = async (movementId: string) => {
    const keyName = `${movementId}:submit`;
    try {
      await submitMovementMutation.mutateAsync({ siteId: props.siteId, movementId, clientMutationId: actionKey(keyName) });
      clearActionKey(keyName); setMessage("Movement submitted for a different authorised reviewer.");
      await Promise.all([movementsQuery.refetch(), fundsQuery.refetch()]);
    } catch (error) { setMessage(`Submission was not confirmed. Retry the same Draft action. ${errorText(error)}`); }
  };
  const openAction = (movementId: string, action: PendingAction["action"]) => {
    setPendingAction({ movementId, action }); setActionDecision("Approved"); setActionReason(""); setActionMutationId(createClientMutationId());
  };
  const saveAction = async () => {
    if (!pendingAction || actionReason.trim().length < 3) { setMessage("A reason of at least three characters is required for review, posting, or cancellation."); return; }
    const key = actionMutationId || createClientMutationId(); setActionMutationId(key);
    try {
      if (pendingAction.action === "review") await reviewMovementMutation.mutateAsync({ siteId: props.siteId, movementId: pendingAction.movementId, decision: actionDecision, reason: actionReason.trim(), clientMutationId: key });
      else if (pendingAction.action === "post") await postMovementMutation.mutateAsync({ siteId: props.siteId, movementId: pendingAction.movementId, reason: actionReason.trim(), clientMutationId: key });
      else await cancelMovementMutation.mutateAsync({ siteId: props.siteId, movementId: pendingAction.movementId, reason: actionReason.trim(), clientMutationId: key });
      setPendingAction(null); setActionReason(""); setActionMutationId("");
      setMessage(pendingAction.action === "post" ? "Posted to the internal petty-cash ledger. No bank, card or UPI transfer was executed or verified." : pendingAction.action === "review" ? `Movement ${actionDecision.toLowerCase()} with a required audit reason.` : "Unposted movement cancelled; the reason remains in the audit history.");
      await Promise.all([movementsQuery.refetch(), fundsQuery.refetch()]);
    } catch (error) { setMessage(`Action was not confirmed. Retry with the same reason to reuse its idempotency key. ${errorText(error)}`); }
  };
  const actionPending = reviewMovementMutation.isPending || postMovementMutation.isPending || cancelMovementMutation.isPending;
  const actionTitle = pendingAction?.action === "review" ? "Review petty-cash movement" : pendingAction?.action === "post" ? "Post to internal ledger" : "Cancel unposted movement";

  return <View>
    <SectionHeader title="Site petty cash" action={props.canManageFund ? "New fund" : undefined} onPress={props.canManageFund ? openFundForm : undefined} />
    {message ? <View style={[styles.message, { backgroundColor: `${colors.primary}12`, borderColor: `${colors.primary}45` }]}><MaterialIcons name="info-outline" size={17} color={colors.primary} /><Text style={[styles.messageText, { color: colors.foreground }]}>{message}</Text></View> : null}
    <View style={[styles.notice, { backgroundColor: colors.surface, borderColor: colors.border }]}><MaterialIcons name="account-balance-wallet" size={17} color={colors.warning} /><Text style={[styles.noticeText, { color: colors.muted }]}>Balances are calculated from Posted funding, expenses and linked cash returns only. Draft, Submitted, Approved, Rejected and Cancelled entries do not change cash. This site-scoped view intentionally shows authorised site finance users the full ledger, including payer/payee, purpose, receipt-reference text and audit reasons; it returns no private file bytes or account credentials. Personal out-of-pocket costs must not be entered here; the separate reimbursement workflow is not yet available. No bank/card/UPI transfer is sent or verified, and physical reconciliation is not yet available.</Text></View>

    {fundsQuery.isError ? <InlineError message={fundsQuery.error.message} onRetry={() => { void refreshLedger(); }} />
      : fundsQuery.isLoading ? <View style={styles.loading}><ActivityIndicator color={colors.primary} /><Text style={[styles.meta, { color: colors.muted }]}>Loading site funds…</Text></View>
        : funds.length === 0 ? <EmptyState icon="account-balance-wallet" title="No petty-cash fund" detail={props.canManageFund ? "Create an authorised site fund; its named custodian must acknowledge before transactions. No sample balance is provided." : "No site fund has been authorised for this account."} action={props.canManageFund ? "Create fund" : undefined} onPress={props.canManageFund ? openFundForm : undefined} />
          : <View style={styles.stack}>{funds.map((fund) => {
            const selected = fund.id === selectedFundId;
            const mayAcknowledge = fund.status === "Pending Custodian" && fund.custodianUserId === props.currentUserId;
            return <Pressable key={fund.id} accessibilityRole="button" accessibilityState={{ selected }} onPress={() => { setSelectedFundId(fund.id); setPage(0); }} style={[styles.fundCard, { backgroundColor: colors.surface, borderColor: selected ? colors.primary : colors.border }]}>
              <View style={styles.cardTop}><View style={{ flex: 1 }}><Text style={[styles.cardTitle, { color: colors.foreground }]}>{fund.name}</Text><Text style={[styles.meta, { color: colors.muted }]}>Custodian · {fund.custodianNameSnapshot} · {fund.reconciliationPeriod} reconciliation period</Text></View><Text style={[styles.status, { color: fund.status === "Active" ? colors.success : colors.warning, backgroundColor: `${fund.status === "Active" ? colors.success : colors.warning}18` }]}>{fund.status}</Text></View>
              <View style={styles.balanceRow}><View><Text style={[styles.balanceLabel, { color: colors.muted }]}>Posted ledger balance</Text><Text style={[styles.balanceAmount, { color: colors.foreground }]}>{formatMinorAsRupees(fund.balanceMinor)}</Text></View><View><Text style={[styles.balanceLabel, { color: colors.muted }]}>Authorised balance ceiling</Text><Text style={[styles.limitAmount, { color: colors.muted }]}>{formatMinorAsRupees(fund.authorizedLimitMinor)}</Text></View></View>
              {fund.status === "Pending Custodian" ? <Text style={[styles.meta, { color: colors.warning }]}>{mayAcknowledge ? "You are the named custodian. Acknowledge responsibility to activate this fund." : "Waiting for the named custodian’s acknowledgement. No movement is permitted yet."}</Text> : null}
              {mayAcknowledge ? <View style={styles.actionRow}><SecondaryButton label={acknowledgeFundMutation.isPending ? "Recording…" : "Acknowledge responsibility"} disabled={acknowledgeFundMutation.isPending} onPress={() => { void acknowledgeFund(fund.id); }} /></View> : null}
            </Pressable>;
          })}</View>}

    {selectedFund ? <>
      <SectionHeader title={`${selectedFund.name} · movements`} action={props.canCreateMovement && selectedFund.status === "Active" ? "Record movement" : undefined} onPress={props.canCreateMovement && selectedFund.status === "Active" ? openMovementForm : undefined} />
      {movementsQuery.isError ? <InlineError message={movementsQuery.error.message} onRetry={() => { void movementsQuery.refetch(); }} />
        : movementsQuery.isLoading ? <View style={styles.loading}><ActivityIndicator color={colors.primary} /><Text style={[styles.meta, { color: colors.muted }]}>Loading movement ledger…</Text></View>
          : rows.length === 0 ? <EmptyState icon="receipt-long" title="No fund movements" detail="No transaction record exists for this fund. Only an authorised Posted event changes the balance." />
            : <View style={styles.stack}>{rows.map((movement) => {
              const isCreator = movement.createdBy === props.currentUserId;
              const maySubmit = props.canSubmit && movement.status === "Draft" && isCreator;
              const mayReview = props.canReview && movement.status === "Submitted" && !isCreator;
              const mayPost = props.canPost && (movement.status === "Approved" || (movement.status === "Submitted" && props.canReview)) && !isCreator;
              const mayCancel = props.canCancel && (movement.status === "Draft" || movement.status === "Submitted") && isCreator;
              const statusColor = movement.status === "Posted" ? colors.success : movement.status === "Rejected" || movement.status === "Cancelled" ? colors.warning : colors.primary;
              return <View key={movement.id} style={[styles.movementCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <View style={styles.cardTop}><View style={{ flex: 1 }}><Text style={[styles.cardTitle, { color: colors.foreground }]}>{movement.movementType} · {formatMinorAsRupees(movement.amountMinor)}</Text><Text style={[styles.meta, { color: colors.muted }]}>{movement.movementDate} · {movement.paymentMode} · {movement.category}</Text></View><Text style={[styles.status, { color: statusColor, backgroundColor: `${statusColor}18` }]}>{movement.status}</Text></View>
                <Text style={[styles.meta, { color: colors.muted }]}>{movement.movementType === "Cash Return" ? "Returned by" : movement.movementType === "Funding" ? "Received by" : "Payee"} · {movement.payeeName} · Paid by {movement.paidByName}</Text>
                <Text style={[styles.meta, { color: colors.muted }]}>Source label · {movement.sourceAccountLabel}</Text>
                {movement.movementType === "Expense" ? <Text style={[styles.meta, { color: colors.muted }]}>Expense source · {movement.expenseFundingSource ?? "Unavailable"} · {movement.fundSourceAttestation === "Confirmed" ? "creator attested" : "not attested"}</Text> : null}
                <Text style={[styles.purpose, { color: colors.foreground }]}>{movement.purpose}</Text>
                {movement.taskId ? <Text style={[styles.meta, { color: colors.muted }]}>Work task · {movement.taskCode && movement.taskTitle ? `${movement.taskCode} · ${movement.taskTitle}${movement.taskStatus ? ` (${movement.taskStatus})` : ""}` : `ID ${shortId(movement.taskId)}`}</Text> : null}
                {movement.relatedMovementId ? <Text style={[styles.meta, { color: colors.muted }]}>Linked original expense · {shortId(movement.relatedMovementId)}</Text> : null}
                {movement.receiptReference ? <Text style={[styles.meta, { color: colors.muted }]}>Receipt/reference text · {movement.receiptReference}</Text> : movement.receiptMissingReason ? <Text style={[styles.reason, { color: colors.warning }]}>Receipt absence reason · {movement.receiptMissingReason}</Text> : null}
                <Text style={[styles.meta, { color: colors.muted }]}>Recorded by {movement.createdByName} · {formatTime(movement.createdAt)}{movement.postedAt ? ` · posted ${formatTime(movement.postedAt)}` : ""}</Text>
                {movement.reviewReason ? <Text style={[styles.reason, { color: colors.muted }]}>Review/direct-post reason · {movement.reviewReason}</Text> : null}
                {movement.cancellationReason ? <Text style={[styles.reason, { color: colors.warning }]}>Cancellation reason · {movement.cancellationReason}</Text> : null}
                <View style={styles.actionRow}>
                  {maySubmit ? <SecondaryButton label={submitMovementMutation.isPending ? "Submitting…" : "Submit"} disabled={submitMovementMutation.isPending} onPress={() => { void submitMovement(movement.id); }} /> : null}
                  {mayReview ? <SecondaryButton label="Review" onPress={() => openAction(movement.id, "review")} /> : null}
                  {mayPost ? <SecondaryButton label="Post to ledger" onPress={() => openAction(movement.id, "post")} /> : null}
                  {mayCancel ? <SecondaryButton label="Cancel" onPress={() => openAction(movement.id, "cancel")} /> : null}
                </View>
              </View>;
            })}</View>}
      {total > PAGE_SIZE ? <View style={styles.pager}><SecondaryButton label="Previous" disabled={page <= 0} onPress={() => setPage((value) => Math.max(0, value - 1))} /><Text style={[styles.meta, { color: colors.muted }]}>Page {page + 1} of {pageCount}</Text><SecondaryButton label="Next" disabled={page + 1 >= pageCount} onPress={() => setPage((value) => Math.min(pageCount - 1, value + 1))} /></View> : null}
    </> : null}

    <Modal visible={fundModalVisible} transparent animationType="slide" onRequestClose={() => setFundModalVisible(false)}><View style={styles.backdrop}><View style={[styles.modal, { backgroundColor: colors.background, borderColor: colors.border }]}><ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
      <ModalHeader title="Create site petty-cash fund" onClose={() => setFundModalVisible(false)} />
      <Text style={[styles.noticeText, { color: colors.warning }]}>This creates a real site finance record with a derived zero balance. The selected custodian must acknowledge; no starting cash is seeded.</Text>
      <Field label="Fund name *" value={fundName} onChangeText={(value) => changeFund(setFundName, value)} placeholder="e.g. Site petty cash" />
      <Field label="Authorised balance ceiling (₹) *" value={fundLimitRupees} onChangeText={(value) => changeFund(setFundLimitRupees, value)} placeholder="0.00" keyboardType="decimal-pad" />
      <Text style={[styles.label, { color: colors.muted }]}>Named site custodian *</Text>
      {custodiansQuery.isError ? <InlineError message={custodiansQuery.error.message} onRetry={() => { void custodiansQuery.refetch(); }} />
        : custodiansQuery.isLoading ? <View style={styles.loading}><ActivityIndicator color={colors.primary} /><Text style={[styles.meta, { color: colors.muted }]}>Loading eligible assigned accounts…</Text></View>
          : (custodiansQuery.data ?? []).length === 0 ? <Text style={[styles.meta, { color: colors.warning }]}>No active eligible site assignee is available. Add/activate an authorised site account first; a free-text custodian is not accepted.</Text>
            : <View style={styles.choiceStack}>{custodiansQuery.data!.map((candidate) => <Choice key={candidate.id} label={`${candidate.name} · ${candidate.businessRole}`} selected={custodianUserId === candidate.id} onPress={() => { setCustodianUserId(candidate.id); setFundMutationId(createClientMutationId()); }} />)}</View>}
      <Text style={[styles.label, { color: colors.muted }]}>Reconciliation period *</Text>
      <View style={styles.choiceStack}>{RECONCILIATION_PERIODS.map((period) => <Choice key={period} label={period} selected={reconciliationPeriod === period} onPress={() => { setReconciliationPeriod(period); setFundMutationId(createClientMutationId()); }} />)}</View>
      <View style={[styles.notice, { backgroundColor: colors.surface, borderColor: colors.border }]}><Text style={[styles.noticeText, { color: colors.muted }]}>The period is recorded, but physical cash-count reconciliation and variance adjustments are not yet available.</Text></View>
      <PrimaryButton icon="save" label={createFundMutation.isPending ? "Saving fund…" : "Create Pending Custodian fund"} disabled={createFundMutation.isPending || !props.canManageFund || fundName.trim().length < 2 || !custodianUserId || !fundLimitRupees.trim() || !custodiansQuery.data?.some((candidate) => candidate.id === custodianUserId)} onPress={() => { void saveFund(); }} />
    </ScrollView></View></View></Modal>

    <Modal visible={movementModalVisible} transparent animationType="slide" onRequestClose={closeMovementForm}><View style={styles.backdrop}><View style={[styles.modal, { backgroundColor: colors.background, borderColor: colors.border }]}><ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
      <ModalHeader title="Record petty-cash movement" onClose={closeMovementForm} />
      <Text style={[styles.noticeText, { color: colors.warning }]}>Records movement from this named site petty-cash fund only. Do not enter personal out-of-pocket costs here; the separate reimbursement workflow is not yet available. This saves a Draft; posting requires a different authorised person. No money is sent or verified.</Text>
      <Text style={[styles.label, { color: colors.muted }]}>Movement type *</Text>
      <View style={styles.choiceStack}>{MOVEMENT_TYPES.map((type) => <Choice key={type} label={type} selected={movementType === type} onPress={() => setType(type)} />)}</View>
      <Field label="Date * (YYYY-MM-DD)" value={movementDate} onChangeText={(value) => changeMovement(setMovementDate, value)} placeholder="2026-11-01" />
      <Field label="Amount (₹) *" value={amountRupees} onChangeText={(value) => changeMovement(setAmountRupees, value)} placeholder="0.00" keyboardType="decimal-pad" />
      {movementType === "Funding" ? <>
        <Text style={[styles.label, { color: colors.muted }]}>Funding source label *</Text>
        <View style={styles.choiceStack}>{FUNDING_SOURCES.map((source) => <Choice key={source} label={source} selected={fundingSource === source} onPress={() => { setFundingSource(source); setMovementMutationId(createClientMutationId()); }} />)}</View>
        <Text style={[styles.meta, { color: colors.muted }]}>Received by · {selectedFund?.custodianNameSnapshot ?? "Named custodian"}</Text>
      </> : null}
      {movementType === "Expense" ? <Field label="Payee *" value={payeeName} onChangeText={(value) => changeMovement(setPayeeName, value)} placeholder="Person or business paid" /> : null}
      {movementType === "Expense" ? <View style={styles.choiceStack}><Choice label="I confirm this Expense was paid directly from the selected site petty-cash fund—not from my own or another personal source." selected={fundSourceConfirmed} onPress={() => { setFundSourceConfirmed((value) => !value); setMovementMutationId(createClientMutationId()); }} /></View> : null}
      {movementType === "Cash Return" ? <Field label="Cash returned by *" value={payeeName} onChangeText={(value) => changeMovement(setPayeeName, value)} placeholder="Person returning cash" /> : null}
      <Field label="Paid/recorded by person *" value={paidByName} onChangeText={(value) => changeMovement(setPaidByName, value)} placeholder="Actual payer or recorder" />
      {movementType !== "Cash Return" ? <>
        <Text style={[styles.label, { color: colors.muted }]}>Payment mode *</Text>
        <View style={styles.choiceStack}>{PAYMENT_MODES.map((mode) => <Choice key={mode} label={mode} selected={paymentMode === mode} onPress={() => { setPaymentMode(mode); setMovementMutationId(createClientMutationId()); }} />)}</View>
      </> : <Text style={[styles.meta, { color: colors.muted }]}>Payment mode · Cash (fixed for return to fund)</Text>}
      <Field label="Category *" value={category} onChangeText={(value) => changeMovement(setCategory, value)} placeholder="Fuel, small tools, local transport…" />
      {movementType === "Expense" ? <>
        <Text style={[styles.label, { color: colors.muted }]}>Optional site work task</Text>
        {tasksQuery.isError ? <InlineError message={tasksQuery.error.message} onRetry={() => { void tasksQuery.refetch(); }} />
          : <View style={styles.choiceStack}><Choice label="No task allocation" selected={!taskId} onPress={() => { setTaskId(""); setMovementMutationId(createClientMutationId()); }} />{(tasksQuery.data ?? []).map((task) => <Choice key={task.id} label={`${task.taskCode} · ${task.title} (${task.status})`} selected={taskId === task.id} onPress={() => { setTaskId(task.id); setMovementMutationId(createClientMutationId()); }} />)}</View>}
      </> : null}
      {movementType === "Cash Return" ? <>
        <Text style={[styles.label, { color: colors.muted }]}>Original Posted expense *</Text>
        {returnCandidatesQuery.isError ? <InlineError message={returnCandidatesQuery.error.message} onRetry={() => { void returnCandidatesQuery.refetch(); }} />
          : returnCandidatesQuery.isLoading ? <View style={styles.loading}><ActivityIndicator color={colors.primary} /><Text style={[styles.meta, { color: colors.muted }]}>Loading Posted expense balances…</Text></View>
            : (returnCandidatesQuery.data?.items ?? []).length === 0 ? <Text style={[styles.meta, { color: colors.warning }]}>No Posted expense with a remaining returnable amount exists in this fund.</Text>
              : <View style={styles.choiceStack}>{returnCandidatesQuery.data!.items.map((candidate) => <Choice key={candidate.id} label={`${candidate.movementDate} · ${candidate.payeeName} · remaining ₹${formatMinorAsRupees(candidate.remainingMinor)} · ${candidate.purpose}`} selected={relatedMovementId === candidate.id} onPress={() => { setRelatedMovementId(candidate.id); setMovementMutationId(createClientMutationId()); }} />)}</View>}
      </> : null}
      <Field label="Purpose *" value={purpose} onChangeText={(value) => changeMovement(setPurpose, value)} placeholder="Why was this cash moved?" multiline />
      <Field label="Receipt/reference text" value={receiptReference} onChangeText={(value) => changeMovement(setReceiptReference, value)} placeholder="Optional text reference only; no file upload" />
      <Field label="If no receipt, explain why" value={receiptMissingReason} onChangeText={(value) => changeMovement(setReceiptMissingReason, value)} placeholder="Required when no receipt reference is entered" multiline />
      <View style={[styles.notice, { backgroundColor: colors.surface, borderColor: colors.border }]}><Text style={[styles.noticeText, { color: colors.muted }]}>Do not enter card, bank-account or login credentials. Receipt evidence is text-only in this increment. If an active reviewer/poster grant requires an accepted Private receipt file, review/post stays blocked until secure upload exists; a text reference does not satisfy that requirement. Only Posted entries change balance; posted entries cannot be edited or deleted here.</Text></View>
      <PrimaryButton icon="save" label={createMovementMutation.isPending ? "Saving Draft…" : "Save movement Draft"} disabled={createMovementMutation.isPending || !props.canCreateMovement || !selectedFund || selectedFund.status !== "Active" || !validDate(movementDate) || !amountRupees.trim() || paidByName.trim().length < 2 || category.trim().length < 2 || purpose.trim().length < 4 || (movementType !== "Funding" && payeeName.trim().length < 2) || (movementType === "Expense" && !fundSourceConfirmed) || (!receiptReference.trim() && receiptMissingReason.trim().length < 3) || (movementType === "Cash Return" && !relatedMovementId)} onPress={() => { void saveMovement(); }} />
    </ScrollView></View></View></Modal>

    <Modal visible={Boolean(pendingAction)} transparent animationType="fade" onRequestClose={() => setPendingAction(null)}><View style={styles.backdrop}><View style={[styles.actionModal, { backgroundColor: colors.background, borderColor: colors.border }]}>
      <ModalHeader title={actionTitle} onClose={() => setPendingAction(null)} />
      <Text style={[styles.meta, { color: colors.muted }]}>{pendingAction?.action === "review" ? "The creator cannot review their own movement. Enter a reason for approval or rejection." : pendingAction?.action === "post" ? "Posting recalculates the site-fund balance under a lock. A direct post from Submitted also records a review reason." : "Only the creator can cancel a Draft or Submitted entry. Posted entries are not reversed by cancellation."}</Text>
      {pendingAction?.action === "review" ? <View style={styles.choiceStack}>{(["Approved", "Rejected"] as const).map((decision) => <Choice key={decision} label={decision} selected={actionDecision === decision} onPress={() => { setActionDecision(decision); setActionMutationId(createClientMutationId()); }} />)}</View> : null}
      <Field label="Reason *" value={actionReason} onChangeText={(value) => { setActionReason(value); setActionMutationId(createClientMutationId()); }} placeholder="At least three characters" multiline />
      <PrimaryButton icon={pendingAction?.action === "post" ? "check-circle" : pendingAction?.action === "cancel" ? "cancel" : "fact-check"} label={actionPending ? "Saving…" : pendingAction?.action === "review" ? `Record ${actionDecision}` : pendingAction?.action === "post" ? "Confirm ledger post" : "Confirm cancellation"} disabled={actionPending || actionReason.trim().length < 3} onPress={() => { void saveAction(); }} />
    </View></View></Modal>
  </View>;
}

function ModalHeader({ title, onClose }: { title: string; onClose: () => void }) {
  const colors = useColors();
  return <View style={styles.modalHeader}><Text style={[styles.modalTitle, { color: colors.foreground }]}>{title}</Text><Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={onClose}><MaterialIcons name="close" size={22} color={colors.muted} /></Pressable></View>;
}
function Choice({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  const colors = useColors();
  return <Pressable accessibilityRole="button" accessibilityState={{ selected }} onPress={onPress} style={[styles.choice, { backgroundColor: selected ? `${colors.primary}12` : colors.surface, borderColor: selected ? colors.primary : colors.border }]}><Text style={[styles.choiceText, { color: selected ? colors.primary : colors.foreground }]}>{label}</Text></Pressable>;
}
function Field({ label, value, onChangeText, placeholder, keyboardType, multiline = false, editable = true }: {
  label: string; value: string; onChangeText: (value: string) => void; placeholder?: string;
  keyboardType?: TextInputProps["keyboardType"]; multiline?: boolean; editable?: boolean;
}) {
  const colors = useColors();
  return <View style={styles.field}><Text style={[styles.label, { color: colors.muted }]}>{label}</Text><TextInput value={value} onChangeText={onChangeText} placeholder={placeholder} placeholderTextColor={colors.muted} keyboardType={keyboardType} multiline={multiline} editable={editable} style={[styles.input, multiline && styles.multiline, { color: colors.foreground, backgroundColor: colors.surface, borderColor: colors.border, opacity: editable ? 1 : 0.72 }]} /></View>;
}

const styles = StyleSheet.create({
  stack: { gap: 10, marginBottom: 16 },
  message: { flexDirection: "row", gap: 8, alignItems: "flex-start", borderWidth: 1, borderRadius: 14, padding: 12, marginBottom: 12 },
  messageText: { flex: 1, fontSize: 12, lineHeight: 18 },
  notice: { flexDirection: "row", gap: 8, alignItems: "flex-start", borderWidth: 1, borderRadius: 14, padding: 12, marginBottom: 12 },
  noticeText: { flex: 1, fontSize: 11, lineHeight: 16 },
  fundCard: { borderWidth: 1, borderRadius: 16, padding: 13, gap: 8 },
  movementCard: { borderWidth: 1, borderRadius: 16, padding: 13, gap: 7 },
  cardTop: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  cardTitle: { fontSize: 14, lineHeight: 18, fontWeight: "800" },
  meta: { fontSize: 11, lineHeight: 16 },
  purpose: { fontSize: 12, lineHeight: 18, fontWeight: "600" },
  status: { fontSize: 10, fontWeight: "800", paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999, overflow: "hidden" },
  balanceRow: { flexDirection: "row", gap: 20, marginVertical: 3 },
  balanceLabel: { fontSize: 10, lineHeight: 14 },
  balanceAmount: { fontSize: 20, lineHeight: 25, fontWeight: "800" },
  limitAmount: { fontSize: 15, lineHeight: 24, fontWeight: "700" },
  loading: { minHeight: 70, justifyContent: "center", alignItems: "center", gap: 8 },
  actionRow: { flexDirection: "row", gap: 8, flexWrap: "wrap", marginTop: 4 },
  pager: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 14, gap: 8 },
  backdrop: { flex: 1, backgroundColor: "rgba(15,23,42,0.55)", justifyContent: "flex-end" },
  modal: { maxHeight: "92%", borderTopLeftRadius: 22, borderTopRightRadius: 22, borderWidth: 1, padding: 18, paddingBottom: 25 },
  actionModal: { marginHorizontal: 18, marginBottom: 24, borderRadius: 20, borderWidth: 1, padding: 18, gap: 12 },
  modalHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 },
  modalTitle: { flex: 1, fontSize: 17, fontWeight: "800" },
  field: { marginTop: 13 },
  label: { fontSize: 11, fontWeight: "800", marginBottom: 6 },
  input: { borderWidth: 1, borderRadius: 12, minHeight: 46, paddingHorizontal: 12, paddingVertical: 10, fontSize: 13 },
  multiline: { minHeight: 78, textAlignVertical: "top" },
  choiceStack: { gap: 7, marginTop: 7, marginBottom: 5 },
  choice: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 11, paddingVertical: 10, minHeight: 40, justifyContent: "center" },
  choiceText: { fontSize: 11, lineHeight: 16, fontWeight: "700" },
  reason: { fontSize: 11, lineHeight: 16, fontStyle: "italic" },
});
