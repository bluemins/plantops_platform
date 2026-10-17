// Sending an application from the public page (docs/JOB_APPLICATIONS_PHASE_PLAN.md "Sending an application", Phase
// 4 tests): every public input is hostile. The plant comes only from the address; files are checked by their bytes;
// the spam rules (trap, 5 an hour, 30-day repeat, Turnstile) hold; a double tap never makes two.
import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import { readdirSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { resetRateLimits } from "@plantops/module-kit/http";

// next/server's after() runs once the answer is sent; here it runs at once and can be awaited
const pending: Promise<unknown>[] = [];
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: (fn: () => unknown) => void pending.push(Promise.resolve().then(fn)) }));

import { POST as apply } from "@/app/api/apply/[code]/route";
import { newRequestKey } from "@/lib/apply";
import { createOpening, OpeningInput, updateOpening } from "@/server/openings";
import { submitApplication } from "@/server/apply";
import { resolvePublicPlant } from "@/server/public";
import { NOMAIL_OWNER_ID, OWNER_ID, startFakePlatform, type FakePlatform } from "./fake-platform";
import { addApplication, asOwner, EXE, HEIC, HTML, JPEG, PDF, plant, PNG, sized, SVG, WEBP } from "./helpers";

let platform: FakePlatform;
let turnstile: Server;
let turnstileUrl = "";
let turnstileDown = false;
const turnstileAsked: string[] = [];

beforeAll(async () => {
  platform = await startFakePlatform();
  process.env.PLATFORM_URL = platform.url;
  turnstile = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      turnstileAsked.push(raw);
      if (turnstileDown) return res.writeHead(500).end();
      const token = new URLSearchParams(raw).get("response");
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ success: token === "good-token" }));
    });
  });
  await new Promise<void>((r) => turnstile.listen(0, "127.0.0.1", r));
  turnstileUrl = `http://127.0.0.1:${(turnstile.address() as { port: number }).port}/siteverify`;
});
afterAll(async () => {
  await platform.close();
  await new Promise<void>((r) => turnstile.close(() => r()));
});
beforeEach(() => {
  resetRateLimits();
  platform.notifications.length = 0;
});

/** A plant the platform knows under a fresh code (lookups are cached a minute, so each test gets its own). */
function knownPlant() {
  const p = plant();
  const code = `J${randomUUID().slice(0, 6).toUpperCase()}`;
  platform.plants.set(code, { tenant_id: p.tenantId, name: "Bluemins" });
  platform.branding.set(p.tenantId, { name: "Bluemins", brand_color: "#0b6e99", logo: false, code });
  return { ...p, code };
}
const opening = (over: Record<string, unknown> = {}) =>
  OpeningInput.parse({ title: "Lab Assistant", grp: "lab_quality", tag: null, description: "Water tests", minQualification: "10th pass", goodToHave: null, status: "active", ...over });

let ip = 0;
const good = (over: Record<string, string> = {}) => ({ position: "any", name: "Priya Mishra", phone: "98765 43210", place: "Bargarh", consent: "yes", request_key: newRequestKey(), ...over });

/** The browser's send: multipart, from our own page. */
async function send(code: string, fields: Record<string, string>, files: Buffer[] = [JPEG], headers: Record<string, string> = {}) {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  files.forEach((f, i) => form.append("resume", new Blob([new Uint8Array(f)]), `page-${i + 1}.jpg`));
  const req = new Request(`http://localhost:3007/api/apply/${code}`, { method: "POST", body: form, headers: { origin: "http://localhost:3007", "x-real-ip": `10.0.0.${++ip % 250}`, ...headers } });
  const res = await apply(req, { params: Promise.resolve({ code }) });
  await Promise.all(pending.splice(0));
  return { status: res.status, body: (await res.json()) as { ref?: string; name?: string; phone?: string; error?: string } };
}
const rows = async (tenantId: string) => (await asOwner("select * from job_applications.applications where tenant_id = $1 order by ref_no", [tenantId])).rows;
const fileRows = async (tenantId: string) => (await asOwner("select * from job_applications.application_files where tenant_id = $1 order by page_no", [tenantId])).rows;
const storedFiles = (tenantId: string) => {
  try {
    return readdirSync(path.join(process.env.JOBS_STORAGE_DIR!, "tenant", tenantId));
  } catch {
    return [];
  }
};

describe("a good send", () => {
  it("photos: saved with reference J-0001, the position's name copied, consent version and time, files by page", async () => {
    const p = knownPlant();
    const o = await createOpening(p.owner, opening());
    const res = await send(p.code, good({ position: o.id }), [JPEG, PNG, WEBP]);
    expect(res).toEqual({ status: 200, body: { ref: "J-0001", name: "Priya Mishra", phone: "9876543210" } });
    const [a] = await rows(p.tenantId);
    expect(a).toMatchObject({ ref_no: 1, opening_id: o.id, opening_title: "Lab Assistant", name: "Priya Mishra", phone: "9876543210", place: "Bargarh", consent_version: "v1", status: "new", seen_at: null });
    expect((await fileRows(p.tenantId)).map((f) => [f.page_no, f.content_type])).toEqual([
      [1, "image/jpeg"],
      [2, "image/png"],
      [3, "image/webp"],
    ]);
    expect(storedFiles(p.tenantId)).toHaveLength(3);
  });

  it("one PDF, Any job; the next reference is J-0002; lower-case plant code works", async () => {
    const p = knownPlant();
    await send(p.code, good());
    const res = await send(p.code.toLowerCase(), good({ phone: "+91 91234 56789" }), [PDF]);
    expect(res.body.ref).toBe("J-0002");
    expect((await rows(p.tenantId))[1]).toMatchObject({ opening_id: null, opening_title: null, phone: "9123456789" });
  });

  it("tells the owners and ticked HR desk (bell, no phone number in the text)", async () => {
    const p = knownPlant();
    const o = await createOpening(p.owner, opening());
    await send(p.code, good({ position: o.id }));
    const [a] = await rows(p.tenantId);
    expect(platform.notifications).toEqual([
      {
        tenantId: p.tenantId,
        body: expect.objectContaining({ kind: "job_applications.new", title: "New job application J-0001: Lab Assistant, Bargarh", level: "bell", link: `/applications/${a!.id}`, dedupe_key: `new:${a!.id}` }),
      },
    ]);
    expect(JSON.stringify(platform.notifications)).not.toMatch(/98765|9876543210/);
    expect(platform.notifications[0]!.body.only_listed).toBeUndefined(); // owners + ticked people (the platform decides)
  });
});

describe("field rules", () => {
  it.each([
    ["no name", { name: "" }, /Full name/],
    ["a one-letter name", { name: "P" }, /Full name/],
    ["a 101-letter name", { name: "x".repeat(101) }, /Full name/],
    ["a landline", { phone: "011 2345 6789" }, /Mobile number/],
    ["a 9-digit mobile", { phone: "987654321" }, /Mobile number/],
    ["no place", { place: " " }, /Where you live/],
    ["a 201-letter place", { place: "x".repeat(201) }, /Where you live/],
    ["no consent", { consent: "" }, /agree/],
    ["a bad request key", { request_key: "short" }, /reload/],
    ["a position that isn't an id", { position: "Manager" }, /pick a position/],
  ])("refuses %s", async (_what, over, msg) => {
    const p = knownPlant();
    const res = await send(p.code, good(over));
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(msg);
    expect(await rows(p.tenantId)).toEqual([]);
  });
});

describe("files are checked by their bytes", () => {
  it.each([
    ["a renamed .exe", [EXE], 415],
    ["an SVG", [SVG], 415],
    ["an HTML page", [HTML], 415],
    ["an iPhone HEIC that wasn't shrunk", [HEIC], 415],
    ["a PDF over 5 MB", [sized(PDF, 5 * 1024 * 1024 + 1)], 413],
    ["a photo over 5 MB", [sized(JPEG, 5 * 1024 * 1024 + 1)], 413],
    ["4 photos", [JPEG, JPEG, JPEG, JPEG], 400],
    ["a PDF and a photo", [PDF, JPEG], 400],
    ["no file", [], 400],
  ])("refuses %s", async (_what, files, status) => {
    const p = knownPlant();
    expect((await send(p.code, good(), files as Buffer[])).status).toBe(status);
    expect(await rows(p.tenantId)).toEqual([]);
    expect(storedFiles(p.tenantId)).toEqual([]);
  });
});

describe("the plant comes only from the address", () => {
  it("a tenant id, another plant's opening or an opening title in the form never count", async () => {
    const p = knownPlant();
    const q = knownPlant();
    const theirs = await createOpening(q.owner, opening({ title: "Their job" }));
    expect((await send(p.code, good({ position: theirs.id }))).body.error).toMatch(/no longer open/);
    const res = await send(p.code, good({ tenant_id: q.tenantId, tenantId: q.tenantId, opening_title: "Boss" }));
    expect(res.status).toBe(200);
    expect(await rows(q.tenantId)).toEqual([]);
    expect((await rows(p.tenantId))[0]).toMatchObject({ opening_title: null });
  });

  it("a switched-off opening is refused", async () => {
    const p = knownPlant();
    const o = await createOpening(p.owner, opening());
    await updateOpening(p.owner, o.id, opening({ status: "off" }));
    expect((await send(p.code, good({ position: o.id }))).body.error).toMatch(/no longer open/);
  });

  it("unknown or malformed plant: the same 'not available'", async () => {
    for (const code of ["NOPLANT9", "a b"]) expect(await send(code, good())).toEqual({ status: 404, body: { error: "This page is not available" } });
  });
});

describe("spam rules", () => {
  it("the trap field: answers 'sent' with a reference, saves nothing, tells nobody", async () => {
    const p = knownPlant();
    const res = await send(p.code, good({ website: "http://spam.example" }));
    expect(res.status).toBe(200);
    expect(res.body.ref).toMatch(/^J-\d{4}$/);
    expect(await rows(p.tenantId)).toEqual([]);
    expect(storedFiles(p.tenantId)).toEqual([]);
    expect(platform.notifications).toEqual([]);
  });

  it("20 sends per connection per hour; the 21st is refused; another connection is fine", async () => {
    const p = knownPlant();
    for (let i = 0; i < 20; i++) expect((await send(p.code, good({ phone: `98${String(i).padStart(8, "0")}` }), [JPEG], { "x-real-ip": "203.0.113.7" })).status).toBe(200);
    const extra = await send(p.code, good({ phone: "9000000021" }), [JPEG], { "x-real-ip": "203.0.113.7" });
    expect(extra).toEqual({ status: 429, body: { error: "Too many applications from this connection. Please try again later." } });
    expect((await send(p.code, good({ phone: "9000000021" }), [JPEG], { "x-real-ip": "203.0.113.8" })).status).toBe(200);
  });

  it("one per phone per position per 30 days ('Any job' counts as one); another position or after 30 days is fine", async () => {
    const p = knownPlant();
    const o = await createOpening(p.owner, opening());
    expect((await send(p.code, good())).status).toBe(200);
    const again = await send(p.code, good());
    expect(again.status).toBe(409);
    expect(again.body.error).toMatch(/^You already applied on \d{1,2} [A-Z][a-z]{2}\. We have your details\.$/);
    expect((await send(p.code, good({ position: o.id }))).status).toBe(200); // another position
    expect((await send(p.code, good({ position: o.id }))).status).toBe(409);
    await asOwner("update job_applications.applications set created_at = now() - interval '31 days' where tenant_id = $1", [p.tenantId]);
    expect((await send(p.code, good())).status).toBe(200); // after 30 days
    // another plant's applicant with the same phone is not this plant's business
    const q = knownPlant();
    await addApplication(q.tenantId, { phone: "9876543210" });
    expect((await send(q.code, good({ phone: "9876543211" }))).status).toBe(200);
  });

  describe("Cloudflare Turnstile (when both keys are set)", () => {
    beforeAll(() => {
      process.env.TURNSTILE_SITE_KEY = "test-site-key";
      process.env.TURNSTILE_SECRET = "test-secret";
      process.env.TURNSTILE_VERIFY_URL = turnstileUrl;
    });
    afterAll(() => {
      for (const k of ["TURNSTILE_SITE_KEY", "TURNSTILE_SECRET", "TURNSTILE_VERIFY_URL"]) delete process.env[k];
    });

    it("a good token passes (checked with our secret); a bad or missing one is refused; Cloudflare down refuses too", async () => {
      const p = knownPlant();
      expect((await send(p.code, good({ "cf-turnstile-response": "good-token" }))).status).toBe(200);
      expect(new URLSearchParams(turnstileAsked.at(-1)).get("secret")).toBe("test-secret");
      expect(await send(p.code, good({ "cf-turnstile-response": "bad-token" }))).toEqual({ status: 400, body: { error: "Please tick the spam check again." } });
      expect((await send(p.code, good())).status).toBe(400);
      turnstileDown = true;
      try {
        expect((await send(p.code, good({ "cf-turnstile-response": "good-token" }))).status).toBe(503);
      } finally {
        turnstileDown = false;
      }
      expect(await rows(p.tenantId)).toHaveLength(1);
    });
  });
});

describe("double taps, two at once, storage", () => {
  it("the same request key twice: one application, the same reference, one notification", async () => {
    const p = knownPlant();
    const fields = good();
    const first = await send(p.code, fields);
    const second = await send(p.code, fields);
    expect(second.body.ref).toBe(first.body.ref);
    expect(await rows(p.tenantId)).toHaveLength(1);
    expect(platform.notifications).toHaveLength(1);
  });

  it("two sends at the same moment get J-0001 and J-0002", async () => {
    const p = knownPlant();
    const view = (await resolvePublicPlant(p.code))!;
    const [a, b] = await Promise.all([
      submitApplication(view, { fields: good({ phone: "9111111111" }), files: [JPEG], ip: "198.51.100.1" }),
      submitApplication(view, { fields: good({ phone: "9222222222" }), files: [JPEG], ip: "198.51.100.2" }),
    ]);
    expect([a.ref, b.ref].sort()).toEqual(["J-0001", "J-0002"]);
  });

  it("storage full: 'closed', no row, no file, and the owners (only) are told", async () => {
    const p = knownPlant();
    platform.limits.set(p.tenantId, { job_applications: { storage_mb: 1 } });
    expect((await send(p.code, good({ phone: "9111111111" }), [sized(JPEG, 700 * 1024)])).status).toBe(200);
    platform.notifications.length = 0;
    const res = await send(p.code, good({ phone: "9222222222" }), [sized(JPEG, 400 * 1024)]);
    expect(res).toEqual({ status: 503, body: { error: "Applications are closed right now. Please try again later." } });
    expect(await rows(p.tenantId)).toHaveLength(1);
    expect(storedFiles(p.tenantId)).toHaveLength(1);
    expect(platform.notifications).toEqual([
      { tenantId: p.tenantId, body: expect.objectContaining({ kind: "job_applications.storage", level: "push", only_listed: true, also_user_ids: [OWNER_ID, NOMAIL_OWNER_ID], dedupe_key: "storage:1:full", link: "/openings" }) },
    ]);
  });

  it("crossing 80 % of the plan's storage tells the owners", async () => {
    const p = knownPlant();
    platform.limits.set(p.tenantId, { job_applications: { storage_mb: 1 } });
    await send(p.code, good(), [sized(PDF, 850 * 1024)]);
    expect(platform.notifications.map((n) => n.body.dedupe_key)).toEqual([expect.stringMatching(/^new:/), "storage:1:80"]);
  });
});

describe("only our own page may send", () => {
  it("another website's Origin or none: 403; not multipart: 415; a body over 12 MB: 413", async () => {
    const p = knownPlant();
    expect((await send(p.code, good(), [JPEG], { origin: "https://evil.example" })).status).toBe(403);
    const noOrigin = new Request(`http://localhost:3007/api/apply/${p.code}`, { method: "POST", body: new FormData() });
    expect((await apply(noOrigin, { params: Promise.resolve({ code: p.code }) })).status).toBe(403);
    const json = new Request(`http://localhost:3007/api/apply/${p.code}`, { method: "POST", body: JSON.stringify(good()), headers: { origin: "http://localhost:3007", "content-type": "application/json" } });
    expect((await apply(json, { params: Promise.resolve({ code: p.code }) })).status).toBe(415);
    expect((await send(p.code, good(), [sized(PDF, 4 * 1024 * 1024), sized(PDF, 4 * 1024 * 1024), sized(PDF, 4 * 1024 * 1024 + 10)])).status).toBe(413);
    expect(await rows(p.tenantId)).toEqual([]);
  });
});
