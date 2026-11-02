import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { ChipGroup, Field, InlineError, PrimaryButton, Sheet } from "@/components/jp/ui";
import { useColors } from "@/hooks/use-colors";
import { saveIssueDraft, isRetryableSyncError } from "@/lib/jp/issue-drafts";
import {
  issueCategories,
  issueSeverities,
  safetyCategories,
  type IssueCategory,
  type IssueSeverity,
} from "@/lib/jp/issue-policy";
import { createClientMutationId } from "@/lib/jp/local-repository";
import { trpc } from "@/lib/trpc";
import { useT } from "@/lib/i18n";

export function IssueFormSheet({
  visible,
  sites,
  defaultSiteId,
  online,
  onClose,
  onSaved,
}: {
  visible: boolean;
  sites: { id: string; name: string }[];
  defaultSiteId?: string;
  online: boolean | null;
  onClose: () => void;
  onSaved: (result: { id?: string; offline: boolean }) => void;
}) {
  return visible ? (
    <IssueForm
      sites={sites}
      defaultSiteId={defaultSiteId}
      online={online}
      onClose={onClose}
      onSaved={onSaved}
    />
  ) : null;
}

function IssueForm({
  sites,
  defaultSiteId,
  online,
  onClose,
  onSaved,
}: {
  sites: { id: string; name: string }[];
  defaultSiteId?: string;
  online: boolean | null;
  onClose: () => void;
  onSaved: (result: { id?: string; offline: boolean }) => void;
}) {
  const colors = useColors();
  const { t } = useT();
  const utils = trpc.useUtils();
  const create = trpc.jp.issues.create.useMutation();
  const [mutationId] = useState(createClientMutationId);
  const [siteId, setSiteId] = useState<string | null>(defaultSiteId ?? sites[0]?.id ?? null);
  const [category, setCategory] = useState<IssueCategory | null>(null);
  const [severity, setSeverity] = useState<IssueSeverity | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [location, setLocation] = useState("");
  const [immediate, setImmediate] = useState("");
  const [stopWork, setStopWork] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const serious = severity === "High" || severity === "Critical";
  const valid =
    siteId && category && severity && title.trim().length >= 3 && description.trim().length >= 5;

  const saveOffline = async () => {
    const site = sites.find((row) => row.id === siteId);
    await saveIssueDraft({
      clientMutationId: mutationId,
      siteId: siteId!,
      siteName: site?.name ?? "Site",
      category: category!,
      severity: severity!,
      title: title.trim(),
      description: description.trim(),
      locationLabel: location.trim() || undefined,
      immediateAction: immediate.trim() || undefined,
      stopWork: serious && stopWork,
      observedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      status: "Pending Sync",
    });
    onSaved({ offline: true });
  };

  const submit = async () => {
    if (!valid) return;
    setSaving(true);
    setError(null);
    try {
      if (online === false) {
        await saveOffline();
        return;
      }
      const result = await create.mutateAsync({
        siteId: siteId!,
        category: category!,
        severity: severity!,
        title: title.trim(),
        description: description.trim(),
        locationLabel: location.trim() || undefined,
        immediateAction: immediate.trim() || undefined,
        stopWork: serious && stopWork,
        clientMutationId: mutationId,
      });
      await Promise.all([utils.jp.issues.invalidate(), utils.jp.workspace.inbox.invalidate()]);
      onSaved({ id: result.id, offline: false });
    } catch (cause) {
      if (isRetryableSyncError(cause)) await saveOffline();
      else setError(cause instanceof Error ? cause.message : "The issue could not be saved.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet
      visible
      title={t("Report an issue")}
      subtitle="Safety, quality, material, access or any problem holding up work."
      onClose={onClose}
      footer={
        <PrimaryButton
          icon={online === false ? "save" : "send"}
          label={online === false ? "Save on phone — sync later" : t("Report issue")}
          tone={severity === "Critical" ? "danger" : "primary"}
          onPress={() => void submit()}
          disabled={!valid}
          loading={saving}
        />
      }
    >
      {error ? <InlineError message={error} title="Not saved" /> : null}
      {sites.length > 1 ? (
        <ChipGroup
          label="Site"
          options={sites.map((site) => site.id)}
          value={siteId}
          onChange={setSiteId}
          format={(id) => sites.find((site) => site.id === id)?.name ?? id}
        />
      ) : null}
      <ChipGroup
        label={t("Type")}
        options={issueCategories}
        value={category}
        onChange={setCategory}
      />
      <ChipGroup
        label={t("Severity")}
        options={issueSeverities}
        value={severity}
        onChange={setSeverity}
      />
      {category && safetyCategories.includes(category) ? (
        <View
          style={[
            styles.safety,
            { backgroundColor: `${colors.error}10`, borderColor: `${colors.error}35` },
          ]}
        >
          <MaterialIcons name="health-and-safety" size={18} color={colors.error} />
          <Text style={[styles.safetyText, { color: colors.foreground }]}>
            Make the area safe first. This app records the issue; it does not certify that a hazard
            is safe.
          </Text>
        </View>
      ) : null}
      <Field
        label={t("Short title")}
        value={title}
        onChangeText={setTitle}
        placeholder="e.g. Trench edge not barricaded"
      />
      <Field
        label={t("What did you see?")}
        value={description}
        onChangeText={setDescription}
        multiline
        placeholder="Describe the problem, who or what is affected"
      />
      <Field
        label={t("Exact location")}
        value={location}
        onChangeText={setLocation}
        placeholder="e.g. Chainage 2+350, near valve chamber"
      />
      <Field
        label={t("Immediate action taken")}
        value={immediate}
        onChangeText={setImmediate}
        multiline
        placeholder="e.g. Area cordoned, workers moved"
      />
      {serious ? (
        <Pressable
          accessibilityRole="checkbox"
          accessibilityState={{ checked: stopWork }}
          onPress={() => setStopWork((value) => !value)}
          style={[styles.stop, { borderColor: stopWork ? colors.error : colors.border }]}
        >
          <MaterialIcons
            name={stopWork ? "check-box" : "check-box-outline-blank"}
            size={22}
            color={stopWork ? colors.error : colors.muted}
          />
          <View style={{ flex: 1 }}>
            <Text style={[styles.stopTitle, { color: colors.foreground }]}>
              {t("Stop work in this area")}
            </Text>
            <Text style={[styles.stopText, { color: colors.muted }]}>
              Flags the issue as STOP WORK for every site lead until it is resolved.
            </Text>
          </View>
        </Pressable>
      ) : null}
      <Text style={[styles.hint, { color: colors.muted }]}>
        Add photos from the issue page after reporting.
        {online === false
          ? " You are offline: the issue will be sent automatically when you reconnect."
          : ""}
      </Text>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  safety: {
    flexDirection: "row",
    gap: 8,
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
    marginBottom: 14,
  },
  safetyText: { flex: 1, fontSize: 12, lineHeight: 17 },
  stop: {
    flexDirection: "row",
    gap: 10,
    borderWidth: 1.5,
    borderRadius: 14,
    padding: 12,
    marginBottom: 12,
  },
  stopTitle: { fontSize: 14, fontWeight: "800" },
  stopText: { fontSize: 12, marginTop: 2 },
  hint: { fontSize: 11, lineHeight: 16 },
});
