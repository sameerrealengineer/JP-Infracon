import { useCallback, useEffect, useRef, useState } from "react";
import {
  isRetryableSyncError,
  readIssueDrafts,
  removeIssueDraft,
  saveIssueDraft,
  type IssueDraft,
} from "@/lib/jp/issue-drafts";
import { trpc } from "@/lib/trpc";

/**
 * Sends issues saved offline once the phone is online. Each draft keeps its clientMutationId,
 * so a retry after a dropped connection never creates a duplicate issue.
 */
export function useIssueDraftSync(online: boolean | null) {
  const utils = trpc.useUtils();
  const create = trpc.jp.issues.create.useMutation();
  const [drafts, setDrafts] = useState<IssueDraft[]>([]);
  const running = useRef(false);

  const reload = useCallback(async () => {
    const rows = await readIssueDrafts();
    setDrafts(rows);
    return rows;
  }, []);

  const syncNow = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    try {
      const pending = (await readIssueDrafts()).filter((draft) => draft.status === "Pending Sync");
      for (const draft of pending) {
        try {
          await create.mutateAsync({
            siteId: draft.siteId,
            category: draft.category,
            severity: draft.severity,
            title: draft.title,
            description: draft.description,
            locationLabel: draft.locationLabel,
            immediateAction: draft.immediateAction,
            stopWork: draft.stopWork,
            observedAt: new Date(draft.observedAt),
            clientMutationId: draft.clientMutationId,
          });
          await removeIssueDraft(draft.clientMutationId);
        } catch (error) {
          if (isRetryableSyncError(error)) break;
          await saveIssueDraft({
            ...draft,
            status: "Sync Failed",
            error: error instanceof Error ? error.message : "The server refused this issue.",
          });
        }
      }
      await utils.jp.issues.invalidate();
      await utils.jp.workspace.inbox.invalidate();
    } finally {
      running.current = false;
      await reload();
    }
  }, [create, reload, utils]);

  useEffect(() => {
    if (online) void syncNow();
    // Only react to connectivity changes, not to new function identities.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online]);

  useEffect(() => {
    let active = true;
    void readIssueDrafts().then((rows) => {
      if (active) setDrafts(rows);
    });
    return () => {
      active = false;
    };
  }, []);

  return { drafts, reload, syncNow };
}
