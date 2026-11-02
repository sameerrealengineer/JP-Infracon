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
