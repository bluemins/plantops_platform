// Order flow check (Reports → Sales; owner 2026-11-10): the order measures of docs/ORDER_FLOW_LEAN_ANALYSIS.md
// (sections 2 and 4.5) for any dates, so the owner can repeat the check without asking. Pure rules over the plant's
// orders; the server reads them (src/server/flow-check.ts). Nothing is stored. Stock measures (out-of-stock days,
// material days) belong to Reports → Stock (Floor Stock), not here.
//
// Which orders: those ENTERED in the chosen dates (India dates). Exception: "Pending now" lists every pending order of
// the plant, whatever its date, because it is today's to-do list.
//   Entered → Delivered   hours from saving to the (latest) Delivered tap, delivered orders only
//   Same / next day       India date of delivery minus India date of entry: 0, 1, 2 or more
//   Changed after saving  orders with at least one "Change" (a new version of the lines)
//   Bill linked           delivered orders with a bill (PlantOps or Zoho) or a Zoho invoice no. typed on delivery
//   Quick cancels         cancelled within 1 hour of saving (often a mistake or a test)
// Money in paise (BigInt).

export const CHECK_PERIODS = ["last_7", "last_14", "last_30", "this_month", "prev_month", "custom"] as const;
export type CheckPeriod = (typeof CHECK_PERIODS)[number];
export const CHECK_PERIOD_LABEL: Record<CheckPeriod, string> = {
  last_7: "Last 7 days",
  last_14: "Last 14 days",
  last_30: "Last 30 days",
  this_month: "This month",
  prev_month: "Previous month",
  custom: "Custom dates",
};

/** Targets from the analysis (section 4.5), to be reached in about 2 months. */
export const TARGETS = { sameNextPct: 85, pendingOld: 0, changedPct: 10 } as const;
/** The first check (plant 001, orders entered 13 Oct – 1 Nov 2026), shown next to today's numbers for comparison. */
export const FIRST_CHECK = { label: "13 Oct – 1 Nov", sameNextPct: 58, pendingOld: 9, changedPct: 32, billedPct: 0 } as const;
/** A pending order older than this is late (the analysis: "pending older than 2 days"). */
export const LATE_HOURS = 48;
const HOUR = 3_600_000;
const DAY = 86_400_000;

export type CheckOrder = {
  id: string;
  ref_no: number;
  status: "pending" | "delivered" | "cancelled";
  /** saved / delivered / cancelled, epoch ms */
  entered_at: number;
  delivered_at: number | null;
  cancelled_at: number | null;
  /** India dates YYYY-MM-DD and hour 0–23 */
  entered: string;
  delivered: string | null;
  entered_hour: number;
  delivered_hour: number | null;
  entered_by: string;
  delivered_by: string | null;
  customer_id: string;
  customer_name: string;
  place: string;
  total: bigint;
  /** "Change" events on the order, and how many came on a later India day than the entry */
  changes: number;
  changes_later: number;
  /** "Undo delivered" events */
  undone: number;
  cancel_reason: string | null;
  /** a live bill or a typed Zoho invoice no. */
  billed: boolean;
};

export const orderRef = (n: number) => `O-${String(n).padStart(4, "0")}`;
const ymd = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const dayDiff = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / DAY);

/** The dates a period means on `today` (an India date), both included. */
export function checkDates(period: CheckPeriod, today: string, custom: { from?: string; to?: string } = {}) {
  const t = Date.parse(today);
  const back = (n: number) => ({ from: ymd(t - (n - 1) * DAY), to: today });
  switch (period) {
    case "last_7":
      return back(7);
    case "last_14":
      return back(14);
    case "last_30":
      return back(30);
    case "this_month":
      return { from: `${today.slice(0, 8)}01`, to: today };
    case "prev_month": {
      const first = new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 2, 1));
      const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0));
      return { from: ymd(first.getTime()), to: ymd(last.getTime()) };
    }
    case "custom": {
      const ok = (d?: string) => !!d && /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(d));
      const from = ok(custom.from) ? custom.from! : back(14).from;
      const to = ok(custom.to) ? custom.to! : today;
      return from <= to ? { from, to } : { from: to, to: from };
    }
  }
}

/** The value at fraction q (0–1) of sorted numbers, nearest rank; null when empty. */
export function quantile(sorted: number[], q: number): number | null {
  if (!sorted.length) return null;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1))]!;
}
function median(sorted: number[]): number | null {
  if (!sorted.length) return null;
  const m = sorted.length >> 1;
  return sorted.length % 2 ? sorted[m]! : (sorted[m - 1]! + sorted[m]!) / 2;
}
function medianBig(xs: bigint[]): bigint | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2n;
}
export const pct = (part: number, whole: number) => (whole ? Math.round((part / whole) * 100) : null);

/** Time-of-day bands for when orders come in and when deliveries are tapped. */
export const HOUR_BANDS = [
  { label: "Before 9:00", from: 0, to: 9 },
  { label: "9:00–12:00", from: 9, to: 12 },
  { label: "12:00–16:00", from: 12, to: 16 },
  { label: "16:00–19:00", from: 16, to: 19 },
  { label: "After 19:00", from: 19, to: 24 },
] as const;
const band = (h: number) => HOUR_BANDS.findIndex((b) => h >= b.from && h < b.to);

export type Count = { name: string; count: number };
const counts = (xs: string[]): Count[] =>
  [...xs.reduce((m, x) => m.set(x, (m.get(x) ?? 0) + 1), new Map<string, number>())]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

export type DeliverySpeed = {
  delivered: number;
  medianHours: number | null;
  averageHours: number | null;
  p80Hours: number | null;
  longestHours: number | null;
  sameDay: number;
  nextDay: number;
  later: number;
  over4Days: number;
};

function speed(delivered: CheckOrder[]): DeliverySpeed {
  const hours = delivered.map((o) => (o.delivered_at! - o.entered_at) / HOUR).sort((a, b) => a - b);
  const gap = delivered.map((o) => dayDiff(o.entered, o.delivered!));
  return {
    delivered: delivered.length,
    medianHours: median(hours),
    averageHours: hours.length ? hours.reduce((t, h) => t + h, 0) / hours.length : null,
    p80Hours: quantile(hours, 0.8),
    longestHours: hours.length ? hours[hours.length - 1]! : null,
    sameDay: gap.filter((d) => d <= 0).length,
    nextDay: gap.filter((d) => d === 1).length,
    later: gap.filter((d) => d >= 2).length,
    over4Days: hours.filter((h) => h > 96).length,
  };
}

export type WeekRow = { from: string; to: string; entered: number; delivered: number; sameNextPct: number | null; changedPct: number | null; cancelled: number };

/** Weeks Monday–Sunday covering the dates (the first and last may be part weeks), each with its orders' measures. */
function weeks(orders: CheckOrder[], from: string, to: string): WeekRow[] {
  const out: WeekRow[] = [];
  const dow = (new Date(from).getUTCDay() + 6) % 7; // Monday = 0
  let start = Date.parse(from) - dow * DAY;
  while (ymd(start) <= to) {
    const wf = ymd(Math.max(start, Date.parse(from)));
    const wt = ymd(Math.min(start + 6 * DAY, Date.parse(to)));
    const inWeek = orders.filter((o) => o.entered >= wf && o.entered <= wt);
    const live = inWeek.filter((o) => o.status !== "cancelled");
    const del = inWeek.filter((o) => o.status === "delivered");
    const s = speed(del);
    out.push({
      from: wf,
      to: wt,
      entered: inWeek.length,
      delivered: del.length,
      sameNextPct: pct(s.sameDay + s.nextDay, del.length),
      changedPct: pct(live.filter((o) => o.changes > 0).length, live.length),
      cancelled: inWeek.length - live.length,
    });
    start += 7 * DAY;
  }
  return out;
}

export type PendingRow = { id: string; ref: string; href: string; customer_name: string; customer_href: string; place: string; entered: string; hours: number; total: bigint };

export type FlowCheck = {
  from: string;
  to: string;
  days: number;
  orders: { entered: number; delivered: number; pending: number; cancelled: number };
  value: { total: bigint; average: bigint | null; median: bigint | null };
  speed: DeliverySpeed;
  sameNextPct: number | null;
  changed: { orders: number; changes: number; later: number; pct: number | null; undone: number };
  billed: { delivered: number; billed: number; pct: number | null };
  cancels: { total: number; quick: number; withoutQuick: number; reasons: Count[] };
  customers: { total: number; once: number; twice: number; more: number };
  deliveryDays: number;
  enteredBy: Count[];
  deliveredBy: Count[];
  enteredHours: number[];
  deliveredHours: number[];
  places: Count[];
  weeks: WeekRow[];
  /** every pending order of the plant, oldest first, and how many are late */
  pendingNow: PendingRow[];
  pendingLate: number;
};

const placeKey = (p: string) => p.trim().replace(/\s+/g, " ");

/** The check for the orders entered from `from` to `to` (India dates), as of `now` (epoch ms). */
export function flowCheck(all: CheckOrder[], from: string, to: string, now: number): FlowCheck {
  const orders = all.filter((o) => o.entered >= from && o.entered <= to);
  const live = orders.filter((o) => o.status !== "cancelled");
  const delivered = orders.filter((o) => o.status === "delivered");
  const cancelled = orders.filter((o) => o.status === "cancelled");
  const s = speed(delivered);
  const quick = cancelled.filter((o) => o.cancelled_at !== null && o.cancelled_at - o.entered_at <= HOUR);
  const changedOrders = live.filter((o) => o.changes > 0);
  const total = live.reduce((t, o) => t + o.total, 0n);
  const perCustomer = counts(live.map((o) => o.customer_id));
  const hoursIn = HOUR_BANDS.map(() => 0);
  for (const o of orders) hoursIn[band(o.entered_hour)]!++;
  const hoursOut = HOUR_BANDS.map(() => 0);
  for (const o of delivered) if (o.delivered_hour !== null) hoursOut[band(o.delivered_hour)]!++;
  const billed = delivered.filter((o) => o.billed).length;
  const pendingNow = all
    .filter((o) => o.status === "pending")
    .sort((a, b) => a.entered_at - b.entered_at || a.ref_no - b.ref_no)
    .map((o) => ({
      id: o.id,
      ref: orderRef(o.ref_no),
      href: `/o/${o.id}`,
      customer_name: o.customer_name,
      customer_href: `/customers/${o.customer_id}`,
      place: o.place,
      entered: o.entered,
      hours: Math.max(0, (now - o.entered_at) / HOUR),
      total: o.total,
    }));
  return {
    from,
    to,
    days: dayDiff(from, to) + 1,
    orders: { entered: orders.length, delivered: delivered.length, pending: orders.filter((o) => o.status === "pending").length, cancelled: cancelled.length },
    value: { total, average: live.length ? total / BigInt(live.length) : null, median: medianBig(live.map((o) => o.total)) },
    speed: s,
    sameNextPct: pct(s.sameDay + s.nextDay, s.delivered),
    changed: {
      orders: changedOrders.length,
      changes: live.reduce((t, o) => t + o.changes, 0),
      later: live.filter((o) => o.changes_later > 0).length,
      pct: pct(changedOrders.length, live.length),
      undone: orders.reduce((t, o) => t + o.undone, 0),
    },
    billed: { delivered: delivered.length, billed, pct: pct(billed, delivered.length) },
    cancels: {
      total: cancelled.length,
      quick: quick.length,
      withoutQuick: cancelled.length - quick.length,
      reasons: counts(cancelled.filter((o) => !quick.includes(o)).map((o) => (o.cancel_reason ?? "").trim() || "No reason")),
    },
    customers: {
      total: perCustomer.length,
      once: perCustomer.filter((c) => c.count === 1).length,
      twice: perCustomer.filter((c) => c.count === 2).length,
      more: perCustomer.filter((c) => c.count >= 3).length,
    },
    deliveryDays: new Set(delivered.map((o) => o.delivered!)).size,
    enteredBy: counts(orders.map((o) => o.entered_by.trim() || "Not mentioned")),
    deliveredBy: counts(delivered.map((o) => o.delivered_by?.trim() || "Not mentioned")),
    enteredHours: hoursIn,
    deliveredHours: hoursOut,
    places: counts(live.map((o) => placeKey(o.place) || "No place")),
    weeks: weeks(orders, from, to),
    pendingNow,
    pendingLate: pendingNow.filter((p) => p.hours > LATE_HOURS).length,
  };
}

/** Places that look like the same village typed differently (same letters ignoring case, spaces and dots, or one
 *  letter apart for names of 5+ letters). Only places with orders in the check; each pair once. */
export function lookAlikePlaces(places: Count[]): [string, string][] {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-zऀ-෿]/g, "");
  const close = (a: string, b: string) => {
    if (a === b) return true;
    if (Math.min(a.length, b.length) < 5 || Math.abs(a.length - b.length) > 1) return false;
    // one edit (change, add or drop a letter), or two neighbouring letters swapped
    let i = 0;
    while (i < a.length && a[i] === b[i]) i++;
    if (a.length === b.length) {
      if (a.slice(i + 1) === b.slice(i + 1)) return true;
      return a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2);
    }
    const [s, l] = a.length < b.length ? [a, b] : [b, a];
    return s.slice(i) === l.slice(i + 1);
  };
  const out: [string, string][] = [];
  for (let x = 0; x < places.length; x++)
    for (let y = x + 1; y < places.length; y++) {
      const a = places[x]!.name;
      const b = places[y]!.name;
      if (a !== "No place" && b !== "No place" && close(norm(a), norm(b))) out.push([a, b]);
    }
  return out;
}
