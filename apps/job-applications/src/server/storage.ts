// Where resumes live: the shared storage in packages/module-kit/src/storage.ts, in Job applications' OWN folder
// (JOBS_STORAGE_DIR) or bucket (JOBS_STORAGE_BUCKET) - never another module's. The only module that removes files
// (12-month removal, "Remove now": see daily.ts).
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
    bucketVar: "JOBS_STORAGE_BUCKET",
  });
}
