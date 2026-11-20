// Where purchase bill copies live (src/server/purchase-files.ts): the shared storage in packages/module-kit/src/storage.ts,
// in Sales' OWN folder (ORDER_STORAGE_DIR, on Railway the volume) or bucket (ORDER_STORAGE_BUCKET), never another module's.
import { eq, sql } from "drizzle-orm";
import { fileStorageFrom, type FileStorage } from "@plantops/module-kit/storage";
import { schema, type OcTx } from "./db";
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
    bucketVar: "ORDER_STORAGE_BUCKET",
  });
}

/** The plan's Sales storage limit in bytes (super_admin sets MB on the plan screen; blank = unlimited). */
export async function storageLimitBytes(tenantId: string) {
  const mb = (await kit.plan(tenantId))?.limits.modules.order_capture?.storage_mb;
  return mb ? mb * 1024 * 1024 : null;
}

/** Everything the plant has stored in Sales (purchase bill copies). The caller holds `lockStorage`. */
export async function storageUsedBytes(tx: OcTx, tenantId: string): Promise<number> {
  const f = schema.purchaseBillFiles;
  const [r] = await tx.select({ n: sql<number>`coalesce(sum(${f.sizeBytes}), 0)::bigint` }).from(f).where(eq(f.tenantId, tenantId));
  return Number(r?.n ?? 0);
}

/** One upload per plant at a time while the limit is checked. */
export const lockStorage = (tx: OcTx, tenantId: string) => tx.execute(sql`select pg_advisory_xact_lock(hashtext('order_capture.storage'), hashtext(${tenantId}))`);
