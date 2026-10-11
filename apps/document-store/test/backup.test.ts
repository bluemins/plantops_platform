// POST /api/cron/backup: the app's uploaded files reach the backup bucket encrypted, only once each.
// (The copy logic itself is tested in packages/module-kit/test/backup.test.ts.)
import { mkdtempSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { generateX25519Identity, identityToRecipient } from "age-encryption";
import { decryptBackup } from "@plantops/module-kit/backup";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST } from "@/app/api/cron/backup/route";
import { localStorage, newStorageKey } from "@/server/storage";
import { PDF } from "./helpers";

let server: Server;
const objects = new Map<string, Buffer>();
const NAMES = ["DOC_STORAGE_DIR", "CRON_SECRET", "BACKUP_BUCKET", "BACKUP_ENDPOINT", "BACKUP_ACCESS_KEY_ID", "BACKUP_SECRET_ACCESS_KEY", "BACKUP_RECIPIENT"];
const before = new Map(NAMES.map((n) => [n, process.env[n]]));
let identity = "";
let dir = "";

beforeAll(async () => {
  // a bucket that accepts any signature: signing is checked in module-kit's tests
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const url = new URL(req.url!, "http://x");
      if (req.method === "PUT") objects.set(url.pathname.replace(/^\/backups\//, ""), Buffer.concat(chunks));
      if (url.searchParams.get("list-type") === "2") {
        const keys = [...objects.keys()].filter((k) => k.startsWith(url.searchParams.get("prefix") ?? ""));
        return res.end(`<ListBucketResult>${keys.map((k) => `<Key>${k}</Key>`).join("")}<IsTruncated>false</IsTruncated></ListBucketResult>`);
      }
      res.end();
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  identity = await generateX25519Identity();
  dir = mkdtempSync(path.join(tmpdir(), "docs-backup-"));
  Object.assign(process.env, {
    DOC_STORAGE_DIR: dir,
    CRON_SECRET: "cron-test-secret",
    BACKUP_BUCKET: "backups",
    BACKUP_ENDPOINT: `http://127.0.0.1:${(server.address() as { port: number }).port}`,
    BACKUP_ACCESS_KEY_ID: "k",
    BACKUP_SECRET_ACCESS_KEY: "s",
    BACKUP_RECIPIENT: await identityToRecipient(identity),
  });
});
afterAll(async () => {
  for (const [n, v] of before) if (v === undefined) delete process.env[n];
  else process.env[n] = v;
  await new Promise<void>((r) => server.close(() => r()));
});

const call = (secret = "cron-test-secret") => POST(new Request("http://docs/api/cron/backup", { method: "POST", headers: { "x-cron-secret": secret } }));

describe("POST /api/cron/backup", () => {
  it("refuses a wrong secret", async () => {
    expect((await call("nope")).status).toBe(401);
  });

  it("copies uploaded files encrypted, then only new ones", async () => {
    const store = localStorage(dir);
    const first = newStorageKey(crypto.randomUUID());
    await store.put(first, PDF, "application/pdf");
    const r1 = await call();
    expect(r1.status).toBe(200);
    expect(await r1.json()).toEqual({ status: "ok", total: 1, copied: 1, waiting: 0, failed: 0 });
    const sealed = objects.get(`files/document_store/${first}.age`)!;
    expect(sealed.includes(PDF)).toBe(false);
    expect((await decryptBackup(sealed, identity)).equals(PDF)).toBe(true);

    await store.put(newStorageKey(crypto.randomUUID()), PDF, "application/pdf");
    expect(await (await call()).json()).toMatchObject({ status: "ok", total: 2, copied: 1 });
  });
});
