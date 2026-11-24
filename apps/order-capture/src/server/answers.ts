// Plant answers (docs/MORNING_REPORT_PHASE_PLAN.md): the one server entry point. Every check happens here, on every
// card, even though only the owner can open the page (rule 3): plant switched on, access, card built, then the facts.
// Read-only: nothing here enters, changes, sends or deletes anything (rule 2).
import { sql } from "drizzle-orm";
import { CARDS, cardById, isBuilt, type CardDef } from "@/lib/answers/cards";
import { copyText, CopyRefused } from "@/lib/answers/copy";
import type { CardResult, Facts } from "@/lib/answers/facts";
import { m2Facts } from "@/lib/answers/m2";
import { WORDING_VERSION, word } from "@/lib/answers/word";
import { can, requireAccess } from "./access";
import { withTenant } from "./db";
import { env } from "./env";
import { notFound } from "./http";
import { istToday } from "./ledger";
import { receivablesData } from "./reports";
import type { OcUser } from "./session";

/** the facts rules; bumped when a card's calculation changes, so saved reports say which rules made them */
export const RULES_VERSION = 1;

/** D9: switched on per plant (PLANT_ANSWERS_PLANTS), off by default */
export const answersOn = (tenantId: string) => env.plantAnswersPlants.includes(tenantId.toLowerCase());

/** support never sees private cards (D8); the owner sees all */
const mayOpen = (user: OcUser, card: CardDef) => can(user, "answers") && (!card.private || can(user, "answers_private"));

/** The cards this person may see, built or not (the page greys the unbuilt ones). 404 when the plant is off. */
export function listCards(user: OcUser): CardDef[] {
  if (!answersOn(user.tenantId)) throw notFound();
  requireAccess(user, "answers");
  return CARDS.filter((c) => mayOpen(user, c));
}

async function phonesOf(tenantId: string) {
  const r = await withTenant(tenantId, (tx) =>
    tx.execute<{ key: string; phone: string }>(sql`
      select 'c:' || id::text as key, phone from order_capture.customers where tenant_id = ${tenantId} and phone is not null
      union all
      select 'z:' || id::text, mobile from order_capture.zoho_contacts where tenant_id = ${tenantId} and mobile is not null`),
  );
  return new Map(r.rows.map((x) => [x.key, x.phone]));
}

const FACTS: Record<string, (tenantId: string, today: string) => Promise<{ facts: Facts; missing: string[] }>> = {
  M2: async (tenantId, today) => {
    const [d, phones] = await Promise.all([receivablesData(tenantId), phonesOf(tenantId)]);
    return { facts: m2Facts(d, phones, today), missing: d.bills.length ? [] : ["No bills in Sales yet."] };
  },
};

/** One card's answer. 404 when the plant is off, the card is unknown / not built yet, or private for this person. */
export async function runCard(user: OcUser, id: string, today = istToday()): Promise<CardResult> {
  if (!answersOn(user.tenantId)) throw notFound();
  requireAccess(user, "answers");
  const card = cardById(id);
  if (!card || !isBuilt(card) || !FACTS[card.id] || !mayOpen(user, card)) throw notFound();
  const { facts, missing } = await FACTS[card.id]!(user.tenantId, today);
  return {
    card,
    at: new Date().toISOString(),
    asOf: today,
    facts,
    missing,
    sentence: word(card.id, facts),
    preparedBy: { by: "rules", rules: RULES_VERSION, wording: WORDING_VERSION },
  };
}

/** The WhatsApp text for this person, or null (support, private cards, or the guard found money / a phone). */
export function copyFor(user: OcUser, r: CardResult): string | null {
  if (!can(user, "answers_copy") || r.card.private) return null;
  try {
    return copyText(r.card, r.facts, r.asOf);
  } catch (e) {
    if (e instanceof CopyRefused) {
      console.error(`[answers] ${e.message}`);
      return null;
    }
    throw e;
  }
}
