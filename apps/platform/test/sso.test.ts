// SSO: one-time code handoff, server-to-server exchange, token verification by a module.
import { generateKeyPairSync, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { importJWK, SignJWT, type JWK } from "jose";
import { beforeAll, describe, expect, it } from "vitest";
import { InvalidTokenError, verifyToken } from "@plantops/auth";
import * as handoffRoute from "@/app/api/sso/handoff/route";
import * as exchangeRoute from "@/app/api/sso/exchange/route";
import * as statusRoute from "@/app/api/m/tenants/[tid]/users/[uid]/status/route";
import * as planRoute from "@/app/api/tenants/[id]/plan/route";
import * as jwksRoute from "@/app/.well-known/jwks.json/route";
import * as adminUserRoute from "@/app/api/admin/users/[id]/route";
import { sha256 } from "@/server/crypto";
import { publicJwks } from "@/server/sso";
import { asOwner, call, makePlant, makeStaff, type Handler } from "./helpers";

const LAB_SECRET = "lab-module-test-secret";
const STOCK_SECRET = "stock-module-test-secret";
const basic = (id: string, secret: string) => ({ authorization: "Basic " + btoa(`${id}:${secret}`) });
const LAB = basic("lab_records", LAB_SECRET);
const STOCK = basic("floor_stock", STOCK_SECRET);

let plant: Awaited<ReturnType<typeof makePlant>>;
let labTech: Awaited<ReturnType<typeof makeStaff>>;
let multi: Awaited<ReturnType<typeof makeStaff>>;

beforeAll(async () => {
  await asOwner("update platform.modules set base_url = 'https://lab.example.test', client_secret_hash = $1 where id = 'lab_records'", [sha256(LAB_SECRET)]);
  await asOwner("update platform.modules set base_url = 'https://stock.example.test', client_secret_hash = $1 where id = 'floor_stock'", [sha256(STOCK_SECRET)]);
  await asOwner("update platform.modules set base_url = null, client_secret_hash = null where id = 'preventive_mgmt'");
  plant = await makePlant({ modules: ["lab_records", "floor_stock", "preventive_mgmt"] });
  labTech = await makeStaff(plant, "ramesh", ["lab_technician"]);
  multi = await makeStaff(plant, "both", ["lab_technician", "store_keeper"]);
});

const handoff = (cookie: string, module: string) => call(handoffRoute.POST as Handler, { cookie, body: { module } });
const codeFrom = (redirect: string) => new URL(redirect).searchParams.get("code")!;
const exchange = (code: string, headers: Record<string, string> = LAB) => call(exchangeRoute.POST as Handler, { body: { code }, headers });
const keys = () => ({ jwks: publicJwks() as { keys: JWK[] } });

async function tokenFor(cookie: string, module = "lab_records", headers = LAB) {
  const h = await handoff(cookie, module);
  expect(h.status).toBe(200);
  const ex = await exchange(codeFrom(h.body.redirect_url), headers);
  expect(ex.status).toBe(200);
  return ex.body.token as string;
}

describe("handoff (platform decides who may open which module)", () => {
  it("lab technician gets a one-time code for Lab Records, pointing at the module's callback", async () => {
    const res = await handoff(labTech.cookie, "lab_records");
    expect(res.status).toBe(200);
    const url = new URL(res.body.redirect_url);
    expect(url.origin + url.pathname).toBe("https://lab.example.test/sso/callback");
    expect(url.searchParams.get("code")!.length).toBeGreaterThanOrEqual(40);
    expect(res.body.redirect_url).not.toMatch(/eyJ/); // no JWT in the URL
  });

  it("lab technician is refused Floor Stock", async () => {
    expect((await handoff(labTech.cookie, "floor_stock")).status).toBe(403);
  });

  it("a multi-role user may open each of their modules", async () => {
    expect((await handoff(multi.cookie, "lab_records")).status).toBe(200);
    expect((await handoff(multi.cookie, "floor_stock")).status).toBe(200);
  });

  it("the owner may open any enabled module, but not one that isn't in the plan", async () => {
    expect((await handoff(plant.adminCookie, "floor_stock")).status).toBe(200);
    expect((await handoff(plant.adminCookie, "amc")).status).toBe(403);
  });

  it("a module with no URL registered yet gives a clear 409", async () => {
    expect((await handoff(plant.adminCookie, "preventive_mgmt")).status).toBe(409);
  });

  it("no session -> 401; unknown module -> 400", async () => {
    expect((await call(handoffRoute.POST as Handler, { body: { module: "lab_records" } })).status).toBe(401);
    expect((await handoff(labTech.cookie, "nonsense")).status).toBe(400);
  });
});

describe("exchange (module server swaps the code for a token)", () => {
  it("returns a token the module can verify, with exactly the agreed contents", async () => {
    const token = await tokenFor(multi.cookie);
    const payload = await verifyToken(token, { audience: "lab_records", keys: keys() });
    expect(Object.keys(payload).sort()).toEqual(["aud", "enabled_modules", "exp", "iat", "iss", "jti", "roles", "tenant_id", "user_id"]);
    expect(payload).toMatchObject({
      iss: "plantops-platform",
      aud: "lab_records",
      tenant_id: plant.tenantId,
      user_id: multi.userId,
      roles: ["lab_technician", "store_keeper"],
      enabled_modules: ["lab_records", "floor_stock", "preventive_mgmt"],
    });
    expect(payload.exp - payload.iat).toBe(15 * 60);
  });

  it("a code works only once", async () => {
    const code = codeFrom((await handoff(labTech.cookie, "lab_records")).body.redirect_url);
    expect((await exchange(code)).status).toBe(200);
    expect((await exchange(code)).status).toBe(400);
  });

  it("a code issued for Lab Records cannot be redeemed by Floor Stock", async () => {
    const code = codeFrom((await handoff(multi.cookie, "lab_records")).body.redirect_url);
    expect((await exchange(code, STOCK)).status).toBe(400);
    expect((await exchange(code, LAB)).status).toBe(200); // the wrong attempt didn't burn it
  });

  it("an expired code is refused", async () => {
    const code = codeFrom((await handoff(labTech.cookie, "lab_records")).body.redirect_url);
    await asOwner("update platform.sso_handoff_codes set expires_at = now() - interval '1 second' where code_hash = $1", [sha256(code)]);
    expect((await exchange(code)).status).toBe(400);
  });

  it("wrong or missing module secret -> 401", async () => {
    const code = codeFrom((await handoff(labTech.cookie, "lab_records")).body.redirect_url);
    expect((await exchange(code, basic("lab_records", "wrong"))).status).toBe(401);
    expect((await exchange(code, {})).status).toBe(401);
    expect((await exchange(code, basic("not_a_module", "x"))).status).toBe(401);
  });

  it("a user disabled between handoff and exchange gets no token", async () => {
    const s = await makeStaff(plant, "soonGone".toLowerCase(), ["lab_technician"]);
    const code = codeFrom((await handoff(s.cookie, "lab_records")).body.redirect_url);
    await call(adminUserRoute.PATCH as Handler, { cookie: plant.adminCookie, method: "PATCH", body: { status: "disabled" }, params: { id: s.userId } });
    expect((await exchange(code)).status).toBe(403);
  });
});

describe("token verification in a module (packages/auth verifyToken)", () => {
  let signingJwk: JWK;
  beforeAll(() => {
    signingJwk = JSON.parse(Buffer.from(process.env.SSO_PRIVATE_JWK_B64!, "base64").toString("utf8"));
  });

  async function forge(claims: Record<string, unknown>, opts: { jwk?: JWK; exp?: number } = {}) {
    const jwk = opts.jwk ?? signingJwk;
    const now = Math.floor(Date.now() / 1000);
    return new SignJWT({ tenant_id: plant.tenantId, user_id: labTech.userId, roles: ["lab_technician"], enabled_modules: ["lab_records"], ...claims })
      .setProtectedHeader({ alg: "EdDSA", kid: jwk.kid })
      .setIssuer("plantops-platform")
      .setAudience("lab_records")
      .setIssuedAt(now - 3600)
      .setExpirationTime(opts.exp ?? now + 600)
      .setJti(randomUUID())
      .sign(await importJWK(jwk, "EdDSA"));
  }

  const rejects = (token: string, audience: "lab_records" | "floor_stock" = "lab_records") =>
    expect(verifyToken(token, { audience, keys: keys() })).rejects.toBeInstanceOf(InvalidTokenError);

  it("accepts a correctly signed token (sanity check for the forging helper)", async () => {
    await expect(verifyToken(await forge({}), { audience: "lab_records", keys: keys() })).resolves.toBeTruthy();
  });

  it("rejects an expired token", async () => {
    await rejects(await forge({}, { exp: Math.floor(Date.now() / 1000) - 10 }));
  });

  it("rejects a token meant for another module", async () => {
    await rejects(await tokenFor(labTech.cookie), "floor_stock");
  });

  it("rejects a tampered token (roles changed after signing)", async () => {
    const [h, p, s] = (await tokenFor(labTech.cookie)).split(".");
    const payload = JSON.parse(Buffer.from(p!, "base64url").toString());
    payload.roles = ["tenant_admin"];
    await rejects([h, Buffer.from(JSON.stringify(payload)).toString("base64url"), s].join("."));
  });

  it("rejects an unsigned token (alg: none)", async () => {
    const enc = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
    const now = Math.floor(Date.now() / 1000);
    await rejects(`${enc({ alg: "none" })}.${enc({ iss: "plantops-platform", aud: "lab_records", exp: now + 600, iat: now, jti: randomUUID(), tenant_id: plant.tenantId, user_id: labTech.userId, roles: ["tenant_admin"], enabled_modules: ["lab_records"] })}.`);
  });

  it("rejects an HS256 token 'signed' with the public key", async () => {
    const now = Math.floor(Date.now() / 1000);
    const token = await new SignJWT({ tenant_id: plant.tenantId, user_id: labTech.userId, roles: ["tenant_admin"], enabled_modules: ["lab_records"] })
      .setProtectedHeader({ alg: "HS256", kid: signingJwk.kid })
      .setIssuer("plantops-platform").setAudience("lab_records").setIssuedAt(now).setExpirationTime(now + 600).setJti(randomUUID())
      .sign(new TextEncoder().encode(signingJwk.x));
    await rejects(token);
  });

  it("rejects a token signed by any other key", async () => {
    const { privateKey } = generateKeyPairSync("ed25519");
    await rejects(await forge({}, { jwk: { ...privateKey.export({ format: "jwk" }), kid: signingJwk.kid } as JWK }));
    await rejects(await forge({}, { jwk: { ...privateKey.export({ format: "jwk" }), kid: "unknown-kid" } as JWK }));
  });

  it("rejects a validly signed token with an unexpected payload shape", async () => {
    await rejects(await forge({ roles: ["superhero"] }));
  });

  it("JWKS publishes only public keys", async () => {
    const res = await call(jwksRoute.GET as Handler);
    expect(res.status).toBe(200);
    expect(res.body.keys).toHaveLength(1);
    expect(res.body.keys[0]).not.toHaveProperty("d");
    expect(res.body.keys[0]).toMatchObject({ kty: "OKP", crv: "Ed25519", alg: "EdDSA", kid: signingJwk.kid });
  });
});

describe("module re-checks (status + plan)", () => {
  const status = (tid: string, uid: string, headers: Record<string, string> = LAB) => call(statusRoute.GET as Handler, { headers, params: { tid, uid } });

  it("reflects role removal and disabling immediately", async () => {
    const s = await makeStaff(plant, "changing", ["lab_technician", "store_keeper"]);
    expect((await status(plant.tenantId, s.userId)).body).toEqual({
      active: true,
      roles: ["lab_technician", "store_keeper"],
      enabled_modules: ["lab_records", "floor_stock", "preventive_mgmt"],
    });
    const patch = (body: unknown) =>
      call(adminUserRoute.PATCH as Handler, { cookie: plant.adminCookie, method: "PATCH", body, params: { id: s.userId } });
    await patch({ roles: ["store_keeper"] });
    expect((await status(plant.tenantId, s.userId)).body.roles).toEqual(["store_keeper"]);
    await patch({ status: "disabled" });
    expect((await status(plant.tenantId, s.userId)).body.active).toBe(false);
  });

  it("requires module credentials; a user id from another plant is 404", async () => {
    expect((await status(plant.tenantId, labTech.userId, {})).status).toBe(401);
    const other = await makePlant();
    expect((await status(other.tenantId, labTech.userId)).status).toBe(404);
  });

  it("plan endpoint returns enabled modules + limits, never without module credentials", async () => {
    const res = await call(planRoute.GET as Handler, { headers: LAB, params: { id: plant.tenantId } });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ tenant_id: plant.tenantId, plan_name: "Growth", enabled_modules: ["lab_records", "floor_stock", "preventive_mgmt"] });
    expect((await call(planRoute.GET as Handler, { params: { id: plant.tenantId } })).status).toBe(401);
  });
});

describe("module verifies via the platform's JWKS URL over HTTP (how a real module does it)", () => {
  it("fetches the public key from the URL and verifies; refetches nothing it doesn't need", async () => {
    let hits = 0;
    const server = createServer((_req, res) => {
      hits++;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(publicJwks()));
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const { port } = server.address() as { port: number };
    try {
      const jwksUrl = `http://127.0.0.1:${port}/.well-known/jwks.json`;
      const token = await tokenFor(labTech.cookie);
      const payload = await verifyToken(token, { audience: "lab_records", keys: { jwksUrl } });
      expect(payload.user_id).toBe(labTech.userId);
      await verifyToken(await tokenFor(labTech.cookie), { audience: "lab_records", keys: { jwksUrl } });
      expect(hits).toBe(1); // key is cached, not fetched on every login
      await expect(verifyToken(token, { audience: "floor_stock", keys: { jwksUrl } })).rejects.toBeInstanceOf(InvalidTokenError);
    } finally {
      server.close();
    }
  });
});

describe("modules listed for the user after login", () => {
  it("lists exactly the modules each user may open", async () => {
    const me = (await import("@/app/api/auth/me/route")).GET as Handler;
    expect((await call(me, { cookie: labTech.cookie })).body.modules).toEqual(["lab_records"]);
    expect((await call(me, { cookie: multi.cookie })).body.modules).toEqual(["lab_records", "floor_stock"]);
    expect((await call(me, { cookie: plant.adminCookie })).body.modules).toEqual(["lab_records", "floor_stock", "preventive_mgmt"]);
  });
});
