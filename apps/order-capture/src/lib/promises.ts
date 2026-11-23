// Promise to pay (owner, 2026-11-23): pure rules. Whether a promise was kept is worked out from payments, never stored.
//   kept      enough money came between the day it was noted and the promised day
//   late      the promised day passed, the money came afterwards
//   broken    the promised day passed and the money has not come
//   due_today the promised day is today, not met yet
//   open      the promised day is ahead
//   replaced  a newer promise was noted on or before its day (not counted for or against the customer)
// With no amount, any payment in the period meets the promise. Money in paise.
import type { DeskDue } from "./accounts-desk";

export type PromiseRow = {
  id: string;
  customer_key: string;
  promised_on: string;
  amount: bigint | null;
  note: string | null;
  by: string;
  /** India date it was noted */
  created_on: string;
  created_at: string;
};
export type PromisePayment = { customer_key: string; payment_date: string; amount: bigint };
export type PromiseState = "kept" | "late" | "broken" | "due_today" | "open" | "replaced";
export type PromiseView = PromiseRow & { state: PromiseState; received: bigint };
export const PROMISE_LABEL: Record<PromiseState, string> = {
  kept: "Kept",
  late: "Paid late",
  broken: "Promise broken",
  due_today: "Due today",
  open: "Promised",
  replaced: "Date changed",
};

export type CustomerPromises = {
  /** the latest promise, while it still needs attention */
  current: PromiseView | null;
  kept: number;
  /** kept + late + broken */
  counted: number;
  /** newest first */
  history: PromiseView[];
};

const NONE: CustomerPromises = { current: null, kept: 0, counted: 0, history: [] };

/** One customer's promises (any order) with their state. */
export function promiseStates(list: PromiseRow[], payments: PromisePayment[], today: string): CustomerPromises {
  if (!list.length) return NONE;
  const sorted = [...list].sort((a, b) => a.created_at.localeCompare(b.created_at));
  const sum = (from: string, to: string) => payments.filter((p) => p.payment_date >= from && p.payment_date <= to).reduce((s, p) => s + p.amount, 0n);
  const views = sorted.map((p, i): PromiseView => {
    const next = sorted[i + 1];
    const target = p.amount ?? 1n;
    const inTime = sum(p.created_on, p.promised_on < today ? p.promised_on : today);
    const seen = sum(p.created_on, today);
    let state: PromiseState;
    if (inTime >= target) state = "kept";
    else if (next && next.created_on <= p.promised_on) state = "replaced";
    else if (p.promised_on < today) state = seen >= target ? "late" : "broken";
    else state = p.promised_on === today ? "due_today" : "open";
    return { ...p, state, received: state === "replaced" ? inTime : seen };
  });
  const last = views[views.length - 1]!;
  return {
    current: last.state === "open" || last.state === "due_today" || last.state === "broken" ? last : null,
    kept: views.filter((v) => v.state === "kept").length,
    counted: views.filter((v) => v.state === "kept" || v.state === "late" || v.state === "broken").length,
    history: [...views].reverse(),
  };
}

export type DeskDueWithPromise = DeskDue & { promises: CustomerPromises };

const rank = (r: DeskDueWithPromise) => {
  const s = r.promises.current?.state;
  return s === "broken" ? 0 : s === "due_today" ? 1 : s === "open" ? 3 : 2;
};

/** Adds each customer's promises. Call list: broken, due today, then the usual order, and those promised later last. */
export function withPromises(rows: DeskDue[], promises: PromiseRow[], payments: PromisePayment[], today: string): DeskDueWithPromise[] {
  const byKey = <T extends { customer_key: string }>(xs: T[]) => {
    const m = new Map<string, T[]>();
    for (const x of xs) (m.get(x.customer_key) ?? m.set(x.customer_key, []).get(x.customer_key)!).push(x);
    return m;
  };
  const ps = byKey(promises);
  const pays = byKey(payments);
  return rows
    .map((r) => ({ ...r, promises: promiseStates(ps.get(r.key) ?? [], pays.get(r.key) ?? [], today) }))
    .map((r, i) => ({ r, i }))
    .sort((a, b) => rank(a.r) - rank(b.r) || a.i - b.i)
    .map(({ r }) => r);
}
