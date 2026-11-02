import AsyncStorage from "@react-native-async-storage/async-storage";
import { getApiBaseUrl, setApiBaseUrlOverride } from "@/constants/api";

const KEY = "jp-infracon.server-address.v1";

/** Loads the saved server address before the first API call. */
export async function loadServerAddress(): Promise<void> {
  try {
    const saved = await AsyncStorage.getItem(KEY);
    if (saved) setApiBaseUrlOverride(saved);
  } catch {
    // Keep the built-in address.
  }
}

export function normalizeServerAddress(value: string): string | null {
  let text = value.trim();
  if (!text) return null;
  if (!/^https?:\/\//i.test(text)) text = `https://${text}`;
  try {
    const url = new URL(text);
    if (url.protocol !== "https:" && !/^(localhost|127\.|10\.|192\.168\.)/.test(url.hostname))
      return null;
    return `${url.protocol}//${url.host}`;
  } catch {
    return null;
  }
}

/** Checks the address answers /api/health before saving it. */
export async function saveServerAddress(value: string): Promise<string> {
  const address = normalizeServerAddress(value);
  if (!address) throw new Error("Enter a valid https:// server address.");
  const response = await fetch(`${address}/api/health`).catch(() => null);
  if (!response?.ok)
    throw new Error("That server did not answer. Check the address and your internet.");
  setApiBaseUrlOverride(address);
  await AsyncStorage.setItem(KEY, address);
  return address;
}

export function currentServerAddress(): string {
  return getApiBaseUrl() || "Not set";
}
