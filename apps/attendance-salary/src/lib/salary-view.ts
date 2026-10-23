// How the Salary tab shows a row in its short form (owner, 2026-10-19; mock-up
// https://claude.ai/artifact/VnGsfKjT5WRc4dhvF5EsdM): Days, Extras and Taken each merge several of the full columns.
// Screen only: every amount comes from monthPay() unchanged, and "Show all columns" still shows each one.
import { fmtMinutes } from "./days";
import { halvesText, shortDaysText, type DayCounts, type PayResult } from "./salary";

type Money = Pick<PayResult, "otPayPaise" | "taPaise" | "daPaise" | "expensesPaise" | "advancesPaise" | "carriedInPaise">;

/** Extras = overtime pay + TA + DA + expenses. */
export const extrasPaise = (r: Money) => r.otPayPaise + r.taPaise + r.daPaise + r.expensesPaise;

/** Taken = advances + carried in from earlier months. */
export const takenPaise = (r: Money) => r.advancesPaise + r.carriedInPaise;

/**
 * The Days cell: "11 full" on top, "1 off · 9 short 61h 57m = 7.74 d · 1 absent · 2 leave" under it. Days off, short
 * days (rule 21), half days (months paid before rule 21) and leave only when there are any; per-day people have no paid
 * leave (rule 15), so `leaveHalves` is null for them.
 */
export function daysText(c: Pick<DayCounts, "present" | "half" | "absent" | "off" | "short" | "shortMinutes">, leaveHalves: number | null, shiftMinutes: number): { main: string; sub: string } {
  const sub: string[] = [];
  if (c.off) sub.push(`${c.off} off`); // rule 20: the owner's paid days off
  if (c.short) sub.push(`${c.short} short ${fmtMinutes(c.shortMinutes ?? 0)} = ${shortDaysText(c.shortMinutes ?? 0, shiftMinutes)} d`);
  if (c.half) sub.push(`${c.half} half`);
  sub.push(`${c.absent} absent`);
  if (leaveHalves) sub.push(`${halvesText(leaveHalves)} leave`);
  return { main: `${c.present} full`, sub: sub.join(" · ") };
}
