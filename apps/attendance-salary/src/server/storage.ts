// Where bill photos of expense claims live: the shared storage in packages/module-kit/src/storage.ts, in Attendance's
// OWN folder (ATTEND_STORAGE_DIR) or bucket (ATTEND_STORAGE_BUCKET), never another module's.
import { eq, sql } from "drizzle-orm";
import { fileStorageFrom, type FileStorage } from "@plantops/module-kit/storage";
import { schema, type AtTx } from "./db";
import { env } from "./env";
import { kit } from "./kit";

/** The storage this server is set up for. */
export function fileStorage(): FileStorage {
  return fileStorageFrom({
    dir: env.storageDir,
    bucket: env.storageBucket,
    endpoint: env.storageEndpoint,
    region: env.storageRegion,
    accessKey: env.storageAccessKey,
    secretKey: env.storageSecretKey,
    bucketVar: "ATTEND_STORAGE_BUCKET",
  });
}

/** docs/SALARY_EXTRAS_PHASE_PLAN.md: photos only, ≤ 10 MB before shrinking, up to 3 per expense. */
export const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
export const MAX_PHOTOS = 3;

/** The plan's Attendance storage limit in bytes (super_admin sets MB; blank = unlimited). */
export async function storageLimitBytes(tenantId: string) {
  const mb = (await kit.plan(tenantId))?.limits.modules.attendance_salary?.storage_mb;
  return mb ? mb * 1024 * 1024 : null;
}

/**
 * Everything the plant has stored: claim bill photos + field-day meter photos (they share the plan's one limit). The
 * caller holds the plant's storage lock (`lockStorage`), so two uploads at once can't pass the limit together.
 */
export async function storageUsedBytes(tx: AtTx, tenantId: string): Promise<number> {
  const [claims] = await tx.select({ n: sql<number>`coalesce(sum(${schema.salaryClaimFiles.sizeBytes}), 0)::bigint` }).from(schema.salaryClaimFiles).where(eq(schema.salaryClaimFiles.tenantId, tenantId));
  const [field] = await tx.select({ n: sql<number>`coalesce(sum(${schema.fieldEventFiles.sizeBytes}), 0)::bigint` }).from(schema.fieldEventFiles).where(eq(schema.fieldEventFiles.tenantId, tenantId));
  return Number(claims?.n ?? 0) + Number(field?.n ?? 0);
}

/** One upload per plant at a time while the limit is checked. */
export const lockStorage = (tx: AtTx, tenantId: string) => tx.execute(sql`select pg_advisory_xact_lock(hashtext('attendance_salary.storage'), hashtext(${tenantId}))`);
