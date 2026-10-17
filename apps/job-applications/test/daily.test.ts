// The daily job (docs/JOB_APPLICATIONS_PHASE_PLAN.md Phase 6): notifications that didn't reach PlantOps, the 12-month
// removal, deleting removed applications' files from storage AND the backup bucket, and stray files.
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { createServer, type Server } from "node:http";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { newStorageKey } from "@plantops/module-kit/storage";

const pending: Promise<unknown>[] = [];
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: (fn: () => unknown) => void pending.push(Promise.resolve().then(fn)) }));

import { POST as dailyRoute } from "@/app/api/cron/daily/route";
import { newRequestKey } from "@/lib/apply";
import { removeApplication } from "@/server/applications";
import { submitApplication } from "@/server/apply";
import { runDaily } from "@/server/daily";
import { kit } from "@/server/kit";
import { newApplicationNotification } from "@/server/notify";
import { resolvePublicPlant } from "@/server/public";
import { fileStorage } from "@/server/storage";
import { startFakePlatform, type FakePlatform } from "./fake-platform";
import { asOwner, JPEG, plant } from "./helpers";

let platform: FakePlatform;
let bucket: Server;
let bucketDown = false;
const deleted: string[] = [];

beforeAll(async () => {
  platform = await startFakePlatform();
  process.env.PLATFORM_URL = platform.url;
  // a stand-in backup bucket (S3 API): records DELETEs, can fail on purpose
  bucket = createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      if (bucketDown) return res.writeHead(500).end();
      if (req.method === "DELETE") deleted.push(decodeURIComponent(new URL(req.url!, "http://x").pathname.replace(/^\/backups\//, "")));
      res.writeHead(204).end();
    });
  });
  await new Promise<void>((r) => bucket.listen(0, "127.0.0.1", r));
  Object.assign(process.env, {
    BACKUP_BUCKET: "backups",
    BACKUP_ENDPOINT: `http://127.0.0.1:${(bucket.address() as { port: number }).port}`,
    BACKUP_ACCESS_KEY_ID: "AKIDTEST",
    BACKUP_SECRET_ACCESS_KEY: "test-secret",
    BACKUP_RECIPIENT: `age1${"q".repeat(58)}`,
  });
});
afterAll(async () => {
  for (const k of ["BACKUP_BUCKET", "BACKUP_ENDPOINT", "BACKUP_ACCESS_KEY_ID", "BACKUP_SECRET_ACCESS_KEY", "BACKUP_RECIPIENT"]) delete process.env[k];
  await platform.close();
  await new Promise<void>((r) => bucket.close(() => r()));
});
beforeEach(() => {
  deleted.length = 0;
  platform.notifyStatus = 201;
});

function knownPlant() {
  const p = plant();
  const code = `D${randomUUID().slice(0, 6).toUpperCase()}`;
  platform.plants.set(code, { tenant_id: p.tenantId, name: "Bluemins" });
  return { ...p, code };
}
let n = 0;
async function sendOne(p: ReturnType<typeof knownPlant>, files = [JPEG]) {
  const sent = await submitApplication((await resolvePublicPlant(p.code))!, {
    fields: { position: "any", name: "Priya", phone: `9${String(++n).padStart(9, "0")}`, place: "Bargarh", consent: "yes", request_key: newRequestKey() },
    files,
    ip: `198.18.0.${n % 250}`,
  });
  const keys = (await asOwner<{ storage_key: string }>("select storage_key from job_applications.application_files where application_id = $1 order by page_no", [sent.saved!.id])).rows.map((r) => r.storage_key);
  return { id: sent.saved!.id, keys };
}
const onDisk = (key: string) => existsSync(path.join(process.env.JOBS_STORAGE_DIR!, key));
const queued = async (tenantId: string) => (await asOwner<{ storage_key: string }>("select storage_key from job_applications.file_removals where tenant_id = $1", [tenantId])).rows.map((r) => r.storage_key);

describe("the cron route", () => {
  it("refuses a wrong or missing secret; runs with the right one", async () => {
    const call = (secret?: string) => dailyRoute(new Request("http://x/api/cron/daily", { method: "POST", headers: secret ? { "x-cron-secret": secret } : {} }));
    expect((await call()).status).toBe(401);
    expect((await call("wrong")).status).toBe(401);
    const ok = await call(process.env.CRON_SECRET);
    expect(ok.status).toBe(200);
    expect(Object.keys(await ok.json()).sort()).toEqual(["files", "orphans", "outbox", "purged"]);
  });
});

describe("12-month removal", () => {
  it("removes exactly the applications older than 12 months, their files from storage and the backup, then the queue", async () => {
    const p = knownPlant();
    const old = await sendOne(p, [JPEG, JPEG]);
    const recent = await sendOne(p);
    await asOwner("update job_applications.applications set created_at = now() - interval '367 days' where id = $1", [old.id]);
    await asOwner("update job_applications.applications set created_at = now() - interval '364 days' where id = $1", [recent.id]);
    const result = await runDaily();
    expect(result.purged).toBeGreaterThanOrEqual(1);
    expect((await asOwner("select id from job_applications.applications where tenant_id = $1", [p.tenantId])).rows).toEqual([{ id: recent.id }]);
    for (const k of old.keys) {
      expect(onDisk(k)).toBe(false);
      expect(deleted).toContain(`files/job_applications/${k}.age`);
    }
    expect(onDisk(recent.keys[0]!)).toBe(true);
    expect(await queued(p.tenantId)).toEqual([]);
  });

  it("'Remove now' files go the same way; a backup that can't be reached keeps them queued for the next run", async () => {
    const p = knownPlant();
    const a = await sendOne(p);
    await removeApplication(p.owner, a.id, "Applicant asked");
    bucketDown = true;
    try {
      await runDaily();
    } finally {
      bucketDown = false;
    }
    expect(await queued(p.tenantId)).toEqual(a.keys); // still queued (the storage copy is already gone)
    expect(onDisk(a.keys[0]!)).toBe(false);
    await runDaily();
    expect(await queued(p.tenantId)).toEqual([]);
    expect(deleted).toContain(`files/job_applications/${a.keys[0]}.age`);
  });
});

describe("stray files", () => {
  it("a file in no application and not queued is removed (also its backup copy); real files stay", async () => {
    const p = knownPlant();
    const real = await sendOne(p);
    const stray = newStorageKey(p.tenantId);
    await fileStorage().put(stray, JPEG, "image/jpeg");
    const r = await runDaily();
    expect(r.orphans.removed).toBeGreaterThanOrEqual(1);
    expect(onDisk(stray)).toBe(false);
    expect(deleted).toContain(`files/job_applications/${stray}.age`);
    expect(onDisk(real.keys[0]!)).toBe(true);
  });
});

describe("notification outbox", () => {
  it("kept when PlantOps fails (5xx) and sent by the daily job; dropped when PlantOps refuses (4xx)", async () => {
    const p = knownPlant();
    const event = newApplicationNotification({ id: randomUUID(), refNo: 7, openingTitle: null, place: "Bargarh" });
    platform.notifyStatus = 503;
    expect(await kit.notify(p.tenantId, event)).toBeNull();
    platform.notifyStatus = 403;
    expect(await kit.notify(p.tenantId, { ...event, dedupe_key: "refused" })).toBeNull();
    const waiting = async () => (await asOwner("select input->>'dedupe_key' as k from job_applications.notification_outbox where tenant_id = $1 and sent_at is null and given_up_at is null", [p.tenantId])).rows;
    expect(await waiting()).toEqual([{ k: event.dedupe_key }]);
    platform.notifyStatus = 201;
    platform.notifications.length = 0;
    expect((await runDaily()).outbox.sent).toBeGreaterThanOrEqual(1);
    expect(platform.notifications.map((x) => x.body.dedupe_key)).toContain(event.dedupe_key);
    expect(await waiting()).toEqual([]);
  });
});
