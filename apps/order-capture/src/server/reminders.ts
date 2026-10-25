// WhatsApp reorder reminders, the 15-day pilot (WhatsApp Step 4, docs/WHATSAPP_BUILD_PLAN.md section 9; pilot rules
// in docs/WHATSAPP_CONTRACT.md checklist 6). Order Capture sends them itself, like the delivery thank-you. Rules:
//   * off unless ORDER_REMINDERS=on, REMINDER_PILOT_START is set and the plant's Twilio entry has its approved
//     reminder template (reminder_content_sid)
//   * one reminder per delivered order, 15 India days after the delivery (a missed run catches up 2 days), only for
//     orders delivered from the pilot start; the pilot ends 8 weeks after the start
//   * re-checked when it is due, in this order: pilot over · customer switched off · newest consent not "granted" ·
//     a newer order since the delivery · a reminder sent to this customer in the last 14 days · pilot full (customers)
//     · the customer's random group is the 30 % holdout · the budget. Anything not sent is kept as 'skipped' with the
//     reason, so the pilot page counts every reminder that was due
//   * each customer's group is drawn once at random (30 % holdout, 70 % remind) and never changed
//   * the row is written ('pending') before Twilio is called and finished after, so a crash can never send twice;
//     a reminder is never retried (a late reminder is worth less than none)
//   * Twilio refusing a reminder (4xx) stops the plant's reminders until REMINDER_PILOT_START is moved past it, and
//     tells the owners (phone + bell)
import { randomInt } from "node:crypto";
import { and, asc, eq, sql } from "drizzle-orm";
import type { NotificationInput } from "@plantops/types";
import { requireAccess } from "./access";
import { latestConsent } from "./consent";
import { orderDb, schema, withTenant, type OcTx } from "./db";
import { env } from "./env";
import { kit } from "./kit";
import type { SkipReason } from "./schema";
import type { OcUser } from "./session";
import { senderFor, twilioTemplate, whatsappProblem, type SendResult, type Sender } from "./thanks";

const { customers, customerMessages: messages, orderLines, orders, reminderGroups } = schema;

export const REMINDER_DAYS = 15;
export const CATCH_UP_DAYS = 2;
export const QUIET_DAYS = 14;
export const PILOT_DAYS = 56;
export const HOLDOUT_PERCENT = 30;
/** who "requested" a reminder row (the job, not a person) */
export const REMINDER_JOB_ID = "00000000-0000-0000-0000-000000000000";
const JOB_NAME = "Reminder job";

const istDay = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(d);
export function addDays(day: string, n: number) {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
/** The pilot's last day: 8 weeks from the start. */
export const pilotEnd = (start: string) => addDays(start, PILOT_DAYS - 1);

/** {{2}}: "5 box Bluemins 1L, 2 box Bluemins 500ml" (the pack part "(1 L × 12)" left out, contract 3.1a). */
export function linesText(lines: { quantity: number; unit: string; productName: string }[]) {
  return lines.map((l) => `${l.quantity} ${l.unit} ${l.productName.replace(/\s*\([^)]*\)\s*$/, "")}`).join(", ");
}

/** A refusal Twilio gave for one of this pilot's reminders (orders delivered from `start`), or null. */
async function refusedSince(tx: OcTx, tenantId: string, start: string) {
  const { rows } = await tx.execute<{ error: string }>(sql`
    select m.error from ${messages} m join ${orders} o on o.tenant_id = m.tenant_id and o.id = m.order_id
     where m.tenant_id = ${tenantId} and m.kind = 'reorder_reminder' and m.status = 'failed' and m.error like 'Twilio said 4%'
       and (o.delivered_at at time zone 'Asia/Kolkata')::date >= ${start}::date
     limit 1`);
  return rows[0]?.error ?? null;
}

interface Deps {
  send?: (sender: Sender, phone: string, variables: Record<string, string>) => Promise<SendResult>;
  /** 0–99; below HOLDOUT_PERCENT = holdout */
  random?: () => number;
  now?: Date;
}

type Decision = { skip: SkipReason } | { send: { name: string; products: string } };

/** Why this due order gets no reminder, or what to send. Inside the plant's transaction (writes the group once). */
async function decide(tx: OcTx, tenantId: string, o: { id: string; customerId: string; deliveredAt: Date; version: number }, today: string, start: string, random: () => number): Promise<Decision> {
  if (today > pilotEnd(start)) return { skip: "pilot_ended" };
  const [c] = await tx.select().from(customers).where(and(eq(customers.tenantId, tenantId), eq(customers.id, o.customerId)));
  if (!c?.active) return { skip: "customer_off" };
  if ((await latestConsent(tx, tenantId, c.id))?.status !== "granted") return { skip: "no_consent" };
  const [newer] = await tx
    .select({ id: orders.id })
    .from(orders)
    .where(and(eq(orders.tenantId, tenantId), eq(orders.customerId, c.id), sql`${orders.id} <> ${o.id}`, sql`${orders.status} <> 'cancelled'`, sql`${orders.createdAt} > ${o.deliveredAt}`))
    .limit(1);
  if (newer) return { skip: "newer_order" };
  const { rows: recent } = await tx.execute(sql`
    select 1 from ${messages} m join ${orders} o2 on o2.tenant_id = m.tenant_id and o2.id = m.order_id
     where m.tenant_id = ${tenantId} and o2.customer_id = ${c.id} and m.kind = 'reorder_reminder' and m.status = 'sent'
       and m.sent_at > now() - make_interval(days => ${QUIET_DAYS}) limit 1`);
  if (recent.length) return { skip: "recent_reminder" };

  let [g] = await tx.select().from(reminderGroups).where(and(eq(reminderGroups.tenantId, tenantId), eq(reminderGroups.customerId, c.id)));
  if (!g) {
    const [{ n }] = (await tx.select({ n: sql<number>`count(*)::int` }).from(reminderGroups).where(eq(reminderGroups.tenantId, tenantId))) as [{ n: number }];
    if (n >= env.reminderPilotCustomers) return { skip: "pilot_full" };
    [g] = await tx
      .insert(reminderGroups)
      .values({ tenantId, customerId: c.id, grp: random() < HOLDOUT_PERCENT ? "holdout" : "remind" })
      .returning();
  }
  if (g!.grp === "holdout") return { skip: "holdout" };

  const [{ sent }] = (await tx
    .select({ sent: sql<number>`count(*)::int` })
    .from(messages)
    .where(and(eq(messages.tenantId, tenantId), eq(messages.kind, "reorder_reminder"), sql`${messages.status} in ('sent', 'pending')`))) as [{ sent: number }];
  if ((sent + 1) * env.reminderCostPaise > env.reminderBudgetPaise) return { skip: "budget" };

  const lines = await tx
    .select({ quantity: orderLines.quantity, unit: orderLines.unit, productName: orderLines.productName })
    .from(orderLines)
    .where(and(eq(orderLines.tenantId, tenantId), eq(orderLines.orderId, o.id), eq(orderLines.version, o.version)))
    .orderBy(asc(orderLines.lineNo));
  return { send: { name: c.name, products: linesText(lines) } };
}

export interface PlantRun {
  tenant_id: string;
  due: number;
  sent: number;
  skipped: Partial<Record<SkipReason, number>>;
  failed: number;
  stopped?: string;
}

/** One plant's due reminders. */
export async function remindPlant(tenantId: string, start: string, deps: Deps = {}): Promise<PlantRun> {
  const send = deps.send ?? twilioTemplate;
  const random = deps.random ?? (() => randomInt(100));
  const now = deps.now ?? new Date();
  const run: PlantRun = { tenant_id: tenantId, due: 0, sent: 0, skipped: {}, failed: 0 };
  const sender = senderFor(tenantId);
  if (!sender?.reminderContentSid) return { ...run, stopped: "no reminder template set for this plant" };
  const template: Sender = { ...sender, contentSid: sender.reminderContentSid };

  const today = istDay(now);
  const fromDay = [start, addDays(today, -(REMINDER_DAYS + CATCH_UP_DAYS))].sort().at(-1)!;
  const toDay = addDays(today, -REMINDER_DAYS);
  const refused = await withTenant(tenantId, (tx) => refusedSince(tx, tenantId, start));
  if (refused) return { ...run, stopped: `stopped after a Twilio refusal: ${refused}` };

  const due = await withTenant(tenantId, (tx) =>
    tx
      .select({ id: orders.id, customerId: orders.customerId, deliveredAt: orders.deliveredAt, version: orders.version, phone: orders.customerPhone })
      .from(orders)
      .where(
        and(
          eq(orders.tenantId, tenantId),
          eq(orders.status, "delivered"),
          sql`${orders.deliveredAt} is not null`,
          sql`(${orders.deliveredAt} at time zone 'Asia/Kolkata')::date between ${fromDay}::date and ${toDay}::date`,
          sql`not exists (select 1 from ${messages} m where m.tenant_id = ${orders.tenantId} and m.order_id = ${orders.id} and m.kind = 'reorder_reminder')`,
        ),
      )
      .orderBy(asc(orders.deliveredAt)),
  );

  for (const o of due) {
    // 1. decide and write the row, one at a time per plant (two runs at once can't both take the same order)
    const step = await withTenant(tenantId, async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('order_capture.reminders'), hashtext(${tenantId}))`);
      const [have] = await tx.select({ id: messages.id }).from(messages).where(and(eq(messages.tenantId, tenantId), eq(messages.orderId, o.id), eq(messages.kind, "reorder_reminder")));
      if (have) return null;
      const d = await decide(tx, tenantId, { ...o, deliveredAt: o.deliveredAt! }, today, start, random);
      const base = { tenantId, orderId: o.id, kind: "reorder_reminder" as const, toPhone: o.phone, requestedBy: REMINDER_JOB_ID, requestedByName: JOB_NAME };
      if ("skip" in d) {
        await tx.insert(messages).values({ ...base, status: "skipped", skipReason: d.skip });
        return d;
      }
      const [row] = await tx.insert(messages).values({ ...base, status: "pending" }).returning({ id: messages.id });
      return { ...d, rowId: row!.id };
    });
    if (!step) continue;
    run.due++;
    if ("skip" in step) {
      run.skipped[step.skip] = (run.skipped[step.skip] ?? 0) + 1;
      continue;
    }
    // 2. send, outside the transaction; 3. finish the row
    const r = await send(template, o.phone, { "1": step.send.name, "2": step.send.products });
    await withTenant(tenantId, (tx) =>
      tx
        .update(messages)
        .set(r.ok ? { status: "sent", providerSid: r.sid, attempts: 1, sentAt: new Date() } : { status: "failed", error: r.error, attempts: 1 })
        .where(and(eq(messages.tenantId, tenantId), eq(messages.id, step.rowId))),
    );
    if (r.ok) {
      run.sent++;
      continue;
    }
    run.failed++;
    if (!r.retry) {
      run.stopped = `stopped after a Twilio refusal: ${r.error}`;
      await kit.notify(tenantId, refusedNotification(r.error, today));
      break;
    }
  }
  return run;
}

export function refusedNotification(error: string, today: string): NotificationInput {
  return {
    kind: "order_capture.reminder_failed",
    title: "WhatsApp reminders stopped",
    body: `Twilio refused a reorder reminder, so no more are sent. ${error}`.slice(0, 300),
    link: "/reminders",
    level: "push",
    dedupe_key: `reminder_failed:${today}`,
  };
}

/** The reminder job (cron-job.org, daily 10:30 IST). Never throws. */
export async function runReminders(deps: Deps = {}) {
  if (!env.remindersOn) return { on: false as const };
  const start = env.reminderPilotStart;
  if (!start) {
    console.error("[order-capture] ORDER_REMINDERS=on but REMINDER_PILOT_START is not a date: no reminders sent");
    return { on: false as const, reason: "REMINDER_PILOT_START not set" };
  }
  const plants: (PlantRun | { tenant_id: string; error: string })[] = [];
  try {
    const { rows } = await orderDb().execute<{ id: string }>(sql`select t as id from order_capture.reminder_tenants() t`);
    for (const { id } of rows) {
      try {
        plants.push(await remindPlant(id, start, deps));
      } catch (err) {
        console.error("[order-capture] reminders for a plant failed:", (err as Error).message);
        plants.push({ tenant_id: id, error: (err as Error).message.slice(0, 200) });
      }
    }
  } catch (err) {
    console.error("[order-capture] reminder job failed:", (err as Error).message);
  }
  return { on: true as const, start, plants };
}

// ---------- the owner's "Reminder pilot" page ----------
export interface PilotView {
  on: boolean;
  start: string | null;
  end: string | null;
  template: boolean;
  /** the plant's WhatsApp settings are broken (thanks.ts whatsappProblem) */
  problem: string | null;
  customers_max: number;
  cost_paise: number;
  budget_paise: number;
  agreed: number;
  groups: { remind: number; holdout: number };
  due: number;
  sent: number;
  failed: number;
  waiting: number;
  skipped: Partial<Record<SkipReason, number>>;
  /** customers who ordered again within 7 / 14 days of their due day, per group (sent reminders vs the holdout) */
  reordered: { remind: { base: number; d7: number; d14: number }; holdout: { base: number; d7: number; d14: number } };
  opt_outs: number;
  refused: string | null;
}

export async function reminderPilot(user: OcUser): Promise<PilotView> {
  requireAccess(user, "reminder_pilot");
  const t = user.tenantId;
  const start = env.reminderPilotStart;
  return withTenant(t, async (tx) => {
    const counts = await tx
      .select({ status: messages.status, reason: messages.skipReason, n: sql<number>`count(*)::int` })
      .from(messages)
      .where(and(eq(messages.tenantId, t), eq(messages.kind, "reorder_reminder")))
      .groupBy(messages.status, messages.skipReason);
    const by = (s: string) => counts.filter((c) => c.status === s).reduce((a, c) => a + c.n, 0);
    const skipped: PilotView["skipped"] = {};
    for (const c of counts) if (c.status === "skipped" && c.reason) skipped[c.reason] = c.n;

    const groups = { remind: 0, holdout: 0 };
    for (const g of await tx.select({ grp: reminderGroups.grp, n: sql<number>`count(*)::int` }).from(reminderGroups).where(eq(reminderGroups.tenantId, t)).groupBy(reminderGroups.grp))
      groups[g.grp] = g.n;

    // the comparison: reminders sent (remind group) vs reminders held back (holdout), and whether the customer ordered
    const { rows: outcome } = await tx.execute<{ grp: "remind" | "holdout"; base: number; d7: number; d14: number }>(sql`
      select case when m.status = 'sent' then 'remind' else 'holdout' end as grp,
             count(*)::int as base,
             count(*) filter (where exists (select 1 from ${orders} n where n.tenant_id = m.tenant_id and n.customer_id = o.customer_id
                and n.id <> m.order_id and n.status <> 'cancelled' and n.created_at > m.created_at and n.created_at <= m.created_at + interval '7 days'))::int as d7,
             count(*) filter (where exists (select 1 from ${orders} n where n.tenant_id = m.tenant_id and n.customer_id = o.customer_id
                and n.id <> m.order_id and n.status <> 'cancelled' and n.created_at > m.created_at and n.created_at <= m.created_at + interval '14 days'))::int as d14
        from ${messages} m join ${orders} o on o.tenant_id = m.tenant_id and o.id = m.order_id
       where m.tenant_id = ${t} and m.kind = 'reorder_reminder' and (m.status = 'sent' or m.skip_reason = 'holdout')
       group by 1`);
    const reordered = { remind: { base: 0, d7: 0, d14: 0 }, holdout: { base: 0, d7: 0, d14: 0 } };
    for (const r of outcome) reordered[r.grp] = { base: r.base, d7: r.d7, d14: r.d14 };

    const { rows: agreed } = await tx.execute<{ n: number }>(sql`
      select count(*)::int as n from (
        select distinct on (customer_id) status from order_capture.customer_consents
         where tenant_id = ${t} and scope = 'reorder_reminder' order by customer_id, created_at desc, id desc) x
       where status = 'granted'`);
    // pilot customers who stopped reminders on WhatsApp (STOP or the button) after joining the pilot
    const { rows: optOuts } = await tx.execute<{ n: number }>(sql`
      select count(distinct c.customer_id)::int as n from order_capture.customer_consents c
        join ${reminderGroups} g on g.tenant_id = c.tenant_id and g.customer_id = c.customer_id
       where c.tenant_id = ${t} and c.status = 'withdrawn' and c.source in ('whatsapp_stop', 'reminder_button') and c.created_at >= g.created_at`);

    return {
      on: env.remindersOn,
      start,
      end: start ? pilotEnd(start) : null,
      template: !!senderFor(t)?.reminderContentSid,
      problem: whatsappProblem(t),
      customers_max: env.reminderPilotCustomers,
      cost_paise: env.reminderCostPaise,
      budget_paise: env.reminderBudgetPaise,
      agreed: agreed[0]?.n ?? 0,
      groups,
      due: counts.reduce((a, c) => a + c.n, 0),
      sent: by("sent"),
      failed: by("failed"),
      waiting: by("pending"),
      skipped,
      reordered,
      opt_outs: optOuts[0]?.n ?? 0,
      refused: start ? await refusedSince(tx, t, start) : null,
    };
  });
}
