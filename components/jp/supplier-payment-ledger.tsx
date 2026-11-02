import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useMemo, useRef, useState } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { EmptyState, InlineError, PrimaryButton, SectionHeader } from "@/components/jp/ui";
import { useColors } from "@/hooks/use-colors";
import { createClientMutationId } from "@/lib/jp/local-repository";
import { calculatePaymentAllocationTotal, formatMinorAsRupees, parseRupeesToMinor } from "@/lib/jp/finance-domain";
import { clampPageIndex } from "@/lib/jp/selection";
import { trpc } from "@/lib/trpc";

const EMPTY_ID = "00000000-0000-4000-8000-000000000000";
const PAGE_SIZE = 25;
const VENDOR_PAGE_SIZE = 50;
const CANDIDATE_PAGE_SIZE = 50;
const PAYMENT_MODES = ["Bank Transfer", "UPI", "Cheque", "Cash", "Other"] as const;
const PAYMENT_STATUSES = ["All", "Draft", "Submitted", "Approved", "Rejected", "Posted", "Cancelled"] as const;
type PaymentMode = (typeof PAYMENT_MODES)[number];
type PaymentStatus = Exclude<(typeof PAYMENT_STATUSES)[number], "All">;
type PaymentAction = "review" | "post" | "cancel";

type Props = {
  siteId: string;
  currentUserId: number;
  canView: boolean;
  canViewVendors: boolean;
  canCreate: boolean;
  canSubmit: boolean;
  canReview: boolean;
  canPost: boolean;
  canCancel: boolean;
};

function todayString() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}
function validCalendarDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
function errorText(error: unknown) {
  return error instanceof Error ? error.message : "The server did not confirm this finance action.";
}
function formatTime(value: string | Date | null | undefined) {
  if (!value) return "Not recorded";
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? "Time unavailable" : new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

export function SupplierPaymentLedger(props: Props) {
  const colors = useColors();
  const [statusFilter, setStatusFilter] = useState<(typeof PAYMENT_STATUSES)[number]>("All");
  const [page, setPage] = useState(0);
  const [expandedPaymentId, setExpandedPaymentId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [formVisible, setFormVisible] = useState(false);
  const [vendorPage, setVendorPage] = useState(0);
  const [candidatePage, setCandidatePage] = useState(0);
  const [vendorId, setVendorId] = useState("");
  const [paymentDate, setPaymentDate] = useState(todayString());
  const [amountRupees, setAmountRupees] = useState("");
  const [paymentMode, setPaymentMode] = useState<PaymentMode>("Bank Transfer");
  const [paidByName, setPaidByName] = useState("");
  const [fundingSourceLabel, setFundingSourceLabel] = useState("");
  const [category, setCategory] = useState("Supplier invoice settlement");
  const [purpose, setPurpose] = useState("");
  const [externalReference, setExternalReference] = useState("");
  const [allocationAmounts, setAllocationAmounts] = useState<Record<string, string>>({});
  const [candidateBalances, setCandidateBalances] = useState<Record<string, string>>({});
  const [draftMutationId, setDraftMutationId] = useState(() => createClientMutationId());
  const [pendingAction, setPendingAction] = useState<{ paymentId: string; action: PaymentAction } | null>(null);
  const [actionDecision, setActionDecision] = useState<"Approved" | "Rejected">("Approved");
  const [actionReason, setActionReason] = useState("");
  const [actionMutationId, setActionMutationId] = useState("");
  const actionKeys = useRef(new Map<string, string>());

  const paymentsQuery = trpc.jp.finance.payments.listPayments.useQuery({
    siteId: props.siteId || EMPTY_ID,
    offset: page * PAGE_SIZE,
    limit: PAGE_SIZE,
    ...(statusFilter === "All" ? {} : { status: statusFilter as PaymentStatus }),
  }, { enabled: Boolean(props.siteId && props.canView) });
  const vendorsQuery = trpc.jp.finance.listVendors.useQuery({
    siteId: props.siteId || EMPTY_ID,
    offset: vendorPage * VENDOR_PAGE_SIZE,
    limit: VENDOR_PAGE_SIZE,
  }, { enabled: Boolean(formVisible && props.canCreate && props.canViewVendors) });
  const candidatesQuery = trpc.jp.finance.payments.listInvoiceCandidates.useQuery({
    siteId: props.siteId || EMPTY_ID,
    vendorId: vendorId || EMPTY_ID,
    offset: candidatePage * CANDIDATE_PAGE_SIZE,
    limit: CANDIDATE_PAGE_SIZE,
  }, { enabled: Boolean(formVisible && props.canCreate && vendorId) });
  const detailQuery = trpc.jp.finance.payments.paymentDetail.useQuery({
    siteId: props.siteId || EMPTY_ID,
    paymentId: expandedPaymentId || EMPTY_ID,
  }, { enabled: Boolean(props.siteId && expandedPaymentId && props.canView) });

  const createMutation = trpc.jp.finance.payments.createPayment.useMutation();
  const submitMutation = trpc.jp.finance.payments.submitPayment.useMutation();
  const reviewMutation = trpc.jp.finance.payments.reviewPayment.useMutation();
  const postMutation = trpc.jp.finance.payments.postPayment.useMutation();
  const cancelMutation = trpc.jp.finance.payments.cancelPayment.useMutation();

  const rows = paymentsQuery.data?.rows ?? [];
  const total = paymentsQuery.data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const vendors = vendorsQuery.data?.rows ?? [];
  const vendorTotal = vendorsQuery.data?.total ?? 0;
  const vendorPageCount = Math.max(1, Math.ceil(vendorTotal / VENDOR_PAGE_SIZE));
  const candidates = candidatesQuery.data?.rows ?? [];
  const candidateTotal = candidatesQuery.data?.total ?? 0;
  const candidatePageCount = Math.max(1, Math.ceil(candidateTotal / CANDIDATE_PAGE_SIZE));

  if (paymentsQuery.data && page !== clampPageIndex(page, total, PAGE_SIZE)) setPage(clampPageIndex(page, total, PAGE_SIZE));
  if (vendorsQuery.data && vendorPage !== clampPageIndex(vendorPage, vendorTotal, VENDOR_PAGE_SIZE)) setVendorPage(clampPageIndex(vendorPage, vendorTotal, VENDOR_PAGE_SIZE));
  if (candidatesQuery.data && candidatePage !== clampPageIndex(candidatePage, candidateTotal, CANDIDATE_PAGE_SIZE)) setCandidatePage(clampPageIndex(candidatePage, candidateTotal, CANDIDATE_PAGE_SIZE));
  // Remember server balances from every candidate page seen, so allocations on earlier pages keep their balance.
  const [mergedCandidateData, setMergedCandidateData] = useState<typeof candidatesQuery.data>(undefined);
  if (candidatesQuery.data && candidatesQuery.data !== mergedCandidateData) {
    const freshData = candidatesQuery.data;
    setMergedCandidateData(freshData);
    setCandidateBalances((current) => ({
      ...current,
      ...Object.fromEntries(freshData.rows.map((invoice) => [invoice.id, invoice.balanceMinor])),
    }));
  }

  const selectedAllocations = useMemo(() => Object.entries(allocationAmounts)
    .filter(([, amount]) => amount.trim().length > 0)
    .map(([invoiceId, amount]) => ({ invoiceId, amountMinor: parseRupeesToMinor(amount) })), [allocationAmounts]);
  const allocationPreview = useMemo(() => {
    try {
      if (!amountRupees.trim()) throw new Error("Enter the payment amount.");
      const amountMinor = parseRupeesToMinor(amountRupees);
      const balances = new Map(selectedAllocations.map((allocation) => [allocation.invoiceId, candidateBalances[allocation.invoiceId] ?? "0"]));
      const totalMinor = calculatePaymentAllocationTotal(amountMinor, selectedAllocations, balances);
      return { totalMinor, error: null as string | null };
    } catch (error) {
      return { totalMinor: null, error: errorText(error) };
    }
  }, [amountRupees, candidateBalances, selectedAllocations]);

  const resetForm = () => {
    setVendorPage(0); setCandidatePage(0); setVendorId(""); setPaymentDate(todayString()); setAmountRupees("");
    setPaymentMode("Bank Transfer"); setPaidByName(""); setFundingSourceLabel(""); setCategory("Supplier invoice settlement");
    setPurpose(""); setExternalReference(""); setAllocationAmounts({}); setCandidateBalances({}); setDraftMutationId(createClientMutationId());
  };
  const openForm = () => {
    resetForm(); setMessage(null); setFormVisible(true);
  };
  const closeForm = () => { setFormVisible(false); };
  const changeDraft = (setter: (value: string) => void, value: string) => {
    setter(value);
    setDraftMutationId(createClientMutationId());
  };
  const selectVendor = (id: string) => {
    setVendorId(id); setCandidatePage(0); setAllocationAmounts({}); setCandidateBalances({}); setDraftMutationId(createClientMutationId());
  };
  const setAllocation = (invoiceId: string, value: string) => {
    setAllocationAmounts((current) => ({ ...current, [invoiceId]: value }));
    setDraftMutationId(createClientMutationId());
  };

  const saveDraft = async () => {
    if (!props.canCreate || !props.canViewVendors || !props.siteId || !vendorId || !validCalendarDate(paymentDate)) {
      setMessage("Choose an authorised site and active supplier, and enter a valid payment date."); return;
    }
    if (!allocationPreview.totalMinor) {
      setMessage(allocationPreview.error ?? "Allocate the full payment to approved invoices."); return;
    }
    try {
      await createMutation.mutateAsync({
        siteId: props.siteId,
        vendorId,
        paymentDate,
        amountRupees: amountRupees.trim(),
        paymentMode,
        paidByName: paidByName.trim(),
        fundingSourceLabel: fundingSourceLabel.trim(),
        category: category.trim(),
        purpose: purpose.trim(),
        externalReference: externalReference.trim() || undefined,
        allocations: Object.entries(allocationAmounts)
          .filter(([, amount]) => amount.trim().length > 0)
          .map(([invoiceId, amountRupees]) => ({ invoiceId, amountRupees: amountRupees.trim() })),
        clientMutationId: draftMutationId,
      });
      setFormVisible(false); resetForm(); setMessage("Payment saved as Draft. This created an internal record only; no money was sent or bank-verified.");
      await paymentsQuery.refetch();
    } catch (error) {
      setMessage(`Draft was not confirmed. Retry unchanged details with the same key; if correcting details, edit a field to generate a fresh key. ${errorText(error)}`);
    }
  };

  const getActionKey = (key: string) => {
    const existing = actionKeys.current.get(key);
    if (existing) return existing;
    const created = createClientMutationId();
    actionKeys.current.set(key, created);
    return created;
  };
  const clearActionKey = (key: string) => actionKeys.current.delete(key);
  const submit = async (paymentId: string) => {
    const keyName = `${paymentId}:submit`;
    try {
      await submitMutation.mutateAsync({ siteId: props.siteId, paymentId, clientMutationId: getActionKey(keyName) });
      clearActionKey(keyName); setMessage("Payment submitted for a different authorised reviewer.");
      await paymentsQuery.refetch();
    } catch (error) { setMessage(`Submission was not confirmed. Retry this same Draft action safely. ${errorText(error)}`); }
  };
  const openAction = (paymentId: string, action: PaymentAction) => {
    setPendingAction({ paymentId, action }); setActionDecision("Approved"); setActionReason(""); setActionMutationId(createClientMutationId());
  };
  const updateActionReason = (value: string) => { setActionReason(value); setActionMutationId(createClientMutationId()); };
  const saveAction = async () => {
    if (!pendingAction || actionReason.trim().length < 3) {
      setMessage("Enter a reason of at least three characters for review, posting, or cancellation."); return;
    }
    const { paymentId, action } = pendingAction;
    const keyName = `${paymentId}:${action}:${actionDecision}:${actionReason.trim()}`;
    const key = actionMutationId || getActionKey(keyName);
    try {
      if (action === "review") {
        await reviewMutation.mutateAsync({ siteId: props.siteId, paymentId, decision: actionDecision, reason: actionReason.trim(), clientMutationId: key });
      } else if (action === "post") {
        await postMutation.mutateAsync({ siteId: props.siteId, paymentId, reason: actionReason.trim(), clientMutationId: key });
      } else {
        await cancelMutation.mutateAsync({ siteId: props.siteId, paymentId, reason: actionReason.trim(), clientMutationId: key });
      }
      clearActionKey(keyName); setPendingAction(null); setActionReason("");
      setMessage(action === "post" ? "Posted to the JP Infracon internal ledger. No bank/UPI transfer or provider verification took place." : action === "review" ? `Payment ${actionDecision.toLowerCase()} with a recorded reason.` : "Unposted payment cancelled with a recorded reason.");
      await Promise.all([paymentsQuery.refetch(), detailQuery.refetch()]);
    } catch (error) {
      setMessage(`Action was not confirmed. Retry with the same decision/reason to reuse its idempotency key. ${errorText(error)}`);
    }
  };

  const actionPending = reviewMutation.isPending || postMutation.isPending || cancelMutation.isPending;
  const modalTitle = pendingAction?.action === "review" ? "Review supplier payment" : pendingAction?.action === "post" ? "Post to internal ledger" : "Cancel unposted payment";
  const modalActionLabel = pendingAction?.action === "review" ? `Record ${actionDecision.toLowerCase()}` : pendingAction?.action === "post" ? "Confirm ledger posting" : "Confirm cancellation";
  const modalCopy = pendingAction?.action === "review"
    ? "The creator cannot review their own payment. Approval is not a bank transfer."
    : pendingAction?.action === "post"
      ? "Posting records an internal ledger event only. The app does not send or verify money through a bank or UPI provider."
      : "Only the creator may cancel an unposted Draft or Submitted record. A reason is retained in the audit trail.";

  return <View>
    <SectionHeader title="Supplier payments" action={props.canCreate && props.canViewVendors ? "Record payment" : undefined} onPress={props.canCreate && props.canViewVendors ? openForm : undefined} />
    {message ? <View style={[styles.message, { backgroundColor: `${colors.primary}12`, borderColor: `${colors.primary}45` }]}><MaterialIcons name="info-outline" size={17} color={colors.primary} /><Text style={[styles.messageText, { color: colors.foreground }]}>{message}</Text></View> : null}
    <View style={[styles.notice, { backgroundColor: colors.surface, borderColor: colors.border }]}><MaterialIcons name="account-balance-wallet" size={17} color={colors.warning} /><Text style={[styles.noticeText, { color: colors.muted }]}>Internal supplier-invoice ledger only. “Posted” is not a bank/UPI transfer or independent confirmation. Only Posted allocations reduce the approved invoice amount shown as available; advances, credit/debit notes, retention, evidence and actual payment execution are not included.</Text></View>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>{PAYMENT_STATUSES.map((status) => <Choice key={status} label={status} selected={statusFilter === status} onPress={() => { setStatusFilter(status); setPage(0); setExpandedPaymentId(null); }} />)}</ScrollView>
    {paymentsQuery.isError ? <InlineError message={paymentsQuery.error.message} onRetry={() => { void paymentsQuery.refetch(); }} />
      : paymentsQuery.isLoading ? <View style={styles.loading}><ActivityIndicator color={colors.primary} /><Text style={[styles.meta, { color: colors.muted }]}>Loading site payment ledger…</Text></View>
        : rows.length === 0 ? <EmptyState icon="payments" title="No supplier-payment records" detail={statusFilter === "All" ? "No payment record exists for this assigned site. Creating a Draft does not execute a payment." : `No records currently have ${statusFilter} status.`} />
          : <View style={styles.stack}>{rows.map((payment) => {
            const isCreator = payment.createdBy === props.currentUserId;
            const maySubmit = props.canSubmit && payment.status === "Draft" && isCreator;
            const mayReview = props.canReview && payment.status === "Submitted" && !isCreator;
            const mayPost = props.canPost && (payment.status === "Submitted" || payment.status === "Approved") && !isCreator;
            const mayCancel = props.canCancel && (payment.status === "Draft" || payment.status === "Submitted") && isCreator;
            const expanded = expandedPaymentId === payment.id;
            const statusColor = payment.status === "Posted" ? colors.success : payment.status === "Rejected" || payment.status === "Cancelled" || payment.status === "Reversed" ? colors.warning : colors.primary;
            return <View key={payment.id} style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <View style={styles.cardTop}><View style={{ flex: 1 }}><Text style={[styles.title, { color: colors.foreground }]}>{payment.vendorName}</Text><Text style={[styles.meta, { color: colors.muted }]}>{payment.transactionType} · {payment.paymentDate} · {payment.paymentMode}</Text></View><Text style={[styles.status, { color: statusColor, backgroundColor: `${statusColor}18` }]}>{payment.status}</Text></View>
              <Text style={[styles.amount, { color: colors.foreground }]}>{formatMinorAsRupees(payment.amountMinor)}</Text>
              <Text style={[styles.meta, { color: colors.muted }]}>Paid by {payment.paidByName} · source {payment.fundingSourceLabel}</Text>
              <Text style={[styles.meta, { color: colors.muted }]}>{payment.category} · {payment.purpose}</Text>
              {payment.externalReference ? <Text style={[styles.meta, { color: colors.muted }]}>External reference text: {payment.externalReference}</Text> : null}
              {payment.status === "Posted" ? <Text style={[styles.postedNote, { color: colors.success }]}>Internal ledger entry only · not bank-verified</Text> : null}
              {payment.reviewReason ? <Text style={[styles.reason, { color: colors.muted }]}>Review reason: {payment.reviewReason}</Text> : null}
              {payment.cancellationReason ? <Text style={[styles.reason, { color: colors.warning }]}>Cancellation: {payment.cancellationReason}</Text> : null}
              {payment.postedAt ? <Text style={[styles.meta, { color: colors.muted }]}>Posted in app ledger {formatTime(payment.postedAt)}</Text> : null}
              <View style={styles.actions}>
                <Pressable accessibilityRole="button" onPress={() => setExpandedPaymentId(expanded ? null : payment.id)} style={[styles.actionButton, { borderColor: colors.border }]}><MaterialIcons name={expanded ? "expand-less" : "expand-more"} size={18} color={colors.primary} /><Text style={[styles.actionText, { color: colors.primary }]}>{expanded ? "Hide allocations" : "View allocations"}</Text></Pressable>
                {maySubmit ? <Pressable accessibilityRole="button" disabled={submitMutation.isPending} onPress={() => { void submit(payment.id); }} style={[styles.actionButton, { borderColor: colors.primary }]}><Text style={[styles.actionText, { color: colors.primary }]}>{submitMutation.isPending ? "Submitting…" : "Submit for review"}</Text></Pressable> : null}
                {mayReview ? <Pressable accessibilityRole="button" onPress={() => openAction(payment.id, "review")} style={[styles.actionButton, { borderColor: colors.success }]}><Text style={[styles.actionText, { color: colors.success }]}>Review</Text></Pressable> : null}
                {mayPost ? <Pressable accessibilityRole="button" onPress={() => openAction(payment.id, "post")} style={[styles.actionButton, { borderColor: colors.primary }]}><Text style={[styles.actionText, { color: colors.primary }]}>Post to ledger</Text></Pressable> : null}
                {mayCancel ? <Pressable accessibilityRole="button" onPress={() => openAction(payment.id, "cancel")} style={[styles.actionButton, { borderColor: colors.warning }]}><Text style={[styles.actionText, { color: colors.warning }]}>Cancel</Text></Pressable> : null}
              </View>
              {expanded ? detailQuery.isLoading ? <Text style={[styles.meta, { color: colors.muted }]}>Loading invoice allocations…</Text>
                : detailQuery.isError ? <InlineError message={detailQuery.error.message} onRetry={() => { void detailQuery.refetch(); }} />
                  : detailQuery.data?.payment.id === payment.id ? <View style={[styles.detail, { borderTopColor: colors.border }]}>
                    <Text style={[styles.meta, { color: colors.muted }]}>Recorded {formatTime(detailQuery.data.payment.createdAt)}{detailQuery.data.payment.submittedAt ? ` · submitted ${formatTime(detailQuery.data.payment.submittedAt)}` : ""}</Text>
                    {detailQuery.data.allocations.map((allocation) => <View key={allocation.invoiceId} style={styles.allocationRow}><Text style={[styles.meta, { color: colors.foreground, flex: 1 }]}>{allocation.invoiceNumber}</Text><Text style={[styles.meta, { color: colors.foreground }]}>{formatMinorAsRupees(allocation.amountMinor)}</Text></View>)}
                    {detailQuery.data.allocations.length === 0 ? <Text style={[styles.meta, { color: colors.warning }]}>No invoice allocations are recorded.</Text> : null}
                    {detailQuery.data.payment.reviewReason ? <Text style={[styles.meta, { color: colors.muted }]}>Review reason: {detailQuery.data.payment.reviewReason}</Text> : null}
                  </View> : null : null}
            </View>;
          })}</View>}
    {total > PAGE_SIZE ? <Pager page={page} pageCount={pageCount} onChange={setPage} /> : null}

    <Modal visible={formVisible} transparent animationType="slide" onRequestClose={closeForm}><View style={styles.backdrop}><View style={[styles.modal, { backgroundColor: colors.background, borderColor: colors.border }]}><ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
      <View style={styles.modalHeader}><Text style={[styles.modalTitle, { color: colors.foreground }]}>Record supplier payment</Text><Pressable accessibilityRole="button" onPress={closeForm}><MaterialIcons name="close" size={22} color={colors.muted} /></Pressable></View>
      <Text style={[styles.noticeText, { color: colors.warning }]}>This saves a Draft ledger record only. It does not send money or prove payment.</Text>
      <Text style={[styles.label, { color: colors.muted }]}>Active supplier *</Text>
      {vendorsQuery.isLoading ? <View style={styles.loading}><ActivityIndicator color={colors.primary} /><Text style={[styles.meta, { color: colors.muted }]}>Loading suppliers…</Text></View>
        : vendorsQuery.isError ? <InlineError message={vendorsQuery.error.message} onRetry={() => { void vendorsQuery.refetch(); }} />
          : vendors.length ? <View style={styles.choiceStack}>{vendors.map((vendor) => <Choice key={vendor.id} label={vendor.legalName} selected={vendorId === vendor.id} onPress={() => selectVendor(vendor.id)} />)}</View>
            : <Text style={[styles.meta, { color: colors.warning }]}>No supplier is available on this page. Add or locate an active organisation supplier in the Suppliers section.</Text>}
      {vendorTotal > VENDOR_PAGE_SIZE ? <Pager page={vendorPage} pageCount={vendorPageCount} onChange={setVendorPage} /> : null}
      <Field label="Payment date * (YYYY-MM-DD)" value={paymentDate} onChangeText={(value) => changeDraft(setPaymentDate, value)} placeholder="2026-10-29" />
      <Field label="Total payment amount (₹) *" value={amountRupees} onChangeText={(value) => changeDraft(setAmountRupees, value)} placeholder="0.00" keyboardType="decimal-pad" />
      <Text style={[styles.label, { color: colors.muted }]}>Payment mode *</Text>
      <View style={styles.choiceStack}>{PAYMENT_MODES.map((mode) => <Choice key={mode} label={mode} selected={paymentMode === mode} onPress={() => { setPaymentMode(mode); setDraftMutationId(createClientMutationId()); }} />)}</View>
      <View style={styles.twoColumns}><View style={{ flex: 1 }}><Field label="Paid by person *" value={paidByName} onChangeText={(value) => changeDraft(setPaidByName, value)} placeholder="Actual payer name" /></View><View style={{ flex: 1 }}><Field label="Funding source label *" value={fundingSourceLabel} onChangeText={(value) => changeDraft(setFundingSourceLabel, value)} placeholder="Source account/fund label" /></View></View>
      <Field label="Category *" value={category} onChangeText={(value) => changeDraft(setCategory, value)} placeholder="Supplier invoice settlement" />
      <Field label="Purpose *" value={purpose} onChangeText={(value) => changeDraft(setPurpose, value)} placeholder="Reason for this payment record" multiline />
      <Field label="External reference (text only)" value={externalReference} onChangeText={(value) => changeDraft(setExternalReference, value)} placeholder="Optional reference; not proof of transfer" />
      <SectionHeader title="Allocate to approved invoices" />
      <Text style={[styles.meta, { color: colors.muted }]}>Select invoice allocations that sum exactly to the payment. Balances are derived from approved invoices minus Posted internal-ledger allocations only.</Text>
      {!vendorId ? <Text style={[styles.meta, { color: colors.warning, marginTop: 10 }]}>Choose a supplier to load its approved invoices for this site.</Text>
        : candidatesQuery.isError ? <InlineError message={candidatesQuery.error.message} onRetry={() => { void candidatesQuery.refetch(); }} />
          : candidatesQuery.isLoading ? <View style={styles.loading}><ActivityIndicator color={colors.primary} /><Text style={[styles.meta, { color: colors.muted }]}>Loading approved invoice balances…</Text></View>
            : candidates.length === 0 ? <EmptyState icon="receipt-long" title="No approved invoices available" detail="This supplier has no approved invoice with an allocatable balance on this site. Supplier advances are not included in this workflow." />
              : <View style={styles.stack}>{candidates.map((invoice) => {
                const balance = invoice.balanceMinor;
                const disabled = BigInt(balance) <= 0n;
                return <View key={invoice.id} style={[styles.candidate, { borderColor: colors.border, opacity: disabled ? 0.55 : 1 }]}>
                  <View style={{ flex: 1 }}><Text style={[styles.cardTitle, { color: colors.foreground }]}>{invoice.invoiceNumber}</Text><Text style={[styles.meta, { color: colors.muted }]}>Approved · date {invoice.invoiceDate}{invoice.dueDate ? ` · due ${invoice.dueDate}` : ""}</Text><Text style={[styles.meta, { color: colors.muted }]}>Available from Posted allocations: {formatMinorAsRupees(balance)} of {formatMinorAsRupees(invoice.totalMinor)}</Text></View>
                  <View style={styles.allocationInput}><Field label="Allocate (₹)" value={allocationAmounts[invoice.id] ?? ""} onChangeText={(value) => setAllocation(invoice.id, value)} placeholder="0.00" keyboardType="decimal-pad" editable={!disabled} /></View>
                </View>;
              })}</View>}
      {candidateTotal > CANDIDATE_PAGE_SIZE ? <Pager page={candidatePage} pageCount={candidatePageCount} onChange={setCandidatePage} /> : null}
      <View style={[styles.totalBox, { backgroundColor: colors.surface, borderColor: allocationPreview.error ? colors.warning : colors.border }]}><Text style={[styles.meta, { color: colors.muted }]}>Allocation check · exact integer paise</Text><Text style={[styles.preview, { color: allocationPreview.totalMinor ? colors.success : colors.warning }]}>{allocationPreview.totalMinor ? formatMinorAsRupees(allocationPreview.totalMinor) : allocationPreview.error}</Text></View>
      <View style={styles.buttonStack}><PrimaryButton icon="save" label={createMutation.isPending ? "Saving Draft…" : "Save payment Draft"} disabled={createMutation.isPending || !props.canCreate || !props.canViewVendors || !vendorId || !validCalendarDate(paymentDate) || !allocationPreview.totalMinor || paidByName.trim().length < 2 || fundingSourceLabel.trim().length < 2 || category.trim().length < 2 || purpose.trim().length < 3} onPress={() => { void saveDraft(); }} /></View>
      <Text style={[styles.meta, { color: colors.muted, marginTop: 10 }]}>No raw bank credentials are collected. Uploading evidence, supplier advances, reversals, retention, notes, petty cash and reimbursements are not part of this slice.</Text>
    </ScrollView></View></View></Modal>

    <Modal visible={Boolean(pendingAction)} transparent animationType="fade" onRequestClose={() => setPendingAction(null)}><View style={styles.backdrop}><View style={[styles.actionModal, { backgroundColor: colors.background, borderColor: colors.border }]}>
      <View style={styles.modalHeader}><Text style={[styles.modalTitle, { color: colors.foreground }]}>{modalTitle}</Text><Pressable accessibilityRole="button" onPress={() => setPendingAction(null)}><MaterialIcons name="close" size={22} color={colors.muted} /></Pressable></View>
      <Text style={[styles.meta, { color: colors.muted }]}>{modalCopy}</Text>
      {pendingAction?.action === "review" ? <View style={styles.choiceStack}>{(["Approved", "Rejected"] as const).map((decision) => <Choice key={decision} label={decision} selected={actionDecision === decision} onPress={() => { setActionDecision(decision); setActionMutationId(createClientMutationId()); }} />)}</View> : null}
      <Field label="Reason *" value={actionReason} onChangeText={updateActionReason} placeholder={pendingAction?.action === "review" ? "Review decision reason" : pendingAction?.action === "post" ? "Reason for internal ledger posting" : "Reason for cancellation"} multiline />
      <PrimaryButton icon={pendingAction?.action === "post" ? "post-add" : pendingAction?.action === "cancel" ? "cancel" : "fact-check"} label={actionPending ? "Saving…" : modalActionLabel} disabled={actionPending || actionReason.trim().length < 3 || (pendingAction?.action === "review" && !props.canReview) || (pendingAction?.action === "post" && !props.canPost) || (pendingAction?.action === "cancel" && !props.canCancel)} onPress={() => { void saveAction(); }} />
    </View></View></Modal>
  </View>;
}

function Field({ label, value, onChangeText, placeholder, keyboardType, multiline, editable = true }: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
  keyboardType?: "default" | "number-pad" | "decimal-pad";
  multiline?: boolean;
  editable?: boolean;
}) {
  const colors = useColors();
  return <View style={styles.field}><Text style={[styles.label, { color: colors.muted }]}>{label}</Text><TextInput value={value} onChangeText={onChangeText} placeholder={placeholder} placeholderTextColor={colors.muted} keyboardType={keyboardType} multiline={multiline} editable={editable} autoCapitalize="sentences" textAlignVertical={multiline ? "top" : "center"} style={[styles.input, { color: colors.foreground, backgroundColor: colors.surface, borderColor: colors.border, opacity: editable ? 1 : 0.7 }, multiline && styles.multiline]} /></View>;
}

function Choice({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  const colors = useColors();
  return <Pressable accessibilityRole="button" accessibilityState={{ selected }} onPress={onPress} style={[styles.choice, { borderColor: selected ? colors.primary : colors.border, backgroundColor: selected ? `${colors.primary}15` : colors.surface }]}><Text style={[styles.choiceText, { color: selected ? colors.primary : colors.foreground }]}>{label}</Text></Pressable>;
}

function Pager({ page, pageCount, onChange }: { page: number; pageCount: number; onChange: (page: number) => void }) {
  const colors = useColors();
  return <View style={styles.pager}><Pressable accessibilityRole="button" accessibilityLabel="Previous page" disabled={page === 0} onPress={() => onChange(Math.max(0, page - 1))} style={[styles.pageButton, { borderColor: colors.border, opacity: page === 0 ? 0.4 : 1 }]}><MaterialIcons name="chevron-left" size={20} color={colors.primary} /></Pressable><Text style={[styles.meta, { color: colors.muted }]}>Page {page + 1} of {pageCount}</Text><Pressable accessibilityRole="button" accessibilityLabel="Next page" disabled={page >= pageCount - 1} onPress={() => onChange(Math.min(pageCount - 1, page + 1))} style={[styles.pageButton, { borderColor: colors.border, opacity: page >= pageCount - 1 ? 0.4 : 1 }]}><MaterialIcons name="chevron-right" size={20} color={colors.primary} /></Pressable></View>;
}

const styles = StyleSheet.create({
  message: { borderWidth: 1, borderRadius: 13, padding: 11, flexDirection: "row", alignItems: "flex-start", gap: 8, marginBottom: 12 },
  messageText: { fontSize: 11, lineHeight: 17, flex: 1 },
  notice: { borderWidth: 1, borderRadius: 13, padding: 11, flexDirection: "row", alignItems: "flex-start", gap: 8, marginBottom: 14 },
  noticeText: { fontSize: 10, lineHeight: 16, flex: 1 },
  filterRow: { gap: 7, paddingBottom: 10 },
  stack: { gap: 10 },
  card: { borderWidth: 1, borderRadius: 16, padding: 13 },
  cardTop: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  title: { fontSize: 14, fontWeight: "900" },
  cardTitle: { fontSize: 12, fontWeight: "800" },
  amount: { fontSize: 22, fontWeight: "900", marginTop: 11 },
  meta: { fontSize: 10, lineHeight: 15, marginTop: 4 },
  status: { fontSize: 9, fontWeight: "900", paddingHorizontal: 8, paddingVertical: 5, borderRadius: 11, overflow: "hidden" },
  postedNote: { fontSize: 10, fontWeight: "800", marginTop: 6 },
  reason: { fontSize: 10, lineHeight: 15, marginTop: 5 },
  actions: { flexDirection: "row", gap: 7, flexWrap: "wrap", marginTop: 11 },
  actionButton: { minHeight: 36, borderWidth: 1, borderRadius: 10, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4, paddingHorizontal: 9 },
  actionText: { fontSize: 10, fontWeight: "800" },
  detail: { borderTopWidth: 1, paddingTop: 8, marginTop: 10 },
  allocationRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 6, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "rgba(128,128,128,0.25)" },
  loading: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 14 },
  field: { marginTop: 11 },
  label: { fontSize: 10, fontWeight: "800", marginBottom: 5 },
  input: { minHeight: 44, borderWidth: 1, borderRadius: 11, paddingHorizontal: 11, fontSize: 13 },
  multiline: { minHeight: 72, paddingTop: 10 },
  choiceStack: { flexDirection: "row", gap: 7, flexWrap: "wrap", marginTop: 8, marginBottom: 4 },
  choice: { borderWidth: 1, borderRadius: 13, minHeight: 36, paddingHorizontal: 10, justifyContent: "center", alignItems: "center" },
  choiceText: { fontSize: 10, fontWeight: "800" },
  candidate: { borderWidth: 1, borderRadius: 12, padding: 9, flexDirection: "row", alignItems: "center", gap: 8 },
  allocationInput: { width: 125 },
  totalBox: { borderWidth: 1, borderRadius: 13, padding: 11, marginTop: 12 },
  preview: { fontSize: 14, fontWeight: "900", marginTop: 4 },
  pager: { flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 14, paddingVertical: 11 },
  pageButton: { width: 36, height: 36, borderWidth: 1, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.68)", justifyContent: "flex-end" },
  modal: { maxHeight: "93%", borderTopLeftRadius: 20, borderTopRightRadius: 20, borderWidth: 1, paddingHorizontal: 15, paddingTop: 13, paddingBottom: 25 },
  actionModal: { borderWidth: 1, borderRadius: 18, margin: 18, padding: 15 },
  modalHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 10 },
  modalTitle: { fontSize: 16, fontWeight: "900", flex: 1 },
  totalText: { fontSize: 18, fontWeight: "900" },
  buttonStack: { gap: 8, marginTop: 13 },
  twoColumns: { flexDirection: "row", gap: 9 },
});
