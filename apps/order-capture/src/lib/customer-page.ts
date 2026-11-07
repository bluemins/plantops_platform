// Pure date rules for the customer page (docs/CUSTOMER_PAGE_PHASE_PLAN.md Part 1): "billed, last 6 months" and the
// Statement's quick ranges. India dates as "YYYY-MM-DD".

/** "YYYY-MM-DD" moved by whole months (day kept, clamped to the month's end: 31 Aug − 6 months = 28/29 Feb). */
export function shiftMonths(ymd: string, months: number) {
  const [y, m, d] = ymd.split("-").map(Number) as [number, number, number];
  const first = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  return new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), Math.min(d, last))).toISOString().slice(0, 10);
}

/** The last day of the month that "YYYY-MM-DD" is in. */
export function monthEnd(ymd: string) {
  return new Date(Date.UTC(Number(ymd.slice(0, 4)), Number(ymd.slice(5, 7)), 0)).toISOString().slice(0, 10);
}

/** Statement quick ranges: this month, previous month, this quarter (Apr–Jun, Jul–Sep, Oct–Dec, Jan–Mar). */
export function quickRanges(today: string) {
  const [y, m] = today.split("-").map(Number) as [number, number];
  const mm = (n: number) => String(n).padStart(2, "0");
  const monthStart = `${y}-${mm(m)}-01`;
  const prevStart = shiftMonths(monthStart, -1);
  const qStart = `${y}-${mm(Math.floor((m - 1) / 3) * 3 + 1)}-01`;
  return [
    { label: "This month", from: monthStart, to: monthEnd(monthStart) },
    { label: "Previous month", from: prevStart, to: monthEnd(prevStart) },
    { label: "This quarter", from: qStart, to: monthEnd(shiftMonths(qStart, 2)) },
  ];
}

export const ACCOUNT_TABS = [
  ["overview", "Overview"],
  ["transactions", "Transactions"],
  ["orders", "Orders"],
  ["comments", "Comments"],
  ["statement", "Statement"],
] as const;
export type AccountTab = (typeof ACCOUNT_TABS)[number][0];

/** The tab from the address; the old Bills / Payments tabs (v0.39.0 links) open Transactions; nothing = Overview. */
export function pickTab(raw: string): AccountTab {
  if (raw === "bills" || raw === "payments") return "transactions";
  return ACCOUNT_TABS.find(([t]) => t === raw)?.[0] ?? "overview";
}

// ---------- Part 2: shop location and GST details ----------

/** Phone GPS rougher than this isn't saved as the shop's location (a wrong pin misleads every later delivery). */
export const MAX_ACCURACY_M = 150;

const inRange = (lat: number, lng: number) => Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0);
const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

/**
 * A position from what the owner pastes: "21.0234, 83.7841", or a full Google Maps link (…?q=21.02,83.78,
 * …/@21.02,83.78,17z, …!3d21.02!4d83.78, …?ll=…, …?query=…). null when there is none (e.g. a short
 * maps.app.goo.gl link: the server opens it first and reads the long one).
 */
export function parseMapPosition(text: string): { lat: number; lng: number } | null {
  const t = decodeURIComponent(text.trim().replace(/\+/g, " "));
  const pats = [
    /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/,
    /[?&](?:q|query|ll|destination|center)=(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/,
    /@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/,
    /^(-?\d{1,2}(?:\.\d+)?)\s*[, ]\s*(-?\d{1,3}(?:\.\d+)?)$/,
  ];
  for (const p of pats) {
    const m = t.match(p);
    if (m) {
      const lat = Number(m[1]);
      const lng = Number(m[2]);
      if (inRange(lat, lng)) return { lat: round6(lat), lng: round6(lng) };
    }
  }
  return null;
}

/** A Google short link the server may open to find the long one (only these hosts; nothing else is fetched). */
export function isShortMapLink(text: string) {
  try {
    const u = new URL(text.trim());
    return u.protocol === "https:" && ["maps.app.goo.gl", "goo.gl"].includes(u.hostname);
  } catch {
    return false;
  }
}

export const mapsLink = (lat: string | number, lng: string | number) => `https://www.google.com/maps?q=${lat},${lng}`;

/** A GST bill's "billed to" address as saved on the bill: street / city / PIN on their own lines. */
export const billToAddress = (a: { address?: string | null; city?: string | null; pin?: string | null }) =>
  [a.address, a.city, a.pin].map((x) => x?.trim()).filter(Boolean).join("\n") || null;
/** …and its parts back, for the Zoho file. */
export function billToParts(saved: string | null) {
  const lines = (saved ?? "").split("\n");
  const pin = lines.length > 1 && /^[1-9]\d{5}$/.test(lines.at(-1)!) ? lines.pop()! : "";
  const city = lines.length > 1 ? lines.pop()! : "";
  return { address: lines.join(", "), city, pin };
}

/** Zoho Books' GST treatment words. */
export const ZOHO_TREATMENT = { registered: "business_gst", unregistered: "business_none", consumer: "consumer" } as const;
