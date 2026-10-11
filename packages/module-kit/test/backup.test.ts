// Backup copy of module files: encryption round trip, only new files copied, time limit, failures, settings and the
// cron route. Runs against a fake S3 server that re-checks every request's AWS SigV4 signature from the raw request
// (a real bucket is checked when it is set up, docs/HANDBOOK.md "Backups").
import { createHash, createHmac } from "node:crypto";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { generateX25519Identity, identityToRecipient } from "age-encryption";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { backupKeyFor, backupNewFiles, backupRoute, backupSettings, decryptBackup, encryptBackup, type BackupSettings, type BackupSource } from "../src/backup";
import { s3Client } from "../src/s3";

const SECRET = "test-secret-key";
const sha = (d: string | Buffer) => createHash("sha256").update(d).digest("hex");
const hmac = (k: Buffer | string, d: string) => createHmac("sha256", k).update(d).digest();
const enc = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

/** Recomputes the signature the way S3 does, from what actually arrived. */
function validSignature(req: IncomingMessage, body: Buffer): boolean {
  const auth = /^AWS4-HMAC-SHA256 Credential=AKIDTEST\/(\d{8})\/auto\/s3\/aws4_request, SignedHeaders=([a-z0-9;-]+), Signature=([0-9a-f]{64})$/.exec(req.headers.authorization ?? "");
  if (!auth) return false;
  const [, day, signedHeaders, signature] = auth;
  if (req.headers["x-amz-content-sha256"] !== sha(body)) return false;
  const url = new URL(req.url!, "http://x");
  const query = [...url.searchParams].map(([k, v]) => [enc(k), enc(v)]).sort(([a], [b]) => (a! < b! ? -1 : 1)).map(([k, v]) => `${k}=${v}`).join("&");
  const headers = signedHeaders!.split(";").map((h) => `${h}:${req.headers[h]}`);
  const canonical = [req.method, url.pathname, query, ...headers, "", signedHeaders, sha(body)].join("\n");
  const toSign = ["AWS4-HMAC-SHA256", req.headers["x-amz-date"], `${day}/auto/s3/aws4_request`, sha(canonical)].join("\n");
  const key = hmac(hmac(hmac(hmac(`AWS4${SECRET}`, day!), "auto"), "s3"), "aws4_request");
  return createHmac("sha256", key).update(toSign).digest("hex") === signature;
}

let server: Server;
let endpoint = "";
const objects = new Map<string, Buffer>();
let requests: string[] = [];
const PAGE = 2; // tiny pages, so listing must follow continuation tokens

beforeAll(async () => {
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const body = Buffer.concat(chunks);
      requests.push(`${req.method} ${req.url}`);
      if (!validSignature(req, body)) return res.writeHead(403).end();
      const url = new URL(req.url!, "http://x");
      if (req.method === "GET" && url.pathname === "/backups" && url.searchParams.get("list-type") === "2") {
        const prefix = url.searchParams.get("prefix") ?? "";
        const keys = [...objects.keys()].filter((k) => k.startsWith(prefix)).sort();
        const start = Number(url.searchParams.get("continuation-token") ?? 0);
        const page = keys.slice(start, start + PAGE);
        const more = start + PAGE < keys.length;
        const xml = `<ListBucketResult>${page.map((k) => `<Contents><Key>${k.replace(/&/g, "&amp;")}</Key></Contents>`).join("")}<IsTruncated>${more}</IsTruncated>${more ? `<NextContinuationToken>${start + PAGE}</NextContinuationToken>` : ""}</ListBucketResult>`;
        return res.writeHead(200, { "content-type": "application/xml" }).end(xml);
      }
      const key = decodeURIComponent(url.pathname.replace(/^\/backups\//, ""));
      if (req.method === "PUT") {
        objects.set(key, body);
        return res.writeHead(200).end();
      }
      const found = objects.get(key);
      return found ? res.writeHead(200).end(found) : res.writeHead(404).end();
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  endpoint = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));
beforeEach(() => {
  objects.clear();
  requests = [];
});

let identity = "";
let settings: BackupSettings;
beforeAll(async () => {
  identity = await generateX25519Identity();
  settings = { endpoint, region: "auto", bucket: "backups", accessKey: "AKIDTEST", secretKey: SECRET, recipient: await identityToRecipient(identity) };
});

const T = "tenant/11111111-1111-1111-1111-111111111111";
function source(files: Record<string, string>, broken: string[] = []): BackupSource & { reads: string[] } {
  const reads: string[] = [];
  return {
    reads,
    list: async () => Object.keys(files),
    get: async (key) => {
      reads.push(key);
      if (broken.includes(key)) throw new Error("ENOENT");
      return Buffer.from(files[key]!);
    },
  };
}

describe("encryption", () => {
  it("round-trips, and the stored bytes are not readable without the private key", async () => {
    const data = Buffer.from("FSSAI licence for plant 002");
    const sealed = await encryptBackup(data, settings.recipient);
    expect(sealed.includes(data)).toBe(false);
    expect(sealed.subarray(0, 21).toString()).toBe("age-encryption.org/v1");
    expect((await decryptBackup(sealed, identity)).equals(data)).toBe(true);
    await expect(decryptBackup(sealed, await generateX25519Identity())).rejects.toThrow();
  });
});

describe("S3 client", () => {
  it("signs list requests with their query string and follows every page", async () => {
    const s3 = s3Client(settings);
    for (const k of ["a/1", "a/2", "a/4", "a/5", "b/1"]) await s3.put(k, Buffer.from(k));
    objects.set("a/3 & more", Buffer.from("")); // XML-escaped in the listing
    expect(await s3.list("a/")).toEqual(["a/1", "a/2", "a/3 & more", "a/4", "a/5"]);
    expect(requests.filter((r) => r.startsWith("GET")).length).toBe(3);
    expect((await s3.get("b/1")).toString()).toBe("b/1");
  });

  it("refuses a bad signature (the fake really checks)", async () => {
    await expect(s3Client({ ...settings, secretKey: "wrong" }).list("")).rejects.toThrow(/403/);
  });
});

describe("backupNewFiles", () => {
  it("copies every file once, encrypted, and only new files on the next run", async () => {
    const files = { [`${T}/aaa`]: "first", [`${T}/bbb`]: "second" };
    const r1 = await backupNewFiles("document_store", source(files), { settings });
    expect(r1).toEqual({ status: "ok", total: 2, copied: 2, waiting: 0, failed: 0 });
    const stored = objects.get(backupKeyFor("document_store", `${T}/aaa`))!;
    expect((await decryptBackup(stored, identity)).toString()).toBe("first");

    const src = source({ ...files, [`${T}/ccc`]: "third" });
    const r2 = await backupNewFiles("document_store", src, { settings });
    expect(r2).toEqual({ status: "ok", total: 3, copied: 1, waiting: 0, failed: 0 });
    expect(src.reads).toEqual([`${T}/ccc`]); // old files are not read again
    expect(objects.size).toBe(3);
  });

  it("keeps modules apart in the bucket", async () => {
    await backupNewFiles("document_store", source({ [`${T}/aaa`]: "doc" }), { settings });
    const r = await backupNewFiles("complaint_box", source({ [`${T}/aaa`]: "photo" }), { settings });
    expect(r).toMatchObject({ copied: 1 });
    expect([...objects.keys()].sort()).toEqual([`files/complaint_box/${T}/aaa.age`, `files/document_store/${T}/aaa.age`]);
  });

  it("stops starting new files at the time limit; the rest wait for the next run", async () => {
    let clock = 0;
    const files = Object.fromEntries([1, 2, 3, 4].map((n) => [`${T}/f${n}`, `file ${n}`]));
    const src = source(files);
    const get = src.get;
    src.get = async (k) => {
      clock += 40;
      return get(k);
    };
    const r = await backupNewFiles("document_store", src, { settings, timeLimitMs: 100, now: () => clock });
    expect(r).toEqual({ status: "ok", total: 3, copied: 3, waiting: 1, failed: 0 });
    expect(await backupNewFiles("document_store", source(files), { settings })).toMatchObject({ copied: 1, waiting: 0, total: 4 });
  });

  it("a file that can't be read fails the run but doesn't stop the others", async () => {
    const r = await backupNewFiles("document_store", source({ [`${T}/bad`]: "", [`${T}/good`]: "ok" }, [`${T}/bad`]), { settings });
    expect(r).toMatchObject({ status: "failed", copied: 1, failed: 1, waiting: 0 });
    expect((r as { error: string }).error).toMatch(/bad: ENOENT/);
  });

  it("refuses odd keys and module ids", async () => {
    const r = await backupNewFiles("document_store", source({ "../etc/passwd": "x" }), { settings });
    expect(r).toMatchObject({ status: "failed", copied: 0 });
    expect(objects.size).toBe(0);
    await expect(backupNewFiles("../x", source({}), { settings })).rejects.toThrow(/module id/);
  });

  it("does nothing while backup is not set up", async () => {
    expect(await backupNewFiles("document_store", source({ [`${T}/a`]: "x" }), { settings: null })).toEqual({ status: "not set up" });
    expect(requests).toEqual([]);
  });
});

describe("settings", () => {
  const NAMES = ["BACKUP_BUCKET", "BACKUP_ENDPOINT", "BACKUP_REGION", "BACKUP_ACCESS_KEY_ID", "BACKUP_SECRET_ACCESS_KEY", "BACKUP_RECIPIENT"];
  function withEnv(values: Record<string, string>, fn: () => void) {
    const before = new Map(NAMES.map((n) => [n, process.env[n]]));
    try {
      for (const n of NAMES) delete process.env[n];
      Object.assign(process.env, values);
      fn();
    } finally {
      for (const [n, v] of before) if (v === undefined) delete process.env[n];
      else process.env[n] = v;
    }
  }
  const full = () => ({ BACKUP_BUCKET: "b", BACKUP_ENDPOINT: "https://x.r2.cloudflarestorage.com", BACKUP_ACCESS_KEY_ID: "k", BACKUP_SECRET_ACCESS_KEY: "s", BACKUP_RECIPIENT: settings.recipient });

  it("unset = not set up; complete = region auto by default", () => {
    withEnv({}, () => expect(backupSettings()).toBeNull());
    withEnv(full(), () => expect(backupSettings()).toMatchObject({ bucket: "b", region: "auto", recipient: settings.recipient }));
  });

  it("refuses half-set settings and a wrong key", () => {
    withEnv({ BACKUP_RECIPIENT: settings.recipient }, () => expect(() => backupSettings()).toThrow(/Set BACKUP_BUCKET/));
    withEnv({ ...full(), BACKUP_SECRET_ACCESS_KEY: "" }, () => expect(() => backupSettings()).toThrow(/BACKUP_SECRET_ACCESS_KEY/));
    withEnv({ ...full(), BACKUP_RECIPIENT: identity }, () => expect(() => backupSettings()).toThrow(/age public key/));
  });
});

describe("backupRoute", () => {
  const call = (secret?: string) => new Request("http://m/api/cron/backup", { method: "POST", headers: secret ? { "x-cron-secret": secret } : {} });
  const ok = async () => ({ status: "ok" as const, total: 1, copied: 1, waiting: 0, failed: 0 });

  it("needs CRON_SECRET on the server and the right header", async () => {
    const before = process.env.CRON_SECRET;
    try {
      delete process.env.CRON_SECRET;
      expect((await backupRoute(call("x"), ok)).status).toBe(503);
      process.env.CRON_SECRET = "cron-secret";
      expect((await backupRoute(call(), ok)).status).toBe(401);
      expect((await backupRoute(call("cron-secreT"), ok)).status).toBe(401);
      expect((await backupRoute(call("cron-secret"), ok)).status).toBe(200);
      expect((await backupRoute(call("cron-secret"), async () => ({ ...(await ok()), status: "failed" as const }))).status).toBe(500);
      const thrown = await backupRoute(call("cron-secret"), async () => {
        throw new Error("bucket unreachable");
      });
      expect(thrown.status).toBe(500);
      expect(await thrown.json()).toEqual({ status: "failed", error: "bucket unreachable" });
    } finally {
      if (before === undefined) delete process.env.CRON_SECRET;
      else process.env.CRON_SECRET = before;
    }
  });
});
