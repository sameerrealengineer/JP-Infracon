import AsyncStorage from "@react-native-async-storage/async-storage";
import type { FieldReport, MaterialRequest, SyncQueueItem } from "@/lib/jp/domain";

const DRAFTS_KEY = "jp-infracon.field-drafts.v1";

type DraftStore = {
  reports: FieldReport[];
  requests: MaterialRequest[];
  syncQueue: SyncQueueItem[];
};

const emptyDraftStore = (): DraftStore => ({ reports: [], requests: [], syncQueue: [] });

export function createClientMutationId(): string {
  const randomHex = (length: number) => Array.from({ length }, () => Math.floor(Math.random() * 16).toString(16)).join("");
  return `${randomHex(8)}-${randomHex(4)}-4${randomHex(3)}-${(8 + Math.floor(Math.random() * 4)).toString(16)}${randomHex(3)}-${randomHex(12)}`;
}

export async function readDraftStore(): Promise<DraftStore> {
  try {
    const raw = await AsyncStorage.getItem(DRAFTS_KEY);
    if (!raw) return emptyDraftStore();
    const parsed = JSON.parse(raw) as Partial<DraftStore>;
    return {
      reports: Array.isArray(parsed.reports) ? parsed.reports : [],
      requests: Array.isArray(parsed.requests) ? parsed.requests : [],
      syncQueue: Array.isArray(parsed.syncQueue) ? parsed.syncQueue : [],
    };
  } catch {
    return emptyDraftStore();
  }
}

export async function writeDraftStore(store: DraftStore): Promise<void> {
  await AsyncStorage.setItem(DRAFTS_KEY, JSON.stringify(store));
}

export async function saveReportDraft(report: FieldReport): Promise<DraftStore> {
  const store = await readDraftStore();
  const reports = [...store.reports.filter((item) => item.id !== report.id), report];
  const syncQueue = [
    ...store.syncQueue.filter((item) => item.id !== report.id),
    { id: report.id, label: `${report.kind} · ${report.title}`, status: report.syncStatus, updatedAt: report.updatedAt },
  ];
  const next = { ...store, reports, syncQueue };
  await writeDraftStore(next);
  return next;
}

export async function removeLocalDraft(kind: "report" | "request", id: string): Promise<DraftStore> {
  const store = await readDraftStore();
  const next: DraftStore = {
    reports: kind === "report" ? store.reports.filter((item) => item.id !== id) : store.reports,
    requests: kind === "request" ? store.requests.filter((item) => item.id !== id) : store.requests,
    syncQueue: store.syncQueue.filter((item) => item.id !== id),
  };
  await writeDraftStore(next);
  return next;
}

export async function saveMaterialRequest(request: MaterialRequest): Promise<DraftStore> {
  const store = await readDraftStore();
  const requests = [...store.requests.filter((item) => item.id !== request.id), request];
  const syncQueue = [
    ...store.syncQueue.filter((item) => item.id !== request.id),
    { id: request.id, label: `Material request · ${request.title}`, status: request.syncStatus, updatedAt: request.requestedAt },
  ];
  const next = { ...store, requests, syncQueue };
  await writeDraftStore(next);
  return next;
}
