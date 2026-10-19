// How the Salary tab shows a row in its short form (owner, 2026-10-19; mock-up
// https://claude.ai/artifact/VnGsfKjT5WRc4dhvF5EsdM): Days, Extras and Taken each merge several of the full columns.
// Screen only: every amount comes from monthPay() unchanged, and "Show all columns" still shows each one.
import { halvesText, type DayCounts, type PayResult } from "./salary";

type Money = Pick<PayResult, "otPayPaise" | "taPaise" | "daPaise" | "expensesPaise" | "advancesPaise" | "carriedInPaise">;

/** Extras = overtime pay + TA + DA + expenses. */
export const extrasPaise = (r: Money) => r.otPayPaise + r.taPaise + r.daPaise + r.expensesPaise;

/** Taken = advances + carried in from earlier months. */
export const takenPaise = (r: Money) => r.advancesPaise + r.carriedInPaise;

/**
 * The Days cell: "3 present" on top, "1 half · 15 absent · 2 leave" under it. Half days and leave only when there
 * are any; per-day people have no paid leave (rule 15), so `leaveHalves` is null for them.
 */
export function daysText(c: Pick<DayCounts, "present" | "half" | "absent">, leaveHalves: number | null): { main: string; sub: string } {
  const sub: string[] = [];
  if (c.half) sub.push(`${c.half} half`);
  sub.push(`${c.absent} absent`);
  if (leaveHalves) sub.push(`${halvesText(leaveHalves)} leave`);
  return { main: `${c.present} present`, sub: sub.join(" · ") };
}
