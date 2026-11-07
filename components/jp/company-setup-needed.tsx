import { useRouter } from "expo-router";

import { EmptyState } from "@/components/jp/ui";
import { useWorkspace } from "@/hooks/use-workspace";

/** True for a Super Admin on a fresh server, before the first company exists. */
export function useNeedsCompanySetup(): boolean {
  return Boolean(useWorkspace().access.data?.canInitializeOrganization);
}

/** Shown instead of "access needed" when the only missing step is creating the company. */
export function CompanySetupNeeded() {
  const router = useRouter();
  return (
    <EmptyState
      icon="business"
      title="Set up your company first"
      detail="Create your company, first project and first site from the Home screen. Projects, sites and team accounts open after that."
      action="Go to Home"
      onPress={() => router.replace("/(tabs)" as never)}
    />
  );
}
