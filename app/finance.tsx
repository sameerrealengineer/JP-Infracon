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
  PrimaryButton,
  Screen,
  SectionHeader,
} from "@/components/jp/ui";
import { SupplierPaymentLedger } from "@/components/jp/supplier-payment-ledger";
import { PettyCashLedger } from "@/components/jp/petty-cash-ledger";
import { useColors } from "@/hooks/use-colors";
import { createClientMutationId } from "@/lib/jp/local-repository";
import {
  calculateInvoiceTotals,
  formatMinorAsRupees,
  parsePositiveQuantity,
  parseRupeesToMinor,
} from "@/lib/jp/finance-domain";
import { clampPageIndex, resolveChoice, resolveSelectedId } from "@/lib/jp/selection";
import { trpc } from "@/lib/trpc";

const EMPTY_ID = "00000000-0000-4000-8000-000000000000";
const INVOICE_PAGE_SIZE = 25;
const VENDOR_PAGE_SIZE = 50;
const VENDOR_TYPES = [
  "Material Supplier",
  "Transporter",
  "Subcontractor",
  "Service Provider",
  "Other",
] as const;
const INVOICE_STATUSES = ["All", "Draft", "Submitted", "Approved", "Rejected", "Disputed"] as const;
type VendorType = (typeof VENDOR_TYPES)[number];
type InvoiceStatus = Exclude<(typeof INVOICE_STATUSES)[number], "All">;
type FinanceSection = "Invoices" | "Suppliers" | "Payments" | "Petty Cash";
type DraftLine = {
  description: string;
  quantity: string;
  unitCode: string;
  lineTotalRupees: string;
};

function todayString() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}
function formatTime(value: string | Date | null | undefined) {
  if (!value) return "Time not recorded";
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime())
    ? "Time unavailable"
    : new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}
function errorText(error: unknown) {
  return error instanceof Error ? error.message : "The server did not confirm this finance action.";
}
function invoiceStatusDescription(status: string) {
  if (status === "Draft") return "Saved draft · not submitted for review";
  if (status === "Submitted") return "Submitted · awaiting a different authorised reviewer";
  if (status === "Approved")
    return "Invoice review approved · see Payments for allocation-derived availability";
  if (status === "Rejected") return "Rejected · no payable or payment was recorded";
  if (status === "Disputed") return "Disputed · not payable until resolved";
  return status;
}

export default function FinanceScreen() {
  const colors = useColors();
  const me = trpc.auth.me.useQuery(undefined, { retry: false });
  const sitesQuery = trpc.jp.workspace.mySites.useQuery();
  const capabilitiesQuery = trpc.jp.workspace.myCapabilities.useQuery();
  const utils = trpc.useUtils();
  const [chosenSiteId, setSiteId] = useState("");
  const [chosenSection, setSection] = useState<FinanceSection>("Invoices");
  const [invoicePage, setInvoicePage] = useState(0);
  const [vendorPage, setVendorPage] = useState(0);
  const [statusFilter, setStatusFilter] = useState<(typeof INVOICE_STATUSES)[number]>("All");
  const [expandedInvoiceId, setExpandedInvoiceId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [vendorModalVisible, setVendorModalVisible] = useState(false);
  const [vendorType, setVendorType] = useState<VendorType>("Material Supplier");
  const [legalName, setLegalName] = useState("");
  const [tradeName, setTradeName] = useState("");
  const [contactName, setContactName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [address, setAddress] = useState("");
  const [paymentTermsDays, setPaymentTermsDays] = useState("");
  const [vendorMutationId, setVendorMutationId] = useState(() => createClientMutationId());

  const [invoiceModalVisible, setInvoiceModalVisible] = useState(false);
  const [invoiceVendorId, setInvoiceVendorId] = useState("");
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [invoiceDate, setInvoiceDate] = useState(todayString());
  const [dueDate, setDueDate] = useState("");
  const [taxRupees, setTaxRupees] = useState("0");
  const [chargesRupees, setChargesRupees] = useState("0");
  const [purchaseReference, setPurchaseReference] = useState("");
  const [receiptReference, setReceiptReference] = useState("");
  const [lineDescription, setLineDescription] = useState("");
  const [lineQuantity, setLineQuantity] = useState("");
  const [lineUnitCode, setLineUnitCode] = useState("");
  const [lineTotalRupees, setLineTotalRupees] = useState("");
  const [invoiceLines, setInvoiceLines] = useState<DraftLine[]>([]);
  const [invoiceMutationId, setInvoiceMutationId] = useState(() => createClientMutationId());

  const [reviewInvoiceId, setReviewInvoiceId] = useState<string | null>(null);
  const [reviewDecision, setReviewDecision] = useState<"Approved" | "Rejected" | "Disputed">(
    "Approved",
  );
  const [reviewReason, setReviewReason] = useState("");
  const [reviewMutationId, setReviewMutationId] = useState<string | null>(null);

  const capabilities = capabilitiesQuery.data ?? [];
  const siteOptions = useMemo(
    () =>
      (sitesQuery.data ?? []).filter((site) =>
        capabilities.some(
          (capability) =>
            capability.siteId === site.id &&
            (capability["finance.invoice.view"] ||
              capability["finance.payment.view"] ||
              capability["finance.cash.view"] ||
              capability["vendor.view"]),
        ),
      ),
    [sitesQuery.data, capabilities],
  );
  const siteId = resolveSelectedId(siteOptions, chosenSiteId);
  const invoiceListKey = `${siteId}|${statusFilter}`;
  const [shownInvoiceListKey, setShownInvoiceListKey] = useState(invoiceListKey);
  if (shownInvoiceListKey !== invoiceListKey) {
    setShownInvoiceListKey(invoiceListKey);
    setInvoicePage(0);
    setExpandedInvoiceId(null);
  }
  const [shownVendorSiteId, setShownVendorSiteId] = useState(siteId);
  if (shownVendorSiteId !== siteId) {
    setShownVendorSiteId(siteId);
    setVendorPage(0);
  }

  const siteCapability = capabilities.find((capability) => capability.siteId === siteId);
  const canViewVendors = Boolean(siteCapability?.["vendor.view"]);
  const canViewInvoices = Boolean(siteCapability?.["finance.invoice.view"]);
  const canViewPayments = Boolean(siteCapability?.["finance.payment.view"]);
  const canViewPettyCash = Boolean(siteCapability?.["finance.cash.view"]);
  const canCreateVendor = Boolean(siteCapability?.["vendor.create"]);
  const canCreateInvoice = Boolean(siteCapability?.["finance.invoice.create"]);
  const canSubmitInvoice = Boolean(siteCapability?.["finance.invoice.submit"]);
  const canReviewInvoice = Boolean(siteCapability?.["finance.invoice.review"]);
  const visibleSections = (
    [
      ["Invoices", canViewInvoices],
      ["Suppliers", canViewVendors],
      ["Payments", canViewPayments],
      ["Petty Cash", canViewPettyCash],
    ] as const
  )
    .filter(([, visible]) => visible)
    .map(([name]) => name);
  const section = resolveChoice(visibleSections, chosenSection);
  const invoicesQuery = trpc.jp.finance.listInvoices.useQuery(
    {
      siteId: siteId || EMPTY_ID,
      offset: invoicePage * INVOICE_PAGE_SIZE,
      limit: INVOICE_PAGE_SIZE,
      ...(statusFilter === "All" ? {} : { status: statusFilter as InvoiceStatus }),
    },
    { enabled: Boolean(siteId && siteCapability?.["finance.invoice.view"]) },
  );
  const vendorsQuery = trpc.jp.finance.listVendors.useQuery(
    {
      siteId: siteId || EMPTY_ID,
      offset: vendorPage * VENDOR_PAGE_SIZE,
      limit: VENDOR_PAGE_SIZE,
    },
    { enabled: Boolean(siteId && canViewVendors) },
  );
  const detailQuery = trpc.jp.finance.invoiceDetail.useQuery(
    { siteId: siteId || EMPTY_ID, invoiceId: expandedInvoiceId || EMPTY_ID },
    { enabled: Boolean(siteId && expandedInvoiceId) },
  );
  const createVendorMutation = trpc.jp.finance.createVendor.useMutation();
  const createInvoiceMutation = trpc.jp.finance.createInvoice.useMutation();
  const submitInvoiceMutation = trpc.jp.finance.submitInvoice.useMutation();
  const reviewInvoiceMutation = trpc.jp.finance.reviewInvoice.useMutation();

  const invoices = invoicesQuery.data?.rows ?? [];
  const invoiceTotal = invoicesQuery.data?.total ?? 0;
  const invoicePageCount = Math.max(1, Math.ceil(invoiceTotal / INVOICE_PAGE_SIZE));
  const vendors = vendorsQuery.data?.rows ?? [];
  const vendorTotal = vendorsQuery.data?.total ?? 0;
  const vendorPageCount = Math.max(1, Math.ceil(vendorTotal / VENDOR_PAGE_SIZE));
  if (
    invoicesQuery.data &&
    invoicePage !== clampPageIndex(invoicePage, invoiceTotal, INVOICE_PAGE_SIZE)
  ) {
    setInvoicePage(clampPageIndex(invoicePage, invoiceTotal, INVOICE_PAGE_SIZE));
  }
  if (
    vendorsQuery.data &&
    vendorPage !== clampPageIndex(vendorPage, vendorTotal, VENDOR_PAGE_SIZE)
  ) {
    setVendorPage(clampPageIndex(vendorPage, vendorTotal, VENDOR_PAGE_SIZE));
  }

  const refresh = async () => {
    await Promise.all([
      sitesQuery.refetch(),
      capabilitiesQuery.refetch(),
      invoicesQuery.refetch(),
      ...(canViewVendors ? [vendorsQuery.refetch()] : []),
    ]);
  };

  const resetVendorForm = () => {
    setVendorType("Material Supplier");
    setLegalName("");
    setTradeName("");
    setContactName("");
    setPhone("");
    setEmail("");
    setAddress("");
    setPaymentTermsDays("");
    setVendorMutationId(createClientMutationId());
  };
  const saveVendor = async () => {
    if (
      !siteId ||
      legalName.trim().length < 2 ||
      (paymentTermsDays.trim() && !/^\d{1,4}$/.test(paymentTermsDays.trim()))
    ) {
      setMessage(
        "Choose an assigned site, enter the supplier’s legal name, and use a whole-day payment term if supplied.",
      );
      return;
    }
    try {
      await createVendorMutation.mutateAsync({
        siteId,
        vendorType,
        legalName: legalName.trim(),
        tradeName: tradeName.trim() || undefined,
        contactName: contactName.trim() || undefined,
        phone: phone.trim() || undefined,
        email: email.trim() || undefined,
        address: address.trim() || undefined,
        paymentTermsDays: paymentTermsDays.trim() ? Number(paymentTermsDays.trim()) : undefined,
        clientMutationId: vendorMutationId,
      });
      setVendorModalVisible(false);
      resetVendorForm();
      setMessage(
        "Supplier saved as a real organisation record. Raw bank details are not collected here.",
      );
      await vendorsQuery.refetch();
    } catch (error) {
      setMessage(
        `Supplier save was not confirmed. Retry without changing the form to safely reuse its mutation key. ${errorText(error)}`,
      );
    }
  };

  const openInvoiceForm = () => {
    setInvoiceVendorId(vendors[0]?.id ?? "");
    setInvoiceNumber("");
    setInvoiceDate(todayString());
    setDueDate("");
    setTaxRupees("0");
    setChargesRupees("0");
    setPurchaseReference("");
    setReceiptReference("");
    setInvoiceLines([]);
    setLineDescription("");
    setLineQuantity("");
    setLineUnitCode("");
    setLineTotalRupees("");
    setInvoiceMutationId(createClientMutationId());
    setInvoiceModalVisible(true);
  };
  const addInvoiceLine = () => {
    try {
      if (lineDescription.trim().length < 1 || !lineUnitCode.trim())
        throw new Error("Enter an item description and unit.");
      const quantity = parsePositiveQuantity(lineQuantity);
      parseRupeesToMinor(lineTotalRupees);
      setInvoiceLines((existing) => [
        ...existing,
        {
          description: lineDescription.trim(),
          quantity,
          unitCode: lineUnitCode.trim(),
          lineTotalRupees: lineTotalRupees.trim(),
        },
      ]);
      setLineDescription("");
      setLineQuantity("");
      setLineUnitCode("");
      setLineTotalRupees("");
    } catch (error) {
      setMessage(errorText(error));
    }
  };
  const computedTotal = (() => {
    try {
      if (!invoiceLines.length) return null;
      const totals = calculateInvoiceTotals(
        invoiceLines.map((line) => ({ lineTotalMinor: parseRupeesToMinor(line.lineTotalRupees) })),
        parseRupeesToMinor(taxRupees, true),
        parseRupeesToMinor(chargesRupees, true),
      );
      return formatMinorAsRupees(totals.totalMinor);
    } catch {
      return null;
    }
  })();
  const createInvoice = async (action: "Draft" | "Submitted") => {
    if (
      !siteId ||
      !invoiceVendorId ||
      invoiceNumber.trim().length < 1 ||
      !invoiceLines.length ||
      !/^\d{4}-\d{2}-\d{2}$/.test(invoiceDate)
    ) {
      setMessage(
        "Choose a supplier, enter an invoice number and date, and add at least one complete line item.",
      );
      return;
    }
    try {
      await createInvoiceMutation.mutateAsync({
        siteId,
        vendorId: invoiceVendorId,
        invoiceNumber: invoiceNumber.trim(),
        invoiceDate,
        dueDate: dueDate.trim() || undefined,
        taxRupees: taxRupees.trim(),
        chargesRupees: chargesRupees.trim(),
        purchaseReference: purchaseReference.trim() || undefined,
        receiptReference: receiptReference.trim() || undefined,
        items: invoiceLines,
        action,
        clientMutationId: invoiceMutationId,
      });
      setInvoiceModalVisible(false);
      setInvoiceMutationId(createClientMutationId());
      setMessage(
        action === "Draft"
          ? "Invoice saved as Draft. It is not approved and no payable balance is calculated."
          : "Invoice submitted for a different authorised reviewer. No payment was recorded.",
      );
      await Promise.all([invoicesQuery.refetch(), vendorsQuery.refetch()]);
    } catch (error) {
      setMessage(
        `Invoice save was not confirmed. Retry without changing the form to safely reuse its mutation key. ${errorText(error)}`,
      );
    }
  };

  const submitDraft = async (invoiceId: string) => {
    const clientMutationId = createClientMutationId();
    try {
      await submitInvoiceMutation.mutateAsync({ siteId, invoiceId, clientMutationId });
      setMessage("Invoice submitted for a different authorised reviewer.");
      await invoicesQuery.refetch();
    } catch (error) {
      setMessage(`Invoice submission was not confirmed. ${errorText(error)}`);
    }
  };
  const openReview = (invoiceId: string, decision: "Approved" | "Rejected" | "Disputed") => {
    setReviewInvoiceId(invoiceId);
    setReviewDecision(decision);
    setReviewReason("");
    setReviewMutationId(createClientMutationId());
  };
  const reviewInvoice = async () => {
    if (!reviewInvoiceId || (reviewDecision !== "Approved" && reviewReason.trim().length < 3)) {
      setMessage("A short reason is required when rejecting or disputing an invoice.");
      return;
    }
    const key = reviewMutationId ?? createClientMutationId();
    setReviewMutationId(key);
    try {
      await reviewInvoiceMutation.mutateAsync({
        siteId,
        invoiceId: reviewInvoiceId,
        decision: reviewDecision,
        reason: reviewReason.trim() || undefined,
        clientMutationId: key,
      });
      setReviewInvoiceId(null);
      setReviewMutationId(null);
      setReviewReason("");
      setMessage(
        reviewDecision === "Approved"
          ? "Invoice approval recorded by a different authorised user. This is not a payment or payable balance."
          : `Invoice marked ${reviewDecision.toLowerCase()}; the reason is preserved in audit history.`,
      );
      await invoicesQuery.refetch();
    } catch (error) {
      setMessage(
        `Invoice review was not confirmed. Retry using the same decision and reason. ${errorText(error)}`,
      );
    }
  };

  const selectedSite = siteOptions.find((site) => site.id === siteId);
  return (
    <AuthGate>
      <Screen>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
          <AppHeader
            eyebrow="Commercial records"
            title="Finance"
            subtitle="Suppliers, invoices, payments and petty cash for your sites."
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

          <View
            style={[
              styles.scopeNotice,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
            <MaterialIcons name="lock-outline" size={17} color={colors.primary} />
            <Text style={[styles.noticeText, { color: colors.muted }]}>
              Approvals need a connection. Payments and petty cash are recorded in the JP Infracon
              ledger — no money is sent from this app. Balances count Posted entries only.
            </Text>
          </View>
          <SectionHeader title="Assigned site" />
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
                    setMessage(null);
                    setReviewInvoiceId(null);
                    setInvoiceModalVisible(false);
                    setExpandedInvoiceId(null);
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
            <View style={styles.loading}>
              <ActivityIndicator color={colors.primary} />
              <Text style={[styles.loadingText, { color: colors.muted }]}>
                Loading authorised sites…
              </Text>
            </View>
          ) : (
            <EmptyState
              icon="lock-outline"
              title="No commercial-view access"
              detail="No assigned site grants supplier, invoice, payment, or petty-cash view permission to this account."
            />
          )}
          {siteId && selectedSite ? (
            <View style={[styles.siteMeta, { borderColor: colors.border }]}>
              <Text style={[styles.siteMetaText, { color: colors.muted }]}>
                {selectedSite.project} · {selectedSite.name} · online actions only
              </Text>
            </View>
          ) : null}

          {siteId && visibleSections.length ? (
            <View
              style={[
                styles.segment,
                { backgroundColor: colors.surface, borderColor: colors.border },
              ]}
            >
              {visibleSections.map((label) => (
                <Pressable
                  key={label}
                  accessibilityRole="button"
                  accessibilityState={{ selected: section === label }}
                  onPress={() => {
                    setSection(label);
                    setMessage(null);
                  }}
                  style={[
                    styles.segmentButton,
                    section === label && { backgroundColor: colors.primary },
                  ]}
                >
                  <Text
                    style={[
                      styles.segmentText,
                      { color: section === label ? colors.background : colors.muted },
                    ]}
                  >
                    {label}
                  </Text>
                </Pressable>
              ))}
            </View>
          ) : null}

          {siteId && section === "Invoices" && canViewInvoices ? (
            <>
              <SectionHeader
                title="Supplier invoices"
                action={canCreateInvoice ? "New invoice" : undefined}
                onPress={canCreateInvoice ? openInvoiceForm : undefined}
              />
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.filterRow}
              >
                {INVOICE_STATUSES.map((status) => (
                  <Pressable
                    key={status}
                    accessibilityRole="button"
                    accessibilityState={{ selected: statusFilter === status }}
                    onPress={() => setStatusFilter(status)}
                    style={[
                      styles.filterChip,
                      {
                        borderColor: statusFilter === status ? colors.primary : colors.border,
                        backgroundColor:
                          statusFilter === status ? `${colors.primary}16` : colors.surface,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.filterText,
                        { color: statusFilter === status ? colors.primary : colors.muted },
                      ]}
                    >
                      {status}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>
              {invoicesQuery.isError ? (
                <InlineError
                  message={invoicesQuery.error.message}
                  onRetry={() => {
                    void invoicesQuery.refetch();
                  }}
                />
              ) : invoicesQuery.isLoading ? (
                <View style={styles.loading}>
                  <ActivityIndicator color={colors.primary} />
                  <Text style={[styles.loadingText, { color: colors.muted }]}>
                    Loading site invoices…
                  </Text>
                </View>
              ) : invoices.length === 0 ? (
                <EmptyState
                  icon="receipt-long"
                  title="No supplier invoices"
                  detail={
                    statusFilter === "All"
                      ? "No invoice record exists for this assigned site yet."
                      : `No invoices currently have ${statusFilter.toLowerCase()} status.`
                  }
                />
              ) : (
                <View style={styles.stack}>
                  {invoices.map((invoice) => {
                    const mayReview =
                      canReviewInvoice &&
                      invoice.status === "Submitted" &&
                      invoice.createdBy !== me.data?.id;
                    const maySubmit =
                      canSubmitInvoice &&
                      invoice.status === "Draft" &&
                      invoice.createdBy === me.data?.id;
                    const expanded = expandedInvoiceId === invoice.id;
                    return (
                      <View
                        key={invoice.id}
                        style={[
                          styles.invoiceCard,
                          { backgroundColor: colors.surface, borderColor: colors.border },
                        ]}
                      >
                        <View style={styles.cardTop}>
                          <View style={{ flex: 1 }}>
                            <Text style={[styles.invoiceNumber, { color: colors.foreground }]}>
                              {invoice.invoiceNumber}
                            </Text>
                            <Text style={[styles.vendorName, { color: colors.muted }]}>
                              {invoice.vendorName} · {invoice.vendorType}
                            </Text>
                          </View>
                          <Text
                            style={[
                              styles.statusPill,
                              {
                                color:
                                  invoice.status === "Approved"
                                    ? colors.success
                                    : invoice.status === "Rejected" || invoice.status === "Disputed"
                                      ? colors.warning
                                      : colors.primary,
                                backgroundColor:
                                  invoice.status === "Approved"
                                    ? `${colors.success}14`
                                    : `${colors.primary}12`,
                              },
                            ]}
                          >
                            {invoice.status}
                          </Text>
                        </View>
                        <Text style={[styles.grossLabel, { color: colors.muted }]}>
                          Supplier-stated gross amount
                        </Text>
                        <Text style={[styles.gross, { color: colors.foreground }]}>
                          {formatMinorAsRupees(invoice.totalMinor)}
                        </Text>
                        <Text style={[styles.cardMeta, { color: colors.muted }]}>
                          Invoice {invoice.invoiceDate}
                          {invoice.dueDate ? ` · due ${invoice.dueDate}` : " · no due date"}
                        </Text>
                        <Text style={[styles.statusDetail, { color: colors.muted }]}>
                          {invoiceStatusDescription(invoice.status)}
                        </Text>
                        {invoice.reviewedAt ? (
                          <Text style={[styles.cardMeta, { color: colors.muted }]}>
                            Review recorded {formatTime(invoice.reviewedAt)} · actor is available in
                            Audit activity when authorised
                          </Text>
                        ) : null}
                        {invoice.status === "Rejected" || invoice.status === "Disputed" ? (
                          <Text style={[styles.reviewReason, { color: colors.warning }]}>
                            {invoice.reviewReason || "Review reason not recorded"}
                          </Text>
                        ) : null}
                        <View style={styles.cardActions}>
                          <Pressable
                            accessibilityRole="button"
                            onPress={() => setExpandedInvoiceId(expanded ? null : invoice.id)}
                            style={[styles.textAction, { borderColor: colors.border }]}
                          >
                            <MaterialIcons
                              name={expanded ? "expand-less" : "expand-more"}
                              size={18}
                              color={colors.primary}
                            />
                            <Text style={[styles.actionText, { color: colors.primary }]}>
                              {expanded ? "Hide items" : "View items"}
                            </Text>
                          </Pressable>
                          {maySubmit ? (
                            <Pressable
                              accessibilityRole="button"
                              disabled={submitInvoiceMutation.isPending}
                              onPress={() => {
                                void submitDraft(invoice.id);
                              }}
                              style={[styles.textAction, { borderColor: colors.primary }]}
                            >
                              <Text style={[styles.actionText, { color: colors.primary }]}>
                                {submitInvoiceMutation.isPending
                                  ? "Submitting…"
                                  : "Submit for review"}
                              </Text>
                            </Pressable>
                          ) : null}
                          {mayReview ? (
                            <>
                              <Pressable
                                accessibilityRole="button"
                                onPress={() => openReview(invoice.id, "Approved")}
                                style={[styles.textAction, { borderColor: colors.success }]}
                              >
                                <Text style={[styles.actionText, { color: colors.success }]}>
                                  Review
                                </Text>
                              </Pressable>
                            </>
                          ) : null}
                        </View>
                        {expanded ? (
                          detailQuery.isLoading ? (
                            <Text style={[styles.statusDetail, { color: colors.muted }]}>
                              Loading invoice items…
                            </Text>
                          ) : detailQuery.isError ? (
                            <InlineError
                              message={detailQuery.error.message}
                              onRetry={() => {
                                void detailQuery.refetch();
                              }}
                            />
                          ) : detailQuery.data?.invoice.id === invoice.id ? (
                            <View style={[styles.detailBox, { borderTopColor: colors.border }]}>
                              {detailQuery.data.lines.map((line) => (
                                <View key={line.id} style={styles.lineRow}>
                                  <View style={{ flex: 1 }}>
                                    <Text style={[styles.lineTitle, { color: colors.foreground }]}>
                                      {line.description}
                                    </Text>
                                    <Text style={[styles.cardMeta, { color: colors.muted }]}>
                                      {line.quantity} {line.unitCode}
                                    </Text>
                                  </View>
                                  <Text style={[styles.lineAmount, { color: colors.foreground }]}>
                                    {formatMinorAsRupees(line.lineTotalMinor)}
                                  </Text>
                                </View>
                              ))}
                              <Text style={[styles.cardMeta, { color: colors.muted }]}>
                                Subtotal {formatMinorAsRupees(invoice.subtotalMinor)} · Tax{" "}
                                {formatMinorAsRupees(invoice.taxMinor)} · Charges{" "}
                                {formatMinorAsRupees(invoice.chargesMinor)}
                              </Text>
                              {invoice.purchaseReference || invoice.receiptReference ? (
                                <Text style={[styles.cardMeta, { color: colors.muted }]}>
                                  Reference text only ·{" "}
                                  {invoice.purchaseReference
                                    ? `Purchase: ${invoice.purchaseReference}`
                                    : ""}
                                  {invoice.purchaseReference && invoice.receiptReference
                                    ? " · "
                                    : ""}
                                  {invoice.receiptReference
                                    ? `Receipt: ${invoice.receiptReference}`
                                    : ""}
                                </Text>
                              ) : null}
                            </View>
                          ) : null
                        ) : null}
                      </View>
                    );
                  })}
                </View>
              )}
              {invoiceTotal > INVOICE_PAGE_SIZE ? (
                <Pager page={invoicePage} pageCount={invoicePageCount} onChange={setInvoicePage} />
              ) : null}
            </>
          ) : null}

          {siteId && section === "Suppliers" && canViewVendors ? (
            <>
              <SectionHeader
                title="Organisation suppliers"
                action={canCreateVendor ? "Add supplier" : undefined}
                onPress={canCreateVendor ? () => setVendorModalVisible(true) : undefined}
              />
              {vendorsQuery.isError ? (
                <InlineError
                  message={vendorsQuery.error.message}
                  onRetry={() => {
                    void vendorsQuery.refetch();
                  }}
                />
              ) : vendorsQuery.isLoading ? (
                <View style={styles.loading}>
                  <ActivityIndicator color={colors.primary} />
                  <Text style={[styles.loadingText, { color: colors.muted }]}>
                    Loading supplier directory…
                  </Text>
                </View>
              ) : vendors.length === 0 ? (
                <EmptyState
                  icon="business"
                  title="No supplier records"
                  detail={
                    canCreateVendor
                      ? "Add a real supplier record; this does not create an invoice or payment."
                      : "No active supplier record is available to this organisation."
                  }
                />
              ) : (
                <View style={styles.stack}>
                  {vendors.map((vendor) => (
                    <View
                      key={vendor.id}
                      style={[
                        styles.vendorCard,
                        { backgroundColor: colors.surface, borderColor: colors.border },
                      ]}
                    >
                      <View style={styles.cardTop}>
                        <View style={{ flex: 1 }}>
                          <Text style={[styles.vendorNameStrong, { color: colors.foreground }]}>
                            {vendor.legalName}
                          </Text>
                          {vendor.tradeName ? (
                            <Text style={[styles.cardMeta, { color: colors.muted }]}>
                              {vendor.tradeName}
                            </Text>
                          ) : null}
                        </View>
                        <Text
                          style={[
                            styles.statusPill,
                            { color: colors.primary, backgroundColor: `${colors.primary}12` },
                          ]}
                        >
                          {vendor.vendorType}
                        </Text>
                      </View>
                      {vendor.contactName ? (
                        <Text style={[styles.cardMeta, { color: colors.muted }]}>
                          {vendor.contactName}
                        </Text>
                      ) : null}
                      {vendor.phone ? (
                        <Text style={[styles.cardMeta, { color: colors.muted }]}>
                          {vendor.phone}
                        </Text>
                      ) : null}
                      {vendor.email ? (
                        <Text style={[styles.cardMeta, { color: colors.muted }]}>
                          {vendor.email}
                        </Text>
                      ) : null}
                      {vendor.paymentTermsDays !== null ? (
                        <Text style={[styles.cardMeta, { color: colors.muted }]}>
                          Payment terms entered: {vendor.paymentTermsDays} days
                        </Text>
                      ) : null}
                      <Text style={[styles.cardMeta, { color: colors.muted }]}>
                        No bank credentials are collected in this register.
                      </Text>
                    </View>
                  ))}
                </View>
              )}
              {vendorTotal > VENDOR_PAGE_SIZE ? (
                <Pager page={vendorPage} pageCount={vendorPageCount} onChange={setVendorPage} />
              ) : null}
            </>
          ) : null}

          {siteId && section === "Payments" && canViewPayments ? (
            <SupplierPaymentLedger
              siteId={siteId}
              currentUserId={me.data?.id ?? -1}
              canView={canViewPayments}
              canViewVendors={canViewVendors}
              canCreate={Boolean(siteCapability?.["finance.payment.create"])}
              canSubmit={Boolean(siteCapability?.["finance.payment.submit"])}
              canReview={Boolean(siteCapability?.["finance.payment.review"])}
              canPost={Boolean(siteCapability?.["finance.payment.post"])}
              canCancel={Boolean(siteCapability?.["finance.payment.cancel"])}
            />
          ) : null}
          {siteId && section === "Petty Cash" && canViewPettyCash ? (
            <PettyCashLedger
              siteId={siteId}
              currentUserId={me.data?.id ?? -1}
              currentUserName={me.data?.name ?? ""}
              canManageFund={Boolean(siteCapability?.["finance.cash.fund.manage"])}
              canCreateMovement={Boolean(siteCapability?.["finance.cash.movement.create"])}
              canSubmit={Boolean(siteCapability?.["finance.cash.movement.submit"])}
              canReview={Boolean(siteCapability?.["finance.cash.movement.review"])}
              canPost={Boolean(siteCapability?.["finance.cash.movement.post"])}
              canCancel={Boolean(siteCapability?.["finance.cash.movement.cancel"])}
            />
          ) : null}
          {siteId ? (
            <View
              style={[
                styles.notice,
                { backgroundColor: colors.surface, borderColor: colors.border },
              ]}
            >
              <MaterialIcons name="info-outline" size={16} color={colors.warning} />
              <Text style={[styles.noticeText, { color: colors.muted }]}>
                Invoice approval is review only. Only Posted internal supplier allocations reduce
                invoice availability. Petty-cash balances are calculated from Posted fund movements,
                not physical cash counts. The app does not execute or verify bank/card/UPI transfers
                and does not claim overall supplier dues, worker payables, or reimbursement
                liabilities.
              </Text>
            </View>
          ) : null}
        </ScrollView>
      </Screen>

      <Modal
        visible={vendorModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setVendorModalVisible(false)}
      >
        <View style={styles.modalBackdrop}>
          <View
            style={[
              styles.modalCard,
              { backgroundColor: colors.background, borderColor: colors.border },
            ]}
          >
            <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
              <View style={styles.modalHeader}>
                <Text style={[styles.modalTitle, { color: colors.foreground }]}>Add supplier</Text>
                <Pressable accessibilityRole="button" onPress={() => setVendorModalVisible(false)}>
                  <MaterialIcons name="close" size={22} color={colors.muted} />
                </Pressable>
              </View>
              <Text style={[styles.fieldLabel, { color: colors.muted }]}>Supplier type</Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.filterRow}
              >
                {VENDOR_TYPES.map((type) => (
                  <Choice
                    key={type}
                    label={type}
                    selected={vendorType === type}
                    onPress={() => setVendorType(type)}
                  />
                ))}
              </ScrollView>
              <Field
                label="Legal name *"
                value={legalName}
                onChangeText={setLegalName}
                placeholder="Registered supplier name"
              />
              <Field
                label="Trade name"
                value={tradeName}
                onChangeText={setTradeName}
                placeholder="Optional"
              />
              <Field
                label="Contact person"
                value={contactName}
                onChangeText={setContactName}
                placeholder="Optional"
              />
              <Field
                label="Phone"
                value={phone}
                onChangeText={setPhone}
                placeholder="Optional"
                keyboardType="phone-pad"
              />
              <Field
                label="Email"
                value={email}
                onChangeText={setEmail}
                placeholder="Optional"
                keyboardType="email-address"
                autoCapitalize="none"
              />
              <Field
                label="Address"
                value={address}
                onChangeText={setAddress}
                placeholder="Optional supplier address"
                multiline
              />
              <Field
                label="Payment terms (days)"
                value={paymentTermsDays}
                onChangeText={setPaymentTermsDays}
                placeholder="Optional"
                keyboardType="number-pad"
              />
              <View
                style={[
                  styles.notice,
                  { backgroundColor: colors.surface, borderColor: colors.border },
                ]}
              >
                <Text style={[styles.noticeText, { color: colors.muted }]}>
                  Organisation-level supplier records are shared across sites. Payment account/bank
                  details are intentionally not collected.
                </Text>
              </View>
              <PrimaryButton
                icon="save"
                label={createVendorMutation.isPending ? "Saving…" : "Save supplier"}
                disabled={createVendorMutation.isPending || !canCreateVendor}
                onPress={() => {
                  void saveVendor();
                }}
              />
            </ScrollView>
          </View>
        </View>
      </Modal>

      <Modal
        visible={invoiceModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setInvoiceModalVisible(false)}
      >
        <View style={styles.modalBackdrop}>
          <View
            style={[
              styles.modalCard,
              { backgroundColor: colors.background, borderColor: colors.border },
            ]}
          >
            <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
              <View style={styles.modalHeader}>
                <Text style={[styles.modalTitle, { color: colors.foreground }]}>
                  New supplier invoice
                </Text>
                <Pressable accessibilityRole="button" onPress={() => setInvoiceModalVisible(false)}>
                  <MaterialIcons name="close" size={22} color={colors.muted} />
                </Pressable>
              </View>
              <Text style={[styles.fieldLabel, { color: colors.muted }]}>Active supplier *</Text>
              {vendors.length ? (
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.filterRow}
                >
                  {vendors.map((vendor) => (
                    <Choice
                      key={vendor.id}
                      label={vendor.legalName}
                      selected={invoiceVendorId === vendor.id}
                      onPress={() => setInvoiceVendorId(vendor.id)}
                    />
                  ))}
                </ScrollView>
              ) : (
                <Text style={[styles.cardMeta, { color: colors.warning }]}>
                  No active supplier is loaded on this page. Add/locate a supplier before creating
                  an invoice.
                </Text>
              )}
              <Field
                label="Invoice number *"
                value={invoiceNumber}
                onChangeText={setInvoiceNumber}
                placeholder="Supplier invoice number"
                autoCapitalize="characters"
              />
              <DateField
                label="Invoice date *"
                value={invoiceDate}
                onChange={(value) => {
                  setInvoiceDate(value);
                  if (dueDate && dueDate < value) setDueDate("");
                }}
              />
              <DateField
                label="Due date"
                value={dueDate}
                minDate={invoiceDate}
                allowClear
                onChange={setDueDate}
              />
              <SectionHeader title="Invoice line items" />
              {invoiceLines.map((line, index) => (
                <View
                  key={`${index}-${line.description}`}
                  style={[styles.lineRow, { borderBottomColor: colors.border }]}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.lineTitle, { color: colors.foreground }]}>
                      {line.description}
                    </Text>
                    <Text style={[styles.cardMeta, { color: colors.muted }]}>
                      {line.quantity} {line.unitCode} ·{" "}
                      {formatMinorAsRupees(parseRupeesToMinor(line.lineTotalRupees))}
                    </Text>
                  </View>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Remove ${line.description}`}
                    onPress={() =>
                      setInvoiceLines((existing) =>
                        existing.filter((_, itemIndex) => itemIndex !== index),
                      )
                    }
                  >
                    <MaterialIcons name="remove-circle-outline" size={21} color={colors.warning} />
                  </Pressable>
                </View>
              ))}
              <Field
                label="Item description *"
                value={lineDescription}
                onChangeText={setLineDescription}
                placeholder="Material or service description"
              />
              <View style={styles.twoColumns}>
                <View style={{ flex: 1 }}>
                  <Field
                    label="Quantity *"
                    value={lineQuantity}
                    onChangeText={setLineQuantity}
                    placeholder="e.g. 12.500"
                    keyboardType="decimal-pad"
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Field
                    label="Unit *"
                    value={lineUnitCode}
                    onChangeText={setLineUnitCode}
                    placeholder="bag, kg, hr"
                  />
                </View>
              </View>
              <Field
                label="Line total (₹) *"
                value={lineTotalRupees}
                onChangeText={setLineTotalRupees}
                placeholder="0.00"
                keyboardType="decimal-pad"
              />
              <Pressable
                accessibilityRole="button"
                onPress={addInvoiceLine}
                style={[styles.secondaryButton, { borderColor: colors.primary }]}
              >
                <MaterialIcons name="add" size={18} color={colors.primary} />
                <Text style={[styles.actionText, { color: colors.primary }]}>Add line item</Text>
              </Pressable>
              <View style={styles.twoColumns}>
                <View style={{ flex: 1 }}>
                  <Field
                    label="Tax total (₹)"
                    value={taxRupees}
                    onChangeText={setTaxRupees}
                    placeholder="0.00"
                    keyboardType="decimal-pad"
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Field
                    label="Other charges (₹)"
                    value={chargesRupees}
                    onChangeText={setChargesRupees}
                    placeholder="0.00"
                    keyboardType="decimal-pad"
                  />
                </View>
              </View>
              <Field
                label="Purchase reference (text only)"
                value={purchaseReference}
                onChangeText={setPurchaseReference}
                placeholder="Optional reference number"
              />
              <Field
                label="Receipt reference (text only)"
                value={receiptReference}
                onChangeText={setReceiptReference}
                placeholder="Optional reference number"
              />
              {computedTotal ? (
                <View
                  style={[
                    styles.totalBox,
                    { backgroundColor: colors.surface, borderColor: colors.border },
                  ]}
                >
                  <Text style={[styles.cardMeta, { color: colors.muted }]}>
                    Server-calculated from line amounts + entered tax/charges
                  </Text>
                  <Text style={[styles.totalText, { color: colors.foreground }]}>
                    {computedTotal}
                  </Text>
                </View>
              ) : (
                <Text style={[styles.cardMeta, { color: colors.warning }]}>
                  Add a complete line item to calculate the gross total.
                </Text>
              )}
              <View
                style={[
                  styles.notice,
                  { backgroundColor: colors.surface, borderColor: colors.border },
                ]}
              >
                <Text style={[styles.noticeText, { color: colors.muted }]}>
                  Saving records the invoice for review. It does not pay the supplier or decide tax
                  treatment — enter tax and charges exactly as printed on the bill.
                </Text>
              </View>
              <View style={styles.buttonStack}>
                <PrimaryButton
                  icon="save"
                  label={createInvoiceMutation.isPending ? "Saving…" : "Save as Draft"}
                  disabled={createInvoiceMutation.isPending || !canCreateInvoice}
                  onPress={() => {
                    void createInvoice("Draft");
                  }}
                />
                <PrimaryButton
                  icon="send"
                  label={createInvoiceMutation.isPending ? "Saving…" : "Submit for review"}
                  disabled={
                    createInvoiceMutation.isPending || !canCreateInvoice || !canSubmitInvoice
                  }
                  onPress={() => {
                    void createInvoice("Submitted");
                  }}
                />
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>

      <Modal
        visible={Boolean(reviewInvoiceId)}
        transparent
        animationType="fade"
        onRequestClose={() => setReviewInvoiceId(null)}
      >
        <View style={styles.modalBackdrop}>
          <View
            style={[
              styles.reviewModal,
              { backgroundColor: colors.background, borderColor: colors.border },
            ]}
          >
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: colors.foreground }]}>Review invoice</Text>
              <Pressable accessibilityRole="button" onPress={() => setReviewInvoiceId(null)}>
                <MaterialIcons name="close" size={22} color={colors.muted} />
              </Pressable>
            </View>
            <Text style={[styles.cardMeta, { color: colors.muted }]}>
              Only a different authorised user can review this submitted invoice.
            </Text>
            <View style={styles.choiceStack}>
              {(["Approved", "Rejected", "Disputed"] as const).map((decision) => (
                <Choice
                  key={decision}
                  label={decision}
                  selected={reviewDecision === decision}
                  onPress={() => setReviewDecision(decision)}
                />
              ))}
            </View>
            {reviewDecision !== "Approved" ? (
              <Field
                label="Reason *"
                value={reviewReason}
                onChangeText={setReviewReason}
                placeholder="Why is this invoice rejected/disputed?"
                multiline
              />
            ) : null}
            <PrimaryButton
              icon="fact-check"
              label={
                reviewInvoiceMutation.isPending
                  ? "Recording…"
                  : `Record ${reviewDecision.toLowerCase()}`
              }
              disabled={
                reviewInvoiceMutation.isPending ||
                !canReviewInvoice ||
                (reviewDecision !== "Approved" && reviewReason.trim().length < 3)
              }
              onPress={() => {
                void reviewInvoice();
              }}
            />
            <Text style={[styles.cardMeta, { color: colors.warning, marginTop: 12 }]}>
              Approval is invoice review only. It does not post or settle a payment.
            </Text>
          </View>
        </View>
      </Modal>
    </AuthGate>
  );
}

function Field({
  label,
  value,
  onChangeText,
  placeholder,
  keyboardType,
  autoCapitalize,
  multiline,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
  keyboardType?: "default" | "number-pad" | "decimal-pad" | "phone-pad" | "email-address";
  autoCapitalize?: "none" | "sentences" | "words" | "characters";
  multiline?: boolean;
}) {
  const colors = useColors();
  return (
    <View style={styles.field}>
      <Text style={[styles.fieldLabel, { color: colors.muted }]}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.muted}
        keyboardType={keyboardType}
        autoCapitalize={autoCapitalize}
        multiline={multiline}
        textAlignVertical={multiline ? "top" : "center"}
        style={[
          styles.input,
          { color: colors.foreground, backgroundColor: colors.surface, borderColor: colors.border },
          multiline && styles.multiline,
        ]}
      />
    </View>
  );
}

function parseLocalCalendarDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day, 12);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day
    ? date
    : null;
}

function calendarDateString(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function DateField({
  label,
  value,
  onChange,
  minDate,
  allowClear = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  minDate?: string;
  allowClear?: boolean;
}) {
  const colors = useColors();
  const [open, setOpen] = useState(false);
  const [monthCursor, setMonthCursor] = useState(() => {
    const initial =
      parseLocalCalendarDate(value) ?? parseLocalCalendarDate(minDate ?? "") ?? new Date();
    return new Date(initial.getFullYear(), initial.getMonth(), 1, 12);
  });
  const cursorSourceKey = `${value}|${minDate ?? ""}`;
  const [shownCursorSourceKey, setShownCursorSourceKey] = useState(cursorSourceKey);
  if (shownCursorSourceKey !== cursorSourceKey) {
    setShownCursorSourceKey(cursorSourceKey);
    const selected = parseLocalCalendarDate(value) ?? parseLocalCalendarDate(minDate ?? "");
    if (selected) setMonthCursor(new Date(selected.getFullYear(), selected.getMonth(), 1, 12));
  }
  const year = monthCursor.getFullYear();
  const month = monthCursor.getMonth();
  const leadingBlanks = (new Date(year, month, 1).getDay() + 6) % 7;
  const dayCount = new Date(year, month + 1, 0).getDate();
  const cellCount = Math.ceil((leadingBlanks + dayCount) / 7) * 7;
  const minValue = minDate ? (parseLocalCalendarDate(minDate) ? minDate : "") : "";
  const monthLabel = new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" }).format(
    monthCursor,
  );
  return (
    <View style={styles.field}>
      <Text style={[styles.fieldLabel, { color: colors.muted }]}>{label}</Text>
      <View style={styles.dateControlRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Choose ${label.toLowerCase()} using calendar`}
          accessibilityState={{ expanded: open }}
          onPress={() => setOpen((current) => !current)}
          style={[
            styles.dateButton,
            { backgroundColor: colors.surface, borderColor: open ? colors.primary : colors.border },
          ]}
        >
          <MaterialIcons name="calendar-month" size={18} color={colors.primary} />
          <Text
            style={[styles.dateButtonText, { color: value ? colors.foreground : colors.muted }]}
          >
            {value || "Choose date"}
          </Text>
          <MaterialIcons
            name={open ? "expand-less" : "expand-more"}
            size={19}
            color={colors.muted}
          />
        </Pressable>
        {allowClear && value ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => onChange("")}
            style={[styles.clearDate, { borderColor: colors.border }]}
          >
            <Text style={[styles.clearDateText, { color: colors.muted }]}>Clear</Text>
          </Pressable>
        ) : null}
      </View>
      {open ? (
        <View
          style={[styles.calendar, { backgroundColor: colors.surface, borderColor: colors.border }]}
        >
          <View style={styles.calendarHeader}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Previous month"
              onPress={() => setMonthCursor(new Date(year, month - 1, 1, 12))}
              style={styles.calendarArrow}
            >
              <MaterialIcons name="chevron-left" size={22} color={colors.primary} />
            </Pressable>
            <Text style={[styles.monthLabel, { color: colors.foreground }]}>{monthLabel}</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Next month"
              onPress={() => setMonthCursor(new Date(year, month + 1, 1, 12))}
              style={styles.calendarArrow}
            >
              <MaterialIcons name="chevron-right" size={22} color={colors.primary} />
            </Pressable>
          </View>
          <View style={styles.calendarGrid}>
            {["M", "T", "W", "T", "F", "S", "S"].map((weekday, index) => (
              <View key={`${weekday}-${index}`} style={styles.calendarCell}>
                <Text style={[styles.weekdayText, { color: colors.muted }]}>{weekday}</Text>
              </View>
            ))}
          </View>
          <View style={styles.calendarGrid}>
            {Array.from({ length: cellCount }, (_, index) => {
              const day = index - leadingBlanks + 1;
              if (day < 1 || day > dayCount)
                return <View key={`blank-${index}`} style={styles.calendarCell} />;
              const candidate = calendarDateString(new Date(year, month, day, 12));
              const selected = candidate === value;
              const disabled = Boolean(minValue && candidate < minValue);
              return (
                <Pressable
                  key={candidate}
                  accessibilityRole="button"
                  accessibilityState={{ selected, disabled }}
                  disabled={disabled}
                  onPress={() => {
                    onChange(candidate);
                    setOpen(false);
                  }}
                  style={[
                    styles.calendarCell,
                    styles.dayCell,
                    selected && { backgroundColor: colors.primary },
                    disabled && { opacity: 0.35 },
                  ]}
                >
                  <Text
                    style={[
                      styles.dayText,
                      { color: selected ? colors.background : colors.foreground },
                    ]}
                  >
                    {day}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <Text style={[styles.calendarHint, { color: colors.muted }]}>
            {minValue
              ? "Due date must be on or after invoice date."
              : "Dates are saved as YYYY-MM-DD."}
          </Text>
        </View>
      ) : null}
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
          borderColor: selected ? colors.primary : colors.border,
          backgroundColor: selected ? `${colors.primary}15` : colors.surface,
        },
      ]}
    >
      <Text style={[styles.choiceText, { color: selected ? colors.primary : colors.foreground }]}>
        {label}
      </Text>
    </Pressable>
  );
}

function Pager({
  page,
  pageCount,
  onChange,
}: {
  page: number;
  pageCount: number;
  onChange: (page: number) => void;
}) {
  const colors = useColors();
  return (
    <View style={styles.pager}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Previous page"
        disabled={page === 0}
        onPress={() => onChange(Math.max(0, page - 1))}
        style={[styles.pageButton, { borderColor: colors.border, opacity: page === 0 ? 0.4 : 1 }]}
      >
        <MaterialIcons name="chevron-left" size={20} color={colors.primary} />
      </Pressable>
      <Text style={[styles.pageText, { color: colors.muted }]}>
        Page {page + 1} of {pageCount}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Next page"
        disabled={page >= pageCount - 1}
        onPress={() => onChange(Math.min(pageCount - 1, page + 1))}
        style={[
          styles.pageButton,
          { borderColor: colors.border, opacity: page >= pageCount - 1 ? 0.4 : 1 },
        ]}
      >
        <MaterialIcons name="chevron-right" size={20} color={colors.primary} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { paddingBottom: 32 },
  message: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    marginBottom: 14,
  },
  messageText: { fontSize: 12, lineHeight: 18, flex: 1 },
  scopeNotice: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
    flexDirection: "row",
    gap: 8,
    alignItems: "flex-start",
    marginBottom: 18,
  },
  notice: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
    flexDirection: "row",
    gap: 8,
    alignItems: "flex-start",
    marginTop: 16,
    marginBottom: 14,
  },
  noticeText: { fontSize: 11, lineHeight: 17, flex: 1 },
  siteRow: { gap: 9, paddingBottom: 10 },
  siteChip: {
    borderWidth: 1,
    borderRadius: 13,
    minWidth: 160,
    maxWidth: 230,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  siteName: { fontSize: 12, fontWeight: "800" },
  siteProject: { fontSize: 10, marginTop: 3 },
  siteMeta: { borderBottomWidth: 1, paddingVertical: 7, marginBottom: 16 },
  siteMetaText: { fontSize: 10, fontWeight: "700" },
  segment: {
    borderWidth: 1,
    borderRadius: 13,
    padding: 4,
    flexDirection: "row",
    gap: 4,
    marginBottom: 17,
  },
  segmentButton: {
    minHeight: 42,
    flex: 1,
    borderRadius: 10,
    justifyContent: "center",
    alignItems: "center",
  },
  segmentText: { fontSize: 12, fontWeight: "800" },
  filterRow: { gap: 7, paddingBottom: 10 },
  filterChip: {
    minHeight: 36,
    borderWidth: 1,
    borderRadius: 18,
    paddingHorizontal: 12,
    justifyContent: "center",
  },
  filterText: { fontSize: 10, fontWeight: "800" },
  stack: { gap: 10 },
  invoiceCard: { borderWidth: 1, borderRadius: 17, padding: 14 },
  vendorCard: { borderWidth: 1, borderRadius: 16, padding: 14 },
  cardTop: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  invoiceNumber: { fontSize: 15, fontWeight: "900" },
  vendorName: { fontSize: 11, marginTop: 3 },
  vendorNameStrong: { fontSize: 14, fontWeight: "800" },
  statusPill: {
    fontSize: 9,
    fontWeight: "900",
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 12,
    overflow: "hidden",
  },
  grossLabel: { fontSize: 10, fontWeight: "700", marginTop: 13 },
  gross: { fontSize: 22, fontWeight: "900", marginTop: 1 },
  cardMeta: { fontSize: 10, lineHeight: 15, marginTop: 4 },
  statusDetail: { fontSize: 10, lineHeight: 15, marginTop: 7 },
  reviewReason: { fontSize: 10, lineHeight: 15, marginTop: 6 },
  cardActions: { flexDirection: "row", gap: 7, flexWrap: "wrap", marginTop: 12 },
  textAction: {
    minHeight: 36,
    borderWidth: 1,
    borderRadius: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 3,
    paddingHorizontal: 9,
  },
  actionText: { fontSize: 10, fontWeight: "800" },
  detailBox: { borderTopWidth: 1, marginTop: 12, paddingTop: 8 },
  lineRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: "transparent",
  },
  lineTitle: { fontSize: 11, fontWeight: "700" },
  lineAmount: { fontSize: 11, fontWeight: "800" },
  pager: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 16,
    paddingVertical: 15,
  },
  pageButton: {
    width: 38,
    height: 38,
    borderWidth: 1,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  pageText: { fontSize: 11, fontWeight: "700" },
  loading: { flexDirection: "row", alignItems: "center", gap: 9, paddingVertical: 16 },
  loadingText: { fontSize: 11 },
  modalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.68)", justifyContent: "flex-end" },
  modalCard: {
    maxHeight: "92%",
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 26,
  },
  reviewModal: { borderWidth: 1, borderRadius: 20, margin: 20, padding: 16 },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  modalTitle: { fontSize: 17, fontWeight: "900" },
  field: { marginTop: 12, flex: 1 },
  fieldLabel: { fontSize: 10, fontWeight: "800", marginBottom: 6 },
  input: { minHeight: 46, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, fontSize: 13 },
  multiline: { minHeight: 84, paddingTop: 10 },
  dateControlRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  dateButton: {
    minHeight: 46,
    flex: 1,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  dateButtonText: { fontSize: 13, fontWeight: "700", flex: 1 },
  clearDate: {
    minHeight: 40,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 11,
    justifyContent: "center",
  },
  clearDateText: { fontSize: 10, fontWeight: "800" },
  calendar: { borderWidth: 1, borderRadius: 14, padding: 8, marginTop: 8 },
  calendarHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 4,
  },
  calendarArrow: { width: 38, height: 38, alignItems: "center", justifyContent: "center" },
  monthLabel: { fontSize: 13, fontWeight: "800" },
  calendarGrid: { flexDirection: "row", flexWrap: "wrap" },
  calendarCell: { width: "14.2857%", height: 36, alignItems: "center", justifyContent: "center" },
  weekdayText: { fontSize: 10, fontWeight: "800" },
  dayCell: { borderRadius: 10 },
  dayText: { fontSize: 11, fontWeight: "700" },
  calendarHint: { fontSize: 9, marginTop: 4, textAlign: "center" },
  choice: {
    borderWidth: 1,
    borderRadius: 14,
    minHeight: 38,
    paddingHorizontal: 11,
    justifyContent: "center",
    alignItems: "center",
  },
  choiceText: { fontSize: 10, fontWeight: "800" },
  choiceStack: { flexDirection: "row", gap: 7, flexWrap: "wrap", marginVertical: 14 },
  secondaryButton: {
    minHeight: 40,
    borderWidth: 1,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 5,
    marginTop: 10,
  },
  totalBox: { borderWidth: 1, borderRadius: 14, padding: 12, marginTop: 14 },
  totalText: { fontSize: 22, fontWeight: "900", marginTop: 4 },
  twoColumns: { flexDirection: "row", gap: 10 },
  buttonStack: { gap: 8, marginTop: 4 },
});
