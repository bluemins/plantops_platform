// Where a module's uploaded files live (moved here from Document Store so every module shares it). Two drivers:
//   * local disk (development, or a single server with a volume)
//   * S3-compatible object storage, when the module's bucket is set
// Files are written once and never changed or deleted. Keys are random: "tenant/<tenant_id>/<uuid>" - any
// original file name is only kept as data in the database. Each module uses its OWN folder / bucket, so one
// module's backup never copies another module's files.
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { s3Client, type S3Settings } from "./s3";

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

// ---------- S3-compatible (signed requests, ./s3.ts) ----------

export function s3Storage(o: S3Settings): FileStorage {
  const client = s3Client(o);
  return {
    put: (key, data, contentType) => client.put(key, data, contentType),
    get: (key) => client.get(key),
    list: () => client.list("tenant/"),
  };
}

export interface StorageSettings {
  /** local folder, used while no bucket is set */
  dir: string;
  bucket: string;
  endpoint: string;
  region: string;
  accessKey: string;
  secretKey: string;
  /** the module's bucket variable, for the error messages (e.g. STORAGE_BUCKET) */
  bucketVar?: string;
}

/** The storage a server is set up for. Half-set S3 settings are an error, never a silent fallback to disk. */
export function fileStorageFrom(s: StorageSettings): FileStorage {
  const bucketVar = s.bucketVar ?? "STORAGE_BUCKET";
  if (s.bucket) {
    if (!s.accessKey || !s.secretKey) throw new Error(`S3 storage needs STORAGE_ACCESS_KEY_ID and STORAGE_SECRET_ACCESS_KEY when ${bucketVar} is set`);
    return s3Storage({ endpoint: s.endpoint, region: s.region, bucket: s.bucket, accessKey: s.accessKey, secretKey: s.secretKey });
  }
  if (s.accessKey || s.secretKey) throw new Error(`Set ${bucketVar} to enable the configured S3 storage credentials`);
  return localStorage(s.dir);
}

// ---------- what may be uploaded ----------

/** The file's real type from its first bytes. Only PDF and photos; never SVG, HTML, Office or programs. */
export function sniffType(data: Buffer): "application/pdf" | "image/jpeg" | "image/png" | "image/webp" | null {
  if (data.subarray(0, 5).toString("latin1") === "%PDF-") return "application/pdf";
  if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return "image/jpeg";
  if (data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (data.subarray(0, 4).toString("latin1") === "RIFF" && data.subarray(8, 12).toString("latin1") === "WEBP") return "image/webp";
  return null;
}

const MP4_BRANDS = new Set(["isom", "iso2", "iso4", "iso5", "iso6", "mp41", "mp42", "avc1", "M4V ", "dash"]);

/**
 * MP4 / MOV video from its first bytes (the "ftyp" box). HEIC / AVIF photos use the same box with other brands
 * (heic, mif1, avif...) and are NOT videos.
 */
export function sniffVideo(data: Buffer): "video/mp4" | "video/quicktime" | null {
  if (data.length < 12 || data.subarray(4, 8).toString("latin1") !== "ftyp") return null;
  const brand = data.subarray(8, 12).toString("latin1");
  if (brand === "qt  ") return "video/quicktime";
  return MP4_BRANDS.has(brand) ? "video/mp4" : null;
}

export const fileSha256 = (data: Buffer) => createHash("sha256").update(data).digest("hex");
