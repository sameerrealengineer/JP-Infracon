import { onlineManager } from "@tanstack/react-query";
import { useNetworkState } from "expo-network";
import { useCallback, useEffect, useState } from "react";
import { readDraftStore } from "@/lib/jp/local-repository";
import type { SyncQueueItem } from "@/lib/jp/domain";
import { DEMO_MODE } from "@/lib/demo/config";

/**
 * Device connectivity from the OS. `null` means not yet known.
 * React Query is told about it so queries pause offline and resume on reconnect.
 */
export function useConnectivity(): { online: boolean | null } {
  const state = useNetworkState();
  // The offline demo answers every call on the phone, so it is never "offline".
  const online = DEMO_MODE
    ? true
    : state.isConnected === undefined
      ? null
      : Boolean(state.isConnected) && state.isInternetReachable !== false;
  useEffect(() => {
    if (online !== null) onlineManager.setOnline(online);
  }, [online]);
  return { online };
}

/** The device-local draft queue (never server-approved). */
export function useSyncQueue() {
  const [queue, setQueue] = useState<SyncQueueItem[]>([]);
  const refresh = useCallback(async () => {
    const store = await readDraftStore();
    setQueue(store.syncQueue);
    return store.syncQueue;
  }, []);
  useEffect(() => {
    let mounted = true;
    void readDraftStore().then((store) => {
      if (mounted) setQueue(store.syncQueue);
    });
    return () => {
      mounted = false;
    };
  }, []);
  const pending = queue.filter((item) => item.status !== "Synced");
  return { queue, pending, refresh };
}
