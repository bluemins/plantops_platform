// The notification outbox (N4): kit.notify keeps an event here when the platform can't be reached, and the daily
// / evening jobs send it again (kit.retryOutbox, packages/module-kit). Only failures are stored; nothing is deleted.
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import type { OutboxStore } from "@plantops/module-kit";
import type { NotificationInput } from "@plantops/types";
import { complaintDb, schema, withTenant } from "./db";

const { notificationOutbox: outbox } = schema;

export const outboxStore: OutboxStore = {
  async save(tenantId, input, error) {
    await withTenant(tenantId, (tx) => tx.insert(outbox).values({ tenantId, input: input as Record<string, unknown>, lastError: error }));
  },
  async tenants() {
    const { rows } = await complaintDb().execute<{ id: string }>(sql`select t as id from complaint_box.outbox_tenants() t`);
    return rows.map((r) => r.id);
  },
  async pending(tenantId) {
    const rows = await withTenant(tenantId, (tx) =>
      tx
        .select()
        .from(outbox)
        .where(and(eq(outbox.tenantId, tenantId), isNull(outbox.sentAt), isNull(outbox.givenUpAt)))
        .orderBy(asc(outbox.createdAt))
        .limit(100),
    );
    return rows.map((r) => ({ id: r.id, tenantId: r.tenantId, input: r.input as unknown as NotificationInput, attempts: r.attempts, createdAt: r.createdAt }));
  },
  async markSent(tenantId, id) {
    await withTenant(tenantId, (tx) => tx.update(outbox).set({ sentAt: new Date() }).where(and(eq(outbox.tenantId, tenantId), eq(outbox.id, id))));
  },
  async markFailed(tenantId, id, error, giveUp) {
    await withTenant(tenantId, (tx) =>
      tx
        .update(outbox)
        .set({ attempts: sql`${outbox.attempts} + 1`, lastError: error, ...(giveUp ? { givenUpAt: new Date() } : {}) })
        .where(and(eq(outbox.tenantId, tenantId), eq(outbox.id, id))),
    );
  },
};
