// Formatting for the Drop app: rupees from paise, boxes, India dates.
const IST = "Asia/Kolkata";

/** ₹12,450 (whole rupees when the paise are 0, else ₹12,450.50). */
export function rupees(paise: number) {
  const r = paise / 100;
  return `₹${r.toLocaleString("en-IN", { minimumFractionDigits: paise % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;
}

/** 1,050 or 2.5 */
export const num = (n: number) => n.toLocaleString("en-IN", { maximumFractionDigits: 2 });

/** "8 Nov" from "2026-11-08" (a date only, no time zone shift). */
export function day(ymd: string) {
  const [y, m, d] = ymd.split("-").map(Number) as [number, number, number];
  return new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, d)));
}

/** "31 Jan 2028" */
export function longDay(ymd: string) {
  const [y, m, d] = ymd.split("-").map(Number) as [number, number, number];
  return new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, d)));
}

/** "Nov 2026" from "2026-11" */
export function month(ym: string) {
  const [y, m] = ym.split("-").map(Number) as [number, number];
  return new Intl.DateTimeFormat("en-IN", { month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, 1)));
}

/** "Sun 15 Nov" from an ISO time, in India time */
export const dayOfTime = (iso: string) => new Intl.DateTimeFormat("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: IST }).format(new Date(iso));

/** 10 digits from what was typed ("+91 98765 43210" → "9876543210"); null when it isn't an Indian mobile. */
export function mobile(typed: string) {
  let d = typed.replace(/\D/g, "");
  if (d.length === 12 && d.startsWith("91")) d = d.slice(2);
  if (d.length === 11 && d.startsWith("0")) d = d.slice(1);
  return /^[6-9]\d{9}$/.test(d) ? d : null;
}

/** "tel:" / WhatsApp links from a support phone ("+91 94370 00111" or "9437000111"). */
export const telLink = (phone: string) => `tel:${phone.replace(/[^\d+]/g, "")}`;
export function waLink(phone: string) {
  const d = phone.replace(/\D/g, "");
  return `https://wa.me/${d.length === 10 ? `91${d}` : d}`;
}
