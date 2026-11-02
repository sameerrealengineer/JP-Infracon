import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { AppHeader, EmptyState, InlineError, OfflineBanner, PrimaryButton, Screen, SectionHeader, SecondaryButton, SyncPill, WorkflowPill, styles as uiStyles } from "@/components/jp/ui";
import { useColors } from "@/hooks/use-colors";
import { resolveSelectedId } from "@/lib/jp/selection";
import { trpc } from "@/lib/trpc";
import { createClientMutationId, readDraftStore, removeLocalDraft, saveReportDraft } from "@/lib/jp/local-repository";
import type { FieldReport, WorkflowStatus } from "@/lib/jp/domain";

function currentDate() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}
function initials(name: string | null | undefined) { return name?.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join("") || "?"; }
function formatDate(value: string | Date) {
  const date = value instanceof Date ? value : new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime()) ? String(value) : new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(date);
}
function formatTime(value: string | Date) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? "Time unavailable" : new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}
function displayStatus(status: string): WorkflowStatus {
  if (status === "Submitted" || status === "Under Review") return "Pending review";
  if (status === "Returned for Correction") return "Returned";
  return status as WorkflowStatus;
}
function errorText(error: unknown) { return error instanceof Error ? error.message : "The server did not confirm this action."; }

export default function ReportsScreen() {
  const colors = useColors();
  const me = trpc.auth.me.useQuery(undefined, { retry: false });
  const utils = trpc.useUtils();
  const sitesQuery = trpc.jp.workspace.mySites.useQuery();
  const capabilitiesQuery = trpc.jp.workspace.myCapabilities.useQuery();
  const reportsQuery = trpc.jp.reports.list.useQuery(undefined);
  const createDraftMutation = trpc.jp.reports.createDraft.useMutation();
  const submitMutation = trpc.jp.reports.submit.useMutation();
  const [localReports, setLocalReports] = useState<FieldReport[]>([]);
  const [filter, setFilter] = useState<"All" | "Needs action" | "Drafts">("All");
  const [composerVisible, setComposerVisible] = useState(false);
  const [title, setTitle] = useState("");
  const [remarks, setRemarks] = useState("");
  const [chosenKind, setKind] = useState<"DPR" | "DLR" | null>(null);
  const [chosenSiteId, setSiteId] = useState("");
  const [savedMessage, setSavedMessage] = useState<string | null>(null);
  const [pendingSync, setPendingSync] = useState(false);

  useEffect(() => { let mounted = true; readDraftStore().then((store) => { if (mounted) setLocalReports(store.reports); }); return () => { mounted = false; }; }, []);
  // DLR only accounts start on the report type they can create; a tap still overrides it.
  const defaultKind = capabilitiesQuery.data && !capabilitiesQuery.data.some((capability) => capability["dpr.create"]) && capabilitiesQuery.data.some((capability) => capability["dlr.create"]) ? "DLR" : "DPR";
  const kind = chosenKind ?? defaultKind;
  const createPermissionKey = kind === "DPR" ? "dpr.create" as const : "dlr.create" as const;
  const siteOptions = useMemo(() => (sitesQuery.data ?? []).filter((site) => capabilitiesQuery.data?.some((capability) => capability.siteId === site.id && capability[createPermissionKey])), [sitesQuery.data, capabilitiesQuery.data, createPermissionKey]);
  const siteId = resolveSelectedId(siteOptions, chosenSiteId);

  const serverReports: FieldReport[] = (reportsQuery.data ?? []).map((report) => ({
    id: report.id,
    siteId: report.siteId,
    siteName: report.siteName,
    title: report.title,
    kind: report.reportKind,
    date: report.reportDate,
    status: displayStatus(report.status),
    evidenceCount: 0,
    author: report.creatorName || "Staff user",
    updatedAt: formatTime(report.updatedAt),
    syncStatus: "Synced",
    lineSummary: report.remarks || "No progress line items or evidence are attached yet.",
    remarks: report.remarks || undefined,
  }));
  const reports = useMemo(() => [...localReports, ...serverReports], [localReports, reportsQuery.data]);
  const visibleReports = useMemo(() => {
    if (filter === "Needs action") return reports.filter((report) => report.status === "Returned" || report.status === "Pending review");
    if (filter === "Drafts") return reports.filter((report) => report.status === "Draft");
    return reports;
  }, [filter, reports]);
  const refresh = async () => {
    await Promise.all([reportsQuery.refetch(), sitesQuery.refetch()]);
    const store = await readDraftStore();
    setLocalReports(store.reports);
  };

  const syncOne = async (draft: FieldReport) => {
    const response = await createDraftMutation.mutateAsync({
      siteId: draft.siteId,
      reportKind: draft.kind,
      reportDate: draft.date,
      shiftCode: "General",
      title: draft.title,
      remarks: draft.remarks,
      clientMutationId: draft.clientMutationId || draft.id,
    });
    await removeLocalDraft("report", draft.id);
    setLocalReports((current) => current.filter((item) => item.id !== draft.id));
    await reportsQuery.refetch();
    return response;
  };

  const retrySync = async () => {
    setPendingSync(true);
    try {
      let lastError: unknown = null;
      for (const draft of localReports) {
        try { await syncOne(draft); } catch (error) { lastError = error; }
      }
      setSavedMessage(lastError ? `Some local drafts remain unconfirmed: ${errorText(lastError)}` : "All local report drafts were saved as server drafts. They are not submitted or approved.");
      await refresh();
    } finally { setPendingSync(false); }
  };

  const createDraft = async () => {
    const selectedSite = siteOptions.find((item) => item.id === siteId);
    if (!selectedSite) { setSavedMessage("Choose an assigned site before saving a report."); return; }
    const clientMutationId = createClientMutationId();
    const localDraft: FieldReport = {
      id: clientMutationId,
      clientMutationId,
      siteId: selectedSite.id,
      siteName: selectedSite.name,
      title: title.trim() || "Untitled daily progress report",
      kind,
      date: currentDate(),
      status: "Draft",
      evidenceCount: 0,
      author: me.data?.name || "Signed-in staff user",
      updatedAt: new Date().toISOString(),
      syncStatus: "Local Draft",
      lineSummary: remarks.trim() || "No work line items or evidence added.",
      remarks: remarks.trim() || undefined,
    };
    setLocalReports((current) => [localDraft, ...current]);
    await saveReportDraft(localDraft);
    setComposerVisible(false);
    setTitle(""); setRemarks(""); setKind(null);
    try {
      await syncOne(localDraft);
      setSavedMessage("Saved to the server as a draft. It has not been submitted for review.");
    } catch (error) {
      setSavedMessage(`Saved on this device; server sync is not confirmed. ${errorText(error)}`);
    }
  };

  const submitReport = async (reportId: string) => {
    try {
      await submitMutation.mutateAsync({ reportId });
      setSavedMessage("Report submitted to the review workflow.");
      await Promise.all([reportsQuery.refetch(), utils.jp.workspace.dashboard.invalidate()]);
    } catch (error) { setSavedMessage(`Submission was not confirmed: ${errorText(error)}`); }
  };

  const localPendingCount = localReports.filter((report) => report.syncStatus !== "Synced").length;
  const lastServerResponse = reportsQuery.dataUpdatedAt ? formatTime(new Date(reportsQuery.dataUpdatedAt)) : null;

  return <Screen>
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
      <AppHeader eyebrow="Field records" title="Reports" subtitle="DPR/DLR drafts and review status from assigned sites." userInitials={initials(me.data?.name)} />
      <OfflineBanner pendingCount={localPendingCount} connected={reportsQuery.isSuccess && sitesQuery.isSuccess} lastSyncedAt={lastServerResponse} onRetry={retrySync} retrying={pendingSync} />
      {reportsQuery.isError ? <InlineError message={reportsQuery.error.message} onRetry={() => { void refresh(); }} /> : null}
      {savedMessage ? <View style={[styles.savedBanner, { backgroundColor: `${colors.primary}12`, borderColor: `${colors.primary}45` }]}><MaterialIcons name="info-outline" size={17} color={colors.primary} /><Text style={[styles.savedText, { color: colors.foreground }]}>{savedMessage}</Text></View> : null}

      <View style={styles.topAction}><View><Text style={[styles.kicker, { color: colors.muted }]}>REPORT REGISTER</Text><Text style={[styles.subheading, { color: colors.foreground }]}>Records in your site scope</Text></View><Pressable accessibilityRole="button" disabled={siteOptions.length === 0} onPress={() => setComposerVisible(true)} style={({ pressed }) => [styles.addButton, { backgroundColor: siteOptions.length ? colors.primary : colors.border }, pressed && uiStyles.pressed]}><MaterialIcons name="add" size={18} color={colors.background} /><Text style={[styles.addText, { color: colors.background }]}>New report</Text></Pressable></View>

      <View style={styles.filterRow}>{(["All", "Needs action", "Drafts"] as const).map((item) => <Pressable key={item} accessibilityRole="button" onPress={() => setFilter(item)} style={[styles.filterChip, { backgroundColor: filter === item ? colors.primary : colors.surface, borderColor: filter === item ? colors.primary : colors.border }]}><Text style={[styles.filterText, { color: filter === item ? colors.background : colors.muted }]}>{item}</Text></Pressable>)}</View>
      <SectionHeader title={`${visibleReports.length} records`} />
      {reportsQuery.isLoading ? <View style={styles.loading}><ActivityIndicator color={colors.primary} /><Text style={[styles.loadingText, { color: colors.muted }]}>Loading authorised reports…</Text></View> : reportsQuery.isError ? null : visibleReports.length === 0 ? <EmptyState icon="description" title="No reports in this view" detail="No report record matches this filter in your current assigned-site scope." /> : <View style={styles.reportStack}>{visibleReports.map((report) => {
        const serverReport = serverReports.find((item) => item.id === report.id);
        const localDraft = !serverReport;
        const submitPermission = report.kind === "DPR" ? "dpr.submit" as const : "dlr.submit" as const;
        const canSubmit = Boolean(capabilitiesQuery.data?.some((capability) => capability.siteId === report.siteId && capability[submitPermission]));
        return <ReportCard key={report.id} report={report} localDraft={localDraft} canSubmit={canSubmit} submitting={submitMutation.isPending} onSubmit={() => { if (serverReport) void submitReport(serverReport.id); }} onSync={() => { void syncOne(report).then(() => setSavedMessage("Local draft saved to the server as a draft.")).catch((error) => setSavedMessage(`Sync is still unconfirmed: ${errorText(error)}`)); }} />;
      })}</View>}
      <View style={styles.auditNote}><MaterialIcons name="history" size={16} color={colors.primary} /><Text style={[styles.auditText, { color: colors.muted }]}>A submitted report is not approved. Review and correction decisions are recorded separately.</Text></View>
    </ScrollView>

    <Modal visible={composerVisible} transparent animationType="slide" onRequestClose={() => setComposerVisible(false)}>
      <View style={styles.modalBackdrop}><View style={[styles.modalCard, { backgroundColor: colors.background, borderColor: colors.border }]}>
        <View style={styles.modalHeader}><View><Text style={[styles.modalKicker, { color: colors.primary }]}>NEW FIELD RECORD</Text><Text style={[styles.modalTitle, { color: colors.foreground }]}>Start a report draft</Text></View><Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={() => setComposerVisible(false)}><MaterialIcons name="close" size={23} color={colors.foreground} /></Pressable></View>
        <Text style={[styles.inputLabel, { color: colors.muted }]}>Report type</Text><View style={styles.siteChoiceRow}>{(["DPR", "DLR"] as const).map((item) => <Pressable key={item} accessibilityRole="button" onPress={() => setKind(item)} style={[styles.siteChoice, { backgroundColor: kind === item ? `${colors.primary}16` : colors.surface, borderColor: kind === item ? colors.primary : colors.border }]}><Text style={[styles.siteChoiceText, { color: kind === item ? colors.primary : colors.foreground }]}>{item === "DPR" ? "Daily Progress Report" : "Daily Labour Report"}</Text></Pressable>)}</View>
        <Text style={[styles.inputLabel, { color: colors.muted }]}>Report title</Text><TextInput value={title} onChangeText={setTitle} placeholder="e.g. Footing concrete — Grid A" placeholderTextColor={colors.muted} style={[styles.input, { color: colors.foreground, backgroundColor: colors.surface, borderColor: colors.border }]} />
        <Text style={[styles.inputLabel, { color: colors.muted }]}>Site</Text><ScrollView style={styles.siteChoiceScroll} nestedScrollEnabled>{siteOptions.map((site) => <Pressable key={site.id} accessibilityRole="button" onPress={() => setSiteId(site.id)} style={[styles.siteChoice, { backgroundColor: siteId === site.id ? `${colors.primary}16` : colors.surface, borderColor: siteId === site.id ? colors.primary : colors.border }]}><Text style={[styles.siteChoiceText, { color: siteId === site.id ? colors.primary : colors.foreground }]}>{site.name} · {site.project}</Text></Pressable>)}</ScrollView>
        <Text style={[styles.inputLabel, { color: colors.muted }]}>Notes (optional)</Text><TextInput value={remarks} onChangeText={setRemarks} multiline placeholder="Add a field note; no line items or evidence are recorded yet." placeholderTextColor={colors.muted} style={[styles.input, styles.notesInput, { color: colors.foreground, backgroundColor: colors.surface, borderColor: colors.border }]} />
        <View style={[styles.draftCallout, { backgroundColor: `${colors.warning}12`, borderColor: `${colors.warning}35` }]}><MaterialIcons name="info-outline" size={18} color={colors.warning} /><Text style={[styles.draftCalloutText, { color: colors.foreground }]}>Online, this saves a server Draft. Offline, it remains on this device until the server acknowledges it. Nothing is submitted or approved.</Text></View>
        <PrimaryButton icon="save" label={createDraftMutation.isPending ? "Saving…" : "Save draft"} disabled={createDraftMutation.isPending || siteOptions.length === 0} onPress={createDraft} />
      </View></View>
    </Modal>
  </Screen>;
}

function ReportCard({ report, localDraft, canSubmit, submitting, onSubmit, onSync }: { report: FieldReport; localDraft: boolean; canSubmit: boolean; submitting: boolean; onSubmit: () => void; onSync: () => void }) {
  const colors = useColors();
  return <View style={[styles.reportCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
    <View style={styles.reportTop}><View style={[styles.kindTag, { backgroundColor: `${colors.primary}15` }]}><Text style={[styles.kindText, { color: colors.primary }]}>{report.kind}</Text></View><WorkflowPill status={report.status} /></View>
    <Text style={[styles.reportTitle, { color: colors.foreground }]}>{report.title}</Text><Text style={[styles.reportSite, { color: colors.muted }]}>{report.siteName} · {formatDate(report.date)}</Text>
    <View style={styles.reportMeta}><View style={styles.metaItem}><MaterialIcons name="person-outline" size={15} color={colors.muted} /><Text style={[styles.metaText, { color: colors.muted }]}>{report.author}</Text></View><View style={styles.metaItem}><MaterialIcons name="notes" size={15} color={colors.muted} /><Text style={[styles.metaText, { color: colors.muted, flexShrink: 1 }]}>{report.lineSummary}</Text></View></View>
    <View style={styles.reportBottom}><Text style={[styles.updatedAt, { color: colors.muted }]}>{localDraft ? "Stored on this device" : `Updated ${report.updatedAt}`}</Text><SyncPill status={report.syncStatus} /></View>
    {localDraft ? <View style={styles.cardAction}><SecondaryButton icon="sync" label="Sync draft" onPress={onSync} /></View> : canSubmit && (report.status === "Draft" || report.status === "Returned") ? <View style={styles.cardAction}><PrimaryButton icon="send" label={submitting ? "Submitting…" : report.status === "Returned" ? "Resubmit for review" : "Submit for review"} disabled={submitting} onPress={onSubmit} /></View> : null}
  </View>;
}

const styles = StyleSheet.create({
  content: { paddingBottom: 30 },
  savedBanner: { borderWidth: 1, borderRadius: 13, padding: 11, flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 15 },
  savedText: { fontSize: 12, fontWeight: "700", flex: 1, lineHeight: 17 },
  topAction: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 13 },
  kicker: { fontSize: 10, letterSpacing: 1.35, fontWeight: "800" },
  subheading: { fontSize: 17, fontWeight: "800", marginTop: 4 },
  addButton: { borderRadius: 13, minHeight: 42, paddingHorizontal: 13, flexDirection: "row", alignItems: "center", gap: 5 },
  addText: { fontSize: 12, fontWeight: "800" },
  filterRow: { flexDirection: "row", gap: 8, marginBottom: 22 },
  filterChip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8 },
  filterText: { fontSize: 11, fontWeight: "800" },
  reportStack: { gap: 11 },
  reportCard: { borderWidth: 1, borderRadius: 18, padding: 15 },
  reportTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  kindTag: { borderRadius: 7, paddingHorizontal: 8, paddingVertical: 5 },
  kindText: { fontSize: 10, fontWeight: "900", letterSpacing: 0.5 },
  reportTitle: { fontSize: 15, fontWeight: "800", marginTop: 12 },
  reportSite: { fontSize: 11, marginTop: 4 },
  reportMeta: { gap: 8, marginTop: 14 },
  metaItem: { flexDirection: "row", alignItems: "flex-start", gap: 5 },
  metaText: { fontSize: 11, flex: 1 },
  reportBottom: { borderTopWidth: 1, borderTopColor: "rgba(120, 140, 130, 0.18)", marginTop: 14, paddingTop: 11, flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  updatedAt: { fontSize: 10, flex: 1, paddingRight: 6 },
  cardAction: { marginTop: 12 },
  auditNote: { flexDirection: "row", alignItems: "center", gap: 7, justifyContent: "center", marginTop: 20, paddingHorizontal: 6 },
  auditText: { fontSize: 11, textAlign: "center", flex: 1, lineHeight: 16 },
  loading: { minHeight: 90, alignItems: "center", justifyContent: "center", gap: 8 },
  loadingText: { fontSize: 12 },
  modalBackdrop: { flex: 1, backgroundColor: "rgba(10, 20, 18, 0.52)", justifyContent: "flex-end" },
  modalCard: { maxHeight: "94%", borderTopLeftRadius: 25, borderTopRightRadius: 25, borderWidth: 1, padding: 21, paddingBottom: 30 },
  modalHeader: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 20 },
  modalKicker: { fontSize: 10, letterSpacing: 1.4, fontWeight: "800" },
  modalTitle: { fontSize: 22, fontWeight: "800", marginTop: 4 },
  inputLabel: { fontSize: 11, fontWeight: "800", marginBottom: 7, marginTop: 2 },
  input: { minHeight: 46, borderWidth: 1, borderRadius: 13, paddingHorizontal: 13, fontSize: 14, marginBottom: 15 },
  notesInput: { minHeight: 65, paddingTop: 11, textAlignVertical: "top" },
  siteChoiceScroll: { maxHeight: 105, marginBottom: 15 },
  siteChoiceRow: { gap: 8, marginBottom: 16 },
  siteChoice: { borderWidth: 1, borderRadius: 12, padding: 11, marginBottom: 6 },
  siteChoiceText: { fontSize: 12, fontWeight: "700" },
  draftCallout: { borderWidth: 1, borderRadius: 13, padding: 12, flexDirection: "row", alignItems: "flex-start", gap: 9, marginBottom: 17 },
  draftCalloutText: { fontSize: 12, lineHeight: 18, flex: 1 },
});
