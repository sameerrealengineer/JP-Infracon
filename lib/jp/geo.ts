/** Distance and site-boundary helpers for GPS photos and arrival/departure alerts. */

export type LatLng = { latitude: number; longitude: number };

/** Great-circle distance in metres (haversine). */
export function distanceMeters(a: LatLng, b: LatLng): number {
  const R = 6_371_000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.min(1, Math.sqrt(h))));
}

export function isValidLatLng(value: Partial<LatLng> | null | undefined): value is LatLng {
  return Boolean(
    value &&
    typeof value.latitude === "number" &&
    typeof value.longitude === "number" &&
    Math.abs(value.latitude) <= 90 &&
    Math.abs(value.longitude) <= 180 &&
    !(value.latitude === 0 && value.longitude === 0),
  );
}

/**
 * Whether a reported position agrees with an arrival/departure, allowing for GPS error.
 * Arrivals must be within radius + accuracy (+50 m slack); departures beyond radius − accuracy.
 */
export function presencePlausible(
  eventType: "Arrived" | "Left",
  distance: number,
  radius: number,
  accuracy: number | null,
): boolean {
  const slack = Math.min(accuracy ?? 50, 200) + 50;
  return eventType === "Arrived" ? distance <= radius + slack : distance >= radius - slack;
}

export function describeDistance(distance: number | null, radius: number | null): string {
  if (distance === null) return "Location recorded";
  if (radius !== null && distance <= radius) return "Taken on site";
  return distance >= 1000
    ? `${(distance / 1000).toFixed(1)} km from site`
    : `${distance} m from site`;
}

export function mapsLink(point: LatLng): string {
  return `https://maps.google.com/?q=${point.latitude.toFixed(6)},${point.longitude.toFixed(6)}`;
}
