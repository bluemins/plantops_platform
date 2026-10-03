// Business details + products (SKUs): owner edits them, staff can't, plants never see each other's.
// Plant code and usernames: only super_admin may change them.
import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import * as businessRoute from "@/app/api/admin/business/route";
import * as skusRoute from "@/app/api/admin/skus/route";
import * as skuRoute from "@/app/api/admin/skus/[id]/route";
import * as logoRoute from "@/app/api/business/logo/route";
import * as superTenantsRoute from "@/app/api/super/tenants/route";
import * as superTenantRoute from "@/app/api/super/tenants/[id]/route";
import * as superBusinessRoute from "@/app/api/super/tenants/[id]/business/route";
import * as superLogoRoute from "@/app/api/super/tenants/[id]/logo/route";
import * as superSkusRoute from "@/app/api/super/tenants/[id]/skus/route";
import * as superUserRoute from "@/app/api/super/tenants/[id]/users/[userId]/route";
import * as brandingRoute from "@/app/api/m/tenants/[tid]/branding/route";
import * as moduleLogoRoute from "@/app/api/m/tenants/[tid]/logo/route";
import * as adminUserRoute from "@/app/api/admin/users/[id]/route";
import * as meRoute from "@/app/api/auth/me/route";
import { sha256 } from "@/server/crypto";
import { superDb, withTenant } from "@/server/db";
import { asOwner, call, login, makePlant, makeStaff, makeSuperAdmin, unique, type Handler } from "./helpers";

// A real 1x1 PNG, and the first bytes of a JPEG / WebP.
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46]).toString("base64");
const WEBP = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBPVP8 ")]).toString("base64");
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>').toString("base64");

const LAB_SECRET = "lab-module-test-secret";
const LAB = { authorization: "Basic " + btoa(`lab_records:${LAB_SECRET}`) };

let A: Awaited<ReturnType<typeof makePlant>>;
let B: Awaited<ReturnType<typeof makePlant>>;
let aStaff: Awaited<ReturnType<typeof makeStaff>>;
let sa: Awaited<ReturnType<typeof makeSuperAdmin>>;

beforeAll(async () => {
  await asOwner("update platform.modules set base_url = 'https://lab.example.test', client_secret_hash = $1 where id = 'lab_records'", [sha256(LAB_SECRET)]);
  A = await makePlant();
  B = await makePlant();
  aStaff = await makeStaff(A, "ramesh", ["lab_technician"]);
  sa = await makeSuperAdmin();
});

const patchBusiness = (cookie: string, body: unknown) => call(businessRoute.PATCH as Handler, { cookie, method: "PATCH", body });
const addSku = (cookie: string, body: unknown) => call(skusRoute.POST as Handler, { cookie, body });

/** The database's own error message (the query library wraps it as `cause`). */
async function dbError(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (err) {
    const e = err as Error & { cause?: Error };
    return e.cause?.message ?? e.message;
  }
  throw new Error("Expected the database to refuse this, but it succeeded");
}

/** Calls a route that answers with an image rather than JSON. */
async function getRaw(handler: unknown, opts: { cookie?: string; headers?: Record<string, string>; params?: Record<string, string> } = {}) {
  const headers: Record<string, string> = { ...opts.headers };
  if (opts.cookie) headers.cookie = opts.cookie;
  const res = await (handler as Handler)(new Request("http://localhost/test", { headers }), { params: Promise.resolve(opts.params ?? {}) } as never);
  return { status: res.status, type: res.headers.get("content-type"), bytes: Buffer.from(await res.arrayBuffer()) };
}

describe("owner edits business details", () => {
  it("saves every field and reads them back; blank text clears a field", async () => {
    const res = await patchBusiness(A.adminCookie, {
      name: "Aqua Pure Odisha",
      brand_color: "#1D4ED8",
      description: "Packaged drinking water since 2015",
      address: "Plot 12, Industrial Estate",
      city: "Cuttack",
      state: "Odisha",
      pincode: "753010",
      phone: "+91 98765 43210",
      logo: { data_base64: PNG },
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      name: "Aqua Pure Odisha",
      code: A.code,
      brand_color: "#1d4ed8",
      city: "Cuttack",
      pincode: "753010",
    });
    expect(res.body.logo_url).toMatch(/^\/api\/business\/logo\?v=\d+$/);

    const cleared = await patchBusiness(A.adminCookie, { description: "  " });
    expect(cleared.body.description).toBeNull();
    expect(cleared.body.city).toBe("Cuttack"); // fields not sent stay as they were
    expect(cleared.body.logo_url).not.toBeNull();
  });

  it("any logged-in user of the plant can load its logo, as an image", async () => {
    const res = await getRaw(logoRoute.GET, { cookie: aStaff.cookie });
    expect(res.status).toBe(200);
    expect(res.type).toBe("image/png");
    expect(res.bytes.equals(Buffer.from(PNG, "base64"))).toBe(true);
    expect((await getRaw(logoRoute.GET)).status).toBe(401);
  });

  it("accepts JPEG and WebP, and can remove the logo", async () => {
    expect((await patchBusiness(A.adminCookie, { logo: { data_base64: JPEG } })).status).toBe(200);
    expect((await getRaw(logoRoute.GET, { cookie: A.adminCookie })).type).toBe("image/jpeg");
    expect((await patchBusiness(A.adminCookie, { logo: { data_base64: WEBP } })).status).toBe(200);
    expect((await getRaw(logoRoute.GET, { cookie: A.adminCookie })).type).toBe("image/webp");
    const removed = await patchBusiness(A.adminCookie, { logo: null });
    expect(removed.body.logo_url).toBeNull();
    expect((await getRaw(logoRoute.GET, { cookie: A.adminCookie })).status).toBe(404);
    expect((await patchBusiness(A.adminCookie, { logo: { data_base64: PNG } })).status).toBe(200);
  });

  it.each([
    ["SVG logo (can hide scripts)", { logo: { data_base64: SVG } }],
    ["logo over 300 KB", { logo: { data_base64: Buffer.concat([Buffer.from(PNG, "base64"), Buffer.alloc(301 * 1024)]).toString("base64") } }],
    ["empty logo", { logo: { data_base64: "" } }],
    ["brand color that isn't #RRGGBB", { brand_color: "blue" }],
    ["5-digit PIN code", { pincode: "75301" }],
    ["phone with letters", { phone: "call me" }],
    ["empty plant name", { name: "" }],
  ])("rejects %s", async (_name, body) => {
    expect((await patchBusiness(A.adminCookie, body)).status).toBe(400);
  });

  it("staff cannot read or change business details or products", async () => {
    expect((await call(businessRoute.GET as Handler, { cookie: aStaff.cookie })).status).toBe(403);
    expect((await patchBusiness(aStaff.cookie, { name: "hacked" })).status).toBe(403);
    expect((await call(skusRoute.GET as Handler, { cookie: aStaff.cookie })).status).toBe(403);
    expect((await addSku(aStaff.cookie, { name: "x", volume_ml: 1000, pack_type: "bottle" })).status).toBe(403);
  });
});

describe("products (SKUs)", () => {
  it("owner adds, edits and deactivates a product; SKU code is unique per plant", async () => {
    const created = await addSku(A.adminCookie, { name: "Aqua 1L", sku_code: "aq-1l", volume_ml: 1000, pack_type: "bottle" });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ name: "Aqua 1L", sku_code: "AQ-1L", volume_ml: 1000, status: "active" });

    expect((await addSku(A.adminCookie, { name: "Other", sku_code: "AQ-1L", volume_ml: 500, pack_type: "bottle" })).status).toBe(409);
    // Another plant may use the same code.
    expect((await addSku(B.adminCookie, { name: "B 1L", sku_code: "AQ-1L", volume_ml: 1000, pack_type: "bottle" })).status).toBe(201);
    // No code at all is fine, more than once.
    expect((await addSku(A.adminCookie, { name: "20L jar", volume_ml: 20000, pack_type: "jar" })).status).toBe(201);
    expect((await addSku(A.adminCookie, { name: "Pouch", sku_code: "", volume_ml: 250, pack_type: "pouch" })).status).toBe(201);

    const off = await call(skuRoute.PATCH as Handler, {
      cookie: A.adminCookie,
      method: "PATCH",
      body: { status: "inactive", volume_ml: 1200 },
      params: { id: created.body.id },
    });
    expect(off.body).toMatchObject({ status: "inactive", volume_ml: 1200 });

    const list = await call(skusRoute.GET as Handler, { cookie: A.adminCookie });
    expect(list.body.map((s: { name: string }) => s.name)).toEqual(["20L jar", "Aqua 1L", "Pouch"]);
  });

  it("a case holds several units: size is per bottle, units_per_pack says how many (default 1)", async () => {
    const single = await addSku(A.adminCookie, { name: "Single 500ml", volume_ml: 500, pack_type: "bottle" });
    expect(single.body.units_per_pack).toBe(1);
    const box = await addSku(A.adminCookie, { name: "Case 24 x 500ml", volume_ml: 500, units_per_pack: 24, pack_type: "case" });
    expect(box.status).toBe(201);
    expect(box.body).toMatchObject({ volume_ml: 500, units_per_pack: 24, pack_type: "case" });
    // editing another field leaves units_per_pack alone
    const renamed = await call(skuRoute.PATCH as Handler, { cookie: A.adminCookie, method: "PATCH", body: { name: "Case 24" }, params: { id: box.body.id } });
    expect(renamed.body.units_per_pack).toBe(24);
    const changed = await call(skuRoute.PATCH as Handler, { cookie: A.adminCookie, method: "PATCH", body: { units_per_pack: 12 }, params: { id: box.body.id } });
    expect(changed.body.units_per_pack).toBe(12);
    // keep the product list used by later tests unchanged
    for (const id of [single.body.id, box.body.id]) {
      await call(skuRoute.PATCH as Handler, { cookie: A.adminCookie, method: "PATCH", body: { status: "inactive" }, params: { id } });
    }
  });

  it.each([
    ["zero units per pack", { name: "x", volume_ml: 500, units_per_pack: 0, pack_type: "case" }],
    ["fractional units per pack", { name: "x", volume_ml: 500, units_per_pack: 2.5, pack_type: "case" }],
    ["zero size", { name: "x", volume_ml: 0, pack_type: "bottle" }],
    ["unknown pack type", { name: "x", volume_ml: 1000, pack_type: "barrel" }],
    ["no name", { name: " ", volume_ml: 1000, pack_type: "bottle" }],
    ["SKU code with spaces", { name: "x", sku_code: "A B", volume_ml: 1000, pack_type: "bottle" }],
  ])("rejects %s", async (_name, body) => {
    expect((await addSku(A.adminCookie, body)).status).toBe(400);
  });

  it("products can never be deleted, by either login", async () => {
    for (const run of [
      () => withTenant(A.tenantId, (tx) => tx.execute(sql`delete from platform.tenant_skus`)),
      () => superDb().execute(sql`delete from platform.tenant_skus`),
    ]) {
      expect(await dbError(run())).toMatch(/permission denied/);
    }
  });
});

describe("tenant isolation", () => {
  it("plant A's owner gets 404 for plant B's product", async () => {
    const bList = await call(skusRoute.GET as Handler, { cookie: B.adminCookie });
    const res = await call(skuRoute.PATCH as Handler, { cookie: A.adminCookie, method: "PATCH", body: { name: "hacked" }, params: { id: bList.body[0].id } });
    expect(res.status).toBe(404);
  });

  it("each owner only ever sees their own plant's details and products", async () => {
    const b = await call(businessRoute.GET as Handler, { cookie: B.adminCookie });
    expect(b.body).toMatchObject({ code: B.code, city: null, logo_url: null });
    const bSkus = await call(skusRoute.GET as Handler, { cookie: B.adminCookie });
    expect(bSkus.body.map((s: { name: string }) => s.name)).toEqual(["B 1L"]);
    expect((await getRaw(logoRoute.GET, { cookie: B.adminCookie })).status).toBe(404); // A's logo is invisible
  });

  it.each(["tenant_profiles", "tenant_skus"])("database: plant B sees none of plant A's rows in %s", async (table) => {
    const rows = await withTenant(B.tenantId, (tx) => tx.execute<{ owner: string }>(sql.raw(`select tenant_id::text as owner from platform.${table}`)));
    expect(rows.rows.every((r) => r.owner === B.tenantId)).toBe(true);
    const all = await asOwner<{ n: number }>(`select count(*)::int as n from platform.${table} where tenant_id = $1`, [A.tenantId]);
    expect(all.rows[0]!.n).toBeGreaterThan(0);
  });

  it("database: plant A cannot write a profile or product for plant B", async () => {
    await expect(
      withTenant(A.tenantId, (tx) => tx.execute(sql`insert into platform.tenant_profiles (tenant_id, updated_by) values (${B.tenantId}, 'x')`)),
    ).rejects.toThrow();
    const res = await withTenant(A.tenantId, (tx) => tx.execute(sql`update platform.tenant_skus set name = 'hacked' where tenant_id = ${B.tenantId}`));
    expect(res.rowCount).toBe(0);
  });
});

describe("plant code and usernames: super_admin only", () => {
  it("owner cannot change the plant code or a username through the API (fields are ignored)", async () => {
    const res = await patchBusiness(A.adminCookie, { code: "HACKED", username: "x" });
    expect(res.status).toBe(200);
    expect(res.body.code).toBe(A.code);
    const u = await call(adminUserRoute.PATCH as Handler, { cookie: A.adminCookie, method: "PATCH", body: { username: "renamed" }, params: { id: aStaff.userId } });
    expect(u.body.username).toBe("ramesh");
  });

  it("database: the app login may rename its plant but never change its code or status", async () => {
    expect(await dbError(withTenant(A.tenantId, (tx) => tx.execute(sql`update platform.tenants set code = 'HACKED'`)))).toMatch(/permission denied/);
    expect(await dbError(withTenant(A.tenantId, (tx) => tx.execute(sql`update platform.tenants set status = 'active'`)))).toMatch(/permission denied/);
    // and renaming only ever touches its own plant
    const res = await withTenant(A.tenantId, (tx) => tx.execute(sql`update platform.tenants set name = 'hacked' where id = ${B.tenantId}`));
    expect(res.rowCount).toBe(0);
  });

  it("super_admin changes the plant code: new code logs in, old code doesn't, open sessions stay", async () => {
    const plant = await makePlant();
    const newCode = unique("N");
    const res = await call(superTenantRoute.PATCH as Handler, { cookie: sa.cookie, method: "PATCH", body: { code: newCode.toLowerCase() }, params: { id: plant.tenantId } });
    expect(res.status).toBe(200);
    expect(res.body.code).toBe(newCode);
    expect((await login(plant.code, "owner", plant.adminPassword)).status).toBe(401);
    expect((await login(newCode, "owner", plant.adminPassword)).status).toBe(200);
    expect((await call(meRoute.GET as Handler, { cookie: plant.adminCookie })).status).toBe(200);

    const dup = await call(superTenantRoute.PATCH as Handler, { cookie: sa.cookie, method: "PATCH", body: { code: A.code }, params: { id: plant.tenantId } });
    expect(dup.status).toBe(409);
    const bad = await call(superTenantRoute.PATCH as Handler, { cookie: sa.cookie, method: "PATCH", body: { code: "a b" }, params: { id: plant.tenantId } });
    expect(bad.status).toBe(400);
  });

  it("super_admin renames a user: they are logged out and log in with the new name", async () => {
    const plant = await makePlant();
    const staff = await makeStaff(plant, "suresh", ["store_keeper"], "135790");
    await makeStaff(plant, "mahesh", ["store_keeper"]);
    const rename = (userId: string, username: string) =>
      call(superUserRoute.PATCH as Handler, { cookie: sa.cookie, method: "PATCH", body: { username }, params: { id: plant.tenantId, userId } });

    const res = await rename(staff.userId, "Suresh.K");
    expect(res.status).toBe(200);
    expect(res.body.users.find((u: { id: string }) => u.id === staff.userId).username).toBe("suresh.k");
    expect((await call(meRoute.GET as Handler, { cookie: staff.cookie })).status).toBe(401);
    expect((await login(plant.code, "suresh", "135790")).status).toBe(401);
    expect((await login(plant.code, "suresh.k", "135790")).status).toBe(200);

    expect((await rename(staff.userId, "mahesh")).status).toBe(409);
    expect((await rename(plant.adminUserId, "owner2")).status).toBe(200); // owners too
    expect((await rename(aStaff.userId, "x-other")).status).toBe(404); // user of another plant
  });

  it("owner and staff cannot use the super_admin rename / code routes", async () => {
    for (const cookie of [A.adminCookie, aStaff.cookie]) {
      expect((await call(superUserRoute.PATCH as Handler, { cookie, method: "PATCH", body: { username: "x" }, params: { id: A.tenantId, userId: aStaff.userId } })).status).toBe(401);
      expect((await call(superTenantRoute.PATCH as Handler, { cookie, method: "PATCH", body: { code: "XYZ" }, params: { id: A.tenantId } })).status).toBe(401);
    }
  });
});

describe("super_admin and business details", () => {
  it("can fill business details when creating a plant", async () => {
    const code = unique("C");
    const res = await call(superTenantsRoute.POST as Handler, {
      cookie: sa.cookie,
      body: {
        code,
        name: "New Plant",
        plan: { plan_name: "Starter", enabled_modules: ["lab_records"], limits: { platform: {}, modules: {} } },
        admin: { username: "owner", display_name: "Owner" },
        business: { brand_color: "#0f766e", city: "Bhubaneswar", phone: "", logo: { data_base64: PNG } },
      },
    });
    expect(res.status).toBe(201);
    const b = await call(superBusinessRoute.GET as Handler, { cookie: sa.cookie, params: { id: res.body.id } });
    expect(b.body).toMatchObject({ name: "New Plant", brand_color: "#0f766e", city: "Bhubaneswar", phone: null });
    expect((await getRaw(superLogoRoute.GET, { cookie: sa.cookie, params: { id: res.body.id } })).type).toBe("image/png");
  });

  it("a bad logo at creation creates nothing", async () => {
    const code = unique("C");
    const res = await call(superTenantsRoute.POST as Handler, {
      cookie: sa.cookie,
      body: {
        code,
        name: "Bad Logo Plant",
        plan: { plan_name: "Starter", enabled_modules: [], limits: { platform: {}, modules: {} } },
        admin: { username: "owner", display_name: "Owner" },
        business: { logo: { data_base64: SVG } },
      },
    });
    expect(res.status).toBe(400);
    expect((await asOwner("select 1 from platform.tenants where code = $1", [code])).rowCount).toBe(0);
  });

  it("can edit a plant's details and products", async () => {
    const res = await call(superBusinessRoute.PATCH as Handler, { cookie: sa.cookie, method: "PATCH", body: { state: "Odisha" }, params: { id: B.tenantId } });
    expect(res.body.state).toBe("Odisha");
    const sku = await call(superSkusRoute.POST as Handler, { cookie: sa.cookie, body: { name: "B 500ml", volume_ml: 500, pack_type: "bottle" }, params: { id: B.tenantId } });
    expect(sku.status).toBe(201);
    const list = await call(superSkusRoute.GET as Handler, { cookie: sa.cookie, params: { id: B.tenantId } });
    expect(list.body.map((s: { name: string }) => s.name)).toEqual(["B 1L", "B 500ml"]);
  });
});

describe("branding for modules", () => {
  it("a module reads the plant's name, color and logo with its own credentials", async () => {
    const res = await call(brandingRoute.GET as Handler, { headers: LAB, params: { tid: A.tenantId } });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ tenant_id: A.tenantId, name: "Aqua Pure Odisha", brand_color: "#1d4ed8" });
    expect(res.body.logo_url).toMatch(new RegExp(`^/api/m/tenants/${A.tenantId}/logo\\?v=\\d+$`));
    expect((await getRaw(moduleLogoRoute.GET, { headers: LAB, params: { tid: A.tenantId } })).type).toBe("image/png");
  });

  it("without module credentials: refused", async () => {
    expect((await call(brandingRoute.GET as Handler, { params: { tid: A.tenantId } })).status).toBe(401);
    expect((await call(brandingRoute.GET as Handler, { cookie: A.adminCookie, params: { tid: A.tenantId } })).status).toBe(401);
    expect((await getRaw(moduleLogoRoute.GET, { params: { tid: A.tenantId } })).status).toBe(401);
  });
});
