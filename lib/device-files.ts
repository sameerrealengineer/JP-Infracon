import { File as FsFile, Paths } from "expo-file-system";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import * as Sharing from "expo-sharing";
import { Platform } from "react-native";

/** Reads a local file (camera, picker, recorder) as base64 on phone and web. */
export async function readBase64(uri: string): Promise<string> {
  if (Platform.OS === "web") {
    const buffer = new Uint8Array(await (await fetch(uri)).arrayBuffer());
    let binary = "";
    for (let index = 0; index < buffer.length; index += 0x8000)
      binary += String.fromCharCode(...buffer.subarray(index, index + 0x8000));
    return btoa(binary);
  }
  return new FsFile(uri).base64();
}

/**
 * A voice recording ready to send: base64 plus its real type. Phones record AAC in MP4; in a
 * browser Safari records MP4 and Chrome records WebM, so the type is read from the file.
 */
export async function readRecording(
  uri: string,
): Promise<{ audioBase64: string; mimeType: string }> {
  if (Platform.OS === "web") {
    const blob = await (await fetch(uri)).blob();
    const buffer = new Uint8Array(await blob.arrayBuffer());
    let binary = "";
    for (let index = 0; index < buffer.length; index += 0x8000)
      binary += String.fromCharCode(...buffer.subarray(index, index + 0x8000));
    // "audio/webm;codecs=opus" → "audio/webm"; a video/* container from Safari is still audio.
    const type = (blob.type.split(";")[0] || "audio/mp4").replace(/^video\//, "audio/");
    return {
      audioBase64: btoa(binary),
      mimeType: /^audio\/[\w.+-]+$/.test(type) ? type : "audio/mp4",
    };
  }
  return { audioBase64: await new FsFile(uri).base64(), mimeType: "audio/mp4" };
}

/** Shrinks a photo to a sharp but light JPEG before upload. */
export async function compressPhoto(uri: string, width = 1600): Promise<string> {
  const rendered = await ImageManipulator.manipulate(uri).resize({ width }).renderAsync();
  const saved = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: 0.72, base64: true });
  return saved.base64 ?? readBase64(saved.uri);
}

/** Saves text as a file and opens the share sheet (or downloads it on web). */
export async function deliverTextFile(fileName: string, content: string, mimeType: string) {
  if (Platform.OS === "web") {
    const url = URL.createObjectURL(new Blob([content], { type: `${mimeType};charset=utf-8` }));
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    return;
  }
  const file = new FsFile(Paths.cache, fileName);
  if (file.exists) file.delete();
  file.create();
  file.write(content);
  if (await Sharing.isAvailableAsync())
    await Sharing.shareAsync(file.uri, { mimeType, dialogTitle: fileName });
}

/** Saves base64 audio (an assistant reply) to a cache file and returns a playable address. */
export function audioFileFromBase64(base64: string, mimeType: string): string {
  if (Platform.OS === "web") return `data:${mimeType};base64,${base64}`;
  const binary = globalThis.atob
    ? globalThis.atob(base64)
    : Buffer.from(base64, "base64").toString("binary");
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  const file = new FsFile(Paths.cache, `assistant-${Date.now()}.mp3`);
  file.create();
  file.write(bytes);
  return file.uri;
}
