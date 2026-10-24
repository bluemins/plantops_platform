// Consent to WhatsApp reorder reminders (WhatsApp Step 4, docs/WHATSAPP_BUILD_PLAN.md section 9; contract 4.8).
// Rules:
//   * one append-only row per change (migration 0005): granted / declined / withdrawn, with the wording read or shown
//     (`optin-v1`), where it came from and who recorded it; kept forever. A customer's consent = their NEWEST row.
//   * sources: the bot's question after an order, staff "Agreed to WhatsApp reminders" (read out on the phone), STOP /
//     START on WhatsApp, the reminder's "Stop reminders" button
//   * a row is written only when it changes the answer (the same answer again writes nothing), except a decline,
//     which is kept each time it is asked (the bot asks again 90 days after a no)
import { and, desc, eq, inArray } from "drizzle-orm";
import { OPTIN_WORDING } from "@/lib/optin";
import { schema, type OcTx } from "./db";
import type { ConsentSource, ConsentStatus } from "./schema";

const { customerConsents } = schema;

export interface Consent {
  status: ConsentStatus;
  source: ConsentSource;
  at: Date;
  by: string;
}

/** The newest consent row of each of these customers (none = never asked). */
export async function latestConsents(tx: OcTx, tenantId: string, customerIds: string[]): Promise<Map<string, Consent>> {
  if (!customerIds.length) return new Map();
  const rows = await tx
    .selectDistinctOn([customerConsents.customerId])
    .from(customerConsents)
    .where(and(eq(customerConsents.tenantId, tenantId), eq(customerConsents.scope, "reorder_reminder"), inArray(customerConsents.customerId, customerIds)))
    .orderBy(customerConsents.customerId, desc(customerConsents.createdAt), desc(customerConsents.id));
  return new Map(rows.map((r) => [r.customerId, { status: r.status, source: r.source, at: r.createdAt, by: r.createdByName }]));
}

export async function latestConsent(tx: OcTx, tenantId: string, customerId: string): Promise<Consent | null> {
  return (await latestConsents(tx, tenantId, [customerId])).get(customerId) ?? null;
}

/**
 * Record an answer. Returns true when a row was written. Nothing is written when it would not change the answer
 * (granted twice, withdrawn when not granted), so a repeated STOP or a double tap adds nothing.
 */
export async function recordConsent(
  tx: OcTx,
  tenantId: string,
  customerId: string,
  c: { status: ConsentStatus; source: ConsentSource; by: { userId: string; name: string }; messageSid?: string | null },
): Promise<boolean> {
  const now = await latestConsent(tx, tenantId, customerId);
  if (c.status === "granted" && now?.status === "granted") return false;
  if (c.status === "withdrawn" && now?.status !== "granted") return false;
  await tx.insert(customerConsents).values({
    tenantId,
    customerId,
    scope: "reorder_reminder",
    status: c.status,
    wording: OPTIN_WORDING,
    source: c.source,
    messageSid: c.messageSid ?? null,
    createdBy: c.by.userId,
    createdByName: c.by.name,
  });
  return true;
}
