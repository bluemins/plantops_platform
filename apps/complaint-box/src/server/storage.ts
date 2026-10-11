// Where complaint photos and videos live: the shared storage in packages/module-kit/src/storage.ts, in Complaint
// Box's OWN folder (COMPLAINT_STORAGE_DIR) or bucket (COMPLAINT_STORAGE_BUCKET) - never Document Store's.
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
    bucketVar: "COMPLAINT_STORAGE_BUCKET",
  });
}

export const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
export const MAX_VIDEO_BYTES = 30 * 1024 * 1024;
export const MAX_PHOTOS = 5;
export const MAX_VIDEOS = 1;
