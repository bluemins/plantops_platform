// The owner's and HR desk's side (docs/JOB_APPLICATIONS_PHASE_PLAN.md screens 5 and 6, Phase 5 tests): list, filters,
// one application, status with "just changed by …", notes, resume files, CSV and the owner's "Remove now".
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { GET as fileRoute } from "@/app/api/app/files/[id]/route";
import { GET as exportRoute } from "@/app/api/app/export/route";
import { POST as statusRoute } from "@/app/api/app/applications/[id]/status/route";
import { newRequestKey } from "@/lib/apply";
import { addNote, changeStatus, exportCsv, getApplication, listApplications, readResumeFile, removeApplication } from "@/server/applications";
import { submitApplication } from "@/server/apply";
import { recentChanges } from "@/server/audit";
import { kit } from "@/server/kit";
import { createOpening, OpeningInput } from "@/server/openings";
import { resolvePublicPlant } from "@/server/public";
import type { JaUser } from "@/server/session";
import { startFakePlatform, type FakePlatform } from "./fake-platform";
import { asOwner, JPEG, PDF, plant, refused } from "./helpers";

let platform: FakePlatform;
beforeAll(async () => {
  platform = await startFakePlatform();
  process.env.PLATFORM_URL = platform.url;
});
afterAll(() => platform.close());
afterEach(() => vi.restoreAllMocks());

function knownPlant() {
  const p = plant();
  const code = `A${randomUUID().slice(0, 6).toUpperCase()}`;
  platform.plants.set(code, { tenant_id: p.tenantId, name: "Bluemins" });
  return { ...p, code };
}
let ipN = 0;
/** A real application through the public send (files stored, reference allocated). */
async function sendOne(p: ReturnType<typeof knownPlant>, over: Record<string, string> = {}, files = [JPEG]) {
  const view = (await resolvePublicPlant(p.code))!;
  const sent = await submitApplication(view, { fields: { position: "any", name: "Priya Mishra", phone: "9876543210", place: "Bargarh", consent: "yes", request_key: newRequestKey(), ...over }, files, ip: `192.0.2.${++ipN % 250}` });
  return { ...sent, id: sent.saved!.id };
}
const opening = (title: string) => OpeningInput.parse({ title, grp: "production", tag: null, description: "x", minQualification: "x", goodToHave: null, status: "active" });
const as = (u: JaUser) =>
  vi.spyOn(kit, "currentSession").mockResolvedValue(
    u.isSupport
      ? ({ kind: "support", support: { tenant_id: u.tenantId, super_admin_id: u.userId, read_only: true, expires_at: Date.now() + 60_000 } } as never)
      : ({ kind: "user", session: { tenant_id: u.tenantId, user_id: u.userId, display_name: u.name, roles: u.roles, enabled_modules: ["job_applications"], login_at: Date.now(), checked_at: Date.now() } } as never),
  );

describe("the list (screen 5)", () => {
  it("newest first; counts per status; search by name, place, phone digits or reference; position filter incl. Any job", async () => {
    const p = knownPlant();
    const op = await createOpening(p.owner, opening("Operator"));
    const a = await sendOne(p, { name: "Priya Mishra", place: "Bargarh", phone: "9876543210" });
    const b = await sendOne(p, { name: "Sanjay Bag", place: "Bijepur", phone: "9123456780", position: op.id });
    const c = await sendOne(p, { name: "Manoj Sahu", place: "Sambalpur", phone: "9000011111" });
    await changeStatus(p.hr, c.id, { to: "called", expected: "new" });

    const all = await listApplications(p.hr);
    expect(all.rows.map((r) => r.name)).toEqual(["Manoj Sahu", "Sanjay Bag", "Priya Mishra"]);
    expect(all.counts).toEqual({ new: 2, called: 1, all: 3 });
    expect(all.positions).toEqual([{ id: op.id, title: "Operator" }]);
    const names = async (f: Parameters<typeof listApplications>[1]) => (await listApplications(p.owner, f)).rows.map((r) => r.name);
    expect(await names({ status: "new" })).toEqual(["Sanjay Bag", "Priya Mishra"]);
    expect(await names({ q: "priya" })).toEqual(["Priya Mishra"]);
    expect(await names({ q: "bije" })).toEqual(["Sanjay Bag"]);
    expect(await names({ q: "+91 91234 56780" })).toEqual(["Sanjay Bag"]);
    expect(await names({ q: "11111" })).toEqual(["Manoj Sahu"]);
    expect(await names({ q: a.ref })).toEqual(["Priya Mishra"]);
    expect(await names({ q: "j-2" })).toEqual(["Sanjay Bag"]);
    expect(await names({ q: "100%_" })).toEqual([]);
    expect(await names({ position: op.id })).toEqual(["Sanjay Bag"]);
    expect(await names({ position: "any" })).toEqual(["Manoj Sahu", "Priya Mishra"]);
    expect(await names({ position: "nonsense" })).toEqual([]);
    expect(b.ref).toBe("J-0002");
  });

  it("only this plant's applications", async () => {
    const p = knownPlant();
    const q = knownPlant();
    await sendOne(q);
    expect((await listApplications(p.owner)).rows).toEqual([]);
  });
});

describe("who may do what", () => {
  it("HR desk reads and updates; only the owner exports and removes; plant staff and a store keeper nothing; support only reads", async () => {
    const p = knownPlant();
    const a = await sendOne(p);
    for (const u of [p.owner, p.hr, p.hrStaff, p.support]) expect((await listApplications(u)).rows).toHaveLength(1);
    for (const u of [p.general, p.keeper]) {
      expect((await refused(() => listApplications(u))).status).toBe(403);
      expect((await refused(() => getApplication(u, a.id))).status).toBe(403);
      expect((await refused(() => readResumeFile(u, randomUUID()))).status).toBe(403);
    }
    expect(await refused(() => changeStatus(p.support, a.id, { to: "called", expected: "new" }))).toEqual({ status: 403, message: "PlantOps support view is read-only" });
    expect((await refused(() => addNote(p.support, a.id, "x"))).status).toBe(403);
    for (const u of [p.hr, p.support]) {
      expect((await refused(() => exportCsv(u))).status).toBe(403);
      expect((await refused(() => removeApplication(u, a.id, "Applicant asked"))).status).toBe(403);
    }
  });
});

describe("one application (screen 6)", () => {
  it("first open by HR desk records 'Opened by …' once; support's view never does; history in order", async () => {
    const p = knownPlant();
    const a = await sendOne(p);
    const bySupport = await getApplication(p.support, a.id);
    expect(bySupport.history.map((h) => h.text)).toEqual(["Sent from the public page"]);
    await getApplication(p.hr, a.id);
    await getApplication(p.owner, a.id);
    await changeStatus(p.hr, a.id, { to: "called", expected: "new", text: "Interview Monday" });
    await addNote(p.owner, a.id, "Good on the phone");
    const view = await getApplication(p.owner, a.id);
    expect(view.history.map((h) => h.text)).toEqual(["Sent from the public page", "Opened by Meera", "Called by Meera: Interview Monday", "Note by Sujata: Good on the phone"]);
    expect(view).toMatchObject({ ref: "J-0001", name: "Priya Mishra", phone: "9876543210", position: "Any job", status: "called" });
    expect(new Date(view.removalOn).getFullYear()).toBe(new Date(view.createdAt).getFullYear() + 1);
  });

  it("'Applied before' lists the same phone's other applications in this plant only", async () => {
    const p = knownPlant();
    const q = knownPlant();
    const op = await createOpening(p.owner, opening("Operator"));
    const first = await sendOne(p);
    const second = await sendOne(p, { position: op.id });
    await sendOne(q); // same phone, another plant
    expect((await getApplication(p.owner, second.id)).appliedBefore.map((x) => x.ref)).toEqual([first.ref]);
    expect((await getApplication(p.owner, first.id)).appliedBefore.map((x) => x.position)).toEqual(["Operator"]);
  });

  it("another plant's application doesn't exist here", async () => {
    const p = knownPlant();
    const q = knownPlant();
    const a = await sendOne(q);
    expect((await refused(() => getApplication(p.owner, a.id))).status).toBe(404);
    expect((await refused(() => changeStatus(p.owner, a.id, { to: "hired", expected: "new" }))).status).toBe(404);
  });
});

describe("status and notes", () => {
  it("any order, also back; every change is an event", async () => {
    const p = knownPlant();
    const a = await sendOne(p);
    await changeStatus(p.hr, a.id, { to: "shortlisted", expected: "new" });
    await changeStatus(p.owner, a.id, { to: "new", expected: "shortlisted" });
    const ev = (await asOwner("select from_status, to_status, user_name from job_applications.application_events where application_id = $1 and kind = 'status' order by at", [a.id])).rows;
    expect(ev).toEqual([
      { from_status: "new", to_status: "shortlisted", user_name: "Meera" },
      { from_status: "shortlisted", to_status: "new", user_name: "Sujata" },
    ]);
  });

  it("two people at once: the second gets 409 'Just changed by <name>' (also through the route)", async () => {
    const p = knownPlant();
    const a = await sendOne(p);
    await changeStatus(p.hr, a.id, { to: "called", expected: "new" });
    expect(await refused(() => changeStatus(p.owner, a.id, { to: "hired", expected: "new" }))).toEqual({ status: 409, message: "Just changed by Meera. Please reload." });
    as(p.owner);
    const res = await statusRoute(new Request("http://x", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ to: "hired", expected: "new" }) }), { params: Promise.resolve({ id: a.id }) });
    expect(res.status).toBe(409);
  });

  it("notes: text required, at most 300 characters (route), never changed afterwards (database)", async () => {
    const p = knownPlant();
    const a = await sendOne(p);
    await addNote(p.hr, a.id, "Called");
    expect((await refused(() => addNote(p.hr, randomUUID(), "x"))).status).toBe(404);
    const { NoteInput } = await import("@/server/applications");
    expect(NoteInput.safeParse({ text: " " }).success).toBe(false);
    expect(NoteInput.safeParse({ text: "n".repeat(301) }).success).toBe(false);
  });
});

describe("resume files", () => {
  const get = (id: string) => fileRoute(new Request(`http://x/api/app/files/${id}`), { params: Promise.resolve({ id }) });

  it("served inline, never sniffed or cached; photos locked down; a PDF opens in the viewer", async () => {
    const p = knownPlant();
    const photo = await sendOne(p, { phone: "9111111111" }, [JPEG]);
    const pdf = await sendOne(p, { phone: "9222222222" }, [PDF]);
    as(p.hr);
    const photoFile = (await getApplication(p.hr, photo.id)).files[0]!;
    const res = await get(photoFile.id);
    expect(res.status).toBe(200);
    expect(Buffer.from(await res.arrayBuffer())).toEqual(JPEG);
    expect(Object.fromEntries(res.headers)).toMatchObject({
      "content-type": "image/jpeg",
      "content-disposition": 'inline; filename="resume-page-1.jpeg"',
      "x-content-type-options": "nosniff",
      "cache-control": "private, no-store",
      "content-security-policy": expect.stringContaining("default-src 'none'"),
    });
    const pdfRes = await get((await getApplication(p.hr, pdf.id)).files[0]!.id);
    expect(pdfRes.headers.get("content-type")).toBe("application/pdf");
    expect(pdfRes.headers.get("content-security-policy")).toBeNull();
  });

  it("another plant's file, plant staff and no login are refused; support's views are logged", async () => {
    const p = knownPlant();
    const q = knownPlant();
    const theirs = await sendOne(q);
    const theirFile = (await getApplication(q.owner, theirs.id)).files[0]!.id;
    as(p.owner);
    expect((await get(theirFile)).status).toBe(404);
    vi.restoreAllMocks();
    as(q.general);
    expect((await get(theirFile)).status).toBe(403);
    vi.restoreAllMocks();
    vi.spyOn(kit, "currentSession").mockResolvedValue(null);
    expect((await get(theirFile)).status).toBe(401);
    vi.restoreAllMocks();
    as(q.support);
    expect((await get(theirFile)).status).toBe(200);
    expect((await asOwner("select path from job_applications.support_views where tenant_id = $1", [q.tenantId])).rows).toEqual([{ path: `/files/${theirFile}` }]);
  });
});

describe("CSV and Remove now (owner)", () => {
  it("one row per application, formulas neutralised, no files; the export is audited", async () => {
    const p = knownPlant();
    const a = await sendOne(p, { name: "=HYPERLINK(1)" });
    await addNote(p.owner, a.id, "First");
    await addNote(p.owner, a.id, "+second");
    as(p.owner);
    const res = await exportRoute(new Request("http://x/api/app/export"), undefined as never);
    expect(res.headers.get("content-disposition")).toMatch(/^attachment; filename="job-applications-\d{4}-\d{2}-\d{2}\.csv"$/);
    const lines = (await res.text()).replace(/^﻿/, "").trim().split("\r\n");
    expect(lines[0]).toBe("Reference,Sent,Position,Name,Mobile,Place,Status,Last note,Removed on");
    expect(lines[1]).toMatch(/^J-0001,\d{4}-\d{2}-\d{2} \d{2}:\d{2},Any job,'=HYPERLINK\(1\),9876543210,Bargarh,New,'\+second,\d{4}-\d{2}-\d{2}$/);
    expect((await recentChanges(p.owner))[0]!.text).toBe("Exported the applications (CSV, 1 rows)");
  });

  it("Remove now: reason required; the details, history, file rows go; the files are queued; only the audit line stays", async () => {
    const p = knownPlant();
    const a = await sendOne(p, {}, [JPEG, JPEG]);
    await addNote(p.hr, a.id, "Called");
    expect(await refused(() => removeApplication(p.owner, a.id, "no"))).toEqual({ status: 400, message: "Write why (at least 3 characters)" });
    expect(await removeApplication(p.owner, a.id, "Applicant asked")).toEqual({ removed: "J-0001" });
    for (const t of ["applications", "application_events", "application_files"]) {
      expect((await asOwner(`select count(*)::int as n from job_applications.${t} where tenant_id = $1`, [p.tenantId])).rows[0], t).toEqual({ n: 0 });
    }
    expect((await asOwner("select count(*)::int as n from job_applications.file_removals where tenant_id = $1", [p.tenantId])).rows[0]).toEqual({ n: 2 });
    expect((await recentChanges(p.owner)).map((c) => [c.by, c.text])).toEqual([["Sujata", "J-0001 removed: Applicant asked"]]);
    expect((await refused(() => removeApplication(p.owner, a.id, "Applicant asked"))).status).toBe(404);
  });
});
