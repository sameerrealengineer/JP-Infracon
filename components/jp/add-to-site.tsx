import { useState } from "react";
import { Text } from "react-native";
import { Card, ChipGroup, InlineError, PrimaryButton } from "@/components/jp/ui";
import { useColors } from "@/hooks/use-colors";
import { useT } from "@/lib/i18n";
import { createClientMutationId } from "@/lib/jp/local-repository";
import { trpc } from "@/lib/trpc";

/**
 * Sends a person to another site of the company (a mistri moving to the next job). Offers only
 * active sites where the viewer may manage the workforce and the person is not already on.
 */
export function AddToSite({
  personId,
  currentSiteIds,
  onAdded,
}: {
  personId: string;
  currentSiteIds: string[];
  onAdded: () => void;
}) {
  const { t } = useT();
  const colors = useColors();
  const sites = trpc.jp.workspace.mySites.useQuery();
  const capabilities = trpc.jp.workspace.myCapabilities.useQuery();
  const add = trpc.jp.workforce.assignToSite.useMutation();
  const [siteId, setSiteId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const manageable = new Set(
    (capabilities.data ?? [])
      .filter((row) => (row as Record<string, unknown>)["workforce.manage"] === true)
      .map((row) => row.siteId),
  );
  const options = (sites.data ?? []).filter(
    (site) =>
      site.status === "Active" && manageable.has(site.id) && !currentSiteIds.includes(site.id),
  );
  if (!options.length) return null;
  const chosen = options.some((site) => site.id === siteId) ? siteId : null;
  return (
    <Card>
      <Text style={{ fontSize: 14, fontWeight: "800", color: colors.foreground, marginBottom: 6 }}>
        {t("Send to another site")}
      </Text>
      <ChipGroup
        options={options.map((site) => site.id)}
        value={chosen}
        onChange={setSiteId}
        format={(id) => options.find((site) => site.id === id)?.name ?? id}
      />
      {error ? <InlineError message={error} onRetry={() => setError(null)} /> : null}
      <PrimaryButton
        icon="add-location-alt"
        label={add.isPending ? t("Saving…") : t("Add to this site")}
        disabled={!chosen || add.isPending}
        onPress={() => {
          if (!chosen) return;
          setError(null);
          add
            .mutateAsync({ siteId: chosen, personId, clientMutationId: createClientMutationId() })
            .then(() => {
              setSiteId(null);
              onAdded();
            })
            .catch((cause: unknown) =>
              setError(cause instanceof Error ? t(cause.message) : t("Could not save.")),
            );
        }}
      />
    </Card>
  );
}
