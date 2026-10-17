// Where bill photos of expense claims live: the shared storage in packages/module-kit/src/storage.ts, in Attendance's
// OWN folder (ATTEND_STORAGE_DIR) or bucket (ATTEND_STORAGE_BUCKET), never another module's.
import { fileStorageFrom, type FileStorage } from "@plantops/module-kit/storage";
import { env } from "./env";

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
