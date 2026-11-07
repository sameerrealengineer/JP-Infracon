import { useState } from "react";
import { Text } from "react-native";
import { ChipGroup, InlineError, LoadingBlock, PrimaryButton, Sheet } from "@/components/jp/ui";
import { useColors } from "@/hooks/use-colors";
import { createClientMutationId } from "@/lib/jp/local-repository";
import { prettyRole } from "@/lib/jp/site-admin-policy";
import { useT } from "@/lib/i18n";
import { trpc } from "@/lib/trpc";

const NOBODY = "none";

/** Choose who is responsible for a task and which crew does it. The server checks both. */
export function AssignTaskSheet({
  task,
  siteId,
  onClose,
}: {
  task: { id: string; title: string; assigneeUserId: number | null; crewId: string | null };
  siteId: string;
  onClose: () => void;
}) {
  const { t } = useT();
  const colors = useColors();
  const utils = trpc.useUtils();
  const detail = trpc.jp.sitesAdmin.siteDetail.useQuery({ siteId });
  const month = new Date().toISOString().slice(0, 7);
  const crews = trpc.jp.crews.list.useQuery({ siteId, month }, { retry: false });
  const assign = trpc.jp.tasks.assign.useMutation();
  const [person, setPerson] = useState(task.assigneeUserId ? String(task.assigneeUserId) : NOBODY);
  const [crew, setCrew] = useState(task.crewId ?? NOBODY);
  const [key] = useState(createClientMutationId);
  const [error, setError] = useState<string | null>(null);

  const team = detail.data?.team ?? [];
  const people = [NOBODY, ...team.map((member) => String(member.userId))];
  const openCrews = (crews.data?.crews ?? []).filter((row) => row.status === "Active");
  const crewOptions = [NOBODY, ...openCrews.map((row) => row.id)];

  const save = async () => {
    setError(null);
    try {
      await assign.mutateAsync({
        taskId: task.id,
        assigneeUserId: person === NOBODY ? null : Number(person),
        crewId: crew === NOBODY ? null : crew,
        clientMutationId: key,
      });
      await utils.jp.tasks.list.invalidate();
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("Something went wrong"));
    }
  };

  return (
    <Sheet visible title={t("Assign task")} subtitle={task.title} onClose={onClose}>
      {detail.isLoading ? <LoadingBlock /> : null}
      {detail.data ? (
        <ChipGroup
          label={t("Responsible person")}
          options={people}
          value={people.includes(person) ? person : NOBODY}
          onChange={setPerson}
          format={(id) => {
            if (id === NOBODY) return t("Nobody");
            const member = team.find((row) => String(row.userId) === id);
            return member ? `${member.name ?? "—"} · ${prettyRole(member.role)}` : id;
          }}
        />
      ) : null}
      {crews.data ? (
        <ChipGroup
          label={t("Crew")}
          options={crewOptions}
          value={crewOptions.includes(crew) ? crew : NOBODY}
          onChange={setCrew}
          format={(id) =>
            id === NOBODY ? t("No crew") : (openCrews.find((row) => row.id === id)?.name ?? id)
          }
        />
      ) : crews.error ? (
        <Text style={{ color: colors.muted, fontSize: 12 }}>
          {t("Crews are not available to you on this site.")}
        </Text>
      ) : null}
      {error ? <InlineError message={error} /> : null}
      <PrimaryButton
        icon="assignment-ind"
        label={t("Save")}
        loading={assign.isPending}
        disabled={!detail.data}
        onPress={() => void save()}
      />
    </Sheet>
  );
}
