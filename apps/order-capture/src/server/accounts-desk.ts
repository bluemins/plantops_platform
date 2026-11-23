// Accounts desk (owner, 2026-11-23): owner, Accounts, support (read-only). See src/lib/accounts-desk.ts for the rules.
import { sql } from "drizzle-orm";
import type { ModuleSummary } from "@plantops/types";
import { deskCounts, deskDues, deskStageRows, type DeskStage } from "@/lib/accounts-desk";
import { flowRows, sortRows, type FlowFilter, type FlowOrder } from "@/lib/order-flow";
import { requireAccess } from "./access";
import { gstQueue } from "./bill-make";
import { waitingToPost } from "./collections";
import { withTenant } from "./db";
import { istToday } from "./ledger";
import { flowData, receivablesData } from "./reports";
import type { OcUser } from "./session";

const EVERY_ORDER: FlowFilter = { period: "all", from: "", to: "", customer: "", salesperson: "", place: "", brand: "", overdue: false, cancelled: false };
const rowsOf = (orders: FlowOrder[], today: string) => sortRows(flowRows(orders, today, { ...EVERY_ORDER, to: today }));

async function dues(tenantId: string, today: string) {
  const [data, phones] = await Promise.all([
    receivablesData(tenantId),
    withTenant(tenantId, (tx) => tx.execute<{ id: string; phone: string }>(sql`select id, phone from order_capture.customers where tenant_id = ${tenantId}`)),
  ]);
  return deskDues(data, new Map(phones.rows.map((r) => [r.id, r.phone])), today);
}

export async function deskHome(user: OcUser, today = istToday()) {
  requireAccess(user, "accounts_desk");
  const [orders, owing, toPost, gst] = await Promise.all([flowData(user.tenantId), dues(user.tenantId, today), waitingToPost(user), gstQueue(user)]);
  return {
    counts: deskCounts(rowsOf(orders, today), today),
    customers_overdue: owing.filter((r) => r.overdue > 0n).length,
    to_post: toPost,
    gst_to_make: gst.not_sent.length,
  };
}

export async function deskStage(user: OcUser, stage: DeskStage, q: string, today = istToday()) {
  requireAccess(user, "accounts_desk");
  return deskStageRows(rowsOf(await flowData(user.tenantId), today), stage, today, q);
}

export async function deskCustomerDues(user: OcUser, today = istToday()) {
  requireAccess(user, "accounts_desk");
  return dues(user.tenantId, today);
}

/** The launcher card: counts only. */
export async function accountsDeskTile(tenantId: string, today: string): Promise<ModuleSummary> {
  const c = deskCounts(rowsOf(await flowData(tenantId), today), today);
  const badges: ModuleSummary["badges"] = [c.delivered ? { text: `${c.delivered} to bill`, tone: "warn" } : { text: "Nothing to bill", tone: "ok" }];
  if (c.overdue) badges.push({ text: `${c.overdue} overdue`, tone: "danger" });
  if (c.billed + c.part) badges.push({ text: `${c.billed + c.part} unpaid`, tone: "info" });
  return { badges };
}
