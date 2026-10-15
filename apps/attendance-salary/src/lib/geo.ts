// Distances on the earth and reading a pasted point. Pure functions (used by the server and the settings screen).

/** Mean earth radius in metres (haversine). */
export const EARTH_RADIUS_M = 6_371_000;

const rad = (deg: number) => (deg * Math.PI) / 180;

/** Great-circle distance in metres between two points (haversine). */
export function distanceM(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

export const validLatLng = (lat: number, lng: number) => Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;

/**
 * "21.347, 83.627" as copied from Google Maps (also "21.347,83.627", "21.347 83.627" or a Maps link with
 * "@21.347,83.627,17z"). Returns null for anything else or out of range.
 */
export function parseLatLng(text: string): { lat: number; lng: number } | null {
  const s = text.trim();
  const m = /@(-?\d{1,3}(?:\.\d+)?),\s*(-?\d{1,3}(?:\.\d+)?)/.exec(s) ?? /^\(?\s*(-?\d{1,3}(?:\.\d+)?)\s*[,\s]\s*(-?\d{1,3}(?:\.\d+)?)\s*\)?$/.exec(s);
  if (!m) return null;
  const lat = Number(m[1]);
  const lng = Number(m[2]);
  return validLatLng(lat, lng) ? { lat, lng } : null;
}

/** "40 m", "1.4 km" */
export function fmtDistance(m: number) {
  if (m < 1000) return `${Math.round(m)} m`;
  return `${(m / 1000).toFixed(m < 10_000 ? 1 : 0)} km`;
}
