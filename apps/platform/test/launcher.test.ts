// Phase 2: launcher tiles per role, live tile numbers from modules, direct links (/sso/start),
// super_admin Modules screen and plant dashboard, plant brand colour.
import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { verifySummaryRequest, verifyToken } from "@plantops/auth";
import { brandPalette } from "@plantops/ui/brand";
import type { SummaryRequestPayload } from "@plantops/types";
import * as launcherRoute from "@/app/api/launcher/route";
import * as summaryRoute from "@/app/api/launcher/summary/[module]/route";
import * as superLauncherRoute from "@/app/api/super/tenants/[id]/launcher/route";
import * as superSummaryRoute from "@/app/api/super/tenants/[id]/summary/[module]/route";
import * as modulesRoute from "@/app/api/super/modules/route";
import * as moduleRoute from "@/app/api/super/modules/[id]/route";
import * as moduleSecretRoute from "@/app/api/super/modules/[id]/secret/route";
import * as exchangeRoute from "@/app/api/sso/exchange/route";
import * as statusRoute from "@/app/api/m/tenants/[tid]/users/[uid]/status/route";
import * as businessRoute from "@/app/api/admin/business/route";
import * as ssoStart from "@/app/sso/start/route";
import { safeNext } from "@/lib/safe-next";
import { sha256 } from "@/server/crypto";
import { decideTiles, landingFor, type ModuleAvailability } from "@/server/launcher";
import { plantBrandColor } from "@/server/brand";
import { publicJwks, signPlatformToken } from "@/server/sso";
import { asOwner, call, makePlant, makeStaff, makeSuperAdmin, type Handler } from "./helpers";

const LAB_SECRET = "lab-module-test-secret";
const STOCK_SECRET = "stock-module-test-secret";
const basic = (id: string, secret: string) => ({ authorization: "Basic " + btoa(`${id}:${secret}`) });

// ---------- a fake module app answering /api/plantops/summary ----------
let fake: Server;
let fakeUrl: string;
let behaviour: "ok" | "slow" | "error" | "junk" = "ok";
let lastRequest: SummaryRequestPayload | null = null;

beforeAll(async () => {
  fake = createServer(async (req, res) => {
    const moduleId = req.headers.host?.startsWith("127.0.0.1") ? "lab_records" : "floor_stock";
    try {
      lastRequest = await verifySummaryRequest(req.headers.authorization, { audience: moduleId, keys: { jwks: publicJwks() } });
    } catch {
      res.writeHead(401);
      return res.end();
    }
    if (behaviour === "slow") await new Promise((r) => setTimeout(r, 4000));
    if (behaviour === "error") {
      res.writeHead(500);
      return res.end();
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(behaviour === "junk" ? JSON.stringify({ badges: "lots" }) : JSON.stringify({ badges: [{ text: `${lastRequest.view}: 3 held today`, tone: "warn" }] }));
  });
  await new Promise<void>((r) => fake.listen(0, "127.0.0.1", r));
  fakeUrl = `http://127.0.0.1:${(fake.address() as { port: number }).port}`;
  await asOwner("update platform.modules set base_url = $1, client_secret_hash = $2, status = 'active' where id = 'lab_records'", [fakeUrl, sha256(LAB_SECRET)]);
  // Floor Stock: same fake app reached as "localhost" (so the fake can tell the two modules apart)
  await asOwner("update platform.modules set base_url = $1, client_secret_hash = $2, status = 'active' where id = 'floor_stock'", [
    fakeUrl.replace("127.0.0.1", "localhost"),
    sha256(STOCK_SECRET),
  ]);
  await asOwner("update platform.modules set base_url = null, client_secret_hash = null, status = 'active' where id = 'preventive_mgmt'");
});

afterAll(async () => {
  await asOwner("update platform.modules set status = 'active' where status = 'disabled'");
  await new Promise<void>((r) => fake.close(() => r()));
});

const avail = (id: string, ready = true): ModuleAvailability => ({ id, status: "active", baseUrl: ready ? "http://x" : null, clientSecretHash: ready ? "h" : null });

describe("tile rules (decideTiles / landingFor)", () => {
  const all = [avail("lab_records"), avail("floor_stock"), avail("preventive_mgmt", false), avail("amc"), avail("attendance_salary"), avail("marketing_contacts")];

  it("owner: enabled modules open (or off if not set up), the rest locked; AMC locked as add-on", () => {
    const tiles = decideTiles(["tenant_admin"], ["lab_records", "floor_stock", "preventive_mgmt"], all);
    expect(tiles.map((t) => [t.module, t.state, t.locked_reason])).toEqual([
      ["lab_records", "open", undefined],
      ["floor_stock", "open", undefined],
      ["preventive_mgmt", "off", undefined],
      ["document_store", "locked", "not_enabled"],
      ["amc", "locked", "addon"],
      ["attendance_salary", "locked", "not_enabled"],
      ["marketing_contacts", "locked", "not_enabled"],
    ]);
    expect(tiles.every((t) => t.view === "owner")).toBe(true);
    expect(landingFor(["tenant_admin"], tiles)).toBe("launcher");
  });

  it("lab-only staff: just Lab Records, no locked tiles, lands straight in it", () => {
    const tiles = decideTiles(["lab_technician"], ["lab_records", "floor_stock"], all);
    expect(tiles).toEqual([{ module: "lab_records", state: "open", view: "staff" }]);
    expect(landingFor(["lab_technician"], tiles)).toBe("lab_records");
  });

  it("multi-role staff see their tiles; a staff member whose only module is off sees the launcher", () => {
    const multi = decideTiles(["lab_technician", "store_keeper"], ["lab_records", "floor_stock"], all);
    expect(multi.map((t) => t.module)).toEqual(["lab_records", "floor_stock"]);
    expect(landingFor(["lab_technician", "store_keeper"], multi)).toBe("launcher");
    const off = decideTiles(["maintenance_technician"], ["preventive_mgmt"], all);
    expect(off).toEqual([{ module: "preventive_mgmt", state: "off", view: "staff" }]);
    expect(landingFor(["maintenance_technician"], off)).toBe("launcher");
  });

  it("plant staff: every enabled module except Lab Records, no locked tiles", () => {
    const tiles = decideTiles(["plant_staff"], ["lab_records", "floor_stock", "document_store"], all);
    expect(tiles.map((t) => t.module).sort()).toEqual(["document_store", "floor_stock"]);
    expect(tiles.every((t) => t.view === "staff" && t.state !== "locked")).toBe(true);
    expect(landingFor(["plant_staff"], tiles)).toBe("launcher");
    const one = decideTiles(["plant_staff"], ["lab_records", "floor_stock"], all);
    expect(landingFor(["plant_staff"], one)).toBe("floor_stock");
  });

  it("an owner who is also lab staff still gets the owner view and the launcher", () => {
    const tiles = decideTiles(["tenant_admin", "lab_technician"], ["lab_records"], all);
    expect(tiles[0]).toMatchObject({ module: "lab_records", view: "owner" });
    expect(landingFor(["tenant_admin", "lab_technician"], tiles)).toBe("launcher");
  });
});

describe("GET /api/launcher", () => {
  let A: Awaited<ReturnType<typeof makePlant>>;
  let lab: Awaited<ReturnType<typeof makeStaff>>;
  let multi: Awaited<ReturnType<typeof makeStaff>>;
  beforeAll(async () => {
    A = await makePlant({ modules: ["lab_records", "floor_stock", "preventive_mgmt"], maxUsers: 10 });
    lab = await makeStaff(A, "lab", ["lab_technician"]);
    multi = await makeStaff(A, "multi", ["lab_technician", "store_keeper"]);
  });

  it("owner: tiles + plan card (Growth, 3 of 7, users 3/10)", async () => {
    const res = await call(launcherRoute.GET as Handler, { cookie: A.adminCookie });
    expect(res.status).toBe(200);
    expect(res.body.landing).toBe("launcher");
    expect(res.body.tiles.filter((t: { state: string }) => t.state === "locked")).toHaveLength(4);
    expect(res.body.plan_summary).toMatchObject({ plan_name: "Growth", modules_enabled: 3, modules_total: 7, users_active: 3, max_users: 10 });
    expect(res.body.plant).toMatchObject({ code: A.code, logo_url: null });
  });

  it("lab staff: one tile, lands in Lab Records, no plan details", async () => {
    const res = await call(launcherRoute.GET as Handler, { cookie: lab.cookie });
    expect(res.body.tiles).toEqual([{ module: "lab_records", state: "open", view: "staff" }]);
    expect(res.body.landing).toBe("lab_records");
    expect(res.body.plan_summary).toBeNull();
  });

  it("multi-role staff: two tiles, launcher", async () => {
    const res = await call(launcherRoute.GET as Handler, { cookie: multi.cookie });
    expect(res.body.tiles.map((t: { module: string }) => t.module)).toEqual(["lab_records", "floor_stock"]);
    expect(res.body.landing).toBe("launcher");
  });

  it("not logged in -> 401", async () => {
    expect((await call(launcherRoute.GET as Handler)).status).toBe(401);
  });

  describe("live tile numbers", () => {
    const summary = (cookie: string, module: string) => call(summaryRoute.GET as Handler, { cookie, params: { module } });

    it("owner gets the owner view's numbers, straight from the module, with a valid signed request", async () => {
      behaviour = "ok";
      const res = await summary(A.adminCookie, "lab_records");
      expect(res.body).toEqual({ state: "ok", badges: [{ text: "owner: 3 held today", tone: "warn" }] });
      expect(lastRequest).toMatchObject({ purpose: "summary", tenant_id: A.tenantId, view: "owner", aud: "lab_records" });
      expect(lastRequest!.exp - lastRequest!.iat).toBe(60);
    });

    it("staff get the staff view", async () => {
      expect((await summary(lab.cookie, "lab_records")).body.badges[0].text).toBe("staff: 3 held today");
    });

    it("staff cannot ask for a module they can't open; unknown module -> 404", async () => {
      expect((await summary(lab.cookie, "floor_stock")).status).toBe(403);
      expect((await summary(lab.cookie, "nope")).status).toBe(404);
    });

    it.each(["error", "junk", "slow"] as const)("module answers %s -> 'unavailable', launcher keeps working", async (b) => {
      behaviour = b;
      expect((await summary(A.adminCookie, "lab_records")).body).toEqual({ state: "unavailable" });
      behaviour = "ok";
    }, 10_000);

    it("module not set up -> 'unavailable' without calling anything", async () => {
      expect((await summary(A.adminCookie, "preventive_mgmt")).body).toEqual({ state: "unavailable" });
    });
  });
});

describe("token separation", () => {
  it("a summary request token is never accepted as a login token (and the reverse)", async () => {
    const keys = { jwks: publicJwks() };
    const summaryToken = await signPlatformToken({ purpose: "summary", tenant_id: crypto.randomUUID(), view: "owner" }, "lab_records", 60);
    await expect(verifyToken(summaryToken, { audience: "lab_records", keys })).rejects.toThrow();
    const login = await signPlatformToken(
      { tenant_id: crypto.randomUUID(), user_id: crypto.randomUUID(), roles: ["tenant_admin"], enabled_modules: ["lab_records"] },
      "lab_records",
      900,
    );
    await expect(verifySummaryRequest(`Bearer ${login}`, { audience: "lab_records", keys })).rejects.toThrow();
    await expect(verifySummaryRequest(`Bearer ${summaryToken}`, { audience: "floor_stock", keys })).rejects.toThrow();
  });
});

describe("direct link: /sso/start", () => {
  let P: Awaited<ReturnType<typeof makePlant>>;
  let lab: Awaited<ReturnType<typeof makeStaff>>;
  beforeAll(async () => {
    P = await makePlant({ modules: ["lab_records", "floor_stock"] });
    lab = await makeStaff(P, "lab", ["lab_technician"]);
  });

  async function start(query: string, cookie?: string) {
    const res = await ssoStart.GET(new Request(`http://localhost/sso/start?${query}`, { headers: cookie ? { cookie } : {} }));
    return { status: res.status, location: res.headers.get("location") ?? "" };
  }

  it("logged in + allowed -> straight to the module with a one-time code that works", async () => {
    const r = await start("module=lab_records&next=%2Fbatches%2F12", lab.cookie);
    expect(r.status).toBe(302);
    const target = new URL(r.location);
    expect(target.origin + target.pathname).toBe(`${fakeUrl}/sso/callback`);
    expect(target.searchParams.get("next")).toBe("/batches/12");
    const ex = await call(exchangeRoute.POST as Handler, { headers: basic("lab_records", LAB_SECRET), body: { code: target.searchParams.get("code") } });
    expect(ex.status).toBe(200);
  });

  it("not logged in -> login page, coming back here afterwards", async () => {
    const r = await start("module=lab_records&next=%2Fx");
    expect(r.location).toBe(`/login?next=${encodeURIComponent("/sso/start?module=lab_records&next=%2Fx")}`);
  });

  it("not allowed, unknown module, or unsafe next", async () => {
    expect((await start("module=floor_stock", lab.cookie)).location).toBe("/sso/blocked?module=floor_stock&reason=no_access");
    expect((await start("module=nope", lab.cookie)).location).toBe("/sso/blocked?reason=unknown");
    const r = await start("module=lab_records&next=%2F%2Fevil.com", lab.cookie);
    expect(new URL(r.location).searchParams.get("next")).toBeNull(); // unsafe next dropped
  });

  it.each(["//evil.com", "https://evil.com", "/\\evil.com", "javascript:alert(1)", "evil", "", "/ok path"])("safeNext rejects %j", (v) => {
    expect(safeNext(v)).toBeNull();
  });
  it("safeNext keeps a normal path", () => {
    expect(safeNext("/sso/start?module=lab_records&next=%2Fb")).toBe("/sso/start?module=lab_records&next=%2Fb");
  });
});

describe("super_admin Modules screen", () => {
  let sa: Awaited<ReturnType<typeof makeSuperAdmin>>;
  let P: Awaited<ReturnType<typeof makePlant>>;
  let lab: Awaited<ReturnType<typeof makeStaff>>;
  beforeAll(async () => {
    sa = await makeSuperAdmin();
    P = await makePlant({ modules: ["lab_records", "floor_stock"] });
    lab = await makeStaff(P, "lab", ["lab_technician"]);
  });
  const patch = (id: string, body: unknown) => call(moduleRoute.PATCH as Handler, { cookie: sa.cookie, method: "PATCH", body, params: { id } });

  it("lists all seven modules with their state; owner/staff are refused", async () => {
    const res = await call(modulesRoute.GET as Handler, { cookie: sa.cookie });
    expect(res.body.map((m: { id: string }) => m.id)).toEqual(["lab_records", "document_store", "floor_stock", "preventive_mgmt", "amc", "attendance_salary", "marketing_contacts"]);
    expect(res.body[0]).toMatchObject({ base_url: fakeUrl, secret_set: true, status: "active", ready: true });
    expect(JSON.stringify(res.body)).not.toContain(sha256(LAB_SECRET)); // never the hash
    expect((await call(modulesRoute.GET as Handler, { cookie: P.adminCookie })).status).toBe(401);
    expect((await call(moduleSecretRoute.POST as Handler, { cookie: lab.cookie, body: {}, params: { id: "amc" } })).status).toBe(401);
  });

  it.each(["ftp://x.com", "https://x.com/path", "https://user:pw@x.com", "not a url"])("refuses module URL %j", async (u) => {
    expect((await patch("amc", { base_url: u })).status).toBe(400);
  });

  it("sets a URL (trailing slash removed) and clears it again", async () => {
    expect((await patch("amc", { base_url: "https://amc.example.com/" })).body.base_url).toBe("https://amc.example.com");
    expect((await patch("amc", { base_url: null })).body.base_url).toBeNull();
  });

  it("new secret works for the module, the old one stops at once", async () => {
    const r = await call(moduleSecretRoute.POST as Handler, { cookie: sa.cookie, body: {}, params: { id: "floor_stock" } });
    expect(r.status).toBe(200);
    const fresh = r.body.client_secret as string;
    const status = (secret: string) =>
      call(statusRoute.GET as Handler, { headers: basic("floor_stock", secret), params: { tid: P.tenantId, uid: lab.userId } });
    expect((await status(STOCK_SECRET)).status).toBe(401);
    expect((await status(fresh)).status).toBe(200);
    await asOwner("update platform.modules set client_secret_hash = $1 where id = 'floor_stock'", [sha256(STOCK_SECRET)]);
  });

  it("switch off: tile off, direct link refused, module's own calls refused; switch on restores it", async () => {
    expect((await patch("lab_records", { status: "disabled" })).body).toMatchObject({ status: "disabled", ready: false });
    const tiles = (await call(launcherRoute.GET as Handler, { cookie: P.adminCookie })).body.tiles;
    expect(tiles.find((t: { module: string }) => t.module === "lab_records").state).toBe("off");
    const r = await ssoStart.GET(new Request("http://localhost/sso/start?module=lab_records", { headers: { cookie: lab.cookie } }));
    expect(r.headers.get("location")).toBe("/sso/blocked?module=lab_records&reason=unavailable");
    const st = await call(statusRoute.GET as Handler, { headers: basic("lab_records", LAB_SECRET), params: { tid: P.tenantId, uid: lab.userId } });
    expect(st.status).toBe(401); // module's users drop out at their next 5-minute re-check
    expect((await patch("lab_records", { status: "active" })).body.ready).toBe(true);
  });

  it("every change is in the audit log", async () => {
    const { rows } = await asOwner<{ action: string }>("select action from platform.audit_log where actor = $1", [`super_admin:${sa.id}`]);
    expect(rows.map((r) => r.action)).toEqual(expect.arrayContaining(["module.updated", "module.secret_rotated"]));
  });

  describe("plant dashboard", () => {
    it("shows the chosen plant's owner view with live numbers", async () => {
      behaviour = "ok";
      const v = await call(superLauncherRoute.GET as Handler, { cookie: sa.cookie, params: { id: P.tenantId } });
      expect(v.body.plant.code).toBe(P.code);
      expect(v.body.tiles.filter((t: { state: string }) => t.state === "open").map((t: { module: string }) => t.module)).toEqual(["lab_records", "floor_stock"]);
      expect(v.body.plan_summary.modules_enabled).toBe(2);
      const s = await call(superSummaryRoute.GET as Handler, { cookie: sa.cookie, params: { id: P.tenantId, module: "lab_records" } });
      expect(s.body.badges[0].text).toBe("owner: 3 held today");
      expect(lastRequest!.tenant_id).toBe(P.tenantId);
    });

    it("refuses a module not in that plant's plan, and non-super users", async () => {
      expect((await call(superSummaryRoute.GET as Handler, { cookie: sa.cookie, params: { id: P.tenantId, module: "amc" } })).status).toBe(403);
      expect((await call(superLauncherRoute.GET as Handler, { cookie: P.adminCookie, params: { id: P.tenantId } })).status).toBe(401);
    });
  });
});

describe("plant brand colour", () => {
  it("palette: darker hover, readable text (white on dark colours, dark on light ones)", () => {
    expect(brandPalette("#1d4ed8")).toMatchObject({ brand: "#1d4ed8", contrast: "#ffffff" });
    expect(brandPalette("#facc15").contrast).toBe("#0f172a"); // yellow -> dark text
    expect(brandPalette("#ffffff").contrast).toBe("#0f172a");
    expect(brandPalette("#000000").contrast).toBe("#ffffff");
    expect(brandPalette("#0e7490").hover).toBe("#0c637a");
    expect(brandPalette("not-a-colour").brand).toBe("#1d4ed8"); // falls back to PlantOps blue
    expect(brandPalette(null).brand).toBe("#1d4ed8");
  });

  it("each plant gets only its own colour", async () => {
    const A = await makePlant();
    const B = await makePlant();
    await call(businessRoute.PATCH as Handler, { cookie: A.adminCookie, method: "PATCH", body: { brand_color: "#0e7490" } });
    expect(await plantBrandColor(A.tenantId)).toBe("#0e7490");
    expect(await plantBrandColor(B.tenantId)).toBeNull();
  });
});
