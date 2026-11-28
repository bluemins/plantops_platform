// Plant answers (docs/MORNING_REPORT_PHASE_PLAN.md): the one server entry point. Every check happens here, on every
// card, even though only the owner can open the page (rule 3): plant switched on, access, card built, then the facts.
// Read-only: nothing here enters, changes, sends or deletes anything (rule 2).
import { sql } from "drizzle-orm";
import { CARDS, cardById, isBuilt, type CardDef } from "@/lib/answers/cards";
import { copyText, CopyRefused } from "@/lib/answers/copy";
import type { CardResult, Facts } from "@/lib/answers/facts";
import { m2Facts } from "@/lib/answers/m2";
import { m1Facts, m3Facts, m4Facts, m5Facts, m5Periods, m6Facts, mondayOf } from "@/lib/answers/money-cards";
import { o1Facts, o2Facts, o3Choices, o3Facts, o4Dates, o4Facts, o4Period, O4_PERIOD_LABEL, O4_PERIODS, o5Facts } from "@/lib/answers/order-cards";
import { WORDING_VERSION, word } from "@/lib/answers/word";
import { can, requireAccess } from "./access";
import {
  cashCheckRows,
  cashNow,
  fetchStock,
  findCustomers,
  moneyInRows,
  ordersByPlace,
  payingRows,
  pendingOrders,
  plantBuying,
  soldToday,
} from "./answers-data";
import { addDays } from "./cash";
import { recordsFrom, saleFacts } from "./business";
import { withTenant } from "./db";
import { env } from "./env";
import { badRequest, notFound } from "./http";
import { istToday } from "./ledger";
import { receivablesData } from "./reports";
import type { OcUser } from "./session";

/** the facts rules; bumped when a card's calculation changes, so saved reports say which rules made them */
export const RULES_VERSION = 2;

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

/** What a card was asked for (O3 product, O4 period, O5 customer), from the page's address. */
export type CardInput = { product?: string; period?: string; customer?: string; q?: string };
/** The pickers' choices, shown above the answer. */
export type Choices = {
  products?: { key: string; name: string; n: number }[];
  periods?: { key: string; label: string }[];
  customers?: { key: string; name: string; place: string | null }[];
  /** the choice the answer is for */
  picked?: string;
};
type Got = { facts: Facts; missing: string[]; choices?: Choices } | null;

const FACTS: Record<string, (user: OcUser, today: string, input: CardInput) => Promise<Got>> = {
  M1: async (user, today) => {
    const [d, phones, pay] = await Promise.all([receivablesData(user.tenantId), phonesOf(user.tenantId), payingRows(user.tenantId)]);
    return { facts: m1Facts(d, phones, pay, today), missing: d.bills.length ? [] : ["No bills in Sales yet."] };
  },
  M2: async (user, today) => {
    const [d, phones] = await Promise.all([receivablesData(user.tenantId), phonesOf(user.tenantId)]);
    return { facts: m2Facts(d, phones, today), missing: d.bills.length ? [] : ["No bills in Sales yet."] };
  },
  M3: async (user, today) => {
    const rows = await moneyInRows(user, addDays(mondayOf(today), -7), today);
    return { facts: m3Facts({ ...rows, today }), missing: [] };
  },
  M4: async (user, today) => {
    const rows = await cashCheckRows(user.tenantId, addDays(today, -120));
    return { facts: m4Facts(rows.closes, rows.entries, today), missing: rows.closes.length ? [] : ["The cash book is not started (Sales → Cash)."] };
  },
  M5: async (user, today) => {
    const p = m5Periods(today);
    const lyFrom = `${Number(p.now.from.slice(0, 4)) - 1}${p.now.from.slice(4)}`;
    const [sales, from] = await withTenant(user.tenantId, async (tx) => Promise.all([saleFacts(tx, user.tenantId, lyFrom, p.now.to), recordsFrom(tx, user.tenantId)]));
    return { facts: m5Facts(sales, today, from), missing: [] };
  },
  M6: async (user, today) => {
    const [cash, sales] = await Promise.all([cashNow(user, today), soldToday(user.tenantId, today)]);
    return { facts: m6Facts(cash, sales, today), missing: cash.started ? [] : ["The cash book is not started (Sales → Cash), so cash in the box is not known."] };
  },
  O1: async (user) => {
    const [orders, stock] = await Promise.all([pendingOrders(user.tenantId), fetchStock(user.tenantId)]);
    const missing = stock.state === "in" ? (stock.levels.counted_on ? [] : ["Floor Stock has no count yet, so stock is not checked."]) : [stock.state === "off" ? "Floor Stock is not switched on for this plant, so stock is not checked." : "Floor Stock did not answer just now, so stock is not checked."];
    return { facts: o1Facts(orders, stock, new Date()), missing };
  },
  O2: async (user, today) => {
    const { list } = await plantBuying(user.tenantId, today);
    return { facts: o2Facts(list), missing: list.length ? [] : ["No orders or bills yet."] };
  },
  O3: async (user, today, input) => {
    const { list } = await plantBuying(user.tenantId, today);
    const products = o3Choices(list);
    const picked = products.find((p) => p.key === input.product) ?? products[0];
    if (!picked) return { facts: { totals: { product: "any product", stopped: 0, still_buying: 0, stopped_all: 0 }, rows: [] }, missing: [], choices: { products } };
    return { facts: o3Facts(list, picked), missing: [], choices: { products, picked: picked.key } };
  },
  O4: async (user, today, input) => {
    const period = o4Period(input.period);
    const d = o4Dates(period, today);
    const orders = await ordersByPlace(user.tenantId, d.before.from, d.now.to);
    return { facts: o4Facts(orders, period, today), missing: [], choices: { periods: O4_PERIODS.map((k) => ({ key: k, label: O4_PERIOD_LABEL[k] })), picked: period } };
  },
  O5: async (user, today, input) => {
    const customers = input.q ? await findCustomers(user.tenantId, input.q) : [];
    const key = input.customer && /^[cz]:[0-9a-f-]{36}$/.test(input.customer) ? input.customer : null;
    if (!key) return { facts: { totals: {}, rows: [] }, missing: [], choices: { customers } };
    const { list, lastRates } = await plantBuying(user.tenantId, today, key);
    const c = list[0];
    if (!c) return { facts: { totals: {}, rows: [] }, missing: ["No orders or bills for this customer yet."], choices: { customers, picked: key } };
    return { facts: o5Facts(c, lastRates.get(key) ?? new Map()), missing: [], choices: { customers, picked: key } };
  },
};

/** The result with its pickers' choices. `ready` false = a card that needs a choice first (O5 before a customer is picked). */
export type CardAnswer = CardResult & { choices?: Choices; ready: boolean };

/** One card's answer. 404 when the plant is off, the card is unknown / not built yet, or private for this person. */
export async function runCard(user: OcUser, id: string, today = istToday(), input: CardInput = {}): Promise<CardAnswer> {
  if (!answersOn(user.tenantId)) throw notFound();
  requireAccess(user, "answers");
  const card = cardById(id);
  if (!card || !isBuilt(card) || !FACTS[card.id] || !mayOpen(user, card)) throw notFound();
  if (input.q && input.q.length > 60) throw badRequest("Search for at most 60 characters");
  const got = await FACTS[card.id]!(user, today, input);
  if (!got) throw notFound();
  const ready = card.id !== "O5" || !!got.choices?.picked;
  return {
    card,
    at: new Date().toISOString(),
    asOf: today,
    facts: got.facts,
    missing: got.missing,
    sentence: ready ? word(card.id, got.facts) : "Pick a customer to see what they usually order.",
    preparedBy: { by: "rules", rules: RULES_VERSION, wording: WORDING_VERSION },
    ...(got.choices ? { choices: got.choices } : {}),
    ready,
  };
}

/** The WhatsApp text for this person, or null (support, private / screen-only cards, or the guard found money / a phone). */
export function copyFor(user: OcUser, r: CardResult & { ready?: boolean }): string | null {
  if (!can(user, "answers_copy") || r.card.private || r.card.noCopy || r.ready === false) return null;
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
