import AsyncStorage from "@react-native-async-storage/async-storage";
import type { IssueCategory, IssueSeverity } from "@/lib/jp/issue-policy";
import { removeSyncQueueItem, upsertSyncQueueItem } from "@/lib/jp/local-repository";

const KEY = "jp-infracon.issue-drafts.v1";

/** An issue reported on this phone that the server has not confirmed yet. Never shown as Open. */
export type IssueDraft = {
  clientMutationId: string;
  siteId: string;
  siteName: string;
  category: IssueCategory;
  severity: IssueSeverity;
  title: string;
  description: string;
  locationLabel?: string;
  immediateAction?: string;
  stopWork: boolean;
  observedAt: string;
  createdAt: string;
  status: "Pending Sync" | "Sync Failed";
  error?: string;
};

export async function readIssueDrafts(): Promise<IssueDraft[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed) ? (parsed as IssueDraft[]) : [];
  } catch {
    return [];
  }
}

async function write(drafts: IssueDraft[]) {
  await AsyncStorage.setItem(KEY, JSON.stringify(drafts));
}

export async function saveIssueDraft(draft: IssueDraft): Promise<void> {
  const drafts = await readIssueDrafts();
  await write([...drafts.filter((row) => row.clientMutationId !== draft.clientMutationId), draft]);
  await upsertSyncQueueItem({
    id: draft.clientMutationId,
    label: `Issue · ${draft.title}`,
    status: draft.status === "Sync Failed" ? "Sync Failed" : "Pending Sync",
    updatedAt: new Date().toLocaleString(),
  });
}

export async function removeIssueDraft(clientMutationId: string): Promise<void> {
  const drafts = await readIssueDrafts();
  await write(drafts.filter((row) => row.clientMutationId !== clientMutationId));
  await removeSyncQueueItem(clientMutationId);
}

/** Network trouble keeps a draft pending; a refusal from the server needs the user's attention. */
export function isRetryableSyncError(error: unknown): boolean {
  const code = (error as { data?: { code?: string } } | undefined)?.data?.code;
  if (!code) return true;
  return [
    "INTERNAL_SERVER_ERROR",
    "TIMEOUT",
    "PRECONDITION_FAILED",
    "UNAUTHORIZED",
    "TOO_MANY_REQUESTS",
  ].includes(code);
}
