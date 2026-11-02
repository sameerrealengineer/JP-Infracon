/**
 * Pure helpers for screen selections that must stay valid as server data changes
 * (a chosen site, section, or role, and the current page of a paged list).
 * Screens derive the effective value with these during render instead of
 * correcting state inside an effect.
 */

/** Keeps the chosen id while it is still offered, else falls back to the first option ("" when none). */
export function resolveSelectedId(
  options: readonly { id: string }[],
  chosenId: string | null | undefined,
): string {
  if (chosenId && options.some((option) => option.id === chosenId)) return chosenId;
  return options[0]?.id ?? "";
}

/** Keeps the chosen value while it is still offered, else falls back to the first option, or keeps the choice when nothing is offered. */
export function resolveChoice<T>(options: readonly T[], chosen: T): T {
  if (options.includes(chosen) || options.length === 0) return chosen;
  return options[0];
}

/** Largest valid zero based page index for `total` rows, never below 0. */
export function clampPageIndex(page: number, total: number, pageSize: number): number {
  const lastPage = Math.max(0, Math.ceil(total / pageSize) - 1);
  return Math.max(0, Math.min(page, lastPage));
}
