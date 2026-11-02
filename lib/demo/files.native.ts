import { Directory, File, Paths } from "expo-file-system";

/** Demo evidence files are kept in the app's private storage on the phone. */
function fileFor(key: string): File {
  const directory = new Directory(Paths.document, "demo-files");
  if (!directory.exists) directory.create({ intermediates: true });
  return new File(directory, key.replace(/[^a-zA-Z0-9._-]/g, "_"));
}

export async function saveDemoFile(
  key: string,
  bytes: Uint8Array,
  _contentType: string,
): Promise<string> {
  const file = fileFor(key);
  if (file.exists) file.delete();
  file.create();
  file.write(bytes);
  return key;
}

/** A `file://` link; the attachment strip opens it with the phone's viewer. */
export async function demoFileUrl(key: string): Promise<string> {
  const file = fileFor(key);
  if (!file.exists) throw new Error("File not found.");
  return file.uri;
}
