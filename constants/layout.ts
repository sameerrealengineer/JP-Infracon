/**
 * Widths that keep the app readable on every device. Phones use the full width; tablets and
 * computers (web app) show the same one-handed column centred, so rows, forms and sheets never
 * stretch across a wide screen.
 */
export const CONTENT_MAX_WIDTH = 760;

/** Spread into a sheet or card style so it stays a centred column on wide screens. */
export const centeredColumn = {
  width: "100%",
  maxWidth: CONTENT_MAX_WIDTH,
  alignSelf: "center",
} as const;
