// The owner's openings and page message (docs/JOB_APPLICATIONS_PHASE_PLAN.md "Openings", mock-ups 7 and 8): only the
// owner changes them, PlantOps support looks, HR desk / plant staff are refused; every change is in Recent changes.
import { afterEach, describe, expect, it, vi } from "vitest";
import * as openingsRoute from "@/app/api/app/openings/route";
import * as openingRoute from "@/app/api/app/openings/[id]/route";
import * as pageRoute from "@/app/api/app/page/route";
import { DEFAULT_MESSAGE } from "@/lib/groups";
import { recentChanges } from "@/server/audit";
import { kit } from "@/server/kit";
import { createOpening, getOpening, getPageMessage, listOpenings, moveOpening, OpeningInput, setPageMessage, updateOpening } from "@/server/openings";
import { addApplication, plant, refused } from "./helpers";

const lab = { title: "Lab Assistant", grp: "lab_quality", tag: "10th + 2 yrs lab, or B.Sc.", description: "Water tests", minQualification: "10th pass", goodToHave: null, status: "active" } as const;
const input = (over: Partial<Record<keyof typeof lab, unknown>> = {}) => OpeningInput.parse({ ...lab, ...over });

describe("field rules", () => {
  it.each([
    ["a 1-letter position", { title: "L" }],
    ["an 81-letter position", { title: "x".repeat(81) }],
    ["an unknown group", { grp: "transport" }],
    ["a 41-letter tag", { tag: "t".repeat(41) }],
    ["no job description", { description: "  " }],
    ["a 1,001-letter description", { description: "d".repeat(1001) }],
    ["no minimum qualification", { minQualification: "" }],
    ["a 501-letter qualification", { minQualification: "q".repeat(501) }],
    ["a 501-letter good to have", { goodToHave: "g".repeat(501) }],
    ["an unknown status", { status: "hidden" }],
  ])("refuses %s", (_what, over) => {
    expect(OpeningInput.safeParse({ ...lab, ...over }).success).toBe(false);
  });

  it("trims, and an empty tag / good to have is stored as nothing", () => {
    expect(input({ title: "  Driver  ", tag: "  ", goodToHave: "" })).toMatchObject({ title: "Driver", tag: null, goodToHave: null });
  });
});

describe("the owner's openings", () => {
  it("adds positions at the end of their group, lists them in page order with application counts", async () => {
    const p = plant();
    const a = await createOpening(p.owner, input({ title: "Operator", grp: "production" }));
    const b = await createOpening(p.owner, input());
    const c = await createOpening(p.owner, input({ title: "Filling Machine", grp: "production" }));
    await addApplication(p.tenantId, { opening: { id: b.id, title: "Lab Assistant" } });
    await addApplication(p.tenantId, { opening: { id: b.id, title: "Lab Assistant" } });
    await addApplication(p.tenantId); // "Any job"
    const list = await listOpenings(p.owner);
    expect(list.map((o) => [o.title, o.applications])).toEqual([
      ["Operator", 0],
      ["Filling Machine", 0],
      ["Lab Assistant", 2],
    ]);
    expect(list.map((o) => o.id)).toEqual([a.id, c.id, b.id]);
  });

  it("edits every field; renaming keeps old applications' name; moving to another group puts it last there", async () => {
    const p = plant();
    const op = await createOpening(p.owner, input({ title: "Operator", grp: "production" }));
    await createOpening(p.owner, input({ title: "Manager", grp: "office_sales" }));
    await addApplication(p.tenantId, { opening: { id: op.id, title: "Operator" } });
    expect(await updateOpening(p.owner, op.id, input({ title: "Plant operator", grp: "office_sales", tag: null, status: "off" }))).toEqual({ id: op.id, changed: true });
    const o = await getOpening(p.owner, op.id);
    expect(o).toMatchObject({ title: "Plant operator", grp: "office_sales", tag: null, status: "off", sortOrder: 1, applications: 1 });
    expect(await updateOpening(p.owner, op.id, input({ title: "Plant operator", grp: "office_sales", tag: null, status: "off" }))).toEqual({ id: op.id, changed: false });
  });

  it("moves a position up and down within its group only", async () => {
    const p = plant();
    const ids = [];
    for (const t of ["Operator", "Filling Machine", "Blow Machine Helper"]) ids.push((await createOpening(p.owner, input({ title: t, grp: "production" }))).id);
    await createOpening(p.owner, input({ title: "Security", grp: "delivery_security" }));
    expect(await moveOpening(p.owner, ids[2]!, "up")).toEqual({ moved: true });
    expect(await moveOpening(p.owner, ids[0]!, "up")).toEqual({ moved: false }); // already first
    const order = (await listOpenings(p.owner)).filter((o) => o.grp === "production").map((o) => o.title);
    expect(order).toEqual(["Operator", "Blow Machine Helper", "Filling Machine"]);
    expect(await moveOpening(p.owner, ids[1]!, "down")).toEqual({ moved: false }); // Filling Machine is last now
  });

  it("another plant's position doesn't exist here", async () => {
    const p = plant();
    const q = plant();
    const op = await createOpening(p.owner, input());
    expect((await refused(() => getOpening(q.owner, op.id))).status).toBe(404);
    expect((await refused(() => updateOpening(q.owner, op.id, input({ title: "Hacked" })))).status).toBe(404);
    expect((await refused(() => moveOpening(q.owner, op.id, "down"))).status).toBe(404);
    expect((await getOpening(p.owner, op.id)).title).toBe("Lab Assistant");
  });

  it("HR desk, plant staff and a store keeper can't see or change openings; support only looks", async () => {
    const p = plant();
    const op = await createOpening(p.owner, input());
    for (const u of [p.hr, p.general, p.keeper]) {
      expect((await refused(() => listOpenings(u))).status).toBe(403);
      expect((await refused(() => createOpening(u, input()))).status).toBe(403);
      expect((await refused(() => setPageMessage(u, "x"))).status).toBe(403);
    }
    expect(await listOpenings(p.support)).toHaveLength(1);
    expect(await refused(() => createOpening(p.support, input()))).toEqual({ status: 403, message: "PlantOps support view is read-only" });
    expect((await refused(() => updateOpening(p.support, op.id, input({ status: "off" })))).status).toBe(403);
    expect((await refused(() => moveOpening(p.support, op.id, "down"))).status).toBe(403);
    expect((await refused(() => setPageMessage(p.support, "x"))).status).toBe(403);
  });
});

describe("page message", () => {
  it("the default until the owner writes one; empty goes back to the default; at most 300 characters", async () => {
    const p = plant();
    expect(await getPageMessage(p.owner)).toEqual({ message: DEFAULT_MESSAGE, isDefault: true });
    expect(await setPageMessage(p.owner, "We need people for the new line.")).toEqual({ message: "We need people for the new line.", isDefault: false });
    expect(await setPageMessage(p.owner, "")).toEqual({ message: DEFAULT_MESSAGE, isDefault: true });
  });
});

describe("recent changes", () => {
  it("one line per change in plain words, newest first; owner and support only", async () => {
    const p = plant();
    const op = await createOpening(p.owner, input({ title: "Operator", grp: "production" }));
    await createOpening(p.owner, input({ title: "Filling Machine", grp: "production", status: "off" }));
    await updateOpening(p.owner, op.id, input({ title: "Plant operator", grp: "production", tag: "ITI", status: "off" }));
    await moveOpening(p.owner, op.id, "down");
    await setPageMessage(p.owner, "Join us");
    await updateOpening(p.owner, op.id, input({ title: "Plant operator", grp: "production", tag: "ITI", status: "off" })); // nothing changed: no line
    const lines = (await recentChanges(p.owner)).map((c) => [c.by, c.text]);
    expect(lines).toEqual([
      ["Sujata", 'Page message changed to "Join us"'],
      ["Sujata", "Plant operator moved down in Production"],
      ["Sujata", "Plant operator: title Operator → Plant operator, short tag 10th + 2 yrs lab, or B.Sc. → ITI, switched off"],
      ["Sujata", "Added position Filling Machine (Production), not shown yet"],
      ["Sujata", "Added position Operator (Production)"],
    ]);
    expect(await recentChanges(p.support)).toHaveLength(5);
    expect((await refused(() => recentChanges(p.hr))).status).toBe(403);
  });
});

describe("routes", () => {
  afterEach(() => vi.restoreAllMocks());
  const as = (u: ReturnType<typeof plant>["owner"]) =>
    vi.spyOn(kit, "currentSession").mockResolvedValue(
      u.isSupport
        ? ({ kind: "support", support: { tenant_id: u.tenantId, super_admin_id: u.userId, read_only: true, expires_at: Date.now() + 60_000 } } as never)
        : ({ kind: "user", session: { tenant_id: u.tenantId, user_id: u.userId, display_name: u.name, roles: u.roles, enabled_modules: ["job_applications"], login_at: Date.now(), checked_at: Date.now() } } as never),
    );
  const post = (body: unknown) => openingsRoute.POST(new Request("http://localhost/api/app/openings", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), undefined as never);

  it("owner adds through the route (201); HR desk gets 403; bad fields 400 in plain words; no login 401", async () => {
    const p = plant();
    as(p.owner);
    expect((await post(lab)).status).toBe(201);
    const bad = await post({ ...lab, title: "L" });
    expect(bad.status).toBe(400);
    expect((await bad.json()).error).toMatch(/Position: at least 2 characters/);
    vi.restoreAllMocks();
    as(p.hr);
    expect((await post(lab)).status).toBe(403);
    vi.restoreAllMocks();
    vi.spyOn(kit, "currentSession").mockResolvedValue(null);
    expect((await post(lab)).status).toBe(401);
  });

  it("a plant id or another plant's tenant in the body changes nothing: the plant always comes from the login", async () => {
    const p = plant();
    const q = plant();
    as(p.owner);
    expect((await post({ ...lab, tenant_id: q.tenantId, tenantId: q.tenantId })).status).toBe(201);
    expect(await listOpenings(q.owner)).toEqual([]);
    expect(await listOpenings(p.owner)).toHaveLength(1);
  });

  it("PATCH a position and PUT the page message as the owner", async () => {
    const p = plant();
    const op = await createOpening(p.owner, input());
    as(p.owner);
    const patch = await openingRoute.PATCH(new Request("http://x", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...lab, status: "off" }) }), { params: Promise.resolve({ id: op.id }) });
    expect(patch.status).toBe(200);
    const put = await pageRoute.PUT(new Request("http://x", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ message: "m".repeat(301) }) }), undefined as never);
    expect(put.status).toBe(400);
  });
});
