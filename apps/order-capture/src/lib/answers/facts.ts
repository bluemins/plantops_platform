// Plant answers: what a card returns. Facts are kept apart from wording (docs/MORNING_REPORT_PHASE_PLAN.md section 3,
// "Ready for AI later"): a card returns values keyed by its declared fields, and sentences / copied text are made from
// them afterwards, so wording can change without touching a calculation.
import { money } from "../money";
import { dmy } from "../receivables";
import type { CardDef, FieldDef, FieldKind } from "./cards";

/** money in paise (bigint); days / counts as whole numbers; dates YYYY-MM-DD; phones 10 digits */
export type Value = string | number | bigint | null;
export type Row = Record<string, Value>;

export interface Facts {
  totals: Row;
  rows: Row[];
}

/** how the answer was made: rules now; an AI-made answer would say so here, beside the rules one */
export interface PreparedBy {
  by: "rules";
  rules: number;
  wording: number;
}

export interface CardResult {
  card: CardDef;
  /** when the answer was worked out (ISO time) and the India day it is "as of" */
  at: string;
  asOf: string;
  facts: Facts;
  /** data that could not be read: said, never treated as zero (rule 5) */
  missing: string[];
  sentence: string;
  preparedBy: PreparedBy;
}

export const fieldsOf = (card: CardDef, scope: FieldDef["scope"]) => (card.fields ?? []).filter((f) => f.scope === scope);

/** One value as text. Money always carries ₹ and phones their digits, so the copy guard can recognise both. */
export function formatValue(kind: FieldKind, v: Value | undefined): string {
  if (v === undefined || v === null || v === "") return "—";
  switch (kind) {
    case "money":
      return money(typeof v === "bigint" ? v : BigInt(v));
    case "days":
      return `${v} ${Number(v) === 1 ? "day" : "days"}`;
    case "date":
      return dmy(String(v));
    case "count":
      return Number(v).toLocaleString("en-IN");
    default:
      return String(v);
  }
}
