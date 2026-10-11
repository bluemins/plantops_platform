// Where uploaded files live. One small interface, two drivers:
//   * local disk (development, or a single server): DOC_STORAGE_DIR, default ./.data/documents
//   * S3-compatible object storage (production, Mumbai region): when STORAGE_BUCKET is set
// Files are written once and never changed or deleted (renewals add new files). Keys are random:
// "tenant/<tenant_id>/<uuid>" - the original file name is only kept as data in the database.
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { s3Client, type S3Settings } from "@plantops/module-kit/s3";
import { env } from "./env";

export interface FileStorage {
  put(key: string, data: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  /** Every stored key (for the backup copy). */
  list(): Promise<string[]>;
}

const KEY = /^tenant\/[0-9a-f-]{36}\/[0-9a-f-]{36}$/;

export const newStorageKey = (tenantId: string) => `tenant/${tenantId}/${randomUUID()}`;

// ---------- local disk ----------

export function localStorage(dir: string): FileStorage {
  const fileFor = (key: string) => {
    if (!KEY.test(key)) throw new Error("Invalid storage key");
    return path.join(dir, key);
  };
  return {
    async put(key, data) {
      const file = fileFor(key);
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, data, { flag: "wx" }); // "wx": never overwrite an existing file
    },
    get: (key) => readFile(fileFor(key)),
    async list() {
      const tenants = await readdir(path.join(dir, "tenant")).catch((err: NodeJS.ErrnoException) => (err.code === "ENOENT" ? [] : Promise.reject(err)));
      const keys: string[] = [];
      for (const t of tenants) for (const f of await readdir(path.join(dir, "tenant", t))) keys.push(`tenant/${t}/${f}`);
      return keys.filter((k) => KEY.test(k));
    },
  };
}

// ---------- S3-compatible (signed requests, packages/module-kit/src/s3.ts) ----------

export function s3Storage(o: S3Settings): FileStorage {
  const client = s3Client(o);
  return {
    put: (key, data, contentType) => client.put(key, data, contentType),
    get: (key) => client.get(key),
    list: () => client.list("tenant/"),
  };
}

/** The storage this server is set up for. */
export function fileStorage(): FileStorage {
  if (env.storageBucket) {
    if (!env.storageAccessKey || !env.storageSecretKey) {
      throw new Error("S3 storage needs STORAGE_ACCESS_KEY_ID and STORAGE_SECRET_ACCESS_KEY when STORAGE_BUCKET is set");
    }
    return s3Storage({ endpoint: env.storageEndpoint, region: env.storageRegion, bucket: env.storageBucket, accessKey: env.storageAccessKey, secretKey: env.storageSecretKey });
  }
  if (env.storageAccessKey || env.storageSecretKey) throw new Error("Set STORAGE_BUCKET to enable the configured S3 storage credentials");
  return localStorage(env.storageDir);
}

// ---------- what may be uploaded ----------

export const MAX_FILE_BYTES = 10 * 1024 * 1024;

/** The file's real type from its first bytes. Only PDF and photos; never SVG, HTML, Office or programs. */
export function sniffType(data: Buffer): "application/pdf" | "image/jpeg" | "image/png" | "image/webp" | null {
  if (data.subarray(0, 5).toString("latin1") === "%PDF-") return "application/pdf";
  if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return "image/jpeg";
  if (data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (data.subarray(0, 4).toString("latin1") === "RIFF" && data.subarray(8, 12).toString("latin1") === "WEBP") return "image/webp";
  return null;
}

export const fileSha256 = (data: Buffer) => createHash("sha256").update(data).digest("hex");
