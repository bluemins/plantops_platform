// Plant answers, step "rank the actions": only its shape for now (owner 2026-11-24, P1-c). The priority rules come with
// the morning report in Phase 5 (docs/MORNING_REPORT_PHASE_PLAN.md section 3); a later AI ranking would take the same
// input and give the same output, and the rules stay as the fallback.
import type { CardResult } from "./facts";

/** the morning report lists at most this many actions (D11) */
export const MAX_ACTIONS = 7;

export interface Action {
  cardId: string;
  /** the priority level of section 3's table (1 = first) */
  level: number;
  text: string;
}

export type Rank = (results: CardResult[]) => Action[];
