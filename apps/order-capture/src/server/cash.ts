// The cash book (petty cash) inside Sales, step C1 (docs/CASHBOOK_PHASE_PLAN.md): the owner starts it with today's
// count; owner and Accounts enter expenses, staff cash and money in / out, and close each day by counting the box. Cash in
// hand is worked out, never stored (src/lib/cash.ts). Nothing is deleted: the owner cancels a wrong entry with a reason;
// a wrong close is corrected by the owner as a new version with a reason. Entries go on days after the last close only.
import { and, asc, desc, eq, gt, lte, sql } from "drizzle-orm";
import { z } from "zod";
import {
  bookDays,
  cashRef,
  directionOf,
  expectedOn,
  paise,
  rupees,
  STARTER_CATEGORIES,
  type CashKind,
  type MathClose,
  type MathEntry,
  type StaffPurpose,
} from "@/lib/cash";
import { requireAccess } from "./access";
import { audit } from "./audit";
import { schema, withTenant, type OcTx } from "./db";
import { badRequest, conflict, notFound } from "./http";
import { kit } from "./kit";
import type { OcUser } from "./session";

const { cashCloses, cashEntries, cashVehicles, expenseCategories } = schema;

const IST = "Asia/Kolkata";
export const istToday = (now = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: IST }).format(now);
export const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const YMD = /^\d{4}-\d{2}-\d{2}$/;
const Day = z.string().regex(YMD, "date as YYYY-MM-DD");
const Amount = z.string().trim().regex(/^\d{1,8}(\.\d{1,2})?$/, "amount in rupees, e.g. 500 or 1250.50");
const Reason = z.string().trim().min(3, "Please give a reason (at least 3 letters)").max(300);
/** How many days back an entry may be put (the group posts 2-3 days late; owner's plan: "the past 7 days"). */
export const BACK_DAYS = 7;

// ---------- what is saved so far ----------

/** The latest version of each day's close, oldest day first. */
export async function closesOf(tx: OcTx, t: string) {
  const rows = await tx.execute<{ id: string; cash_date: string; version: number; opening: boolean; counted: string; expected: string; difference: string; reason: string | null; created_by_name: string; created_at: Date }>(sql`
    select distinct on (cash_date) id, cash_date::text, version, opening, counted::text, expected::text, difference::text, reason, created_by_name, created_at
      from order_capture.cash_closes where tenant_id = ${t}
     order by cash_date, version desc`);
  return rows.rows;
}
type CloseRow = Awaited<ReturnType<typeof closesOf>>[number];

const mathEntry = (e: { cashDate: string; direction: "in" | "out"; amount: string; cancelledAt: Date | null }): MathEntry => ({
  cash_date: e.cashDate,
  direction: e.direction,
  amount: e.amount,
  cancelled: e.cancelledAt !== null,
});
const mathClose = (c: CloseRow): MathClose => ({ cash_date: c.cash_date, counted: c.counted });

async function entriesFrom(tx: OcTx, t: string, from: string | null, to: string) {
  return tx
    .select()
    .from(cashEntries)
    .where(and(eq(cashEntries.tenantId, t), from ? gt(cashEntries.cashDate, from) : undefined, lte(cashEntries.cashDate, to)))
    .orderBy(asc(cashEntries.cashDate), asc(cashEntries.refNo));
}

export const cashLock = (tx: OcTx, t: string) => tx.execute(sql`select pg_advisory_xact_lock(hashtext('order_capture.cash'), hashtext(${t}))`);

// ---------- lists: categories, vehicles, people ----------

export async function cashLists(user: OcUser) {
  requireAccess(user, "cash_view");
  const [lists, contacts] = await Promise.all([
    withTenant(user.tenantId, async (tx) => ({
      categories: await tx.select({ id: expenseCategories.id, name: expenseCategories.name, active: expenseCategories.active }).from(expenseCategories).where(eq(expenseCategories.tenantId, user.tenantId)).orderBy(asc(expenseCategories.sort), asc(expenseCategories.name)),
      vehicles: await tx.select({ id: cashVehicles.id, name: cashVehicles.name, active: cashVehicles.active }).from(cashVehicles).where(eq(cashVehicles.tenantId, user.tenantId)).orderBy(asc(cashVehicles.sort), asc(cashVehicles.name)),
      names: (await tx.execute<{ name: string }>(sql`select distinct person_name as name from order_capture.cash_entries where tenant_id = ${user.tenantId} and person_name is not null order by 1 limit 200`)).rows.map((r) => r.name),
    })),
    kit.contacts(user.tenantId),
  ]);
  // people with a Sales role or owners (the platform's list); other employees are typed by name until the Attendance link (C4)
  const people = (contacts ?? []).filter((c) => c.user_id !== user.userId).map((c) => ({ id: c.user_id, name: c.display_name }));
  return { ...lists, people };
}

export const ListInput = z.object({ list: z.enum(["category", "vehicle"]), name: z.string().trim().min(1).max(60) });
export const ListEdit = z.object({ list: z.enum(["category", "vehicle"]), name: z.string().trim().min(1).max(60).optional(), active: z.boolean().optional() });

const tableOf = (list: "category" | "vehicle") => (list === "category" ? expenseCategories : cashVehicles);

export async function addListItem(user: OcUser, input: z.infer<typeof ListInput>) {
  requireAccess(user, "cash_owner");
  if (input.list === "vehicle" && input.name.length > 40) throw badRequest("A vehicle name is at most 40 letters");
  return withTenant(user.tenantId, async (tx) => {
    const tbl = tableOf(input.list);
    const dup = await tx.execute(sql`select 1 from ${tbl} where tenant_id = ${user.tenantId} and lower(trim(name)) = lower(${input.name})`);
    if (dup.rows.length) throw conflict(`"${input.name}" is already on the list`);
    const [{ n }] = (await tx.execute<{ n: number }>(sql`select coalesce(max(sort), 0)::int + 1 as n from ${tbl} where tenant_id = ${user.tenantId}`)).rows as [{ n: number }];
    const [row] = await tx.insert(tbl).values({ tenantId: user.tenantId, name: input.name, sort: n, createdBy: user.userId, createdByName: user.name }).returning({ id: tbl.id });
    await audit(tx, user, `cash.${input.list}_add`, row!.id, { name: input.name });
    return { id: row!.id };
  });
}

export async function editListItem(user: OcUser, id: string, input: z.infer<typeof ListEdit>) {
  requireAccess(user, "cash_owner");
  return withTenant(user.tenantId, async (tx) => {
    const tbl = tableOf(input.list);
    const [old] = await tx.select().from(tbl).where(and(eq(tbl.tenantId, user.tenantId), eq(tbl.id, id)));
    if (!old) throw notFound();
    if (input.name && input.name.toLowerCase() !== old.name.toLowerCase()) {
      const dup = await tx.execute(sql`select 1 from ${tbl} where tenant_id = ${user.tenantId} and lower(trim(name)) = lower(${input.name}) and id <> ${id}`);
      if (dup.rows.length) throw conflict(`"${input.name}" is already on the list`);
    }
    await tx.update(tbl).set({ ...(input.name ? { name: input.name } : {}), ...(input.active !== undefined ? { active: input.active } : {}), updatedAt: new Date() }).where(and(eq(tbl.tenantId, user.tenantId), eq(tbl.id, id)));
    await audit(tx, user, `cash.${input.list}_edit`, id, { name: input.name ?? old.name, was: old.name, active: input.active ?? old.active });
    return { ok: true };
  });
}

// ---------- start the cash book (owner): the first close is the opening balance ----------

export const StartInput = z.object({ date: Day, counted: Amount });

export async function startCashBook(user: OcUser, input: z.infer<typeof StartInput>, today = istToday()) {
  requireAccess(user, "cash_owner");
  if (input.date > today) throw badRequest("The opening count can't be for a day that hasn't come yet");
  if (input.date < addDays(today, -31)) throw badRequest("Start the cash book with a recent day (the last 31 days)");
  return withTenant(user.tenantId, async (tx) => {
    await cashLock(tx, user.tenantId);
    if ((await closesOf(tx, user.tenantId)).length) throw conflict("The cash book has already been started");
    await tx.insert(cashCloses).values({ tenantId: user.tenantId, cashDate: input.date, version: 1, opening: true, counted: input.counted, expected: input.counted, difference: "0", createdBy: user.userId, createdByName: user.name });
    const have = await tx.select({ id: expenseCategories.id }).from(expenseCategories).where(eq(expenseCategories.tenantId, user.tenantId)).limit(1);
    if (!have.length)
      await tx.insert(expenseCategories).values(STARTER_CATEGORIES.map((name, i) => ({ tenantId: user.tenantId, name, sort: i + 1, createdBy: user.userId, createdByName: user.name })));
    await audit(tx, user, "cash.start", null, { date: input.date, counted: input.counted });
    return { ok: true };
  });
}

// ---------- entries ----------

export const EntryInput = z.object({
  kind: z.enum(["expense", "staff_out", "staff_in", "owner_in", "owner_out", "bank_deposit", "other_in", "other_out"]),
  amount: Amount,
  cash_date: Day,
  work_date: Day.optional(),
  category_id: z.uuid().optional(),
  vehicle_id: z.uuid().optional(),
  person_user_id: z.uuid().optional(),
  person_name: z.string().trim().min(1).max(100).optional(),
  staff_purpose: z.enum(["advance", "plant", "salary"]).optional(),
  paid_to: z.string().trim().max(100).optional(),
  note: z.string().trim().max(300).optional(),
});
export type EntryInput = z.infer<typeof EntryInput>;

export interface SavedEntry {
  id: string;
  ref: string;
  kind: CashKind;
  amount: string;
  cash_date: string;
  work_date: string;
  category: string | null;
  person: string | null;
  purpose: StaffPurpose | null;
  paid_to: string | null;
  note: string | null;
}

/** Days an entry may go on now: after the last close, up to today, at most BACK_DAYS back. */
export function entryWindow(lastClose: string, today: string) {
  const from = [addDays(lastClose, 1), addDays(today, -BACK_DAYS)].sort().at(-1)!;
  return { from, to: today };
}

export async function addEntry(user: OcUser, input: EntryInput, today = istToday()): Promise<SavedEntry> {
  requireAccess(user, "cash_enter");
  const k = input.kind;
  const work = input.work_date ?? input.cash_date;
  if (work > input.cash_date) throw badRequest("The work day can't be after the day the cash came in");
  if (work < addDays(input.cash_date, -31)) throw badRequest("The work day can be at most 31 days earlier");
  if (k === "expense" && !input.category_id) throw badRequest("Pick what the expense was for");
  const staff = k === "staff_out" || k === "staff_in";
  if (k === "staff_out" && !input.staff_purpose) throw badRequest("Pick what the cash was for: advance, plant spending or salary");
  if (staff && !input.person_user_id && !input.person_name) throw badRequest("Who was the cash given to?");
  const contacts = staff && input.person_user_id ? await kit.contacts(user.tenantId) : null;

  return withTenant(user.tenantId, async (tx) => {
    const t = user.tenantId;
    await cashLock(tx, t);
    const closes = await closesOf(tx, t);
    if (!closes.length) throw badRequest("The cash book hasn't been started yet. The owner starts it with today's cash count.");
    const w = entryWindow(closes.at(-1)!.cash_date, today);
    if (input.cash_date > w.to) throw badRequest("The cash day can't be after today");
    if (input.cash_date < w.from)
      throw badRequest(input.cash_date <= closes.at(-1)!.cash_date ? `${input.cash_date} is already closed. Put it on today's sheet (the work day can stay ${work}).` : `At most ${BACK_DAYS} days back`);

    let categoryName: string | null = null;
    if (k === "expense") {
      const [c] = await tx.select().from(expenseCategories).where(and(eq(expenseCategories.tenantId, t), eq(expenseCategories.id, input.category_id!)));
      if (!c || !c.active) throw badRequest("That expense category isn't on the list. Pick again.");
      categoryName = c.name;
    }
    if (input.vehicle_id) {
      const [v] = await tx.select().from(cashVehicles).where(and(eq(cashVehicles.tenantId, t), eq(cashVehicles.id, input.vehicle_id)));
      if (!v || !v.active) throw badRequest("That vehicle isn't on the list. Pick again.");
    }
    let personId: string | null = null;
    let personName: string | null = null;
    if (staff) {
      if (input.person_user_id) {
        const c = (contacts ?? []).find((x) => x.user_id === input.person_user_id);
        if (!c) throw badRequest("That person isn't one of the plant's people. Pick again or type the name.");
        personId = c.user_id;
        personName = c.display_name;
      } else personName = input.person_name!;
      if (personId === user.userId || personName.trim().toLowerCase() === user.name.trim().toLowerCase())
        throw badRequest("You can't enter cash given to yourself. The owner or someone else enters it.");
    }

    const [{ n }] = (await tx.execute<{ n: number }>(sql`select coalesce(max(ref_no), 0)::int + 1 as n from order_capture.cash_entries where tenant_id = ${t}`)).rows as [{ n: number }];
    const [row] = await tx
      .insert(cashEntries)
      .values({
        tenantId: t,
        refNo: n,
        cashDate: input.cash_date,
        workDate: work,
        kind: k,
        direction: directionOf(k),
        amount: input.amount,
        categoryId: k === "expense" ? input.category_id! : null,
        vehicleId: input.vehicle_id ?? null,
        personUserId: personId,
        personName,
        staffPurpose: k === "staff_out" ? input.staff_purpose! : null,
        paidTo: input.paid_to || null,
        note: input.note || null,
        createdBy: user.userId,
        createdByName: user.name,
      })
      .returning({ id: cashEntries.id, amount: cashEntries.amount });
    const saved: SavedEntry = { id: row!.id, ref: cashRef(n), kind: k, amount: row!.amount, cash_date: input.cash_date, work_date: work, category: categoryName, person: personName, purpose: k === "staff_out" ? input.staff_purpose! : null, paid_to: input.paid_to || null, note: input.note || null };
    await audit(tx, user, "cash.entry", row!.id, { ref: saved.ref, kind: k, amount: saved.amount, date: input.cash_date, ...(categoryName ? { category: categoryName } : {}), ...(personName ? { person: personName } : {}) });
    return saved;
  });
}

export const CancelInput = z.object({ reason: Reason });

export async function cancelEntry(user: OcUser, id: string, input: z.infer<typeof CancelInput>) {
  requireAccess(user, "cash_owner");
  return withTenant(user.tenantId, async (tx) => {
    await cashLock(tx, user.tenantId);
    const [e] = await tx.select().from(cashEntries).where(and(eq(cashEntries.tenantId, user.tenantId), eq(cashEntries.id, id)));
    if (!e) throw notFound("Entry not found");
    if (e.cancelledAt) throw conflict(`${cashRef(e.refNo)} was already cancelled`);
    if (e.kind === "collection" || e.kind === "van") {
      // a line already posted onto a customer's account keeps the entry: cancel that payment first (C2)
      const posted = await tx.execute<{ number: string }>(sql`
        select pay.number from order_capture.collection_lines l
          join lateral (select * from order_capture.collection_posts x where x.tenant_id = l.tenant_id and x.line_id = l.id order by x.created_at desc limit 1) p on true
          join order_capture.payments pay on pay.tenant_id = l.tenant_id and pay.id = p.payment_id
         where l.tenant_id = ${user.tenantId} and l.cash_entry_id = ${id} and p.outcome = 'posted' and pay.cancelled_at is null`);
      // a van report's "not paid" lines already billed (C3)
      const billed = await tx.execute<{ number: string }>(sql`
        select b.number from order_capture.van_reports r
          join order_capture.van_credit_lines c on c.tenant_id = r.tenant_id and c.report_id = r.id
          join lateral (select * from order_capture.van_credit_posts x where x.tenant_id = c.tenant_id and x.credit_line_id = c.id order by x.created_at desc limit 1) p on true
          join order_capture.bills b on b.tenant_id = c.tenant_id and b.id = p.bill_id
         where r.tenant_id = ${user.tenantId} and r.cash_entry_id = ${id} and p.outcome = 'billed' and b.cancelled_at is null`);
      const live = [...posted.rows, ...billed.rows].map((r) => r.number);
      if (live.length)
        throw conflict(`Lines of ${cashRef(e.refNo)} are already on customers' accounts (${live.join(", ")}). Cancel ${live.length === 1 ? "that payment / bill" : "those payments / bills"} first.`);
    }
    await tx.update(cashEntries).set({ cancelledAt: new Date(), cancelledBy: user.userId, cancelledByName: user.name, cancelReason: input.reason }).where(and(eq(cashEntries.tenantId, user.tenantId), eq(cashEntries.id, id)));
    await audit(tx, user, "cash.cancel", id, { ref: cashRef(e.refNo), amount: e.amount, reason: input.reason });
    return { ref: cashRef(e.refNo), amount: e.amount, cash_date: e.cashDate };
  });
}

// ---------- close a day (count the box) ----------

export const CloseInput = z.object({ date: Day, counted: Amount, reason: Reason.optional() });

export interface SavedClose {
  id: string;
  date: string;
  version: number;
  counted: string;
  expected: string;
  difference: string;
}

/** Close a day after the last close (owner, Accounts); or, owner only, correct the last close as a new version. */
export async function closeDay(user: OcUser, input: z.infer<typeof CloseInput>, today = istToday()): Promise<SavedClose> {
  requireAccess(user, "cash_close");
  if (input.date > today) throw badRequest("You can't close a day that hasn't come yet");
  return withTenant(user.tenantId, async (tx) => {
    const t = user.tenantId;
    await cashLock(tx, t);
    const closes = await closesOf(tx, t);
    const last = closes.at(-1);
    if (!last) throw badRequest("The cash book hasn't been started yet. The owner starts it with today's cash count.");
    if (input.date < last.cash_date) throw badRequest(`Days up to ${last.cash_date} are closed. Only the last close can be corrected.`);
    const correcting = input.date === last.cash_date;
    if (correcting) {
      requireAccess(user, "cash_owner");
      if (!input.reason) throw badRequest("Correcting a close needs a reason");
    }
    const entries = (await entriesFrom(tx, t, null, input.date)).map(mathEntry);
    let expected: bigint;
    if (correcting && last.opening) expected = paise(last.counted);
    else {
      const e = expectedOn(input.date, closes.map(mathClose), entries);
      if (!e) throw badRequest("Nothing to close before the cash book started");
      expected = e.expected;
    }
    const counted = paise(input.counted);
    const difference = counted - expected;
    if (difference !== 0n && !input.reason) throw badRequest(`The count is ${difference < 0n ? "short" : "more"} by ${rupees(difference < 0n ? -difference : difference)}. Please give a reason.`);
    const version = correcting ? last.version + 1 : 1;
    const [row] = await tx
      .insert(cashCloses)
      .values({ tenantId: t, cashDate: input.date, version, opening: false, counted: rupees(counted), expected: rupees(expected), difference: rupees(difference), reason: input.reason ?? null, createdBy: user.userId, createdByName: user.name })
      .returning({ id: cashCloses.id });
    await audit(tx, user, correcting ? "cash.close_fix" : "cash.close", row!.id, { date: input.date, counted: rupees(counted), difference: rupees(difference), ...(input.reason ? { reason: input.reason } : {}) });
    return { id: row!.id, date: input.date, version, counted: rupees(counted), expected: rupees(expected), difference: rupees(difference) };
  });
}

// ---------- the day sheet ----------

export interface EntryView {
  id: string;
  ref: string;
  kind: CashKind;
  direction: "in" | "out";
  amount: string;
  cash_date: string;
  work_date: string;
  category: string | null;
  vehicle: string | null;
  person: string | null;
  purpose: StaffPurpose | null;
  paid_to: string | null;
  note: string | null;
  by: string;
  at: string;
  cancelled: { by: string; reason: string } | null;
}

async function entryViews(tx: OcTx, t: string, rows: Awaited<ReturnType<typeof entriesFrom>>): Promise<EntryView[]> {
  const cats = new Map((await tx.select({ id: expenseCategories.id, name: expenseCategories.name }).from(expenseCategories).where(eq(expenseCategories.tenantId, t))).map((c) => [c.id, c.name]));
  const vans = new Map((await tx.select({ id: cashVehicles.id, name: cashVehicles.name }).from(cashVehicles).where(eq(cashVehicles.tenantId, t))).map((c) => [c.id, c.name]));
  return rows.map((e) => ({
    id: e.id,
    ref: cashRef(e.refNo),
    kind: e.kind,
    direction: e.direction,
    amount: e.amount,
    cash_date: e.cashDate,
    work_date: e.workDate,
    category: e.categoryId ? (cats.get(e.categoryId) ?? null) : null,
    vehicle: e.vehicleId ? (vans.get(e.vehicleId) ?? null) : null,
    person: e.personName,
    purpose: e.staffPurpose,
    paid_to: e.paidTo,
    note: e.note,
    by: e.createdByName,
    at: e.createdAt.toISOString(),
    cancelled: e.cancelledAt ? { by: e.cancelledByName ?? "", reason: e.cancelReason ?? "" } : null,
  }));
}

export async function daySheet(user: OcUser, date: string, today = istToday()) {
  requireAccess(user, "cash_view");
  if (!YMD.test(date)) throw notFound();
  return withTenant(user.tenantId, async (tx) => {
    const t = user.tenantId;
    const closes = await closesOf(tx, t);
    if (!closes.length) return { started: false as const, date, today };
    const first = closes[0]!.cash_date;
    const last = closes.at(-1)!;
    const all = await entriesFrom(tx, t, null, date);
    const math = all.map(mathEntry);
    const exp = expectedOn(date, closes.map(mathClose), math);
    const close = closes.find((c) => c.cash_date === date) ?? null;
    const history = close
      ? await tx.select().from(cashCloses).where(and(eq(cashCloses.tenantId, t), eq(cashCloses.cashDate, date))).orderBy(desc(cashCloses.version))
      : [];
    const todays = await entryViews(tx, t, all.filter((e) => e.cashDate === date));
    // days after the previous close, before this one, with entries but no close of their own: rolled into this day
    const earlier = exp ? all.filter((e) => e.cashDate > exp.from && e.cashDate < date && !e.cancelledAt) : [];
    const earlierDays = [...new Set(earlier.map((e) => e.cashDate))];
    const w = entryWindow(last.cash_date, today);
    return {
      started: true as const,
      date,
      today,
      first,
      before_start: date < first,
      opening_from: exp?.from ?? null,
      opening: exp ? rupees(exp.opening) : null,
      in: exp ? rupees(exp.in) : "0.00",
      out: exp ? rupees(exp.out) : "0.00",
      expected: exp ? rupees(exp.expected) : null,
      earlier_days: earlierDays,
      close: close ? { version: close.version, opening: close.opening, counted: close.counted, expected: close.expected, difference: close.difference, reason: close.reason, by: close.created_by_name, at: new Date(close.created_at).toISOString() } : null,
      close_history: history.map((h) => ({ version: h.version, counted: h.counted, difference: h.difference, reason: h.reason, by: h.createdByName, at: h.createdAt.toISOString() })),
      /** a close made before an entry was cancelled: what the count is off by now */
      live_difference: close && exp && !close.opening ? rupees(paise(close.counted) - exp.expected) : null,
      entries: todays,
      can_enter: date >= w.from && date <= w.to,
      can_close: date > last.cash_date && date <= today,
      can_fix_close: date === last.cash_date,
      last_close: last.cash_date,
    };
  });
}
export type DaySheet = Awaited<ReturnType<typeof daySheet>>;

// ---------- the owner's cash book (a month) ----------

export async function cashBook(user: OcUser, month: string) {
  requireAccess(user, "cash_view");
  if (!/^\d{4}-\d{2}$/.test(month)) throw notFound();
  const from = `${month}-01`;
  const to = addDays(`${addDays(from, 32).slice(0, 7)}-01`, -1);
  return withTenant(user.tenantId, async (tx) => {
    const t = user.tenantId;
    const closes = await closesOf(tx, t);
    if (!closes.length) return { started: false as const, month, days: [], categories: [], staff: [], totals: null };
    const all = await entriesFrom(tx, t, null, to);
    const days = bookDays(closes.map(mathClose), all.map(mathEntry)).filter((d) => d.date >= from && d.date <= to);
    const inMonth = all.filter((e) => e.cashDate >= from && !e.cancelledAt);
    const views = await entryViews(tx, t, inMonth);
    const cat = new Map<string, bigint>();
    for (const e of views) if (e.kind === "expense") cat.set(e.category ?? "Other", (cat.get(e.category ?? "Other") ?? 0n) + paise(e.amount));
    const closedBy = new Map(closes.map((c) => [c.cash_date, c.created_by_name]));
    const late = views.filter((e) => e.work_date < e.cash_date).length;
    return {
      started: true as const,
      month,
      days: days.map((d) => ({ date: d.date, opening: rupees(d.opening), in: rupees(d.in), out: rupees(d.out), expected: rupees(d.expected), counted: d.counted === null ? null : rupees(d.counted), difference: d.difference === null ? null : rupees(d.difference), entries: d.entries, closed_by: closedBy.get(d.date) ?? null })),
      categories: [...cat.entries()].sort((a, b) => (b[1] > a[1] ? 1 : b[1] < a[1] ? -1 : 0)).map(([name, p]) => ({ name, amount: rupees(p) })),
      staff: views.filter((e) => e.kind === "staff_out" || e.kind === "staff_in").map((e) => ({ ref: e.ref, date: e.cash_date, person: e.person, purpose: e.purpose, direction: e.direction, amount: e.amount })),
      totals: { in: rupees(days.reduce((s, d) => s + d.in, 0n)), out: rupees(days.reduce((s, d) => s + d.out, 0n)), expenses: rupees([...cat.values()].reduce((a, b) => a + b, 0n)), entries: views.length, late },
    };
  });
}

// ---------- daily job: a day with entries left open ----------

/** For each plant with a cash book: entries after the last close, up to yesterday (India date). */
export async function notClosedPlants(dbList: () => Promise<string[]>, today = istToday()) {
  const yesterday = addDays(today, -1);
  const out: { tenantId: string; since: string; days: string[]; yesterday: string }[] = [];
  for (const t of await dbList()) {
    const r = await withTenant(t, async (tx) => {
      const closes = await closesOf(tx, t);
      const last = closes.at(-1);
      if (!last || last.cash_date >= yesterday) return null;
      const open = await tx
        .select({ d: cashEntries.cashDate })
        .from(cashEntries)
        .where(and(eq(cashEntries.tenantId, t), gt(cashEntries.cashDate, last.cash_date), lte(cashEntries.cashDate, yesterday), sql`${cashEntries.cancelledAt} is null`));
      return open.length ? { tenantId: t, since: last.cash_date, days: [...new Set(open.map((o) => o.d))].sort(), yesterday } : null;
    });
    if (r) out.push(r);
  }
  return out;
}
