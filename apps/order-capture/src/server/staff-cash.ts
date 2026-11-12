// Open with staff (docs/CASHBOOK_PHASE_PLAN.md section 9, C4; owner 2026-11-12): cash given to a person "for plant
// spending" stays with them until it comes back ("Took back · plant spending") or they spend it. "Spent from cash given"
// (staff_cash_spends) records what they paid out of it; it never moves money in the box (the cash left the box when it was
// given). Open = given − brought back − spent. Advances against salary are listed too (given − brought back, and whether
// each is in Attendance). Owner + Accounts enter; the owner cancels a wrong "spent" with a reason; support reads.
import { and, asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { cashRef, paise, rupees } from "@/lib/cash";
import { requireAccess } from "./access";
import { statusOf } from "./attendance-link";
import { audit } from "./audit";
import { istToday, addDays } from "./cash";
import { schema, withTenant, type OcTx } from "./db";
import { badRequest, conflict, notFound } from "./http";
import type { OcUser } from "./session";

const { cashEntries, staffCashSpends: spends, expenseCategories } = schema;

/** One person: by platform user id when known, else by the typed name. */
const keyOf = (userId: string | null, name: string) => (userId ? `u:${userId}` : `n:${name.trim().toLowerCase()}`);

export interface StaffLine {
  kind: "given" | "back" | "spent";
  id: string;
  ref: string | null;
  date: string;
  amount: string;
  what: string | null;
  by: string;
  cancelled: { by: string; reason: string } | null;
}

export interface StaffRow {
  key: string;
  person: string;
  person_user_id: string | null;
  /** cash given for plant spending, not yet brought back or spent (rupees; can't go below 0 when entered here) */
  open: string;
  given: string;
  back: string;
  spent: string;
  lines: StaffLine[];
  /** advances against salary with something left */
  advances: { id: string; ref: string; date: string; amount: string; left: string; attendance: { status: string; message: string | null } | null }[];
}

async function rowsOf(tx: OcTx, t: string) {
  const entries = await tx.select().from(cashEntries).where(and(eq(cashEntries.tenantId, t), sql`${cashEntries.kind} in ('staff_out', 'staff_in')`)).orderBy(asc(cashEntries.cashDate), asc(cashEntries.refNo));
  const spent = await tx.select().from(spends).where(eq(spends.tenantId, t)).orderBy(asc(spends.spentOn), asc(spends.createdAt));
  const cats = new Map((await tx.select({ id: expenseCategories.id, name: expenseCategories.name }).from(expenseCategories).where(eq(expenseCategories.tenantId, t))).map((c) => [c.id, c.name]));
  return { entries, spent, cats };
}

/** Everyone with plant-spending cash or an advance on record, most open first. */
export async function openWithStaff(user: OcUser): Promise<StaffRow[]> {
  requireAccess(user, "cash_view");
  return withTenant(user.tenantId, async (tx) => {
    const t = user.tenantId;
    const { entries, spent, cats } = await rowsOf(tx, t);
    const sent = await statusOf(tx, t, entries.filter((e) => e.staffPurpose === "advance" && e.kind === "staff_out").map((e) => e.id));
    const people = new Map<string, StaffRow & { g: bigint; b: bigint; s: bigint }>();
    const row = (userId: string | null, name: string) => {
      const k = keyOf(userId, name);
      let r = people.get(k);
      if (!r) people.set(k, (r = { key: k, person: name, person_user_id: userId, open: "0.00", given: "0.00", back: "0.00", spent: "0.00", lines: [], advances: [], g: 0n, b: 0n, s: 0n }));
      return r;
    };
    const backOf = new Map<string, bigint>();
    for (const e of entries) if (e.returnsEntryId && !e.cancelledAt) backOf.set(e.returnsEntryId, (backOf.get(e.returnsEntryId) ?? 0n) + paise(e.amount));
    for (const e of entries) {
      if (!e.personName) continue;
      const r = row(e.personUserId, e.personName);
      const cancelled = e.cancelledAt ? { by: e.cancelledByName ?? "", reason: e.cancelReason ?? "" } : null;
      if (e.kind === "staff_out" && e.staffPurpose === "advance") {
        const left = paise(e.amount) - (backOf.get(e.id) ?? 0n);
        if (!e.cancelledAt && left > 0n) r.advances.push({ id: e.id, ref: cashRef(e.refNo), date: e.workDate, amount: e.amount, left: rupees(left), attendance: sent.get(e.id) ?? null });
        continue;
      }
      const plant = (e.kind === "staff_out" && e.staffPurpose === "plant") || (e.kind === "staff_in" && e.staffPurpose === "plant");
      if (!plant) continue;
      const line: StaffLine = { kind: e.kind === "staff_out" ? "given" : "back", id: e.id, ref: cashRef(e.refNo), date: e.workDate, amount: e.amount, what: e.note, by: e.createdByName, cancelled };
      r.lines.push(line);
      if (!cancelled) e.kind === "staff_out" ? (r.g += paise(e.amount)) : (r.b += paise(e.amount));
    }
    for (const x of spent) {
      const r = row(x.personUserId, x.personName);
      const cancelled = x.cancelledAt ? { by: x.cancelledByName ?? "", reason: x.cancelReason ?? "" } : null;
      r.lines.push({ kind: "spent", id: x.id, ref: null, date: x.spentOn, amount: x.amount, what: [cats.get(x.categoryId), x.paidTo, x.note].filter(Boolean).join(" · ") || null, by: x.createdByName, cancelled });
      if (!cancelled) r.s += paise(x.amount);
    }
    return [...people.values()]
      .filter((r) => r.lines.length || r.advances.length)
      .map(({ g, b, s, ...r }) => ({ ...r, given: rupees(g), back: rupees(b), spent: rupees(s), open: rupees(g - b - s), lines: r.lines.sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : 0)) }))
      .sort((a, b) => Number(paise(b.open) - paise(a.open)) || a.person.localeCompare(b.person));
  });
}

/** What is open with one person (plant-spending cash), in paise. */
async function openOf(tx: OcTx, t: string, userId: string | null, name: string) {
  const k = keyOf(userId, name);
  const { entries, spent } = await rowsOf(tx, t);
  let open = 0n;
  for (const e of entries)
    if (e.personName && !e.cancelledAt && e.staffPurpose === "plant" && keyOf(e.personUserId, e.personName) === k) open += e.kind === "staff_out" ? paise(e.amount) : -paise(e.amount);
  for (const x of spent) if (!x.cancelledAt && keyOf(x.personUserId, x.personName) === k) open -= paise(x.amount);
  return open;
}

const Amount = z.string().trim().regex(/^\d{1,8}(\.\d{1,2})?$/, "amount in rupees, e.g. 500 or 1250.50");
export const SpendInput = z.object({
  person_key: z.string().min(3).max(120),
  spent_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  category_id: z.uuid(),
  amount: Amount,
  paid_to: z.string().trim().max(100).optional(),
  note: z.string().trim().max(300).optional(),
});

/** Owner, Accounts: what a person paid out of cash given to them. Never more than is open with them; never for yourself. */
export async function addSpend(user: OcUser, input: z.infer<typeof SpendInput>, today = istToday()) {
  requireAccess(user, "cash_enter");
  if (input.spent_on > today) throw badRequest("The day can't be after today");
  if (input.spent_on < addDays(today, -62)) throw badRequest("At most 2 months back");
  if (paise(input.amount) <= 0n) throw badRequest("The amount must be more than ₹0");
  const rows = await openWithStaff(user);
  const person = rows.find((r) => r.key === input.person_key);
  if (!person) throw notFound("That person has no cash given for plant spending");
  if (person.person_user_id === user.userId || person.person.trim().toLowerCase() === user.name.trim().toLowerCase()) throw badRequest("You can't enter your own spending. The owner or someone else enters it.");
  return withTenant(user.tenantId, async (tx) => {
    const t = user.tenantId;
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('order_capture.cash'), hashtext(${t}))`);
    const [c] = await tx.select().from(expenseCategories).where(and(eq(expenseCategories.tenantId, t), eq(expenseCategories.id, input.category_id)));
    if (!c || !c.active) throw badRequest("That expense type isn't on the list. Pick again.");
    const open = await openOf(tx, t, person.person_user_id, person.person);
    if (paise(input.amount) > open) throw badRequest(open > 0n ? `Only ${rupees(open)} is open with ${person.person}` : `Nothing is open with ${person.person}`);
    const [row] = await tx
      .insert(spends)
      .values({ tenantId: t, personUserId: person.person_user_id, personName: person.person, spentOn: input.spent_on, categoryId: c.id, amount: input.amount, paidTo: input.paid_to || null, note: input.note || null, createdBy: user.userId, createdByName: user.name })
      .returning({ id: spends.id });
    await audit(tx, user, "cash.spent", row!.id, { person: person.person, amount: input.amount, category: c.name, date: input.spent_on });
    return { id: row!.id, person: person.person, amount: input.amount, open: rupees(open - paise(input.amount)) };
  });
}

/** Owner: cancel a wrong "spent" (with a reason); the cash is open with the person again. */
export async function cancelSpend(user: OcUser, id: string, reason: string) {
  requireAccess(user, "cash_owner");
  const why = reason.trim();
  if (why.length < 3 || why.length > 300) throw badRequest("Please give a reason (at least 3 letters)");
  return withTenant(user.tenantId, async (tx) => {
    const [x] = await tx.select().from(spends).where(and(eq(spends.tenantId, user.tenantId), eq(spends.id, id)));
    if (!x) throw notFound();
    if (x.cancelledAt) throw conflict("Already cancelled");
    await tx.update(spends).set({ cancelledAt: new Date(), cancelledBy: user.userId, cancelledByName: user.name, cancelReason: why }).where(and(eq(spends.tenantId, user.tenantId), eq(spends.id, id)));
    await audit(tx, user, "cash.spent_cancel", id, { person: x.personName, amount: x.amount, reason: why });
    return { person: x.personName, amount: x.amount };
  });
}
