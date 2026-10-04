// Where uploaded files live. One small interface, two drivers:
//   * local disk (development, or a single server): DOC_STORAGE_DIR, default ./.data/documents
//   * S3-compatible object storage (production, Mumbai region): when STORAGE_BUCKET is set
// Files are written once and never changed or deleted (renewals add new files). Keys are random:
// "tenant/<tenant_id>/<uuid>" - the original file name is only kept as data in the database.
import { createHash, createHmac, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { env } from "./env";

export interface FileStorage {
  put(key: string, data: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer>;
}

export const newStorageKey = (tenantId: string) => `tenant/${tenantId}/${randomUUID()}`;

// ---------- local disk ----------

export function localStorage(dir: string): FileStorage {
  const fileFor = (key: string) => {
    if (!/^tenant\/[0-9a-f-]{36}\/[0-9a-f-]{36}$/.test(key)) throw new Error("Invalid storage key");
    return path.join(dir, key);
  };
  return {
    async put(key, data) {
      const file = fileFor(key);
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, data, { flag: "wx" }); // "wx": never overwrite an existing file
    },
    get: (key) => readFile(fileFor(key)),
  };
}

// ---------- S3-compatible (AWS Signature V4, no SDK needed) ----------

const sha256Hex = (data: string | Buffer) => createHash("sha256").update(data).digest("hex");
const hmac = (key: Buffer | string, data: string) => createHmac("sha256", key).update(data).digest();

export function s3Storage(o: { endpoint: string; region: string; bucket: string; accessKey: string; secretKey: string }): FileStorage {
  async function send(method: "PUT" | "GET", key: string, body?: Buffer, contentType?: string) {
    const url = new URL(`${o.endpoint.replace(/\/$/, "")}/${o.bucket}/${key}`); // path-style: works with AWS, MinIO, R2, Wasabi
    const now = new Date();
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
    const day = amzDate.slice(0, 8);
    const payloadHash = body ? sha256Hex(body) : sha256Hex("");
    const headers: Record<string, string> = { host: url.host, "x-amz-content-sha256": payloadHash, "x-amz-date": amzDate };
    if (contentType) headers["content-type"] = contentType;
    const signed = Object.keys(headers).sort();
    const canonical = [method, url.pathname, "", ...signed.map((h) => `${h}:${headers[h]}`), "", signed.join(";"), payloadHash].join("\n");
    const scope = `${day}/${o.region}/s3/aws4_request`;
    const toSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256Hex(canonical)].join("\n");
    const kSigning = hmac(hmac(hmac(hmac(`AWS4${o.secretKey}`, day), o.region), "s3"), "aws4_request");
    const signature = createHmac("sha256", kSigning).update(toSign).digest("hex");
    headers.authorization = `AWS4-HMAC-SHA256 Credential=${o.accessKey}/${scope}, SignedHeaders=${signed.join(";")}, Signature=${signature}`;
    const { host: _host, ...sendHeaders } = headers;
    const res = await fetch(url, { method, headers: sendHeaders, body: body ? new Uint8Array(body) : undefined, signal: AbortSignal.timeout(30_000) });
    if (!res.ok) throw new Error(`File storage ${method} failed: ${res.status}`);
    return res;
  }
  return {
    async put(key, data, contentType) {
      await send("PUT", key, data, contentType);
    },
    async get(key) {
      return Buffer.from(await (await send("GET", key)).arrayBuffer());
    },
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

export const fileSha256 = (data: Buffer) => sha256Hex(data);
