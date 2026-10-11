// Where uploaded files live: the shared storage in packages/module-kit/src/storage.ts (local disk, or S3-compatible
// when STORAGE_BUCKET is set), set up from Document Store's own environment variables.
import { fileStorageFrom, type FileStorage } from "@plantops/module-kit/storage";
import { env } from "./env";

export { fileSha256, localStorage, newStorageKey, s3Storage, sniffType, type FileStorage } from "@plantops/module-kit/storage";

/** The storage this server is set up for. */
export function fileStorage(): FileStorage {
  return fileStorageFrom({
    dir: env.storageDir,
    bucket: env.storageBucket,
    endpoint: env.storageEndpoint,
    region: env.storageRegion,
    accessKey: env.storageAccessKey,
    secretKey: env.storageSecretKey,
  });
}

export const MAX_FILE_BYTES = 10 * 1024 * 1024;
