import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import * as DocumentPicker from "expo-document-picker";
import { File as FsFile } from "expo-file-system";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";
import * as WebBrowser from "expo-web-browser";
import { useState } from "react";
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { InlineError, SecondaryButton, formatDateTime } from "@/components/jp/ui";
import { useColors } from "@/hooks/use-colors";
import {
  MAX_ATTACHMENT_BYTES,
  formatBytes,
  type AttachmentEntityType,
} from "@/lib/jp/attachment-policy";
import { createClientMutationId } from "@/lib/jp/local-repository";
import { trpc } from "@/lib/trpc";

async function readBase64(uri: string): Promise<string> {
  if (Platform.OS === "web") {
    const buffer = new Uint8Array(await (await fetch(uri)).arrayBuffer());
    let binary = "";
    for (let index = 0; index < buffer.length; index += 0x8000)
      binary += String.fromCharCode(...buffer.subarray(index, index + 0x8000));
    return btoa(binary);
  }
  return new FsFile(uri).base64();
}

/** Shrinks a photo to a sharp but light JPEG (about 1600 px wide) before upload. */
async function compressPhoto(uri: string): Promise<string> {
  const rendered = await ImageManipulator.manipulate(uri).resize({ width: 1600 }).renderAsync();
  const saved = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: 0.72, base64: true });
  return saved.base64 ?? readBase64(saved.uri);
}

/**
 * Private evidence for one record: list, open (signed link after a fresh permission check) and add.
 * Files are only kept once the server confirms the upload.
 */
export function AttachmentStrip({
  entityType,
  entityId,
  canUpload,
  title = "Photos & documents",
}: {
  entityType: AttachmentEntityType;
  entityId: string;
  canUpload: boolean;
  title?: string;
}) {
  const colors = useColors();
  const utils = trpc.useUtils();
  const files = trpc.jp.attachments.list.useQuery({ entityType, entityId });
  const upload = trpc.jp.attachments.upload.useMutation();
  const open = trpc.jp.attachments.open.useMutation();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const send = async (
    base64: string,
    fileName: string,
    sourceType: "Captured in app" | "Selected from device",
  ) => {
    if ((base64.length * 3) / 4 > MAX_ATTACHMENT_BYTES)
      throw new Error("This file is larger than 8 MB.");
    await upload.mutateAsync({
      entityType,
      entityId,
      fileName,
      base64,
      sourceType,
      captureTime: sourceType === "Captured in app" ? new Date() : undefined,
      clientMutationId: createClientMutationId(),
    });
    await utils.jp.attachments.list.invalidate({ entityType, entityId });
  };

  const run = async (label: string, task: () => Promise<void>) => {
    setError(null);
    setBusy(label);
    try {
      await task();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The file could not be added.");
    } finally {
      setBusy(null);
    }
  };

  const takePhoto = () =>
    run("camera", async () => {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) throw new Error("Camera permission was not given.");
      const result = await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 0.9 });
      if (result.canceled || !result.assets[0]) return;
      const base64 = await compressPhoto(result.assets[0].uri);
      await send(base64, `photo-${Date.now()}.jpg`, "Captured in app");
    });

  const pickPhoto = () =>
    run("gallery", async () => {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        quality: 0.9,
      });
      if (result.canceled || !result.assets[0]) return;
      const asset = result.assets[0];
      const base64 = await compressPhoto(asset.uri);
      await send(base64, asset.fileName ?? `photo-${Date.now()}.jpg`, "Selected from device");
    });

  const pickPdf = () =>
    run("pdf", async () => {
      const result = await DocumentPicker.getDocumentAsync({
        type: "application/pdf",
        copyToCacheDirectory: true,
      });
      if (result.canceled || !result.assets[0]) return;
      const asset = result.assets[0];
      if (asset.size && asset.size > MAX_ATTACHMENT_BYTES)
        throw new Error("This file is larger than 8 MB.");
      await send(await readBase64(asset.uri), asset.name, "Selected from device");
    });

  const view = (id: string) =>
    run(`open-${id}`, async () => {
      const { url } = await open.mutateAsync({ attachmentId: id });
      await WebBrowser.openBrowserAsync(url);
    });

  const rows = files.data ?? [];
  return (
    <View style={styles.wrap}>
      <View style={styles.header}>
        <MaterialIcons name="photo-library" size={18} color={colors.accent} />
        <Text style={[styles.title, { color: colors.foreground }]}>{title}</Text>
        <Text style={[styles.count, { color: colors.muted }]}>
          {files.data ? `${rows.length}` : ""}
        </Text>
      </View>
      {error ? <InlineError message={error} title="Not attached" /> : null}
      {files.error ? <InlineError message={files.error.message} /> : null}
      {rows.length === 0 && files.isSuccess ? (
        <Text style={[styles.empty, { color: colors.muted }]}>No files attached yet.</Text>
      ) : null}
      {rows.map((file) => (
        <Pressable
          key={file.id}
          accessibilityRole="button"
          accessibilityLabel={`Open ${file.originalFilename}`}
          onPress={() => void view(file.id)}
          style={({ pressed }) => [
            styles.file,
            { borderColor: colors.border, backgroundColor: colors.background },
            pressed && { opacity: 0.7 },
          ]}
        >
          <MaterialIcons
            name={file.contentType === "application/pdf" ? "picture-as-pdf" : "image"}
            size={22}
            color={file.contentType === "application/pdf" ? colors.error : colors.primary}
          />
          <View style={{ flex: 1 }}>
            <Text style={[styles.fileName, { color: colors.foreground }]} numberOfLines={1}>
              {file.originalFilename}
            </Text>
            <Text style={[styles.fileMeta, { color: colors.muted }]}>
              {formatBytes(file.sizeBytes)} · {file.uploadedByName ?? "Unknown"} ·{" "}
              {formatDateTime(file.uploadedAt)}
            </Text>
          </View>
          {busy === `open-${file.id}` ? (
            <ActivityIndicator size="small" color={colors.primary} />
          ) : (
            <MaterialIcons name="open-in-new" size={18} color={colors.muted} />
          )}
        </Pressable>
      ))}
      {canUpload ? (
        <View style={styles.actions}>
          {Platform.OS !== "web" ? (
            <View style={{ flex: 1 }}>
              <SecondaryButton
                icon="photo-camera"
                label={busy === "camera" ? "Uploading…" : "Camera"}
                disabled={Boolean(busy)}
                onPress={() => void takePhoto()}
              />
            </View>
          ) : null}
          <View style={{ flex: 1 }}>
            <SecondaryButton
              icon="collections"
              label={busy === "gallery" ? "Uploading…" : "Photo"}
              disabled={Boolean(busy)}
              onPress={() => void pickPhoto()}
            />
          </View>
          <View style={{ flex: 1 }}>
            <SecondaryButton
              icon="picture-as-pdf"
              label={busy === "pdf" ? "Uploading…" : "PDF"}
              disabled={Boolean(busy)}
              onPress={() => void pickPdf()}
            />
          </View>
        </View>
      ) : null}
      <Text style={[styles.note, { color: colors.muted }]}>
        Private to people with access to this record. Files cannot be replaced once added.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 8 },
  header: { flexDirection: "row", alignItems: "center", gap: 7 },
  title: { fontSize: 14, fontWeight: "800", flex: 1 },
  count: { fontSize: 12, fontWeight: "700" },
  empty: { fontSize: 12 },
  file: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: 1,
    borderRadius: 14,
    padding: 10,
  },
  fileName: { fontSize: 13, fontWeight: "700" },
  fileMeta: { fontSize: 11, marginTop: 2 },
  actions: { flexDirection: "row", gap: 8, marginTop: 4 },
  note: { fontSize: 10, lineHeight: 14 },
});
