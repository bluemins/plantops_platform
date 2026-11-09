// Drop Phase 5: the plant's look for the app (name, brand colour, logo, support), before anyone logs in. Allow-list only.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { resetRateLimits } from "@plantops/module-kit/http";
import { GET as logoRoute } from "@/app/api/app/v1/logo/route";
import { GET as lookRoute } from "@/app/api/app/v1/look/route";
import { startFakePlatform, type FakePlatform } from "./fake-platform";

let platform: FakePlatform;
const a = randomUUID();
const b = randomUUID();
beforeAll(async () => {
  platform = await startFakePlatform();
  process.env.PLATFORM_URL = platform.url;
  process.env.DROP_CODE_SECRET = "s".repeat(40);
  process.env.DROP_APPS = JSON.stringify({ "app-a": { tenant_id: a, brand: "Bluemins" }, "app-b": { tenant_id: b, brand: "Aqua" } });
});
afterAll(async () => {
  await platform.close();
  for (const k of ["DROP_APPS", "DROP_CODE_SECRET"]) delete process.env[k];
});
beforeEach(() => resetRateLimits());

const req = (path: string, app?: string) => new Request(`http://localhost:3005${path}`, { headers: app ? { "x-drop-app": app } : {} });

describe("Drop look", () => {
  it("the plant's name, colour, logo flag and support contact; nothing else", async () => {
    platform.branding.set(a, { support_phone: "9437000111", support_hours: "Mon–Sat 9–7", gstin: "21ABCDE1234F1Z5", code: "001" });
    const res = await lookRoute(req("/api/app/v1/look", "app-a"));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ name: "Sample Aqua", brand_color: "#0e7490", has_logo: false, support: { phone: "9437000111", hours: "Mon–Sat 9–7" } });
  });
  it("an unknown app gets nothing; a plant without a logo gets 404 for it", async () => {
    expect((await lookRoute(req("/api/app/v1/look"))).status).toBe(401);
    expect((await lookRoute(req("/api/app/v1/look", "nope"))).status).toBe(401);
    expect((await logoRoute(req("/api/app/v1/logo", "app-b"))).status).toBe(404);
  });
});
