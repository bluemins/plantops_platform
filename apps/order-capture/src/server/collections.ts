// Cash book step C2 (docs/CASHBOOK_PHASE_PLAN.md section 6a): the 20 L customers and collections.
//
// - 20 L import (owner): the owner's 20 L pending report → Sales customers with a "20 L" mark and what they owe as an
//   opening-balance bill (OB20-…). Rules: src/lib/jar-import.ts. Preview first; confirm saves everything or nothing.
// - Collection (owner, Accounts): customers + amount + Cash / Online. The cash part goes into the cash book at once (one
//   'collection' entry, C-number); every line WAITS in Sales as "collected, not posted yet" (owner 2026-11-11: "it should
//   not update the billing directly").
// - Post (owner, Accounts): a waiting line becomes a payment on the customer's account (Receive payment's own rules,
//   src/server/ledger.ts receiveInTx), possibly on another customer picked at posting; or it is turned down with a reason.
//   A posted line whose payment is later cancelled waits again. Nothing is changed or deleted.
import { randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { cashRef, paise, rupees } from "@/lib/cash";
import { jarPlan, type JarChoice, type JarSheet, type PlanCustomer } from "@/lib/jar-import";
import { requireAccess } from "./access";
import { audit } from "./audit";
import { addDays, cashLock, closesOf, entryWindow, istToday } from "./cash";
import { insertCustomer } from "./customers";
import { schema, withTenant, type OcTx } from "./db";
import { extraPhoneOwners } from "./drop/shops";
import { badRequest, conflict, notFound } from "./http";
import { receiveInTx } from "./ledger";
import type { OcUser } from "./session";

const { bills, cashEntries, collectionLines, collectionPosts, customers, jarCustomers, jarImports } = schema;

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const Day = z.string().regex(YMD, "date as YYYY-MM-DD");
const Rupees = z.string().regex(/^\d{1,9}\.\d{2}$/);
const Amount = z.string().trim().regex(/^\d{1,8}(\.\d{1,2})?$/, "amount in rupees, e.g. 50 or 120.50");
const Reason = z.string().trim().min(3, "Please give a reason (at least 3 letters)").max(300);

// ---------- 20 L import (owner) ----------

const Choice = z.discriminatedUnion("action", [
  z.object({ action: z.literal("add") }),
  z.object({ action: z.literal("skip") }),
  z.object({ action: z.literal("mobile"), mobile: z.string().trim().min(1).max(30) }),
]);

export const JarImportInput = z.object({
  file_name: z.string().trim().min(1).max(200),
  rows: z
    .array(z.object({ ref: z.string().trim().min(1).max(60), name: z.string().trim().min(1).max(200), mobile_typed: z.string().trim().max(30), group: z.string().trim().max(60), pref: z.string().trim().max(30), due: Rupees }))
    .min(1)
    .max(5000),
  file_total: Rupees.nullable(),
  choices: z.record(z.string(), Choice).default({}),
  /** the place new customers get (the owner can change each later) */
  place: z.string().trim().min(2, "Place: at least 2 letters").max(200),
  /** confirm only: what the preview showed, so a list that changed in between is refused */
  expect: z.object({ create: z.number().int(), add: z.number().int(), imported: Rupees }).optional(),
});
export type JarImportInput = z.infer<typeof JarImportInput>;

const jarLock = (tx: OcTx, t: string) => tx.execute(sql`select pg_advisory_xact_lock(hashtext('order_capture.jar'), hashtext(${t}))`);

async function planIn(tx: OcTx, t: string, input: JarImportInput) {
  const all = await tx.select({ id: customers.id, name: customers.name, phone: customers.phone }).from(customers).where(eq(customers.tenantId, t));
  const byPhone = new Map(all.map((c) => [c.phone, c as PlanCustomer]));
  const byId = new Map(all.map((c) => [c.id, c as PlanCustomer]));
  const extras = await extraPhoneOwners(tx, t);
  const customerOf = (phone: string) => byPhone.get(phone) ?? (extras.has(phone) ? (byId.get(extras.get(phone)!) ?? null) : null);
  const imported = new Set((await tx.select({ r: jarCustomers.sourceRef }).from(jarCustomers).where(eq(jarCustomers.tenantId, t))).map((x) => x.r));
  const sheet: JarSheet = { rows: input.rows, file_total: input.file_total };
  return jarPlan(sheet, customerOf, imported, input.choices as Record<string, JarChoice>);
}

/** What the import would do; nothing is saved. */
export async function jarPreview(user: OcUser, input: JarImportInput) {
  requireAccess(user, "jar_import");
  return withTenant(user.tenantId, (tx) => planIn(tx, user.tenantId, input));
}
export type JarPreview = Awaited<ReturnType<typeof jarPreview>>;

/** Save the import: customers, "20 L" marks and opening bills, all or nothing. */
export async function jarImport(user: OcUser, input: JarImportInput, today = istToday()) {
  requireAccess(user, "jar_import");
  return withTenant(user.tenantId, async (tx) => {
    const t = user.tenantId;
    await jarLock(tx, t);
    const plan = await planIn(tx, t, input);
    if (plan.total_mismatch) throw badRequest(`The file's Total (₹${plan.totals.file}) is not its rows added up (₹${plan.totals.rows}). Is it the report as downloaded?`);
    if (plan.counts.errors) throw badRequest(`${plan.counts.errors} row${plan.counts.errors === 1 ? " needs" : "s need"} a choice: type a real mobile or leave them out.`);
    if (!input.expect || input.expect.create !== plan.counts.create || input.expect.add !== plan.counts.add || input.expect.imported !== plan.totals.imported)
      throw conflict("The list changed since the preview (someone added customers or imported). Check the preview again.");
    const live = plan.rows.filter((r) => r.result === "create" || r.result === "add");
    if (!live.length) throw badRequest("Nothing new to import: every customer in this file is already here or left out.");
    const numbers = live.filter((r) => paise(r.due) > 0n).map((r) => r.number);
    if (new Set(numbers).size !== numbers.length) throw badRequest("Two rows give the same opening-balance number. Check the Ref. No. column.");
    if (numbers.length) {
      const taken = await tx.select({ n: bills.number }).from(bills).where(and(eq(bills.tenantId, t), inArray(bills.number, numbers)));
      if (taken.length) throw conflict(`Bill number ${taken[0]!.n} already exists. This list may have been imported another way.`);
    }

    const [imp] = await tx
      .insert(jarImports)
      .values({ tenantId: t, fileName: input.file_name, counts: { ...plan.counts }, totalDue: plan.totals.imported, importedBy: user.userId, importedByName: user.name })
      .returning({ id: jarImports.id });
    const made = new Map<string, { id: string; name: string }>();
    let created = 0;
    for (const r of live) {
      let cust: { id: string; name: string };
      if (r.result === "add") cust = r.customer!;
      else if (made.has(r.use_phone!)) cust = made.get(r.use_phone!)!;
      else {
        const typed = r.use_phone === r.phone ? r.mobile_typed : r.use_phone!;
        const res = await insertCustomer(tx, user, { name: r.name, phoneTyped: typed, phone: r.use_phone!, place: input.place }, { source: "20 L import", ref: r.ref });
        if (res.created) created++;
        cust = { id: res.customer.id, name: res.customer.name };
        made.set(r.use_phone!, cust);
      }
      let billId: string | null = null;
      if (paise(r.due) > 0n) {
        const [b] = await tx
          .insert(bills)
          .values({
            tenantId: t,
            source: "opening",
            number: r.number,
            billDate: today,
            dueDate: today,
            customerId: cust.id,
            customerName: cust.name,
            subTotal: r.due,
            total: r.due,
            notes: `20 L opening balance: ${r.name} (ref ${r.ref}), from ${input.file_name}`.slice(0, 2000),
            createdBy: user.userId,
            createdByName: user.name,
          })
          .returning({ id: bills.id });
        billId = b!.id;
      }
      await tx.insert(jarCustomers).values({
        tenantId: t,
        customerId: cust.id,
        sourceRef: r.ref,
        sourceName: r.name,
        groupName: r.group || null,
        paymentPref: r.pref || null,
        openingBillId: billId,
        openingDue: billId ? r.due : "0",
        importId: imp!.id,
        createdBy: user.userId,
        createdByName: user.name,
      });
    }
    const result = { customers_new: created, added_to_existing: plan.counts.add, left_out: plan.counts.skip, already: plan.counts.already, opening_bills: numbers.length, imported: plan.totals.imported, left_out_due: plan.totals.left_out };
    await audit(tx, user, "jar.import", imp!.id, { file: input.file_name, ...result });
    return result;
  });
}

// ---------- collections ----------

export const CollectionInput = z.object({
  cash_date: Day,
  work_date: Day.optional(),
  lines: z
    .array(z.object({ customer_id: z.uuid(), amount: Amount, mode: z.enum(["cash", "upi"]), note: z.string().trim().max(300).optional() }))
    .min(1, "Add at least one customer")
    .max(100),
});
export type CollectionInput = z.infer<typeof CollectionInput>;

/** Save a collection: the cash part into the cash book now, every line waiting in Sales to be posted. */
export async function addCollection(user: OcUser, input: CollectionInput, today = istToday()) {
  requireAccess(user, "cash_enter");
  const work = input.work_date ?? input.cash_date;
  if (work > input.cash_date) throw badRequest("The work day can't be after the day the cash came in");
  if (work < addDays(input.cash_date, -31)) throw badRequest("The work day can be at most 31 days earlier");
  for (const l of input.lines) if (paise(l.amount) <= 0n) throw badRequest("Each amount must be more than ₹0");
  return withTenant(user.tenantId, async (tx) => {
    const t = user.tenantId;
    await cashLock(tx, t);
    const closes = await closesOf(tx, t);
    if (!closes.length) throw badRequest("The cash book hasn't been started yet. The owner starts it with today's cash count.");
    const w = entryWindow(closes.at(-1)!.cash_date, today);
    if (input.cash_date > w.to) throw badRequest("The cash day can't be after today");
    if (input.cash_date < w.from) throw badRequest(input.cash_date <= closes.at(-1)!.cash_date ? `${input.cash_date} is already closed. Put it on today's sheet (the work day can stay ${work}).` : "At most 7 days back");
    const ids = [...new Set(input.lines.map((l) => l.customer_id))];
    const found = await tx.select({ id: customers.id, name: customers.name, active: customers.active }).from(customers).where(and(eq(customers.tenantId, t), inArray(customers.id, ids)));
    const nameOf = new Map(found.filter((c) => c.active).map((c) => [c.id, c.name]));
    const missing = ids.filter((id) => !nameOf.has(id));
    if (missing.length) throw badRequest("A customer on the list isn't in Sales (or is switched off). Pick again.");

    const cash = input.lines.filter((l) => l.mode === "cash").reduce((s, l) => s + paise(l.amount), 0n);
    const online = input.lines.filter((l) => l.mode === "upi").reduce((s, l) => s + paise(l.amount), 0n);
    let entry: { id: string; ref: string } | null = null;
    if (cash > 0n) {
      const [{ n }] = (await tx.execute<{ n: number }>(sql`select coalesce(max(ref_no), 0)::int + 1 as n from order_capture.cash_entries where tenant_id = ${t}`)).rows as [{ n: number }];
      const count = input.lines.filter((l) => l.mode === "cash").length;
      const [row] = await tx
        .insert(cashEntries)
        .values({ tenantId: t, refNo: n, cashDate: input.cash_date, workDate: work, kind: "collection", direction: "in", amount: rupees(cash), note: `Collection: ${count} customer${count === 1 ? "" : "s"}`, createdBy: user.userId, createdByName: user.name })
        .returning({ id: cashEntries.id });
      entry = { id: row!.id, ref: cashRef(n) };
    }
    const batch = randomUUID();
    await tx.insert(collectionLines).values(
      input.lines.map((l, i) => ({ tenantId: t, batchId: batch, lineNo: i + 1, cashEntryId: entry?.id ?? null, customerId: l.customer_id, amount: rupees(paise(l.amount)), mode: l.mode, workDate: work, note: l.note || null, createdBy: user.userId, createdByName: user.name })),
    );
    const saved = { ref: entry?.ref ?? null, cash: rupees(cash), online: rupees(online), lines: input.lines.length, cash_date: input.cash_date, work_date: work };
    await audit(tx, user, "cash.collection", entry?.id ?? batch, saved);
    return saved;
  });
}

export type LineStatus = "waiting" | "posted" | "turned_down" | "void";

/** Every line with its status (the latest post decides; a cancelled payment = waiting again; a cancelled entry = void). */
async function linesWithStatus(tx: OcTx, t: string, where = sql`true`) {
  const rows = await tx.execute<{
    id: string; batch_id: string; line_no: number; cash_entry_id: string | null; entry_ref: number | null; entry_cancelled: boolean;
    customer_id: string; customer_name: string; phone: string; amount: string; mode: "cash" | "upi"; work_date: string; note: string | null;
    created_by_name: string; created_at: Date; outcome: "posted" | "turned_down" | null; payment_id: string | null; payment_number: string | null;
    payment_cancelled: boolean | null; payment_customer: string | null; reason: string | null; posted_by: string | null;
  }>(sql`
    select l.id, l.batch_id, l.line_no, l.cash_entry_id, e.ref_no as entry_ref, coalesce(e.cancelled_at is not null, false) as entry_cancelled,
           l.customer_id, c.name as customer_name, c.phone, l.amount::text, l.mode, l.work_date::text, l.note, l.created_by_name, l.created_at,
           p.outcome, p.payment_id, pay.number as payment_number, pay.cancelled_at is not null as payment_cancelled, pay.customer_name as payment_customer,
           p.reason, p.created_by_name as posted_by
      from order_capture.collection_lines l
      join order_capture.customers c on c.tenant_id = l.tenant_id and c.id = l.customer_id
      left join order_capture.cash_entries e on e.tenant_id = l.tenant_id and e.id = l.cash_entry_id
      left join lateral (select * from order_capture.collection_posts x where x.tenant_id = l.tenant_id and x.line_id = l.id order by x.created_at desc limit 1) p on true
      left join order_capture.payments pay on pay.tenant_id = l.tenant_id and pay.id = p.payment_id
     where l.tenant_id = ${t} and ${where}
     order by l.work_date desc, l.created_at desc, l.line_no`);
  return rows.rows.map((r) => {
    const status: LineStatus =
      r.outcome === "turned_down" ? "turned_down" : r.outcome === "posted" && !r.payment_cancelled ? "posted" : r.entry_cancelled ? "void" : "waiting";
    return {
      id: r.id,
      batch_id: r.batch_id,
      line_no: r.line_no,
      entry: r.entry_ref ? cashRef(r.entry_ref) : null,
      customer: { id: r.customer_id, name: r.customer_name, phone: r.phone },
      amount: r.amount,
      mode: r.mode,
      work_date: r.work_date,
      note: r.note,
      by: r.created_by_name,
      at: new Date(r.created_at).toISOString(),
      status,
      payment: status === "posted" ? { id: r.payment_id!, number: r.payment_number!, customer: r.payment_customer! } : null,
      turned_down: status === "turned_down" ? { reason: r.reason!, by: r.posted_by! } : null,
    };
  });
}
export type CollectionLine = Awaited<ReturnType<typeof linesWithStatus>>[number];

/** The lines of one cash entry (the day sheet). */
export async function linesOfEntries(tx: OcTx, t: string, entryIds: string[]) {
  if (!entryIds.length) return [];
  return linesWithStatus(tx, t, sql`l.cash_entry_id in (${sql.join(entryIds.map((id) => sql`${id}::uuid`), sql`, `)})`);
}

/** The lines of these cash entries, for the day sheet. */
export async function entryLines(user: OcUser, entryIds: string[]) {
  requireAccess(user, "cash_view");
  return withTenant(user.tenantId, (tx) => linesOfEntries(tx, user.tenantId, entryIds));
}

/** How many lines wait to be posted (the "To post" tab): collection lines + van reports' "not paid" lines. */
export async function waitingToPost(user: OcUser) {
  const collections = (await collectionsList(user, "waiting", 1)).waiting.count;
  const credits = await withTenant(user.tenantId, async (tx) => {
    const r = await tx.execute<{ n: number }>(sql`
      select count(*)::int as n from order_capture.van_credit_lines c
        join order_capture.van_reports r on r.tenant_id = c.tenant_id and r.id = c.report_id
        join order_capture.cash_entries e on e.tenant_id = r.tenant_id and e.id = r.cash_entry_id and e.cancelled_at is null
        left join lateral (select * from order_capture.van_credit_posts x where x.tenant_id = c.tenant_id and x.credit_line_id = c.id order by x.created_at desc limit 1) p on true
        left join order_capture.bills b on b.tenant_id = c.tenant_id and b.id = p.bill_id
       where c.tenant_id = ${user.tenantId} and (p.id is null or (p.outcome = 'billed' and b.cancelled_at is not null))`);
    return r.rows[0]?.n ?? 0;
  });
  return collections + credits;
}

/** "Collections to post" in Sales: waiting lines (oldest first), or the latest of every status. */
export async function collectionsList(user: OcUser, show: "waiting" | "all" = "waiting", limit = 300) {
  requireAccess(user, "cash_view");
  return withTenant(user.tenantId, async (tx) => {
    const all = await linesWithStatus(tx, user.tenantId);
    // oldest first, in the order typed
    const waiting = all.filter((l) => l.status === "waiting").sort((x, y) => (x.work_date + x.at + String(x.line_no).padStart(3, "0") < y.work_date + y.at + String(y.line_no).padStart(3, "0") ? -1 : 1));
    return {
      lines: (show === "waiting" ? waiting : all).slice(0, limit),
      waiting: { count: waiting.length, amount: rupees(waiting.reduce((s, l) => s + paise(l.amount), 0n)) },
    };
  });
}

/** True when the cash entry has a line posted to an account that is still live (cancel those payments first). */
export async function postedLinesOf(tx: OcTx, t: string, entryId: string) {
  return (await linesOfEntries(tx, t, [entryId])).filter((l) => l.status === "posted");
}

export const PostInput = z.object({
  /** another customer than the one typed (the money was theirs) */
  customer_id: z.uuid().optional(),
  /** the bills it pays; none = oldest first */
  bill_ids: z.array(z.uuid()).max(500).default([]),
});

const lineLock = (tx: OcTx, t: string) => tx.execute(sql`select pg_advisory_xact_lock(hashtext('order_capture.collection'), hashtext(${t}))`);

async function waitingLine(tx: OcTx, t: string, id: string) {
  const [l] = await linesWithStatus(tx, t, sql`l.id = ${id}::uuid`);
  if (!l) throw notFound("Collection line not found");
  if (l.status === "posted") throw conflict(`Already posted as payment ${l.payment!.number}`);
  if (l.status === "turned_down") throw conflict("This line was turned down");
  if (l.status === "void") throw conflict(`Cash book entry ${l.entry} was cancelled, so this line can't be posted`);
  return l;
}

/** Owner, Accounts: make the waiting line a payment on the customer's account (Receive payment's rules). */
export async function postLine(user: OcUser, id: string, input: z.infer<typeof PostInput>) {
  requireAccess(user, "collection_post");
  return withTenant(user.tenantId, async (tx) => {
    const t = user.tenantId;
    await lineLock(tx, t);
    const l = await waitingLine(tx, t, id);
    const p = await receiveInTx(tx, user, {
      customer_id: input.customer_id ?? l.customer.id,
      amount: l.amount,
      payment_date: l.work_date,
      mode: l.mode,
      note: `${l.mode === "cash" ? `Cash collection ${l.entry}` : "Online collection"} (cash book)${input.customer_id && input.customer_id !== l.customer.id ? `, typed for ${l.customer.name}` : ""}`.slice(0, 300),
      bill_ids: input.bill_ids,
    });
    await tx.insert(collectionPosts).values({ tenantId: t, lineId: id, outcome: "posted", paymentId: p.id, createdBy: user.userId, createdByName: user.name });
    await audit(tx, user, "collection.post", id, { payment: p.number, customer: p.customer, amount: p.amount, mode: p.mode, entry: l.entry });
    return p;
  });
}

export const TurnDownInput = z.object({ reason: Reason });

/** Owner, Accounts: the line is not a customer payment (the cash stays in the cash book as collected). */
export async function turnDownLine(user: OcUser, id: string, input: z.infer<typeof TurnDownInput>) {
  requireAccess(user, "collection_post");
  return withTenant(user.tenantId, async (tx) => {
    const t = user.tenantId;
    await lineLock(tx, t);
    const l = await waitingLine(tx, t, id);
    await tx.insert(collectionPosts).values({ tenantId: t, lineId: id, outcome: "turned_down", reason: input.reason, createdBy: user.userId, createdByName: user.name });
    await audit(tx, user, "collection.turn_down", id, { customer: l.customer.name, amount: l.amount, entry: l.entry, reason: input.reason });
    return { ok: true };
  });
}

// ---------- finding customers on the collection screen; the 20 L list ----------

/** Customers by any part of the name or phone digits, 20 L customers first, with what they owe and their last collection. */
export async function collectionSearch(user: OcUser, q: string) {
  requireAccess(user, "cash_enter");
  const text = q.trim().slice(0, 100);
  const digits = text.replace(/\D/g, "");
  return withTenant(user.tenantId, async (tx) => {
    const t = user.tenantId;
    const rows = await tx.execute<{ id: string; name: string; phone: string; place: string; jar: boolean; group_name: string | null; due: string; last: string | null }>(sql`
      with paid as (select bill_id, sum(amount) s from order_capture.payment_allocations where tenant_id = ${t} group by bill_id),
           adj as (select bill_id, sum(amount) s from order_capture.bill_adjustments where tenant_id = ${t} group by bill_id)
      select c.id, c.name, c.phone, c.place, j.id is not null as jar, j.group_name,
             coalesce((select sum(greatest(b.total - coalesce(p.s, 0) - coalesce(a.s, 0), 0)) from order_capture.bills b
                        left join paid p on p.bill_id = b.id left join adj a on a.bill_id = b.id
                        left join order_capture.zoho_contacts zc on zc.tenant_id = b.tenant_id and zc.id = b.zoho_contact_id
                       where b.tenant_id = ${t} and b.cancelled_at is null and coalesce(b.customer_id, zc.customer_id) = c.id), 0)::numeric(18, 2)::text as due,
             (select l.amount::text from order_capture.collection_lines l where l.tenant_id = ${t} and l.customer_id = c.id order by l.created_at desc, l.line_no desc limit 1) as last
        from order_capture.customers c
        left join lateral (select id, group_name from order_capture.jar_customers x where x.tenant_id = c.tenant_id and x.customer_id = c.id order by created_at limit 1) j on true
       where c.tenant_id = ${t} and c.active
         and (${text} = '' or c.name ilike ${"%" + text + "%"} or (${digits} <> '' and length(${digits}) >= 4 and c.phone like ${"%" + digits + "%"}))
       order by (j.id is null), c.name
       limit 12`);
    return rows.rows;
  });
}

/** Cash → 20 L: every 20 L customer with what they owe now and what waits to be posted. */
export async function jarList(user: OcUser, q = "") {
  requireAccess(user, "cash_view");
  const text = q.trim().slice(0, 100);
  return withTenant(user.tenantId, async (tx) => {
    const t = user.tenantId;
    const rows = await tx.execute<{ customer_id: string; name: string; phone: string; ref: string; group_name: string | null; pref: string | null; opening_due: string; due: string; waiting: string; last_paid: string | null }>(sql`
      with paid as (select bill_id, sum(amount) s from order_capture.payment_allocations where tenant_id = ${t} group by bill_id),
           adj as (select bill_id, sum(amount) s from order_capture.bill_adjustments where tenant_id = ${t} group by bill_id),
           due as (select coalesce(b.customer_id, zc.customer_id) as cust, sum(greatest(b.total - coalesce(p.s, 0) - coalesce(a.s, 0), 0)) as due
                     from order_capture.bills b left join paid p on p.bill_id = b.id left join adj a on a.bill_id = b.id
                     left join order_capture.zoho_contacts zc on zc.tenant_id = b.tenant_id and zc.id = b.zoho_contact_id
                    where b.tenant_id = ${t} and b.cancelled_at is null group by 1),
           lastpay as (select customer_id, max(payment_date)::text as d from order_capture.payments where tenant_id = ${t} and cancelled_at is null group by 1)
      select j.customer_id, c.name, c.phone, string_agg(j.source_ref, ', ' order by j.created_at) as ref, min(j.group_name) as group_name, min(j.payment_pref) as pref,
             sum(j.opening_due)::numeric(18, 2)::text as opening_due, coalesce(max(d.due), 0)::numeric(18, 2)::text as due,
             '0.00' as waiting, max(lp.d) as last_paid
        from order_capture.jar_customers j
        join order_capture.customers c on c.tenant_id = j.tenant_id and c.id = j.customer_id
        left join due d on d.cust = j.customer_id
        left join lastpay lp on lp.customer_id = j.customer_id
       where j.tenant_id = ${t} and (${text} = '' or c.name ilike ${"%" + text + "%"} or j.source_ref ilike ${"%" + text + "%"} or (length(${text.replace(/\D/g, "")}) >= 4 and c.phone like ${"%" + text.replace(/\D/g, "") + "%"}))
       group by j.customer_id, c.name, c.phone
       order by coalesce(max(d.due), 0) desc, c.name`);
    const waiting = (await linesWithStatus(tx, t)).filter((l) => l.status === "waiting");
    const w = new Map<string, bigint>();
    for (const l of waiting) w.set(l.customer.id, (w.get(l.customer.id) ?? 0n) + paise(l.amount));
    const list = rows.rows.map((r) => ({ ...r, waiting: rupees(w.get(r.customer_id) ?? 0n) }));
    return {
      customers: list,
      totals: {
        count: list.length,
        due: rupees(list.reduce((s, r) => s + paise(r.due), 0n)),
        waiting: rupees(list.reduce((s, r) => s + paise(r.waiting), 0n)),
      },
      imports: (await tx.select().from(jarImports).where(and(eq(jarImports.tenantId, t), eq(jarImports.kind, "opening")))).map((i) => ({ file: i.fileName, by: i.importedByName, at: i.createdAt.toISOString(), total: i.totalDue, counts: i.counts })),
    };
  });
}
