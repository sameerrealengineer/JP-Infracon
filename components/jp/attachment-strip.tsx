import { useT } from "@/lib/i18n";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import * as DocumentPicker from "expo-document-picker";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import * as Sharing from "expo-sharing";
import * as WebBrowser from "expo-web-browser";
import { useState } from "react";
import {
  ActivityIndicator,
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { InlineError, SecondaryButton, formatDateTime } from "@/components/jp/ui";
import { useColors } from "@/hooks/use-colors";
import {
  MAX_ATTACHMENT_BYTES,
  MAX_VIDEO_BYTES,
  formatBytes,
  type AttachmentEntityType,
} from "@/lib/jp/attachment-policy";
import { createClientMutationId } from "@/lib/jp/local-repository";
import { trpc } from "@/lib/trpc";
import { compressPhoto, readBase64 } from "@/lib/device-files";
import { currentPosition } from "@/lib/geofence-task";
import { describeDistance, mapsLink } from "@/lib/jp/geo";

/**
 * Private evidence for one record: list, open (signed link after a fresh permission check) and add.
 * Files are only kept once the server confirms the upload.
 */
export function AttachmentStrip({
  entityType,
  entityId,
  canUpload,
  title = "Photos & documents",
  allowVideo = false,
  cover,
  onUploaded,
  noUploadReason,
}: {
  entityType: AttachmentEntityType;
  entityId: string;
  canUpload: boolean;
  title?: string;
  /** Show a Video button (site walk-throughs, work in progress). */
  allowVideo?: boolean;
  /** Lets a manager pick one of the photos as the cover. */
  cover?: { currentId: string | null; onSet: (attachmentId: string) => Promise<void> };
  /** Called after the server keeps each file (isImage: a photo, not a video or PDF). */
  onUploaded?: (attachmentId: string, isImage: boolean) => Promise<void> | void;
  /** Shown instead of the add buttons when this person cannot add files here. */
  noUploadReason?: string;
}) {
  const { t } = useT();
  const colors = useColors();
  const utils = trpc.useUtils();
  const files = trpc.jp.attachments.list.useQuery({ entityType, entityId });
  const upload = trpc.jp.attachments.upload.useMutation();
  const open = trpc.jp.attachments.open.useMutation();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  const send = async (
    base64: string,
    fileName: string,
    sourceType: "Captured in app" | "Selected from device",
    location?: { latitude: number; longitude: number; accuracyM?: number } | null,
    maxBytes = MAX_ATTACHMENT_BYTES,
  ) => {
    if ((base64.length * 3) / 4 > maxBytes)
      throw new Error(
        maxBytes === MAX_VIDEO_BYTES
          ? "This video is larger than 30 MB. Record a shorter clip."
          : "This file is larger than 8 MB.",
      );
    const saved = await upload.mutateAsync({
      entityType,
      entityId,
      fileName,
      base64,
      sourceType,
      captureTime: sourceType === "Captured in app" ? new Date() : undefined,
      location: location ?? undefined,
      clientMutationId: createClientMutationId(),
    });
    await utils.jp.attachments.list.invalidate({ entityType, entityId });
    await onUploaded?.(saved.id, /\.(jpe?g|png|webp)$/i.test(fileName));
  };

  const run = async (label: string, task: () => Promise<void>) => {
    setError(null);
    setBusy(label);
    try {
      await task();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The file could not be added.");
    } finally {
      setProgress(null);
      setBusy(null);
    }
  };

  const takePhoto = () =>
    run("camera", async () => {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) throw new Error("Camera permission was not given.");
      const result = await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 0.9 });
      if (result.canceled || !result.assets[0]) return;
      // GPS camera: the photo carries where it was taken (if location is allowed).
      const [base64, location] = await Promise.all([
        compressPhoto(result.assets[0].uri),
        currentPosition(),
      ]);
      await send(base64, `photo-${Date.now()}.jpg`, "Captured in app", location);
    });

  // Several photos at once (up to 10); each is sent on its own so one failure keeps the rest.
  const pickPhoto = () =>
    run("gallery", async () => {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        quality: 0.9,
        allowsMultipleSelection: true,
        selectionLimit: 10,
      });
      if (result.canceled || !result.assets.length) return;
      const failed: string[] = [];
      for (const [index, asset] of result.assets.entries()) {
        setProgress({ done: index, total: result.assets.length });
        const name = asset.fileName ?? `photo-${Date.now()}-${index + 1}.jpg`;
        try {
          await send(await compressPhoto(asset.uri), name, "Selected from device");
        } catch (cause) {
          failed.push(`${name}: ${cause instanceof Error ? cause.message : "not added"}`);
        }
      }
      setProgress(null);
      if (failed.length)
        throw new Error(
          `${result.assets.length - failed.length} of ${result.assets.length} added. ${failed.join(" ")}`,
        );
    });

  const pickVideo = (fromCamera: boolean) =>
    run("video", async () => {
      if (fromCamera) {
        const permission = await ImagePicker.requestCameraPermissionsAsync();
        if (!permission.granted) throw new Error("Camera permission was not given.");
      }
      const options: ImagePicker.ImagePickerOptions = {
        mediaTypes: ["videos"],
        videoMaxDuration: 60,
        videoQuality: ImagePicker.UIImagePickerControllerQualityType.Medium,
      };
      const result = fromCamera
        ? await ImagePicker.launchCameraAsync(options)
        : await ImagePicker.launchImageLibraryAsync(options);
      if (result.canceled || !result.assets[0]) return;
      const asset = result.assets[0];
      if (asset.fileSize && asset.fileSize > MAX_VIDEO_BYTES)
        throw new Error("This video is larger than 30 MB. Record a shorter clip.");
      const location = fromCamera ? await currentPosition() : null;
      await send(
        await readBase64(asset.uri),
        asset.fileName ?? `video-${Date.now()}.mp4`,
        fromCamera ? "Captured in app" : "Selected from device",
        location,
        MAX_VIDEO_BYTES,
      );
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
      const { url, contentType } = await open.mutateAsync({ attachmentId: id });
      // The offline demo keeps files on the phone; open those with the phone's own viewer.
      if (url.startsWith("file:")) await Sharing.shareAsync(url, { mimeType: contentType });
      else await WebBrowser.openBrowserAsync(url);
    });

  const all = files.data ?? [];
  const photos = all.filter((file) => file.previewUrl);
  const rows = all.filter((file) => !file.previewUrl);
  return (
    <View style={styles.wrap}>
      <View style={styles.header}>
        <MaterialIcons name="photo-library" size={18} color={colors.accent} />
        <Text style={[styles.title, { color: colors.foreground }]}>{t(title)}</Text>
        <Text style={[styles.count, { color: colors.muted }]}>
          {files.data ? `${all.length}` : ""}
        </Text>
      </View>
      {error ? <InlineError message={error} title="Not attached" /> : null}
      {files.error ? <InlineError message={files.error.message} /> : null}
      {photos.length ? (
        <View style={styles.grid}>
          {photos.map((file) => (
            <View key={file.id} style={styles.thumbWrap}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Open ${file.originalFilename}`}
                onPress={() => void view(file.id)}
                style={({ pressed }) => [pressed && { opacity: 0.75 }]}
              >
                <Image
                  source={{ uri: file.previewUrl! }}
                  style={[styles.thumb, { backgroundColor: colors.border }]}
                  contentFit="cover"
                  cachePolicy="memory-disk"
                  transition={120}
                />
                {cover?.currentId === file.id ? (
                  <View style={[styles.coverBadge, { backgroundColor: colors.accent }]}>
                    <Text style={styles.coverBadgeText}>COVER</Text>
                  </View>
                ) : null}
              </Pressable>
              {cover && cover.currentId !== file.id ? (
                <Text
                  accessibilityRole="button"
                  onPress={() => void run(`cover-${file.id}`, () => cover.onSet(file.id))}
                  style={[styles.coverLink, { color: colors.primary }]}
                >
                  {busy === `cover-${file.id}` ? "Saving…" : t("Set as cover")}
                </Text>
              ) : null}
            </View>
          ))}
        </View>
      ) : null}
      {all.length === 0 && files.isSuccess ? (
        <Text style={[styles.empty, { color: colors.muted }]}>{t("No files attached yet.")}</Text>
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
            name={
              file.contentType === "application/pdf"
                ? "picture-as-pdf"
                : file.contentType.startsWith("video/")
                  ? "movie"
                  : "image"
            }
            size={22}
            color={
              file.contentType === "application/pdf"
                ? colors.error
                : file.contentType.startsWith("video/")
                  ? colors.accent
                  : colors.primary
            }
          />
          <View style={{ flex: 1 }}>
            <Text style={[styles.fileName, { color: colors.foreground }]} numberOfLines={1}>
              {file.originalFilename}
            </Text>
            <Text style={[styles.fileMeta, { color: colors.muted }]}>
              {formatBytes(file.sizeBytes)} · {file.uploadedByName ?? "Unknown"} ·{" "}
              {formatDateTime(file.uploadedAt)}
            </Text>
            {file.location ? (
              <Text
                accessibilityRole="link"
                onPress={() => void Linking.openURL(mapsLink(file.location!))}
                style={[
                  styles.fileMeta,
                  {
                    color:
                      file.location.siteRadiusM !== null &&
                      file.location.distanceFromSiteM !== null &&
                      file.location.distanceFromSiteM > file.location.siteRadiusM
                        ? colors.warning
                        : colors.success,
                  },
                ]}
              >
                📍 {describeDistance(file.location.distanceFromSiteM, file.location.siteRadiusM)}
                {file.location.accuracyM ? ` (±${file.location.accuracyM} m)` : ""}
              </Text>
            ) : null}
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
                label={busy === "camera" ? "Uploading…" : t("Camera")}
                disabled={Boolean(busy)}
                onPress={() => void takePhoto()}
              />
            </View>
          ) : null}
          <View style={{ flex: 1 }}>
            <SecondaryButton
              icon="collections"
              label={
                busy !== "gallery"
                  ? t("Photos")
                  : progress && progress.total > 1
                    ? t("Uploading {done} of {total}…", {
                        done: String(progress.done + 1),
                        total: String(progress.total),
                      })
                    : t("Uploading…")
              }
              disabled={Boolean(busy)}
              onPress={() => void pickPhoto()}
            />
          </View>
          <View style={{ flex: 1 }}>
            <SecondaryButton
              icon="picture-as-pdf"
              label={busy === "pdf" ? "Uploading…" : t("PDF")}
              disabled={Boolean(busy)}
              onPress={() => void pickPdf()}
            />
          </View>
        </View>
      ) : noUploadReason ? (
        <Text style={[styles.empty, { color: colors.muted }]}>{noUploadReason}</Text>
      ) : null}
      {canUpload && allowVideo ? (
        <View style={styles.actions}>
          {Platform.OS !== "web" ? (
            <View style={{ flex: 1 }}>
              <SecondaryButton
                icon="videocam"
                label={busy === "video" ? "Uploading…" : t("Record video")}
                disabled={Boolean(busy)}
                onPress={() => void pickVideo(true)}
              />
            </View>
          ) : null}
          <View style={{ flex: 1 }}>
            <SecondaryButton
              icon="video-library"
              label={busy === "video" ? "Uploading…" : t("Video")}
              disabled={Boolean(busy)}
              onPress={() => void pickVideo(false)}
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
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  thumbWrap: { width: "31%", gap: 4 },
  thumb: { width: "100%", aspectRatio: 1, borderRadius: 12 },
  coverBadge: {
    position: "absolute",
    top: 6,
    left: 6,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  coverBadgeText: { color: "#0E1A26", fontSize: 9, fontWeight: "900", letterSpacing: 0.6 },
  coverLink: { fontSize: 11, fontWeight: "800", textAlign: "center" },
  note: { fontSize: 10, lineHeight: 14 },
});
