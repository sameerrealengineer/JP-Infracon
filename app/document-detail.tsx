import * as DocumentPicker from "expo-document-picker";
import { useLocalSearchParams } from "expo-router";
import * as Sharing from "expo-sharing";
import * as WebBrowser from "expo-web-browser";
import { useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";

import { AuthGate } from "@/components/jp/auth-gate";
import {
  AppHeader,
  Card,
  ChipGroup,
  Field,
  InlineError,
  LoadingBlock,
  PrimaryButton,
  Screen,
  SecondaryButton,
  SectionHeader,
  Sheet,
  StatusPill,
  formatDateTime,
} from "@/components/jp/ui";
import { useColors } from "@/hooks/use-colors";
import { readBase64 } from "@/lib/device-files";
import { formatBytes } from "@/lib/jp/attachment-policy";
import {
  DOCUMENT_CATEGORIES,
  MAX_DOCUMENT_BYTES,
  type DocumentCategory,
} from "@/lib/jp/document-policy";
import { createClientMutationId } from "@/lib/jp/local-repository";
import { trpc } from "@/lib/trpc";

const FIELD_LABELS: Record<string, string> = {
  documentNumber: "Number",
  documentDate: "Date",
  partyName: "Party",
  gstin: "GSTIN",
  totalAmount: "Amount shown",
};

export default function DocumentDetailScreen() {
  const params = useLocalSearchParams<{ documentId?: string }>();
  const documentId = typeof params.documentId === "string" ? params.documentId : "";
  const colors = useColors();
  const utils = trpc.useUtils();
  const detail = trpc.jp.documents.detail.useQuery(
    { documentId },
    { enabled: Boolean(documentId) },
  );
  const open = trpc.jp.documents.open.useMutation();
  const reindex = trpc.jp.documents.reindex.useMutation();
  const [sheet, setSheet] = useState<"version" | "edit" | "archive" | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const refresh = async () => {
    await Promise.all([detail.refetch(), utils.jp.documents.list.invalidate()]);
  };

  const view = async (versionNumber: number) => {
    setMessage(null);
    try {
      const { url, contentType } = await open.mutateAsync({ documentId, versionNumber });
      if (url.startsWith("file:")) await Sharing.shareAsync(url, { mimeType: contentType });
      else await WebBrowser.openBrowserAsync(url);
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "The file could not be opened.");
    }
  };

  return (
    <AuthGate>
      <Screen>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
          {detail.isLoading ? <LoadingBlock label="Loading document…" /> : null}
          {detail.error ? (
            <InlineError message={detail.error.message} onRetry={() => void detail.refetch()} />
          ) : null}
          {detail.data ? (
            <>
              <AppHeader
                eyebrow={detail.data.document.category}
                title={detail.data.document.title}
                subtitle={
                  detail.data.document.status === "Archived"
                    ? "Archived: hidden from lists and search"
                    : `Version ${detail.data.document.currentVersion}`
                }
              />
              {message ? <InlineError message={message} /> : null}
              <PrimaryButton
                icon="open-in-new"
                label={open.isPending ? "Opening…" : "Open current file"}
                disabled={open.isPending}
                onPress={() => void view(detail.data!.document.currentVersion)}
              />
              {detail.data.document.description ? (
                <Card>
                  <Text style={[styles.body, { color: colors.foreground }]}>
                    {detail.data.document.description}
                  </Text>
                </Card>
              ) : null}
              {detail.data.document.tags ? (
                <Text style={[styles.meta, { color: colors.muted }]}>
                  Tags: {detail.data.document.tags}
                </Text>
              ) : null}

              <SectionHeader
                title="Read by AI"
                caption="Suggestions to help you find and check the file. Always confirm against the file itself."
              />
              <Card>
                {detail.data.document.indexStatus === "Pending" ? (
                  <Text style={[styles.body, { color: colors.muted }]}>
                    The file is being read for search. Pull to refresh in a moment.
                  </Text>
                ) : null}
                {detail.data.document.aiDocumentType ? (
                  <Text style={[styles.label, { color: colors.foreground }]}>
                    {detail.data.document.aiDocumentType}
                  </Text>
                ) : null}
                {detail.data.document.aiSummary ? (
                  <Text style={[styles.body, { color: colors.foreground }]}>
                    {detail.data.document.aiSummary}
                  </Text>
                ) : null}
                {Object.entries(detail.data.document.aiFields ?? {}).map(([key, value]) => (
                  <View key={key} style={styles.row}>
                    <Text style={[styles.meta, { color: colors.muted }]}>
                      {FIELD_LABELS[key] ?? key}
                    </Text>
                    <Text style={[styles.body, { color: colors.foreground }]}>{value}</Text>
                  </View>
                ))}
                <Text style={[styles.meta, { color: colors.muted }]}>
                  {detail.data.document.indexStatus === "Indexed"
                    ? "Searchable by meaning and by words."
                    : detail.data.document.indexStatus === "Keyword only"
                      ? "Searchable by words. Meaning search needs the AI key on the server."
                      : detail.data.document.indexStatus === "Failed"
                        ? "No text could be read from this file; it is found by title and tags."
                        : ""}
                </Text>
              </Card>

              <SectionHeader title={`Versions (${detail.data.versions.length})`} />
              {detail.data.versions.map((version) => (
                <Card key={version.versionNumber}>
                  <View style={styles.row}>
                    <Text style={[styles.label, { color: colors.foreground }]}>
                      Version {version.versionNumber}
                    </Text>
                    {version.versionNumber === detail.data!.document.currentVersion ? (
                      <StatusPill label="Current" tone="success" compact />
                    ) : null}
                  </View>
                  <Text style={[styles.meta, { color: colors.muted }]}>
                    {version.fileName} · {formatBytes(version.sizeBytes)} ·{" "}
                    {version.uploaderName ?? "Unknown"} · {formatDateTime(version.createdAt)}
                  </Text>
                  {version.note ? (
                    <Text style={[styles.body, { color: colors.foreground }]}>{version.note}</Text>
                  ) : null}
                  <SecondaryButton
                    icon="visibility"
                    label="Open this version"
                    onPress={() => void view(version.versionNumber)}
                  />
                </Card>
              ))}

              {detail.data.document.status === "Active" && detail.data.canReplace ? (
                <SecondaryButton
                  icon="upload-file"
                  label="Upload a new version"
                  onPress={() => setSheet("version")}
                />
              ) : null}
              {detail.data.canReplace ? (
                <SecondaryButton
                  icon="edit"
                  label="Edit details"
                  onPress={() => setSheet("edit")}
                />
              ) : null}
              {detail.data.canManage ? (
                <>
                  <SecondaryButton
                    icon="refresh"
                    label={reindex.isPending ? "Reading again…" : "Read the file again for search"}
                    disabled={reindex.isPending}
                    onPress={() =>
                      void reindex
                        .mutateAsync({ documentId })
                        .then(refresh)
                        .catch((cause: unknown) =>
                          setMessage(cause instanceof Error ? cause.message : "Not started."),
                        )
                    }
                  />
                  <SecondaryButton
                    icon={detail.data.document.status === "Active" ? "archive" : "unarchive"}
                    label={detail.data.document.status === "Active" ? "Archive" : "Restore"}
                    onPress={() => setSheet("archive")}
                  />
                </>
              ) : null}
            </>
          ) : null}
        </ScrollView>
        {detail.data && sheet === "version" ? (
          <VersionSheet
            documentId={documentId}
            projectId={detail.data.document.projectId}
            category={detail.data.document.category as DocumentCategory}
            title={detail.data.document.title}
            onClose={() => setSheet(null)}
            onDone={() => {
              setSheet(null);
              void refresh();
            }}
          />
        ) : null}
        {detail.data && sheet === "edit" ? (
          <EditSheet
            document={detail.data.document}
            onClose={() => setSheet(null)}
            onDone={() => {
              setSheet(null);
              void refresh();
            }}
          />
        ) : null}
        {detail.data && sheet === "archive" ? (
          <ArchiveSheet
            documentId={documentId}
            archived={detail.data.document.status === "Archived"}
            onClose={() => setSheet(null)}
            onDone={() => {
              setSheet(null);
              void refresh();
            }}
          />
        ) : null}
      </Screen>
    </AuthGate>
  );
}

function VersionSheet(props: {
  documentId: string;
  projectId: string;
  category: DocumentCategory;
  title: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const upload = trpc.jp.documents.upload.useMutation();
  const [file, setFile] = useState<{ name: string; base64: string } | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [mutationId] = useState(createClientMutationId);

  const pick = async () => {
    setError(null);
    try {
      const result = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true });
      if (result.canceled || !result.assets[0]) return;
      const asset = result.assets[0];
      if (asset.size && asset.size > MAX_DOCUMENT_BYTES)
        throw new Error("This file is larger than 15 MB.");
      setFile({ name: asset.name, base64: await readBase64(asset.uri) });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The file could not be read.");
    }
  };

  return (
    <Sheet
      visible
      title="New version"
      subtitle="Earlier versions are kept."
      onClose={props.onClose}
    >
      <SecondaryButton
        icon="attach-file"
        label={file ? `Chosen: ${file.name}` : "Choose the new file"}
        onPress={() => void pick()}
      />
      <Field
        label="What changed (optional)"
        value={note}
        onChangeText={setNote}
        placeholder="e.g. Revised as per site instruction 12"
        maxLength={500}
      />
      {error ? <InlineError message={error} /> : null}
      <PrimaryButton
        icon="cloud-upload"
        label={upload.isPending ? "Uploading…" : "Upload version"}
        disabled={!file || upload.isPending}
        onPress={() =>
          void upload
            .mutateAsync({
              projectId: props.projectId,
              documentId: props.documentId,
              category: props.category,
              title: props.title,
              note: note.trim() || undefined,
              fileName: file!.name,
              base64: file!.base64,
              clientMutationId: mutationId,
            })
            .then(props.onDone)
            .catch((cause: unknown) =>
              setError(cause instanceof Error ? cause.message : "The upload was not confirmed."),
            )
        }
      />
    </Sheet>
  );
}

function EditSheet({
  document,
  onClose,
  onDone,
}: {
  document: {
    id: string;
    title: string;
    category: string;
    description: string | null;
    tags: string | null;
  };
  onClose: () => void;
  onDone: () => void;
}) {
  const update = trpc.jp.documents.update.useMutation();
  const [title, setTitle] = useState(document.title);
  const [category, setCategory] = useState<DocumentCategory>(
    (DOCUMENT_CATEGORIES as readonly string[]).includes(document.category)
      ? (document.category as DocumentCategory)
      : "Other project documents",
  );
  const [tags, setTags] = useState(document.tags ?? "");
  const [description, setDescription] = useState(document.description ?? "");
  const [error, setError] = useState<string | null>(null);
  return (
    <Sheet visible title="Edit details" onClose={onClose}>
      <Field label="Title" value={title} onChangeText={setTitle} maxLength={200} />
      <ChipGroup
        label="Category"
        options={DOCUMENT_CATEGORIES}
        value={category}
        onChange={setCategory}
      />
      <Field label="Tags" value={tags} onChangeText={setTags} maxLength={500} />
      <Field
        label="Description"
        value={description}
        onChangeText={setDescription}
        multiline
        maxLength={4000}
      />
      {error ? <InlineError message={error} /> : null}
      <PrimaryButton
        icon="save"
        label={update.isPending ? "Saving…" : "Save"}
        disabled={update.isPending || title.trim().length < 2}
        onPress={() =>
          void update
            .mutateAsync({
              documentId: document.id,
              title: title.trim(),
              category,
              tags: tags.trim() || undefined,
              description: description.trim() || undefined,
            })
            .then(onDone)
            .catch((cause: unknown) =>
              setError(cause instanceof Error ? cause.message : "Not saved."),
            )
        }
      />
    </Sheet>
  );
}

function ArchiveSheet(props: {
  documentId: string;
  archived: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const setStatus = trpc.jp.documents.setStatus.useMutation();
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  return (
    <Sheet
      visible
      title={props.archived ? "Restore document" : "Archive document"}
      subtitle={
        props.archived
          ? "It will show in lists and search again."
          : "It is hidden from lists and search. Files and history are kept."
      }
      onClose={props.onClose}
    >
      <Field label="Reason" value={reason} onChangeText={setReason} maxLength={500} />
      {error ? <InlineError message={error} /> : null}
      <PrimaryButton
        icon={props.archived ? "unarchive" : "archive"}
        label={props.archived ? "Restore" : "Archive"}
        disabled={setStatus.isPending || reason.trim().length < 3}
        onPress={() =>
          void setStatus
            .mutateAsync({
              documentId: props.documentId,
              status: props.archived ? "Active" : "Archived",
              reason: reason.trim(),
            })
            .then(props.onDone)
            .catch((cause: unknown) =>
              setError(cause instanceof Error ? cause.message : "Not changed."),
            )
        }
      />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  content: { paddingBottom: 40, gap: 12 },
  body: { fontSize: 14, lineHeight: 20 },
  label: { fontSize: 15, fontWeight: "800" },
  meta: { fontSize: 12, lineHeight: 17, marginTop: 4 },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 },
});
