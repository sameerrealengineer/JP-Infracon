import { eq } from "drizzle-orm";
import { organizationSettings } from "../../drizzle/schema";
import { getDb } from "../db";
import { parseDisabledModules, type ModuleKey } from "../../lib/jp/modules";

/**
 * Which modules each company has turned off, cached briefly so every permission check does not
 * read the database. A change clears the company's entry at once on this server.
 */
const cache = new Map<string, { at: number; disabled: ModuleKey[] }>();
const TTL_MS = 30_000;

export async function disabledModulesFor(organizationId: string): Promise<ModuleKey[]> {
  const hit = cache.get(organizationId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.disabled;
  const db = await getDb();
  if (!db) return [];
  let disabled: ModuleKey[] = [];
  try {
    const [row] = await db
      .select({ disabledModules: organizationSettings.disabledModules })
      .from(organizationSettings)
      .where(eq(organizationSettings.organizationId, organizationId))
      .limit(1);
    disabled = parseDisabledModules(row?.disabledModules);
  } catch {
    // Before the settings table exists every module stays on.
    disabled = [];
  }
  cache.set(organizationId, { at: Date.now(), disabled });
  return disabled;
}

export function forgetModuleSettings(organizationId: string) {
  cache.delete(organizationId);
}
