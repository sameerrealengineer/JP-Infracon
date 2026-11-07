export type SiteStatus =
  | "On track"
  | "Attention"
  | "Blocked"
  | "Active"
  | "On Hold"
  | "Completed"
  | "Inactive";
export type WorkflowStatus =
  | "Draft"
  | "Pending review"
  | "Approved"
  | "Returned"
  | "Pending approval"
  | "Queued offline"
  | "Partially Approved"
  | "Rejected"
  | "Cancelled";
export type SyncStatus = "Local Draft" | "Pending Sync" | "Synced" | "Conflict" | "Sync Failed";

export type Site = {
  id: string;
  name: string;
  project: string;
  location: string;
  status: SiteStatus;
  completion: number;
  nextTask: string;
  nextTaskDate: string;
  manpower: number;
  openIssues: number;
  stockAlert?: string;
  lastSync: string;
};

export type FieldReport = {
  id: string;
  siteId: string;
  siteName: string;
  title: string;
  kind: "DPR" | "DLR";
  date: string;
  status: WorkflowStatus;
  evidenceCount: number;
  author: string;
  updatedAt: string;
  syncStatus: SyncStatus;
  lineSummary: string;
  clientMutationId?: string;
  remarks?: string;
  nextDayPlan?: string;
  weatherCode?: string;
  overallStatus?: string;
  /** DPR work lines as typed; the server checks them again when the draft syncs. */
  items?: import("./dpr-domain").DprItemInput[];
};

export type MaterialRequest = {
  id: string;
  siteId: string;
  siteName: string;
  title: string;
  quantity: string;
  unitCode?: string;
  requestedBy: string;
  requestedAt: string;
  status: WorkflowStatus;
  approvalNote: string;
  syncStatus: SyncStatus;
  clientMutationId?: string;
  purpose?: string;
};

export type NotificationItem = {
  id: string;
  label: string;
  title: string;
  detail: string;
  time: string;
  unread: boolean;
  tone: "warning" | "info" | "success";
};

export type SyncQueueItem = {
  id: string;
  label: string;
  status: SyncStatus;
  updatedAt: string;
};

export type WorkspaceData = {
  sites: Site[];
  reports: FieldReport[];
  requests: MaterialRequest[];
  notifications: NotificationItem[];
  syncQueue: SyncQueueItem[];
};

export const initialWorkspace: WorkspaceData = {
  sites: [
    {
      id: "site-vizag-rcc",
      name: "Vizag RCC site",
      project: "Coastal Housing Package",
      location: "Madhurawada, Visakhapatnam",
      status: "On track",
      completion: 68,
      nextTask: "Slab casting — Block C",
      nextTaskDate: "Today · 2:30 PM",
      manpower: 24,
      openIssues: 1,
      lastSync: "8 min ago",
    },
    {
      id: "site-shera-pipeline",
      name: "Sheragada pipeline",
      project: "Rural Water Network",
      location: "Gajapati district",
      status: "Attention",
      completion: 42,
      nextTask: "Excavation — chainage 4+200",
      nextTaskDate: "Tomorrow · 9:00 AM",
      manpower: 17,
      openIssues: 2,
      stockAlert: "Sand delivery delayed",
      lastSync: "21 min ago",
    },
  ],
  reports: [
    {
      id: "dpr-2026-10-26-vizag",
      siteId: "site-vizag-rcc",
      siteName: "Vizag RCC site",
      title: "Slab casting — Block C",
      kind: "DPR",
      date: "26 Oct 2026",
      status: "Pending review",
      evidenceCount: 4,
      author: "Arjun Rao",
      updatedAt: "Submitted 18 min ago",
      syncStatus: "Synced",
      lineSummary: "Planned 42 m³ · completed 38 m³",
    },
    {
      id: "dlr-2026-10-26-vizag",
      siteId: "site-vizag-rcc",
      siteName: "Vizag RCC site",
      title: "Daily workforce attendance",
      kind: "DLR",
      date: "26 Oct 2026",
      status: "Draft",
      evidenceCount: 0,
      author: "Arjun Rao",
      updatedAt: "Saved 46 min ago",
      syncStatus: "Local Draft",
      lineSummary: "21 of 24 roster entries marked",
    },
    {
      id: "dpr-2026-10-25-shera",
      siteId: "site-shera-pipeline",
      siteName: "Sheragada pipeline",
      title: "Excavation progress",
      kind: "DPR",
      date: "25 Oct 2026",
      status: "Returned",
      evidenceCount: 2,
      author: "Arjun Rao",
      updatedAt: "Returned yesterday · add chainage evidence",
      syncStatus: "Synced",
      lineSummary: "Blocker: heavy rain at chainage 4+200",
    },
  ],
  requests: [
    {
      id: "mr-1048",
      siteId: "site-vizag-rcc",
      siteName: "Vizag RCC site",
      title: "DI joints + solvent",
      quantity: "5 joints · 2 L",
      requestedBy: "Arjun Rao",
      requestedAt: "Today · 11:20 AM",
      status: "Pending approval",
      approvalNote: "Within delegated site request flow · approver required",
      syncStatus: "Synced",
    },
    {
      id: "mr-1047",
      siteId: "site-shera-pipeline",
      siteName: "Sheragada pipeline",
      title: "River sand",
      quantity: "12 m³",
      requestedBy: "Arjun Rao",
      requestedAt: "Yesterday · 4:10 PM",
      status: "Returned",
      approvalNote: "Add supplier quote before resubmitting",
      syncStatus: "Synced",
    },
    {
      id: "mr-1046",
      siteId: "site-vizag-rcc",
      siteName: "Vizag RCC site",
      title: "Cement — OPC 43",
      quantity: "300 bags",
      requestedBy: "Arjun Rao",
      requestedAt: "24 Oct · 9:35 AM",
      status: "Approved",
      approvalNote: "Receipt and consumption must be recorded separately",
      syncStatus: "Synced",
    },
  ],
  notifications: [
    {
      id: "n-1",
      label: "Approval queue",
      title: "Material request requires review",
      detail: "DI joints + solvent · Vizag RCC site",
      time: "18 min ago",
      unread: true,
      tone: "warning",
    },
    {
      id: "n-2",
      label: "Report returned",
      title: "Add chainage evidence to DPR",
      detail: "Sheragada pipeline · Excavation progress",
      time: "Yesterday",
      unread: true,
      tone: "warning",
    },
    {
      id: "n-3",
      label: "Sync complete",
      title: "Field drafts are up to date",
      detail: "Last successful sync · 8 min ago",
      time: "8 min ago",
      unread: false,
      tone: "success",
    },
  ],
  syncQueue: [
    { id: "sync-1", label: "DLR attendance draft", status: "Local Draft", updatedAt: "46 min ago" },
    { id: "sync-2", label: "Photo evidence · DPR", status: "Synced", updatedAt: "18 min ago" },
  ],
};

export function getSiteById(workspace: WorkspaceData, siteId: string) {
  return workspace.sites.find((site) => site.id === siteId);
}

export function getUnreadCount(workspace: WorkspaceData) {
  return workspace.notifications.filter((notification) => notification.unread).length;
}

export function getPendingReportCount(workspace: WorkspaceData) {
  return workspace.reports.filter(
    (report) => report.status === "Draft" || report.status === "Returned",
  ).length;
}

export function getPendingRequestCount(workspace: WorkspaceData) {
  return workspace.requests.filter(
    (request) => request.status === "Pending approval" || request.status === "Returned",
  ).length;
}

export function getSiteStatusTone(status: SiteStatus): "success" | "warning" | "error" {
  if (status === "On track" || status === "Active" || status === "Completed") return "success";
  if (status === "Attention" || status === "On Hold") return "warning";
  return "error";
}

export function getWorkflowTone(status: WorkflowStatus): "success" | "warning" | "error" | "info" {
  if (status === "Approved") return "success";
  if (status === "Returned" || status === "Rejected") return "error";
  if (status === "Pending approval" || status === "Pending review") return "warning";
  return "info";
}

export function getSyncTone(status: SyncStatus): "success" | "warning" | "error" | "info" {
  if (status === "Synced") return "success";
  if (status === "Conflict" || status === "Sync Failed") return "error";
  if (status === "Pending Sync") return "warning";
  return "info";
}
