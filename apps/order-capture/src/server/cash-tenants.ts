// Plants that have started a cash book (ids only, through a security-definer function), for the daily job.
import { sql } from "drizzle-orm";
import { orderDb } from "./db";

export async function cashTenantIds(): Promise<string[]> {
  const { rows } = await orderDb().execute<{ id: string }>(sql`select t as id from order_capture.cash_tenants() t`);
  return rows.map((r) => r.id);
}
