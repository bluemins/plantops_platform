// Cash book step C5 (docs/CASHBOOK_PHASE_PLAN.md section 9; owner 2026-11-12): the monthly 20 L "Remaining" import.
// Owner only. Rules: jarMonthPlan in src/lib/jar-import.ts. Preview first; confirm saves everything or nothing; a month is
// imported again only after "Undo this month" (cancels its month bills, refused while any of them has a payment).
//   PlantOps' 20 L due of a ref = unpaid on its OB20 opening bill + its earlier month bills (cancelled ones count 0).
//   "Also buys boxes" = the Sales customer has another bill (PlantOps, Zoho, opening from Zoho) not cancelled;
//   "shared" = the Sales customer holds two 20 L refs. Both are left for the owner (owner: "always leave them for me").
import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { jarMonthPlan, monthEnd, monthNumber, type KnownJar, type MonthChoice } from "@/lib/jar-import";
import { paise, rupees } from "@/lib/ledger";
import { requireAccess } from "./access";
import { audit } from "./audit";
import { istToday } from "./cash";
import { schema, withTenant, type OcTx } from "./db";
import { badRequest, conflict, notFound } from "./http";
import type { OcUser } from "./session";

const { bills, jarCustomers, jarImports, jarMonthLines, paymentAllocations } = schema;

const Rupees = z.string().regex(/^-?\d{1,9}\.\d{2}$/);
const Month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "month as YYYY-MM");
const Choice = z.discriminatedUnion("action", [z.object({ action: z.literal("leave") }), z.object({ action: z.literal("bill"), amount: z.string().trim().min(1).max(20) })]);

export const MonthInput = z.object({
  file_name: z.string().trim().min(1).max(200),
  month: Month,
  rows: z
    .array(z.object({ ref: z.string().trim().min(1).max(60), name: z.string().trim().min(1).max(200), mobile_typed: z.string().trim().max(30), group: z.string().trim().max(60), pref: z.string().trim().max(30), due: Rupees }))
    .min(1)
    .max(5000),
  file_total: Rupees.nullable(),
  choices: z.record(z.string(), Choice).default({}),
  /** confirm only: what the preview showed */
  expect: z.object({ billed: z.number().int(), total: z.string() }).optional(),
});
export type MonthInput = z.infer<typeof MonthInput>;

const jarLock = (tx: OcTx, t: string) => tx.execute(sql`select pg_advisory_xact_lock(hashtext('order_capture.jar'), hashtext(${t}))`);
const monthName = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString("en-IN", { month: "short", year: "numeric", timeZone: "UTC" });

/** Every imported 20 L ref: PlantOps' 20 L due, and whether the owner decides it. */
async function knownJars(tx: OcTx, t: string) {
  const { rows } = await tx.execute<{ jar_id: string; ref: string; name: string; customer_id: string; customer_name: string; due: string; refs_on_customer: number; other_bills: number }>(sql`
    with jar_bills as (
           select j.id as jar_id, j.opening_bill_id as bill_id from order_capture.jar_customers j where j.tenant_id = ${t} and j.opening_bill_id is not null
           union all
           select l.jar_customer_id, l.bill_id from order_capture.jar_month_lines l where l.tenant_id = ${t} and l.bill_id is not null),
         paid as (select bill_id, sum(amount) s from order_capture.payment_allocations where tenant_id = ${t} group by bill_id),
         adj as (select bill_id, sum(amount) s from order_capture.bill_adjustments where tenant_id = ${t} group by bill_id),
         due as (
           select jb.jar_id, sum(case when b.cancelled_at is null then b.total - coalesce(p.s, 0) - coalesce(a.s, 0) else 0 end) as due
             from jar_bills jb join order_capture.bills b on b.tenant_id = ${t} and b.id = jb.bill_id
             left join paid p on p.bill_id = b.id left join adj a on a.bill_id = b.id
            group by jb.jar_id)
    select j.id as jar_id, j.source_ref as ref, j.source_name as name, j.customer_id, c.name as customer_name,
           coalesce(d.due, 0)::numeric(18, 2)::text as due,
           (select count(*)::int from order_capture.jar_customers x where x.tenant_id = ${t} and x.customer_id = j.customer_id) as refs_on_customer,
           (select count(*)::int from order_capture.bills b
              left join order_capture.zoho_contacts zc on zc.tenant_id = b.tenant_id and zc.id = b.zoho_contact_id
             where b.tenant_id = ${t} and b.cancelled_at is null and coalesce(b.customer_id, zc.customer_id) = j.customer_id
               and b.id not in (select bill_id from jar_bills)) as other_bills
      from order_capture.jar_customers j
      join order_capture.customers c on c.tenant_id = j.tenant_id and c.id = j.customer_id
      left join due d on d.jar_id = j.id
     where j.tenant_id = ${t}`);
  const known = new Map<string, KnownJar>();
  const names = new Map<string, string>();
  for (const r of rows) {
    names.set(r.ref, r.name);
    known.set(r.ref, { jar_customer_id: r.jar_id, customer_id: r.customer_id, customer_name: r.customer_name, due: paise(r.due), mixed: r.other_bills > 0 ? "boxes" : r.refs_on_customer > 1 ? "shared" : null });
  }
  return { known, names };
}

/** The month's earlier imports that still have a month bill not cancelled. */
async function liveImportOf(tx: OcTx, t: string, month: string) {
  const { rows } = await tx.execute<{ id: string; by: string; at: Date; live: number }>(sql`
    select i.id, i.imported_by_name as by, i.created_at as at,
           (select count(*)::int from order_capture.jar_month_lines l join order_capture.bills b on b.tenant_id = l.tenant_id and b.id = l.bill_id
             where l.tenant_id = ${t} and l.import_id = i.id and b.cancelled_at is null) as live
      from order_capture.jar_imports i
     where i.tenant_id = ${t} and i.kind = 'month' and i.month = ${`${month}-01`}::date
     order by i.created_at desc`);
  return rows;
}

async function planIn(tx: OcTx, t: string, input: MonthInput, today: string) {
  if (input.month > today.slice(0, 7)) throw badRequest("That month hasn't come yet");
  const { known, names } = await knownJars(tx, t);
  if (!known.size) throw badRequest("No 20 L customers yet. Use Import list first (opening balances).");
  const plan = jarMonthPlan({ rows: input.rows, file_total: input.file_total }, known, names, input.choices as Record<string, MonthChoice>);
  const earlier = await liveImportOf(tx, t, input.month);
  const blocking = earlier.find((e) => e.live > 0) ?? null;
  return { ...plan, month: input.month, bill_date: [monthEnd(input.month), today].sort()[0]!, already: blocking ? { by: blocking.by, at: new Date(blocking.at).toISOString(), bills: blocking.live } : null };
}

/** What the month update would do; nothing is saved. */
export async function monthPreview(user: OcUser, input: MonthInput, today = istToday()) {
  requireAccess(user, "jar_import");
  return withTenant(user.tenantId, (tx) => planIn(tx, user.tenantId, input, today));
}
export type MonthPreview = Awaited<ReturnType<typeof monthPreview>>;

/** Save the month update: one month bill per "billed" row, a line for every known row; all or nothing. */
export async function monthImport(user: OcUser, input: MonthInput, today = istToday()) {
  requireAccess(user, "jar_import");
  return withTenant(user.tenantId, async (tx) => {
    const t = user.tenantId;
    await jarLock(tx, t);
    const plan = await planIn(tx, t, input, today);
    if (plan.already) throw conflict(`${monthName(input.month)} was already imported (${plan.already.bills} month bills, by ${plan.already.by}). Undo that month first to import it again.`);
    if (plan.total_mismatch) throw badRequest(`The file's Total (₹${plan.totals.file}) is not its rows added up (₹${plan.totals.rows}). Is it the report as downloaded?`);
    if (plan.counts.errors) throw badRequest("An amount you typed is not in rupees. Fix it or leave that customer as it is.");
    if (!input.expect || input.expect.billed !== plan.counts.billed || input.expect.total !== plan.totals.billed)
      throw conflict("Something changed since the preview (a payment, a bill or another import). Check the preview again.");
    if (!plan.rows.length) throw badRequest("None of the customers in this file is imported yet. Use Import list first.");

    const [imp] = await tx
      .insert(jarImports)
      .values({ tenantId: t, kind: "month", month: `${input.month}-01`, fileName: input.file_name, counts: { ...plan.counts }, totalDue: plan.totals.billed, importedBy: user.userId, importedByName: user.name })
      .returning({ id: jarImports.id });
    const billRows = plan.rows.filter((r) => r.action === "billed");
    const taken = new Set(
      billRows.length
        ? (await tx.select({ n: bills.number }).from(bills).where(and(eq(bills.tenantId, t), sql`${bills.number} like ${`J20-%-${input.month}%`}`))).map((b) => b.n)
        : [],
    );
    for (const r of plan.rows) {
      let billId: string | null = null;
      if (r.action === "billed") {
        let k = 1;
        let number = monthNumber(r.ref, input.month);
        while (taken.has(number)) number = monthNumber(r.ref, input.month, ++k);
        taken.add(number);
        const why = r.reason === "typed" ? `amount typed by ${user.name}` : `Remaining ₹${r.sheet} on the 20 L report − ₹${r.plantops} due in PlantOps`;
        const [b] = await tx
          .insert(bills)
          .values({
            tenantId: t,
            source: "jar_month",
            number,
            billDate: plan.bill_date,
            dueDate: plan.bill_date, // owner, 2026-11-12: due the same day
            customerId: r.customer_id,
            customerName: r.customer_name,
            subTotal: r.bill!,
            total: r.bill!,
            notes: `20 L deliveries, ${monthName(input.month)}: ${r.name} (ref ${r.ref}); ${why}; from ${input.file_name}`.slice(0, 2000),
            createdBy: user.userId,
            createdByName: user.name,
          })
          .returning({ id: bills.id });
        billId = b!.id;
      }
      await tx.insert(jarMonthLines).values({
        tenantId: t,
        importId: imp!.id,
        jarCustomerId: r.jar_customer_id,
        customerId: r.customer_id,
        sourceRef: r.ref,
        sheetDue: r.sheet,
        plantopsDue: r.plantops,
        action: r.action,
        reason: r.reason,
        billed: r.bill,
        billId,
      });
    }
    const result = { month: input.month, billed: plan.counts.billed, billed_total: plan.totals.billed, matches: plan.counts.matches, flagged: plan.counts.flagged, left: plan.counts.left, new_refs: plan.counts.new_refs };
    await audit(tx, user, "jar.month", imp!.id, { file: input.file_name, ...result });
    return result;
  });
}

export const UndoInput = z.object({ reason: z.string().trim().min(3, "Please give a reason (at least 3 letters)").max(300) });

/** Owner: cancel a month's month bills so the month can be imported again; refused while any has a payment on it. */
export async function monthUndo(user: OcUser, month: string, input: z.infer<typeof UndoInput>) {
  requireAccess(user, "jar_import");
  if (!Month.safeParse(month).success) throw notFound();
  return withTenant(user.tenantId, async (tx) => {
    const t = user.tenantId;
    await jarLock(tx, t);
    const live = (await tx.execute<{ id: string; number: string }>(sql`
      select b.id, b.number from order_capture.jar_month_lines l
        join order_capture.jar_imports i on i.tenant_id = l.tenant_id and i.id = l.import_id
        join order_capture.bills b on b.tenant_id = l.tenant_id and b.id = l.bill_id
       where l.tenant_id = ${t} and i.kind = 'month' and i.month = ${`${month}-01`}::date and b.cancelled_at is null`)).rows;
    if (!live.length) throw badRequest(`${monthName(month)} has no month bills to undo.`);
    const ids = live.map((b) => b.id);
    const paid = await tx
      .select({ billId: paymentAllocations.billId, s: sql<string>`sum(${paymentAllocations.amount})::text` })
      .from(paymentAllocations)
      .where(and(eq(paymentAllocations.tenantId, t), inArray(paymentAllocations.billId, ids)))
      .groupBy(paymentAllocations.billId);
    const withPay = paid.filter((p) => paise(p.s) !== 0n).map((p) => live.find((b) => b.id === p.billId)!.number);
    if (withPay.length)
      throw conflict(`${withPay.length} month bill${withPay.length === 1 ? " has" : "s have"} a payment on ${withPay.length === 1 ? "it" : "them"} (${withPay.slice(0, 5).join(", ")}${withPay.length > 5 ? ", …" : ""}). Cancel those payments first, or keep the month.`);
    await tx.update(bills).set({ cancelledAt: new Date(), cancelledBy: user.userId, cancelledByName: user.name, cancelReason: `20 L ${monthName(month)} undone: ${input.reason}`.slice(0, 300) }).where(and(eq(bills.tenantId, t), inArray(bills.id, ids)));
    const total = rupees((await tx.select({ total: bills.total }).from(bills).where(and(eq(bills.tenantId, t), inArray(bills.id, ids)))).reduce((s, b) => s + paise(b.total), 0n));
    await audit(tx, user, "jar.month_undo", null, { month, bills: ids.length, total, reason: input.reason });
    return { month, bills: ids.length, total };
  });
}

/** The month updates so far, newest first (owner; support reads through jar_view on the 20 L page). */
export async function monthHistory(user: OcUser) {
  requireAccess(user, "jar_import");
  return withTenant(user.tenantId, async (tx) => {
    const t = user.tenantId;
    const { rows } = await tx.execute<{ id: string; month: string; file_name: string; by: string; at: Date; counts: Record<string, number>; total: string; live: number }>(sql`
      select i.id, to_char(i.month, 'YYYY-MM') as month, i.file_name, i.imported_by_name as by, i.created_at as at, i.counts, i.total_due::text as total,
             (select count(*)::int from order_capture.jar_month_lines l join order_capture.bills b on b.tenant_id = l.tenant_id and b.id = l.bill_id
               where l.tenant_id = ${t} and l.import_id = i.id and b.cancelled_at is null) as live
        from order_capture.jar_imports i where i.tenant_id = ${t} and i.kind = 'month' order by i.month desc, i.created_at desc limit 36`);
    return rows.map((r) => ({ ...r, at: new Date(r.at).toISOString(), undone: r.live === 0 && (r.counts.billed ?? 0) > 0 }));
  });
}

/** The lines of one month update (flagged and left ones first), for its page. */
export async function monthLines(user: OcUser, importId: string) {
  requireAccess(user, "jar_import");
  return withTenant(user.tenantId, async (tx) => {
    const t = user.tenantId;
    const [imp] = await tx.select().from(jarImports).where(and(eq(jarImports.tenantId, t), eq(jarImports.id, importId), eq(jarImports.kind, "month")));
    if (!imp) throw notFound();
    const { rows } = await tx.execute<{ ref: string; name: string; customer_id: string; customer_name: string; sheet: string; plantops: string; action: string; reason: string | null; billed: string | null; bill_id: string | null; number: string | null; cancelled: boolean }>(sql`
      select l.source_ref as ref, j.source_name as name, l.customer_id, c.name as customer_name, l.sheet_due::text as sheet, l.plantops_due::text as plantops,
             l.action, l.reason, l.billed::text as billed, l.bill_id, b.number, coalesce(b.cancelled_at is not null, false) as cancelled
        from order_capture.jar_month_lines l
        join order_capture.jar_customers j on j.tenant_id = l.tenant_id and j.id = l.jar_customer_id
        join order_capture.customers c on c.tenant_id = l.tenant_id and c.id = l.customer_id
        left join order_capture.bills b on b.tenant_id = l.tenant_id and b.id = l.bill_id
       where l.tenant_id = ${t} and l.import_id = ${importId}
       order by case l.action when 'flagged' then 0 when 'left' then 1 when 'billed' then 2 else 3 end, j.source_name`);
    return { month: imp.month!.slice(0, 7), file: imp.fileName, by: imp.importedByName, at: imp.createdAt.toISOString(), lines: rows };
  });
}
