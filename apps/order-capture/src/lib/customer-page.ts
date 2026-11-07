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
  ["statement", "Statement"],
] as const;
export type AccountTab = (typeof ACCOUNT_TABS)[number][0];

/** The tab from the address; the old Bills / Payments tabs (v0.39.0 links) open Transactions; nothing = Overview. */
export function pickTab(raw: string): AccountTab {
  if (raw === "bills" || raw === "payments") return "transactions";
  return ACCOUNT_TABS.find(([t]) => t === raw)?.[0] ?? "overview";
}
