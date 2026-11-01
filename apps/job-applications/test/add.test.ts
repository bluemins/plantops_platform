// "+ Add applicant" (owner, 2026-11-01): the owner or HR desk adds someone who phoned or walked in, with an optional
// resume added then or later. Same row as a public application: reference, list, notes, CSV, 12-month removal.
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// next/server's after() runs once the answer is sent; here it runs at once and can be awaited
const pending: Promise<unknown>[] = [];
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: (fn: () => unknown) => void pending.push(Promise.resolve().then(fn)) }));

import { POST as addRoute } from "@/app/api/app/applications/route";
import { POST as resumeRoute } from "@/app/api/app/applications/[id]/resume/route";
import { GET as exportRoute } from "@/app/api/app/export/route";
import { newRequestKey } from "@/lib/apply";
import { AddInput, addApplicant, addChoices, addResumePage } from "@/server/add";
import { addNote, getApplication, listApplications } from "@/server/applications";
import { submitApplication } from "@/server/apply";
import { recentChanges } from "@/server/audit";
import { kit } from "@/server/kit";
import { createOpening, OpeningInput, updateOpening } from "@/server/openings";
import { resolvePublicPlant } from "@/server/public";
import type { JaUser } from "@/server/session";
import { startFakePlatform, type FakePlatform } from "./fake-platform";
import { asOwner, HTML, JPEG, PDF, plant, PNG, refused, sized } from "./helpers";

let platform: FakePlatform;
beforeAll(async () => {
  platform = await startFakePlatform();
  process.env.PLATFORM_URL = platform.url;
});
afterAll(() => platform.close());
beforeEach(() => {
  platform.notifications.length = 0;
  pending.length = 0;
});
afterEach(() => vi.restoreAllMocks());

const input = (over: Record<string, unknown> = {}) => AddInput.parse({ position: "any", name: "Priya Mishra", phone: "98765 43210", place: "Bargarh", consent: true, request_key: newRequestKey(), ...over });
const opening = (title: string, status: "active" | "off" = "active") => OpeningInput.parse({ title, grp: "production", tag: null, description: "x", minQualification: "x", goodToHave: null, status });
const as = (u: JaUser) =>
  vi.spyOn(kit, "currentSession").mockResolvedValue(
    u.isSupport
      ? ({ kind: "support", support: { tenant_id: u.tenantId, super_admin_id: u.userId, read_only: true, expires_at: Date.now() + 60_000 } } as never)
      : ({ kind: "user", session: { tenant_id: u.tenantId, user_id: u.userId, display_name: u.name, roles: u.roles, enabled_modules: ["job_applications"], login_at: Date.now(), checked_at: Date.now() } } as never),
  );
const post = (path: string, body: BodyInit, type: string) => new Request(`http://x${path}`, { method: "POST", headers: { "content-type": type }, body });

describe("adding an applicant", () => {
  it("owner and HR desk add; the next reference after public ones; 'Added by …' and the first note in the history", async () => {
    const p = plant();
    platform.plants.set(`A${p.tenantId.slice(0, 6).toUpperCase()}`, { tenant_id: p.tenantId, name: "Bluemins" });
    const view = (await resolvePublicPlant(`A${p.tenantId.slice(0, 6).toUpperCase()}`))!;
    await submitApplication(view, { fields: { position: "any", name: "Web Sender", phone: "9000000001", place: "Bargarh", consent: "yes", request_key: newRequestKey() }, files: [JPEG], ip: "192.0.2.1" });

    const a = await addApplicant(p.hr, input({ note: "Called on phone, 2 years in an RO plant" }));
    expect(a.ref).toBe("J-0002");
    const b = await addApplicant(p.owner, input({ name: "Sanjay Bag", phone: "9123456780" }));
    expect(b.ref).toBe("J-0003");

    const one = await getApplication(p.owner, a.id);
    expect(one).toMatchObject({ name: "Priya Mishra", phone: "9876543210", position: "Any job", status: "new", entered: true, files: [] });
    expect(one.history.map((h) => h.text)).toEqual(["Added by Meera (phone / walk-in)", "Note by Meera: Called on phone, 2 years in an RO plant"]);
    // whoever added it has seen it: the owner opening it still records "Opened by"
    const [row] = (await asOwner("select seen_by, consent_version from job_applications.applications where id = $1", [b.id])).rows;
    expect(row).toEqual({ seen_by: p.owner.userId, consent_version: "plant-v1" });
    expect((await getApplication(p.hr, b.id)).history.map((h) => h.text)).toEqual(["Added by Sujata (phone / walk-in)"]);

    expect((await listApplications(p.hr)).rows.map((r) => r.ref)).toEqual(["J-0003", "J-0002", "J-0001"]);
    expect((await recentChanges(p.owner)).map((c) => c.text)).toEqual(["Added applicant J-0003 (phone / walk-in)", "Added applicant J-0002 (phone / walk-in)"]);
  });

  it("plant staff, a store keeper and PlantOps support can't add", async () => {
    const p = plant();
    for (const u of [p.general, p.keeper]) expect((await refused(() => addApplicant(u, input()))).status).toBe(403);
    expect(await refused(() => addApplicant(p.support, input()))).toEqual({ status: 403, message: "PlantOps support view is read-only" });
    expect((await refused(() => addChoices(p.support))).status).toBe(403);
  });

  it("the form's rules: name, Indian mobile, place, the consent tick, note at most 300", () => {
    const err = (over: Record<string, unknown>) => AddInput.safeParse({ position: "any", name: "Priya", phone: "9876543210", place: "Bargarh", consent: true, request_key: newRequestKey(), ...over }).error?.issues[0]?.message;
    expect(err({})).toBeUndefined();
    expect(err({ consent: false })).toBe("Tick that they agreed we keep their details for 12 months");
    expect(err({ phone: "12345" })).toMatch(/^Mobile number/);
    expect(err({ name: "P" })).toMatch(/^Full name/);
    expect(err({ place: "" })).toMatch(/^Where you live/);
    expect(err({ note: "x".repeat(301) })).toBe("Note: at most 300 characters");
  });

  it("a double tap makes one; the same phone for the same position within 30 days is refused with its reference", async () => {
    const p = plant();
    const key = newRequestKey();
    const a = await addApplicant(p.owner, input({ request_key: key }));
    const again = await addApplicant(p.owner, input({ request_key: key }));
    expect(again).toEqual({ id: a.id, ref: a.ref, saved: null });
    const twice = await refused(() => addApplicant(p.hr, input()));
    expect(twice.status).toBe(409);
    expect(twice.message).toMatch(/^Already in the list: J-0001, added /);
    // another position is a new application
    const op = await createOpening(p.owner, opening("Operator"));
    expect((await addApplicant(p.hr, input({ position: op.id }))).ref).toBe("J-0002");
  });

  it("any opening of this plant, also a switched-off one; never another plant's", async () => {
    const p = plant();
    const q = plant();
    const off = await createOpening(p.owner, opening("Driver"));
    await updateOpening(p.owner, off.id, opening("Driver", "off"));
    const theirs = await createOpening(q.owner, opening("Lab Assistant"));
    expect((await addChoices(p.hr)).map((o) => [o.title, o.status])).toEqual([["Driver", "off"]]);
    expect((await getApplication(p.owner, (await addApplicant(p.hr, input({ position: off.id }))).id)).position).toBe("Driver");
    expect(await refused(() => addApplicant(p.hr, input({ position: theirs.id, phone: "9123456780" })))).toEqual({ status: 400, message: "This position doesn't exist. Pick another one, or Any job." });
  });

  it("the route: 201, the others get the bell (not whoever added it); JSON only", async () => {
    const p = plant();
    as(p.hr);
    const res = await addRoute(post("/api/app/applications", JSON.stringify({ position: "any", name: "Priya", phone: "9876543210", place: "Bargarh", consent: true, request_key: newRequestKey() }), "application/json"), undefined as never);
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ ref: "J-0001" });
    await Promise.all(pending);
    expect(platform.notifications).toHaveLength(1);
    expect(platform.notifications[0]!.body).toMatchObject({ kind: "job_applications.new", title: "New job application J-0001: Any job, Bargarh", exclude_user_id: p.hr.userId });

    const form = new FormData();
    form.set("name", "Priya");
    expect((await addRoute(new Request("http://x/api/app/applications", { method: "POST", body: form }), undefined as never)).status).toBe(415);
  });

  it("CSV says how each one came in", async () => {
    const p = plant();
    await addApplicant(p.owner, input());
    as(p.owner);
    const lines = (await (await exportRoute(new Request("http://x/api/app/export"), undefined as never)).text()).replace(/^﻿/, "").trim().split("\r\n");
    expect(lines[1]).toMatch(/,Added by the plant$/);
  });
});

describe("the resume, then or later", () => {
  it("one PDF, nothing more; photos up to 3, never a PDF after them; history and Recent changes say who", async () => {
    const p = plant();
    const a = await addApplicant(p.hr, input());
    expect(await addResumePage(p.hr, a.id, PDF)).toEqual({ pageNo: 1, storage: null });
    expect(await refused(() => addResumePage(p.owner, a.id, JPEG))).toEqual({ status: 409, message: "This application already has a PDF resume." });

    const b = await addApplicant(p.owner, input({ phone: "9123456780" }));
    for (const n of [1, 2, 3]) expect((await addResumePage(p.owner, b.id, n === 2 ? PNG : JPEG)).pageNo).toBe(n);
    expect(await refused(() => addResumePage(p.owner, b.id, JPEG))).toEqual({ status: 409, message: "At most 3 photos." });
    const c = await addApplicant(p.owner, input({ phone: "9000011111" }));
    await addResumePage(p.owner, c.id, JPEG);
    expect((await refused(() => addResumePage(p.owner, c.id, PDF))).message).toBe("This application already has photos of the resume. Add photos, not a PDF.");

    const one = await getApplication(p.owner, a.id);
    expect(one.files).toHaveLength(1);
    expect(one.history.map((h) => h.text)).toEqual(["Added by Meera (phone / walk-in)", "Resume PDF added by Meera"]);
    expect((await getApplication(p.owner, b.id)).history.map((h) => h.text).slice(1)).toEqual(["Resume page 1 added by Sujata", "Resume page 2 added by Sujata", "Resume page 3 added by Sujata"]);
    expect((await recentChanges(p.owner)).map((x) => x.text)).toContain("J-0001: resume PDF added");
  });

  it("files checked by their bytes and size; support, plant staff and another plant refused", async () => {
    const p = plant();
    const q = plant();
    const a = await addApplicant(p.owner, input());
    expect((await refused(() => addResumePage(p.owner, a.id, HTML))).status).toBe(415);
    expect((await refused(() => addResumePage(p.owner, a.id, sized(JPEG, 5 * 1024 * 1024 + 1)))).status).toBe(413);
    expect((await refused(() => addResumePage(p.support, a.id, JPEG))).status).toBe(403);
    expect((await refused(() => addResumePage(p.general, a.id, JPEG))).status).toBe(403);
    expect((await refused(() => addResumePage(q.owner, a.id, JPEG))).status).toBe(404);
    expect((await refused(() => addResumePage(p.owner, randomUUID(), JPEG))).status).toBe(404);
    expect((await getApplication(p.owner, a.id)).files).toEqual([]);
  });

  it("works on a public application too (a 1-photo send gets more pages); the plan's storage is checked", async () => {
    const p = plant();
    const code = `B${p.tenantId.slice(0, 6).toUpperCase()}`;
    platform.plants.set(code, { tenant_id: p.tenantId, name: "Bluemins" });
    const sent = await submitApplication((await resolvePublicPlant(code))!, { fields: { position: "any", name: "Web Sender", phone: "9000000001", place: "Bargarh", consent: "yes", request_key: newRequestKey() }, files: [JPEG], ip: "192.0.2.2" });
    expect((await addResumePage(p.hr, sent.saved!.id, JPEG)).pageNo).toBe(2);

    const full = plant();
    platform.limits.set(full.tenantId, { job_applications: { storage_mb: 1 } });
    const b = await addApplicant(full.owner, input());
    expect(await refused(() => addResumePage(full.owner, b.id, sized(PDF, 1024 * 1024 + 1)))).toEqual({ status: 413, message: "Job applications storage is full. Ask PlantOps for more space." });
    expect((await addResumePage(full.owner, b.id, sized(PDF, 900 * 1024))).storage).toMatchObject({ before: 0, after: 900 * 1024, limit: 1024 * 1024 });
  });

  it("the route takes the file itself, never a form; crossing 80 % tells the owners", async () => {
    const p = plant();
    platform.limits.set(p.tenantId, { job_applications: { storage_mb: 1 } });
    const a = await addApplicant(p.owner, input());
    as(p.hr);
    const ctx = { params: Promise.resolve({ id: a.id }) };
    const form = new FormData();
    form.set("resume", new Blob([new Uint8Array(JPEG)]), "x.jpg");
    expect((await resumeRoute(new Request(`http://x/api/app/applications/${a.id}/resume`, { method: "POST", body: form }), ctx)).status).toBe(415);
    const res = await resumeRoute(post(`/api/app/applications/${a.id}/resume`, new Uint8Array(sized(PDF, 900 * 1024)), "application/pdf"), ctx);
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ pageNo: 1 });
    await Promise.all(pending);
    expect(platform.notifications.map((n) => n.body.title)).toEqual(["Job applications storage 80 % full"]);
  });

  it("a note on an added applicant works like any other", async () => {
    const p = plant();
    const a = await addApplicant(p.owner, input());
    await addNote(p.hr, a.id, "Coming Monday");
    expect((await getApplication(p.owner, a.id)).history.at(-1)!.text).toBe("Note by Meera: Coming Monday");
  });
});
