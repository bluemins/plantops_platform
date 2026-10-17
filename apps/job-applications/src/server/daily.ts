// The daily job (POST /api/cron/daily, GitHub Actions at 07:00 IST): notifications that didn't reach PlantOps, the
// 12-month removal of personal data, and deleting the files of removed applications from storage AND the backup.
// docs/JOB_APPLICATIONS_PHASE_PLAN.md "Removal after 12 months". Answers counts only, never names.
import { and, eq, inArray, sql } from "drizzle-orm";
import { removeBackupCopy } from "@plantops/module-kit/backup";
import { jobsDb, schema, withTenant } from "./db";
import { kit } from "./kit";
import { fileStorage } from "./storage";

const MODULE = "job_applications";
const TENANT_OF = /^tenant\/([0-9a-f-]{36})\/[0-9a-f-]{36}$/;

export interface DailyResult {
  outbox: { sent: number; failed: number; given_up: number };
  purged: number;
  files: { removed: number; failed: number };
  orphans: { removed: number; failed: number };
}

/** Deletes one file from storage, then its backup copy. Throws when either fails (the caller keeps it for tomorrow). */
async function removeEverywhere(key: string) {
  await fileStorage().remove(key);
  await removeBackupCopy(MODULE, key);
}

export async function runDaily(now = new Date()): Promise<DailyResult> {
  const outbox = await kit.retryOutbox(now.getTime());

  // 1. applications sent more than 12 months ago (all plants; the database function also queues their files)
  const purged = Number(((await jobsDb().execute<{ n: number }>(sql`select job_applications.purge_applications(${now.toISOString()}::timestamptz) as n`)).rows[0]?.n ?? 0));

  // 2. queued files: storage, then the backup copy, then off the queue. A failure stays queued for the next run.
  const files = { removed: 0, failed: 0 };
  const plants = (await jobsDb().execute<{ id: string }>(sql`select t as id from job_applications.purge_tenants() t`)).rows.map((r) => r.id);
  for (const tenantId of plants) {
    const queued = await withTenant(tenantId, (tx) => tx.select({ key: schema.fileRemovals.storageKey }).from(schema.fileRemovals).where(eq(schema.fileRemovals.tenantId, tenantId)));
    for (const { key } of queued) {
      try {
        await removeEverywhere(key);
        await withTenant(tenantId, (tx) => tx.execute(sql`select job_applications.clear_file_removal(${tenantId}::uuid, ${key})`));
        files.removed++;
      } catch (err) {
        console.error(`[${MODULE}] file removal failed, retried tomorrow:`, (err as Error).message);
        files.failed++;
      }
    }
  }

  // 3. stray files (a send that failed half-way and couldn't clean up): in storage but in no application and not queued
  const orphans = { removed: 0, failed: 0 };
  const byPlant = new Map<string, string[]>();
  for (const key of await fileStorage().list()) {
    const t = TENANT_OF.exec(key)?.[1];
    if (t) byPlant.set(t, [...(byPlant.get(t) ?? []), key]);
  }
  for (const [tenantId, keys] of byPlant) {
    const known = new Set<string>();
    for (let i = 0; i < keys.length; i += 500) {
      const part = keys.slice(i, i + 500);
      await withTenant(tenantId, async (tx) => {
        const a = await tx.select({ k: schema.applicationFiles.storageKey }).from(schema.applicationFiles).where(and(eq(schema.applicationFiles.tenantId, tenantId), inArray(schema.applicationFiles.storageKey, part)));
        const q = await tx.select({ k: schema.fileRemovals.storageKey }).from(schema.fileRemovals).where(and(eq(schema.fileRemovals.tenantId, tenantId), inArray(schema.fileRemovals.storageKey, part)));
        for (const r of [...a, ...q]) known.add(r.k);
      });
    }
    for (const key of keys.filter((k) => !known.has(k))) {
      try {
        await removeEverywhere(key);
        orphans.removed++;
      } catch (err) {
        console.error(`[${MODULE}] stray file removal failed:`, (err as Error).message);
        orphans.failed++;
      }
    }
  }

  return { outbox, purged, files, orphans };
}
