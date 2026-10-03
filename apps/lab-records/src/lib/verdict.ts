// Pass/fail against a plant's limits (CLAUDE.md: computed automatically, never typed by hand).
export type Verdict = "pass" | "fail" | "none";

const num = (v: string | number | null | undefined) => (v === null || v === undefined || v === "" ? null : Number(v));

/**
 * One result against its limits. Outside the limits = fail; exactly on a limit = pass; no limit set = no
 * verdict ("none") - sample limits are placeholders until each plant sets its own.
 */
export function judge(value: string | number, limitMin: string | number | null, limitMax: string | number | null): Verdict {
  const v = Number(value);
  const min = num(limitMin);
  const max = num(limitMax);
  if (min === null && max === null) return "none";
  if ((min !== null && v < min) || (max !== null && v > max)) return "fail";
  return "pass";
}

/** A whole entry: any fail = fail; otherwise pass if anything was judged; otherwise none. */
export function overall(verdicts: Verdict[]): Verdict {
  if (verdicts.includes("fail")) return "fail";
  return verdicts.includes("pass") ? "pass" : "none";
}

/** "max 500", "6.5 – 8.5", "min 2" or "" for showing a limit next to a value. */
export function limitText(limitMin: string | null, limitMax: string | null) {
  if (limitMin !== null && limitMax !== null) return `${limitMin} – ${limitMax}`;
  if (limitMax !== null) return `max ${limitMax}`;
  if (limitMin !== null) return `min ${limitMin}`;
  return "";
}
