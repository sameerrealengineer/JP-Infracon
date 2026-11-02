import { useMemo } from "react";
import { trpc } from "@/lib/trpc";

/**
 * Server-resolved identity, organisation role and per-site capabilities, for showing or hiding UI.
 * The server still checks every action; this only decides what the user is offered.
 */
export function useWorkspace() {
  const me = trpc.auth.me.useQuery(undefined, { retry: false, staleTime: 5 * 60_000 });
  const access = trpc.jp.workspace.onboardingState.useQuery(undefined, { staleTime: 5 * 60_000 });
  const capabilities = trpc.jp.workspace.myCapabilities.useQuery(undefined, {
    staleTime: 60_000,
  });
  const rows = useMemo(() => capabilities.data ?? [], [capabilities.data]);
  const can = useMemo(() => {
    const index = rows as unknown as Record<string, unknown>[];
    return (...keys: string[]) => index.some((row) => keys.some((key) => row[key] === true));
  }, [rows]);
  const sitesWith = useMemo(() => {
    const index = rows as unknown as (Record<string, unknown> & { siteId: string })[];
    return (key: string) => index.filter((row) => row[key] === true).map((row) => row.siteId);
  }, [rows]);
  const isSuperAdmin = Boolean(me.data?.platformOwner);
  return {
    me,
    access,
    capabilities,
    can,
    sitesWith,
    isSuperAdmin,
    canManageSites: isSuperAdmin || Boolean(access.data?.canManageSites),
    canManageAccounts: isSuperAdmin || Boolean(access.data?.canManageAccounts),
    role: isSuperAdmin ? "super_admin" : (access.data?.businessRole ?? null),
  };
}
