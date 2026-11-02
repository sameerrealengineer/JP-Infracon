import { useState } from "react";
import { Text, View } from "react-native";
import { ChipGroup, Field, PrimaryButton, Sheet, InlineError } from "@/components/jp/ui";
import { useColors } from "@/hooks/use-colors";
import { createClientMutationId } from "@/lib/jp/local-repository";
import {
  isValidCode,
  nextStatusOptions,
  prettyRole,
  siteAssignableRoles,
  type SiteAssignableRole,
  type SiteLifecycleStatus,
} from "@/lib/jp/site-admin-policy";
import { trpc } from "@/lib/trpc";

const datePattern = /^\d{4}-\d{2}-\d{2}$/;

function useInvalidateAdmin() {
  const utils = trpc.useUtils();
  return async () => {
    await Promise.all([
      utils.jp.sitesAdmin.invalidate(),
      utils.jp.workspace.mySites.invalidate(),
      utils.jp.workspace.myCapabilities.invalidate(),
      utils.jp.accounts.invalidate(),
    ]);
  };
}

export type ProjectDraft = {
  id?: string;
  organizationId: string;
  code?: string;
  name?: string;
  clientDepartment?: string | null;
  projectType?: string | null;
  startDate?: string | null;
  targetEndDate?: string | null;
};

/** Create or edit a project. A project groups one or more sites. */
export function ProjectFormSheet({
  draft,
  onClose,
}: {
  draft: ProjectDraft | null;
  onClose: () => void;
}) {
  return draft ? <ProjectForm key={draft.id ?? "new"} draft={draft} onClose={onClose} /> : null;
}

function ProjectForm({ draft, onClose }: { draft: ProjectDraft; onClose: () => void }) {
  const invalidate = useInvalidateAdmin();
  const create = trpc.jp.sitesAdmin.createProject.useMutation();
  const update = trpc.jp.sitesAdmin.updateProject.useMutation();
  const [mutationId] = useState(createClientMutationId);
  const [code, setCode] = useState(draft.code ?? "");
  const [name, setName] = useState(draft.name ?? "");
  const [client, setClient] = useState(draft.clientDepartment ?? "");
  const [type, setType] = useState(draft.projectType ?? "");
  const [start, setStart] = useState(draft.startDate ?? "");
  const [end, setEnd] = useState(draft.targetEndDate ?? "");
  const [error, setError] = useState<string | null>(null);
  const editing = Boolean(draft.id);
  const codeError =
    !editing && code && !isValidCode(code) ? "Use 2–32 letters, digits or hyphens." : null;
  const dateError =
    (start && !datePattern.test(start)) || (end && !datePattern.test(end))
      ? "Use YYYY-MM-DD."
      : start && end && end < start
        ? "Target end is before the start date."
        : null;
  const busy = create.isPending || update.isPending;
  const disabled =
    busy || name.trim().length < 2 || (!editing && !isValidCode(code)) || Boolean(dateError);

  const save = async () => {
    setError(null);
    try {
      const fields = {
        name: name.trim(),
        clientDepartment: client.trim() || undefined,
        projectType: type.trim() || undefined,
        startDate: start || undefined,
        targetEndDate: end || undefined,
        clientMutationId: mutationId,
      };
      if (draft.id) await update.mutateAsync({ projectId: draft.id, ...fields });
      else
        await create.mutateAsync({
          organizationId: draft.organizationId,
          projectCode: code,
          ...fields,
        });
      await invalidate();
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The project could not be saved.");
    }
  };

  return (
    <Sheet
      visible
      title={editing ? "Edit project" : "New project"}
      subtitle={
        editing
          ? `Project ${draft.code}`
          : "A project groups the sites delivered under one contract."
      }
      onClose={onClose}
      footer={
        <PrimaryButton
          icon="check"
          label={editing ? "Save changes" : "Create project"}
          onPress={() => void save()}
          disabled={disabled}
          loading={busy}
        />
      }
    >
      {error ? <InlineError message={error} title="Not saved" /> : null}
      {!editing ? (
        <Field
          label="Project code"
          value={code}
          onChangeText={setCode}
          autoCapitalize="characters"
          placeholder="e.g. RWSS-KHD"
          error={codeError}
          hint="Unique in your organisation. Cannot be changed later."
        />
      ) : null}
      <Field
        label="Project name"
        value={name}
        onChangeText={setName}
        placeholder="e.g. Khurda Rural Water Supply"
      />
      <Field
        label="Client / department"
        value={client}
        onChangeText={setClient}
        placeholder="e.g. RWSS Odisha"
      />
      <Field
        label="Project type"
        value={type}
        onChangeText={setType}
        placeholder="e.g. Pipeline, Building, Road"
      />
      <View style={{ flexDirection: "row", gap: 10 }}>
        <View style={{ flex: 1 }}>
          <Field
            label="Start date"
            value={start}
            onChangeText={setStart}
            placeholder="YYYY-MM-DD"
            keyboardType="numbers-and-punctuation"
          />
        </View>
        <View style={{ flex: 1 }}>
          <Field
            label="Target end"
            value={end}
            onChangeText={setEnd}
            placeholder="YYYY-MM-DD"
            keyboardType="numbers-and-punctuation"
          />
        </View>
      </View>
      {dateError ? <InlineError message={dateError} title="Check the dates" /> : null}
    </Sheet>
  );
}

export type SiteDraft = {
  id?: string;
  projectId: string;
  projectName?: string;
  code?: string;
  name?: string;
  address?: string | null;
  village?: string | null;
  district?: string | null;
  state?: string | null;
};

export function SiteFormSheet({
  draft,
  onClose,
}: {
  draft: SiteDraft | null;
  onClose: () => void;
}) {
  return draft ? (
    <SiteForm key={draft.id ?? draft.projectId} draft={draft} onClose={onClose} />
  ) : null;
}

function SiteForm({ draft, onClose }: { draft: SiteDraft; onClose: () => void }) {
  const invalidate = useInvalidateAdmin();
  const create = trpc.jp.sitesAdmin.createSite.useMutation();
  const update = trpc.jp.sitesAdmin.updateSite.useMutation();
  const [mutationId] = useState(createClientMutationId);
  const [code, setCode] = useState(draft.code ?? "");
  const [name, setName] = useState(draft.name ?? "");
  const [address, setAddress] = useState(draft.address ?? "");
  const [village, setVillage] = useState(draft.village ?? "");
  const [district, setDistrict] = useState(draft.district ?? "");
  const [state, setState] = useState(draft.state ?? "Odisha");
  const [error, setError] = useState<string | null>(null);
  const editing = Boolean(draft.id);
  const busy = create.isPending || update.isPending;
  const disabled = busy || name.trim().length < 2 || (!editing && !isValidCode(code));

  const save = async () => {
    setError(null);
    const fields = {
      name: name.trim(),
      address: address.trim() || undefined,
      village: village.trim() || undefined,
      district: district.trim() || undefined,
      state: state.trim() || undefined,
      clientMutationId: mutationId,
    };
    try {
      if (draft.id) await update.mutateAsync({ siteId: draft.id, ...fields });
      else await create.mutateAsync({ projectId: draft.projectId, siteCode: code, ...fields });
      await invalidate();
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The site could not be saved.");
    }
  };

  return (
    <Sheet
      visible
      title={editing ? "Edit site" : "New site"}
      subtitle={draft.projectName ? `Project · ${draft.projectName}` : undefined}
      onClose={onClose}
      footer={
        <PrimaryButton
          icon="check"
          label={editing ? "Save changes" : "Create site"}
          onPress={() => void save()}
          disabled={disabled}
          loading={busy}
        />
      }
    >
      {error ? <InlineError message={error} title="Not saved" /> : null}
      {!editing ? (
        <Field
          label="Site code"
          value={code}
          onChangeText={setCode}
          autoCapitalize="characters"
          placeholder="e.g. KHD-PKG-03"
          error={code && !isValidCode(code) ? "Use 2–32 letters, digits or hyphens." : null}
          hint="Unique in your organisation. Cannot be changed later."
        />
      ) : null}
      <Field
        label="Site name"
        value={name}
        onChangeText={setName}
        placeholder="e.g. Balugaon Pump House"
      />
      <Field
        label="Address / landmark"
        value={address}
        onChangeText={setAddress}
        multiline
        placeholder="Where the team reports"
      />
      <Field label="Village / town" value={village} onChangeText={setVillage} />
      <View style={{ flexDirection: "row", gap: 10 }}>
        <View style={{ flex: 1 }}>
          <Field label="District" value={district} onChangeText={setDistrict} />
        </View>
        <View style={{ flex: 1 }}>
          <Field label="State" value={state} onChangeText={setState} />
        </View>
      </View>
    </Sheet>
  );
}

export type StatusTarget = {
  kind: "project" | "site";
  id: string;
  name: string;
  status: SiteLifecycleStatus;
};

export function StatusSheet({
  target,
  onClose,
}: {
  target: StatusTarget | null;
  onClose: () => void;
}) {
  return target ? <StatusForm key={target.id} target={target} onClose={onClose} /> : null;
}

function StatusForm({ target, onClose }: { target: StatusTarget; onClose: () => void }) {
  const colors = useColors();
  const invalidate = useInvalidateAdmin();
  const projectStatus = trpc.jp.sitesAdmin.setProjectStatus.useMutation();
  const siteStatus = trpc.jp.sitesAdmin.setSiteStatus.useMutation();
  const [mutationId] = useState(createClientMutationId);
  const options = nextStatusOptions(target.status);
  const [status, setStatus] = useState<SiteLifecycleStatus | null>(options[0] ?? null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const busy = projectStatus.isPending || siteStatus.isPending;

  const save = async () => {
    if (!status) return;
    setError(null);
    try {
      const payload = { status, reason: reason.trim(), clientMutationId: mutationId };
      if (target.kind === "project")
        await projectStatus.mutateAsync({ projectId: target.id, ...payload });
      else await siteStatus.mutateAsync({ siteId: target.id, ...payload });
      await invalidate();
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The status could not be changed.");
    }
  };

  return (
    <Sheet
      visible
      title="Change status"
      subtitle={`${target.name} is currently ${target.status}.`}
      onClose={onClose}
      footer={
        <PrimaryButton
          icon="published-with-changes"
          label={status ? `Mark as ${status}` : "Choose a status"}
          tone={status === "Inactive" ? "danger" : "primary"}
          onPress={() => void save()}
          disabled={!status || reason.trim().length < 3}
          loading={busy}
        />
      }
    >
      {error ? <InlineError message={error} title="Not changed" /> : null}
      <ChipGroup label="New status" options={options} value={status} onChange={setStatus} />
      <Text style={{ color: colors.muted, fontSize: 12, lineHeight: 17, marginBottom: 12 }}>
        Sites that are not Active stay readable, but new reports, requests and entries are blocked
        until they are reactivated.
      </Text>
      <Field
        label="Reason (recorded in the audit trail)"
        value={reason}
        onChangeText={setReason}
        multiline
        placeholder="e.g. Work suspended for monsoon"
      />
    </Sheet>
  );
}

export function AssignMemberSheet({
  siteId,
  onClose,
}: {
  siteId: string | null;
  onClose: () => void;
}) {
  return siteId ? <AssignForm key={siteId} siteId={siteId} onClose={onClose} /> : null;
}

function AssignForm({ siteId, onClose }: { siteId: string; onClose: () => void }) {
  const colors = useColors();
  const invalidate = useInvalidateAdmin();
  const candidates = trpc.jp.sitesAdmin.assignmentCandidates.useQuery({ siteId });
  const assign = trpc.jp.sitesAdmin.assignMember.useMutation();
  const [mutationId, setMutationId] = useState(createClientMutationId);
  const [userId, setUserId] = useState<number | null>(null);
  const [role, setRole] = useState<SiteAssignableRole | null>(null);
  const [error, setError] = useState<string | null>(null);
  const people = candidates.data ?? [];
  const selected = people.find((person) => person.userId === userId);

  const save = async () => {
    if (!userId || !role) return;
    setError(null);
    try {
      await assign.mutateAsync({ siteId, userId, role, clientMutationId: mutationId });
      await invalidate();
      onClose();
    } catch (cause) {
      setMutationId(createClientMutationId());
      setError(cause instanceof Error ? cause.message : "The person could not be assigned.");
    }
  };

  return (
    <Sheet
      visible
      title="Assign to site"
      subtitle="Only active organisation members without organisation-wide access are listed."
      onClose={onClose}
      footer={
        <PrimaryButton
          icon="person-add-alt"
          label="Assign"
          onPress={() => void save()}
          disabled={!userId || !role}
          loading={assign.isPending}
        />
      }
    >
      {error ? <InlineError message={error} title="Not assigned" /> : null}
      {candidates.error ? <InlineError message={candidates.error.message} /> : null}
      {candidates.isLoading ? (
        <Text style={{ color: colors.muted, marginBottom: 12 }}>Loading members…</Text>
      ) : people.length === 0 ? (
        <Text style={{ color: colors.muted, fontSize: 13, lineHeight: 19, marginBottom: 12 }}>
          Everyone eligible is already on this site. Create a new login from Team accounts first.
        </Text>
      ) : (
        <ChipGroup
          label="Person"
          options={people.map((person) => String(person.userId))}
          value={userId ? String(userId) : null}
          onChange={(value) => {
            const person = people.find((row) => String(row.userId) === value);
            setUserId(Number(value));
            const suggested = person?.roles.find((r) =>
              (siteAssignableRoles as readonly string[]).includes(r),
            );
            setRole((suggested as SiteAssignableRole | undefined) ?? null);
          }}
          format={(value) => {
            const person = people.find((row) => String(row.userId) === value);
            return person?.name ?? `User ${value}`;
          }}
        />
      )}
      {selected ? (
        <ChipGroup
          label="Site role"
          options={siteAssignableRoles}
          value={role}
          onChange={setRole}
          format={prettyRole}
        />
      ) : null}
    </Sheet>
  );
}

export function RemoveMemberSheet({
  member,
  onClose,
}: {
  member: { assignmentId: string; name: string | null } | null;
  onClose: () => void;
}) {
  return member ? <RemoveForm key={member.assignmentId} member={member} onClose={onClose} /> : null;
}

function RemoveForm({
  member,
  onClose,
}: {
  member: { assignmentId: string; name: string | null };
  onClose: () => void;
}) {
  const invalidate = useInvalidateAdmin();
  const revoke = trpc.jp.sitesAdmin.revokeAssignment.useMutation();
  const [mutationId] = useState(createClientMutationId);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    setError(null);
    try {
      await revoke.mutateAsync({
        assignmentId: member.assignmentId,
        reason: reason.trim(),
        clientMutationId: mutationId,
      });
      await invalidate();
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The assignment could not be removed.");
    }
  };
  return (
    <Sheet
      visible
      title="Remove from site"
      subtitle={`${member.name ?? "This person"} will lose access to this site immediately. Their past records stay.`}
      onClose={onClose}
      footer={
        <PrimaryButton
          icon="person-remove"
          label="Remove access"
          tone="danger"
          onPress={() => void save()}
          disabled={reason.trim().length < 3}
          loading={revoke.isPending}
        />
      }
    >
      {error ? <InlineError message={error} title="Not removed" /> : null}
      <Field
        label="Reason"
        value={reason}
        onChangeText={setReason}
        multiline
        placeholder="e.g. Transferred to another site"
      />
    </Sheet>
  );
}
