import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import * as DocumentPicker from "expo-document-picker";
import { useRouter } from "expo-router";
import { useState } from "react";
import { RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";

import { AuthGate } from "@/components/jp/auth-gate";
import {
  AppHeader,
  Card,
  ChipGroup,
  EmptyState,
  Fab,
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
import { useSiteParam } from "@/hooks/use-site-param";
import { readBase64 } from "@/lib/device-files";
import {
  DOCUMENT_CATEGORIES,
  MAX_DOCUMENT_BYTES,
  type DocumentCategory,
} from "@/lib/jp/document-policy";
import { createClientMutationId } from "@/lib/jp/local-repository";
import { resolveSelectedId } from "@/lib/jp/selection";
import { trpc } from "@/lib/trpc";

const ALL = "all";
const PROJECT_WIDE = "project";
const PICKER_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/csv",
  "text/comma-separated-values",
];

type Picked = { name: string; base64: string };

export default function DocumentsScreen() {
  const colors = useColors();
  const router = useRouter();
  const siteParam = useSiteParam();
  const options = trpc.jp.documents.options.useQuery();
  const projects = options.data?.projects ?? [];
  const [chosenProject, setProject] = useState<string | null>(null);
  const preferredProject =
    chosenProject ?? options.data?.sites.find((site) => site.id === siteParam)?.projectId ?? null;
  const projectId = resolveSelectedId(projects, preferredProject);
  const projectSites = (options.data?.sites ?? []).filter((site) => site.projectId === projectId);
  const [place, setPlace] = useState<string>(siteParam || ALL);
  const placeValue =
    place === ALL || place === PROJECT_WIDE || projectSites.some((site) => site.id === place)
      ? place
      : ALL;
  const [category, setCategory] = useState<string>(ALL);
  const [query, setQuery] = useState("");
  const [submitted, setSubmitted] = useState("");
  const [uploadOpen, setUploadOpen] = useState(false);

  const list = trpc.jp.documents.list.useQuery(
    {
      projectId: projectId || undefined,
      siteId: placeValue !== ALL && placeValue !== PROJECT_WIDE ? placeValue : undefined,
      category: category === ALL ? undefined : category,
      limit: 100,
    },
    { enabled: Boolean(projectId) },
  );
  const search = trpc.jp.documents.search.useQuery(
    { query: submitted, projectId: projectId || undefined },
    { enabled: submitted.length >= 2 },
  );
  const rows = (list.data ?? []).filter((row) => placeValue !== PROJECT_WIDE || !row.siteId);
  const canUpload = projectSites.some((site) => site.canUpload);

  return (
    <AuthGate>
      <Screen>
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          refreshControl={
            <RefreshControl
              refreshing={list.isRefetching}
              onRefresh={() => void list.refetch()}
              tintColor={colors.primary}
            />
          }
        >
          <AppHeader
            eyebrow="Records"
            title="Project documents"
            subtitle="Contracts, drawings, BOQs, bills, approvals and photos, with every version kept."
          />
          {options.error ? (
            <InlineError message={options.error.message} onRetry={() => void options.refetch()} />
          ) : null}
          {options.isLoading ? (
            <LoadingBlock label="Loading projects…" />
          ) : projects.length === 0 ? (
            <EmptyState
              icon="folder-off"
              title="No documents to show"
              detail="Your role cannot see project documents on any site yet."
            />
          ) : (
            <>
              <View
                style={[
                  styles.searchBox,
                  { backgroundColor: colors.surface, borderColor: colors.border },
                ]}
              >
                <MaterialIcons name="search" size={20} color={colors.muted} />
                <TextInput
                  value={query}
                  onChangeText={setQuery}
                  onSubmitEditing={() => setSubmitted(query.trim())}
                  returnKeyType="search"
                  placeholder="Find by meaning: “structural drawing for Block A”"
                  placeholderTextColor={colors.muted}
                  accessibilityLabel="Search documents"
                  style={[styles.searchInput, { color: colors.foreground }]}
                />
                {submitted ? (
                  <MaterialIcons
                    name="close"
                    size={20}
                    color={colors.muted}
                    accessibilityLabel="Clear search"
                    onPress={() => {
                      setQuery("");
                      setSubmitted("");
                    }}
                  />
                ) : null}
              </View>
              <SecondaryButton
                icon="manage-search"
                label="Search"
                disabled={query.trim().length < 2}
                onPress={() => setSubmitted(query.trim())}
              />

              {submitted ? (
                <>
                  <SectionHeader
                    title={`Results for “${submitted}”`}
                    caption={
                      search.data?.mode === "meaning"
                        ? "Matched by meaning and by exact words"
                        : "Matched by words (AI search is not set up or files are still being read)"
                    }
                  />
                  {search.isLoading ? <LoadingBlock label="Searching…" /> : null}
                  {search.error ? <InlineError message={search.error.message} /> : null}
                  {search.data && search.data.results.length === 0 ? (
                    <EmptyState
                      icon="search-off"
                      title="Nothing found"
                      detail="Try other words, a document number, or a supplier name."
                    />
                  ) : null}
                  {search.data?.results.map((row) => (
                    <DocumentCard
                      key={row.id}
                      row={row}
                      excerpt={row.excerpt}
                      onPress={() => router.push(`/document-detail?documentId=${row.id}` as never)}
                    />
                  ))}
                </>
              ) : (
                <>
                  {projects.length > 1 ? (
                    <ChipGroup
                      label="Project"
                      options={projects.map((row) => row.id)}
                      value={projectId}
                      onChange={setProject}
                      format={(id) => projects.find((row) => row.id === id)?.name ?? id}
                    />
                  ) : null}
                  <ChipGroup
                    label="Where"
                    options={[ALL, PROJECT_WIDE, ...projectSites.map((site) => site.id)]}
                    value={placeValue}
                    onChange={setPlace}
                    format={(id) =>
                      id === ALL
                        ? "Everything"
                        : id === PROJECT_WIDE
                          ? "Whole project"
                          : (projectSites.find((site) => site.id === id)?.name ?? id)
                    }
                  />
                  <ChipGroup
                    label="Category"
                    options={[ALL, ...DOCUMENT_CATEGORIES]}
                    value={category}
                    onChange={setCategory}
                    format={(value) => (value === ALL ? "All" : value)}
                  />
                  <SectionHeader title={`${rows.length} documents`} />
                  {list.isLoading ? <LoadingBlock label="Loading documents…" /> : null}
                  {list.error ? (
                    <InlineError message={list.error.message} onRetry={() => void list.refetch()} />
                  ) : null}
                  {list.data && rows.length === 0 ? (
                    <EmptyState
                      icon="folder-open"
                      title="No documents here yet"
                      detail={
                        canUpload
                          ? "Upload the contract, drawings, BOQ, bills or approvals for this project."
                          : "Nothing has been uploaded for this selection."
                      }
                    />
                  ) : null}
                  {rows.map((row) => (
                    <DocumentCard
                      key={row.id}
                      row={row}
                      onPress={() => router.push(`/document-detail?documentId=${row.id}` as never)}
                    />
                  ))}
                </>
              )}
            </>
          )}
        </ScrollView>
        {canUpload ? (
          <Fab icon="upload-file" label="Upload" onPress={() => setUploadOpen(true)} />
        ) : null}
        {uploadOpen && projectId ? (
          <UploadSheet
            projectId={projectId}
            sites={projectSites}
            initialPlace={placeValue === ALL ? PROJECT_WIDE : placeValue}
            onClose={() => setUploadOpen(false)}
            onDone={(documentId) => {
              setUploadOpen(false);
              void list.refetch();
              router.push(`/document-detail?documentId=${documentId}` as never);
            }}
          />
        ) : null}
      </Screen>
    </AuthGate>
  );
}

type Row = {
  id: string;
  title: string;
  category: string;
  projectName: string;
  siteName: string | null;
  currentVersion: number;
  aiDocumentType: string | null;
  indexStatus: string;
  updatedAt: Date;
};

function DocumentCard({
  row,
  excerpt,
  onPress,
}: {
  row: Row;
  excerpt?: string;
  onPress: () => void;
}) {
  const colors = useColors();
  return (
    <Card onPress={onPress} accessibilityLabel={`Open ${row.title}`}>
      <View style={styles.cardTop}>
        <Text style={[styles.cardTitle, { color: colors.foreground }]} numberOfLines={2}>
          {row.title}
        </Text>
        {row.currentVersion > 1 ? (
          <StatusPill label={`v${row.currentVersion}`} tone="info" compact />
        ) : null}
      </View>
      <Text style={[styles.cardMeta, { color: colors.muted }]}>
        {row.category} · {row.siteName ?? `${row.projectName} (whole project)`}
      </Text>
      {excerpt ? (
        <Text style={[styles.excerpt, { color: colors.foreground }]} numberOfLines={3}>
          {excerpt}
        </Text>
      ) : null}
      <Text style={[styles.cardMeta, { color: colors.muted }]}>
        {row.aiDocumentType ? `${row.aiDocumentType} · ` : ""}
        {row.indexStatus === "Pending" ? "Being read for search · " : ""}
        Updated {formatDateTime(row.updatedAt)}
      </Text>
    </Card>
  );
}

function UploadSheet({
  projectId,
  sites,
  initialPlace,
  onClose,
  onDone,
}: {
  projectId: string;
  sites: { id: string; name: string; canUpload: boolean }[];
  initialPlace: string;
  onClose: () => void;
  onDone: (documentId: string) => void;
}) {
  const colors = useColors();
  const upload = trpc.jp.documents.upload.useMutation();
  const uploadSites = sites.filter((site) => site.canUpload);
  const [place, setPlace] = useState(
    initialPlace === PROJECT_WIDE || uploadSites.some((site) => site.id === initialPlace)
      ? initialPlace
      : PROJECT_WIDE,
  );
  const [file, setFile] = useState<Picked | null>(null);
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<DocumentCategory | null>(null);
  const [tags, setTags] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [mutationId] = useState(createClientMutationId);

  const pick = async () => {
    setError(null);
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: PICKER_TYPES,
        copyToCacheDirectory: true,
      });
      if (result.canceled || !result.assets[0]) return;
      const asset = result.assets[0];
      if (asset.size && asset.size > MAX_DOCUMENT_BYTES)
        throw new Error("This file is larger than 15 MB.");
      setFile({ name: asset.name, base64: await readBase64(asset.uri) });
      if (!title.trim()) setTitle(asset.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " "));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The file could not be read.");
    }
  };

  const save = async () => {
    setError(null);
    if (!file || !category || title.trim().length < 2) {
      setError("Choose a file, a category and a title.");
      return;
    }
    try {
      const result = await upload.mutateAsync({
        projectId,
        siteId: place === PROJECT_WIDE ? null : place,
        category,
        title: title.trim(),
        tags: tags.trim() || undefined,
        description: description.trim() || undefined,
        fileName: file.name,
        base64: file.base64,
        clientMutationId: mutationId,
      });
      onDone(result.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The upload was not confirmed.");
    }
  };

  return (
    <Sheet visible title="Upload a document" onClose={onClose}>
      <SecondaryButton
        icon="attach-file"
        label={file ? `Chosen: ${file.name}` : "Choose file (PDF, photo, Word, Excel, CSV)"}
        onPress={() => void pick()}
      />
      <Field label="Title" value={title} onChangeText={setTitle} maxLength={200} />
      <ChipGroup
        label="Category"
        options={DOCUMENT_CATEGORIES}
        value={category}
        onChange={setCategory}
      />
      <ChipGroup
        label="Belongs to"
        options={[PROJECT_WIDE, ...uploadSites.map((site) => site.id)]}
        value={place}
        onChange={setPlace}
        format={(id) =>
          id === PROJECT_WIDE
            ? "Whole project"
            : (uploadSites.find((site) => site.id === id)?.name ?? id)
        }
      />
      <Field
        label="Tags (optional)"
        value={tags}
        onChangeText={setTags}
        placeholder="e.g. Block A, slab, revision 2"
        maxLength={500}
      />
      <Field
        label="Description (optional)"
        value={description}
        onChangeText={setDescription}
        multiline
        maxLength={4000}
      />
      <Text style={[styles.cardMeta, { color: colors.muted }]}>
        After upload, the file is read so it can be found by what is inside it. AI suggestions are
        shown for checking; they never change amounts or approvals.
      </Text>
      {error ? <InlineError message={error} /> : null}
      <PrimaryButton
        icon="cloud-upload"
        label={upload.isPending ? "Uploading…" : "Upload"}
        disabled={upload.isPending}
        onPress={() => void save()}
      />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  content: { paddingBottom: 120, gap: 12 },
  searchBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 12,
    minHeight: 50,
  },
  searchInput: { flex: 1, fontSize: 15, paddingVertical: 10 },
  cardTop: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 8,
  },
  cardTitle: { fontSize: 15, fontWeight: "800", flex: 1 },
  cardMeta: { fontSize: 12, lineHeight: 17, marginTop: 4 },
  excerpt: { fontSize: 13, lineHeight: 19, marginTop: 6 },
});
