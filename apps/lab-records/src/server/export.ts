// The owner's full export (CLAUDE.md: plants can export their data if they leave). Everything, ignoring
// the plan's history window: every batch with its history, every record with every version and result.
import { and, asc, eq } from "drizzle-orm";
import { csv, csvTime } from "@plantops/module-kit/csv";
import { FORMS } from "@/lib/forms";
import { audit } from "./audit";
import { schema, withTenant } from "./db";
import { loadEntries } from "./entries";
import { actorOf } from "./guards";
import { forbidden } from "./http";
import type { LabUser } from "./session";

const { batches, batchEvents } = schema;

const ist = csvTime;

function requireOwner(user: LabUser) {
  if (!user.isOwner) throw forbidden("Only the plant owner can export all records");
}

/** Every record, every version, one row per result (or one row for forms without results). */
export async function exportRecords(user: LabUser) {
  requireOwner(user);
  return withTenant(user.tenantId, async (tx) => {
    const list = await loadEntries(tx, user.tenantId, { limit: 1_000_000 });
    const rows: unknown[][] = [
      ["record_id", "form", "batch_no", "version", "date", "entered_by", "entered_at", "correction_reason", "verdict", "verified_by", "verified_at", "parameter", "value", "unit", "limit_min", "limit_max", "result", "details"],
    ];
    for (const e of [...list].reverse()) {
      for (const v of e.versions) {
        const base = [e.id, FORMS[e.form].short, e.batch_no ?? "", v.version, ist(v.tested_at), v.entered_by_name, ist(v.entered_at), v.reason ?? "", v.verdict, v.verified?.by ?? "", v.verified ? ist(v.verified.at) : ""];
        const details = JSON.stringify(v.data);
        if (!v.results.length) rows.push([...base, "", "", "", "", "", "", details]);
        for (const r of v.results) rows.push([...base, r.name, r.value, r.unit ?? "", r.limit_min ?? "", r.limit_max ?? "", r.verdict, details]);
      }
    }
    await audit(tx, { tenantId: user.tenantId, actor: actorOf(user), action: "export.records", details: { records: list.length } });
    return csv(rows);
  });
}

/** Every batch with its status history. */
export async function exportBatches(user: LabUser) {
  requireOwner(user);
  return withTenant(user.tenantId, async (tx) => {
    const list = await tx.select().from(batches).where(eq(batches.tenantId, user.tenantId)).orderBy(asc(batches.productionDate), asc(batches.createdAt));
    const events = await tx.select().from(batchEvents).where(and(eq(batchEvents.tenantId, user.tenantId))).orderBy(asc(batchEvents.at), asc(batchEvents.id));
    const rows: unknown[][] = [["batch_no", "production_date", "product", "status", "created_by", "created_at", "history"]];
    for (const b of list) {
      const history = events
        .filter((e) => e.batchId === b.id)
        .map((e) => `${ist(e.at)} ${e.event} by ${e.byName}${e.note ? ` (${e.note})` : ""}`)
        .join(" | ");
      rows.push([b.batchNo, b.productionDate, b.productName ?? "", b.status, b.createdByName, ist(b.createdAt), history]);
    }
    await audit(tx, { tenantId: user.tenantId, actor: actorOf(user), action: "export.batches", details: { batches: list.length } });
    return csv(rows);
  });
}
