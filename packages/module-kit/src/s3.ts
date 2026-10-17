// A small S3-compatible client (AWS Signature V4, no SDK): AWS, Cloudflare R2, MinIO, Wasabi. Path-style URLs.
// Used by Document Store's file storage and by the backup copy of every module's files (./backup.ts).
import { createHash, createHmac } from "node:crypto";

export type S3Settings = { endpoint: string; region: string; bucket: string; accessKey: string; secretKey: string };

export interface S3Client {
  put(key: string, data: Buffer, contentType?: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  /** Every key that starts with `prefix` (all pages). */
  list(prefix: string): Promise<string[]>;
  /** Deletes one object (a missing one counts as deleted). Only Job applications uses it (12-month removal). */
  delete?(key: string): Promise<void>;
}

const sha256Hex = (data: string | Buffer) => createHash("sha256").update(data).digest("hex");
const hmac = (key: Buffer | string, data: string) => createHmac("sha256", key).update(data).digest();
// SigV4 wants RFC 3986 encoding: encodeURIComponent leaves !'()* alone.
const rfc3986 = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

export function s3Client(o: S3Settings): S3Client {
  async function send(method: "PUT" | "GET" | "DELETE", key: string, opts: { body?: Buffer; contentType?: string; query?: Record<string, string> } = {}) {
    const url = new URL(`${o.endpoint.replace(/\/$/, "")}/${o.bucket}${key ? `/${key}` : ""}`);
    const query = Object.entries(opts.query ?? {}).sort(([a], [b]) => (a < b ? -1 : 1));
    const canonicalQuery = query.map(([k, v]) => `${rfc3986(k)}=${rfc3986(v)}`).join("&");
    if (canonicalQuery) url.search = canonicalQuery;
    const now = new Date();
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
    const day = amzDate.slice(0, 8);
    const payloadHash = sha256Hex(opts.body ?? "");
    const headers: Record<string, string> = { host: url.host, "x-amz-content-sha256": payloadHash, "x-amz-date": amzDate };
    if (opts.contentType) headers["content-type"] = opts.contentType;
    const signed = Object.keys(headers).sort();
    const canonical = [method, url.pathname, canonicalQuery, ...signed.map((h) => `${h}:${headers[h]}`), "", signed.join(";"), payloadHash].join("\n");
    const scope = `${day}/${o.region}/s3/aws4_request`;
    const toSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256Hex(canonical)].join("\n");
    const kSigning = hmac(hmac(hmac(hmac(`AWS4${o.secretKey}`, day), o.region), "s3"), "aws4_request");
    const signature = createHmac("sha256", kSigning).update(toSign).digest("hex");
    headers.authorization = `AWS4-HMAC-SHA256 Credential=${o.accessKey}/${scope}, SignedHeaders=${signed.join(";")}, Signature=${signature}`;
    const { host: _host, ...sendHeaders } = headers;
    const res = await fetch(url, { method, headers: sendHeaders, body: opts.body ? new Uint8Array(opts.body) : undefined, signal: AbortSignal.timeout(30_000) });
    if (!res.ok && !(method === "DELETE" && res.status === 404)) throw new Error(`File storage ${method} failed: ${res.status}`);
    return res;
  }
  return {
    async put(key, data, contentType) {
      await send("PUT", key, { body: data, contentType });
    },
    async get(key) {
      return Buffer.from(await (await send("GET", key)).arrayBuffer());
    },
    async list(prefix) {
      const keys: string[] = [];
      let token = "";
      do {
        const query: Record<string, string> = { "list-type": "2", prefix };
        if (token) query["continuation-token"] = token;
        const xml = await (await send("GET", "", { query })).text();
        for (const m of xml.matchAll(/<Key>([^<]*)<\/Key>/g)) keys.push(unescapeXml(m[1]!));
        token = /<IsTruncated>true<\/IsTruncated>/.test(xml) ? unescapeXml(/<NextContinuationToken>([^<]*)<\/NextContinuationToken>/.exec(xml)?.[1] ?? "") : "";
      } while (token);
      return keys;
    },
    async delete(key) {
      if (!key) throw new Error("A key is needed to delete");
      await send("DELETE", key);
    },
  };
}

const unescapeXml = (s: string) =>
  s.replace(/&(lt|gt|quot|apos|amp);/g, (_, e: string) => ({ lt: "<", gt: ">", quot: '"', apos: "'", amp: "&" })[e]!);
