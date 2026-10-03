// Step 8: super_admin's read-only support view. Enters with a one-time code (support token), can open
// every page, can change nothing (proxy + server guards), and every page view is listed for the owner.
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GET as supportEntry } from "@/app/sso/support/route";
import { proxy } from "@/proxy";
import { addCorrectiveAction, approveBatch } from "@/server/approval";
import { createBatch } from "@/server/batches";
import { createDailyEntry, verifyEntry } from "@/server/entries";
import { exportRecords } from "@/server/export";
import { listParameters, updateParameter } from "@/server/parameters";
import { openSupportCookie, SUPPORT_COOKIE } from "@/server/session-cookie";
import { supportUser } from "@/server/session";
import { listSupportViews } from "@/server/support";
import { startFakePlatform, TENANT, type FakePlatform } from "./fake-platform";
import { asOwner, labUser, refused } from "./helpers";

let platform: FakePlatform;

beforeAll(async () => {
  platform = await startFakePlatform();
  process.env.PLATFORM_URL = platform.url;
});
afterAll(() => platform.close());

const day = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
const cookieValue = (res: Response) => {
  const m = new RegExp(`${SUPPORT_COOKIE}=([^;]*)`).exec(res.headers.get("set-cookie") ?? "");
  return m ? decodeURIComponent(m[1]!) : undefined;
};

describe("entering the support view", () => {
  const enter = (q: string) => supportEntry(new NextRequest(`http://localhost:3001/sso/support${q}`));

  it("a valid one-time code gives a 15-minute read-only session for that plant", async () => {
    platform.nextToken = await platform.supportToken();
    const res = await enter("?code=abc");
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("/");
    const s = await openSupportCookie(cookieValue(res));
    expect(s).toMatchObject({ tenant_id: TENANT, read_only: true });
    expect(res.headers.get("set-cookie")).toMatch(/Max-Age=(89\d|900)/);
  });

  it("refuses: no code, a used code, a login token passed off as support", async () => {
    expect((await enter("")).status).toBe(400);
    platform.nextToken = "";
    expect((await enter("?code=used")).status).toBe(403);
    platform.nextToken = await platform.loginToken(["tenant_admin"]);
    expect((await enter("?code=x")).status).toBe(403);
  });
});

describe("read-only, enforced twice", () => {
  it("the proxy lets support look (GET) but refuses any change, without asking the platform", async () => {
    platform.nextToken = await platform.supportToken();
    const value = cookieValue(await supportEntry(new NextRequest("http://localhost:3001/sso/support?code=abc")))!;
    const req = (method: string, path: string) =>
      new NextRequest(`http://localhost:3001${path}`, { method, headers: { cookie: `${SUPPORT_COOKIE}=${encodeURIComponent(value)}` } });
    const calls = platform.statusCalls;
    expect((await proxy(req("GET", "/batches/x"))).status).toBe(200);
    for (const [m, p] of [["POST", "/api/entries"], ["POST", "/api/batches/x/approve"], ["PATCH", "/api/parameters/x"], ["POST", "/api/batches"]]) {
      const res = await proxy(req(m!, p!));
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: "PlantOps support view is read-only" });
    }
    expect(platform.statusCalls).toBe(calls);
  });

  it("every server action refuses the support user too", async () => {
    const tenantId = (await import("node:crypto")).randomUUID();
    const tech = labUser(tenantId, ["lab_technician"], "Atharv");
    const owner = labUser(tenantId, ["tenant_admin"], "Sujata");
    const tds = (await listParameters(owner, "daily"))[0]!.id;
    const b = await createBatch(tech, { batch_no: "S-1", production_date: day() });
    const e = await createDailyEntry(tech, { batch_id: b.id, results: [{ parameter_id: tds, value: "100" }] });
    const support = supportUser(tenantId, (await import("node:crypto")).randomUUID());

    for (const action of [
      () => createBatch(support, { batch_no: "S-2", production_date: day() }),
      () => createDailyEntry(support, { results: [{ parameter_id: tds, value: "1" }] }),
      () => approveBatch(support, b.id),
      () => addCorrectiveAction(support, b.id, { note: "support note" }),
      () => verifyEntry(support, e.id),
      () => updateParameter(support, tds, { limit_max: "1" }),
      () => exportRecords(support),
    ]) {
      expect((await refused(action)).status).toBe(403);
    }
  });
});

describe("the owner sees every support view", () => {
  it("lists them newest first; only the owner may see the list", async () => {
    const tenantId = (await import("node:crypto")).randomUUID();
    const sa = (await import("node:crypto")).randomUUID();
    for (const [path, ago] of [["/", 10], ["/batches/abc", 5]] as const) {
      await asOwner(
        "insert into lab_records.support_views (tenant_id, super_admin_id, super_admin_name, path, at) values ($1, $2, 'PlantOps support', $3, now() - ($4 || ' minutes')::interval)",
        [tenantId, sa, path, String(ago)],
      );
    }
    const views = await listSupportViews(labUser(tenantId, ["tenant_admin"]));
    expect(views.map((v) => v.path)).toEqual(["/batches/abc", "/"]);
    expect((await refused(() => listSupportViews(labUser(tenantId, ["lab_lead"])))).status).toBe(403);
    expect(await listSupportViews(labUser((await import("node:crypto")).randomUUID(), ["tenant_admin"]))).toEqual([]); // another plant: nothing
  });

  it("the app can add support-view rows but never remove them", async () => {
    const { asApp, dbError } = await import("./helpers");
    expect(await dbError(asApp(TENANT, "delete from lab_records.support_views"))).toMatch(/permission denied/);
    expect(await dbError(asApp(TENANT, "update lab_records.support_views set path = '/'"))).toMatch(/permission denied/);
  });
});
