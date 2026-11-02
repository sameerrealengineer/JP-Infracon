/**
 * Builds the link that opens a module for one site.
 * Tab registers (reports, requests) stay mounted and keep their own choice, so a
 * site-scoped link opens their stack copy instead; Back then returns where it came from.
 */
const STACK_COPY: Record<string, string> = {
  "/(tabs)/reports": "/site-reports",
  "/(tabs)/requests": "/site-requests",
};

export function siteScopedRoute(route: string, siteId: string | null | undefined): string {
  if (!siteId || route.includes("?")) return route;
  const path = STACK_COPY[route] ?? route;
  return `${path}?siteId=${encodeURIComponent(siteId)}`;
}
