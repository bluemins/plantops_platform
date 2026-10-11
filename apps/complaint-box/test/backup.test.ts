// Phase 7: the nightly encrypted copy of complaint photos / videos (packages/module-kit/src/backup.ts). Against an
// in-memory backup bucket: only new files are copied, they open again with the private key, and the route needs the
// CRON_SECRET. (The S3 signing itself is tested in packages/module-kit.)
import { generateX25519Identity, identityToRecipient } from "age-encryption";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { S3Client } from "@plantops/module-kit/s3";
import { backupNewFiles, decryptBackup } from "@plantops/module-kit/backup";
import { POST as backupRoute } from "@/app/api/cron/backup/route";
import { ComplaintInput, createComplaint } from "@/server/complaints";
import { uploadComplaintFile } from "@/server/files";
import { createItem } from "@/server/items";
import { fileStorage } from "@/server/storage";
import { startFakePlatform, type FakePlatform } from "./fake-platform";
import { asOwner, JPEG, MP4, plant, PNG } from "./helpers";

let platform: FakePlatform;
let identity: string;
let recipient: string;
beforeAll(async () => {
  platform = await startFakePlatform();
  process.env.PLATFORM_URL = platform.url;
  identity = await generateX25519Identity();
  recipient = await identityToRecipient(identity);
});
afterAll(() => platform.close());

/** An in-memory backup bucket. */
function memoryBucket() {
  const objects = new Map<string, Buffer>();
  const client: S3Client = {
    put: async (key, data) => void objects.set(key, Buffer.from(data)),
    get: async (key) => objects.get(key) ?? Promise.reject(new Error("404")),
    list: async (prefix) => [...objects.keys()].filter((k) => k.startsWith(prefix)),
  };
  return { objects, client };
}

describe("nightly file backup", () => {
  it("copies new files only, encrypted, under files/complaint_box/; they decrypt to the same bytes", async () => {
    const p = plant();
    const c = await createComplaint(p.desk, ComplaintInput.parse({ customer_name: "Ramesh", phone: "9876543210", place: "Kalinga Nagar", description: "Jar leaking from the cap", item_id: (await createItem(p.owner, { name: "Jar" })).id }));
    const photo = await uploadComplaintFile(p.desk, c.id, JPEG);
    await uploadComplaintFile(p.desk, c.id, MP4);
    const bucket = memoryBucket();
    const settings = { bucket: "plantops-backup", endpoint: "https://r2.example", region: "auto", accessKey: "a", secretKey: "s", recipient };
    const run = () => backupNewFiles("complaint_box", fileStorage(), { settings, target: bucket.client });

    const first = await run();
    expect(first.status).toBe("ok");
    const mine = [...bucket.objects.keys()].filter((k) => k.includes(p.tenantId));
    expect(mine).toHaveLength(2);
    expect(mine.every((k) => k.startsWith(`files/complaint_box/tenant/${p.tenantId}/`) && k.endsWith(".age"))).toBe(true);

    const { storage_key } = (await asOwner<{ storage_key: string }>("select storage_key from complaint_box.files where id = $1", [photo.id])).rows[0]!;
    const copy = bucket.objects.get(`files/complaint_box/${storage_key}.age`)!;
    expect(copy.includes(JPEG)).toBe(false); // not readable without the key
    expect((await decryptBackup(copy, identity)).equals(JPEG)).toBe(true);

    expect(await run()).toMatchObject({ status: "ok", copied: 0 }); // nothing new
    await uploadComplaintFile(p.desk, c.id, PNG);
    expect(await run()).toMatchObject({ status: "ok", copied: 1 }); // only the new one
  });

  it("the route needs the CRON_SECRET; without BACKUP_BUCKET it says 'not set up'", async () => {
    const before = { secret: process.env.CRON_SECRET, bucket: process.env.BACKUP_BUCKET };
    try {
      process.env.CRON_SECRET = "complaint-backup-test-secret";
      delete process.env.BACKUP_BUCKET;
      const call = (secret?: string) => backupRoute(new Request("http://localhost:3004/api/cron/backup", { method: "POST", headers: secret ? { "x-cron-secret": secret } : {} }));
      expect((await call()).status).toBe(401);
      expect((await call("wrong")).status).toBe(401);
      const ok = await call("complaint-backup-test-secret");
      expect(ok.status).toBe(200);
      expect(await ok.json()).toEqual({ status: "not set up" });
    } finally {
      if (before.secret === undefined) delete process.env.CRON_SECRET;
      else process.env.CRON_SECRET = before.secret;
      if (before.bucket !== undefined) process.env.BACKUP_BUCKET = before.bucket;
    }
  });
});
