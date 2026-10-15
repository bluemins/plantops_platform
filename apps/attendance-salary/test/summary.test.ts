// The launcher tile's numbers (src/server/summary.ts) and the support view (read-only, every page view logged).
import { NextRequest } from "next/server";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import * as exportRoute from "@/app/api/export/route";
import * as addRoute from "@/app/api/fix/add/route";
import * as cancelRoute from "@/app/api/fix/cancel/route";
import * as punchRoute from "@/app/api/punch/route";
import * as qrRoute from "@/app/api/settings/qr/route";
import * as settingsRoute from "@/app/api/settings/route";
import { GET as summaryRoute } from "@/app/api/plantops/summary/route";
import ChangesPage from "@/app/changes/page";
import HomePage from "@/app/page";
import SettingsPage from "@/app/settings/page";
import PersonDayPage from "@/app/staff/[user]/[date]/page";
import StaffPage from "@/app/staff/page";
import { proxy } from "@/proxy";
import { kit } from "@/server/kit";
import { newQr, saveSettings } from "@/server/settings";
import { summaryFor } from "@/server/summary";
import { listSupportViews } from "@/server/support";
import { startFakePlatform, type FakePlatform } from "./fake-platform";
import { atUser, contactsFor, ist, jsonReq, markAt, plant, signInAs } from "./helpers";

let platform: FakePlatform;
beforeAll(async () => {
  platform = await startFakePlatform();
  process.env.PLATFORM_URL = platform.url;
});
afterAll(() => platform.close());
afterEach(() => vi.restoreAllMocks());

const ready = async (p: ReturnType<typeof plant>) => {
  await saveSettings(p.owner, { lat: 21.347, lng: 83.627, radius_m: 200 });
  await newQr(p.owner);
};

describe("tile numbers", () => {
  it("a plant not set up yet: just 'Set location & QR'", async () => {
    const p = plant();
    expect(await summaryFor(p.tenantId, "owner")).toEqual({ badges: [{ text: "Set location & QR", tone: "warn" }] });
  });

  it("set up, nobody to show: 'All in order'", async () => {
    const p = plant();
    await ready(p);
    platform.contacts = [];
    expect(await summaryFor(p.tenantId, "owner", ist("2026-09-10 12:00"))).toEqual({ badges: [{ text: "All in order", tone: "ok" }] });
  });

  it("a mixed plant: in now, not marked (only from 11:00), no exit", async () => {
    const p = plant();
    await ready(p);
    const inside = atUser(p.tenantId, ["plant_staff"], "Anmol");
    const none = atUser(p.tenantId, ["plant_staff"], "Dillip");
    const noExit = atUser(p.tenantId, ["plant_staff"], "Gaja");
    platform.contacts = [...contactsFor(p.owner, inside, none, noExit)];
    await markAt(inside, "in", "2026-09-10 09:02");
    await markAt(noExit, "in", "2026-09-09 08:00");
    expect(await summaryFor(p.tenantId, "owner", ist("2026-09-10 12:00"))).toEqual({
      badges: [
        { text: "1 in now", tone: "info" },
        { text: "2 not marked today", tone: "warn" },
        { text: "1 no exit", tone: "warn" },
      ],
    });
    expect((await summaryFor(p.tenantId, "owner", ist("2026-09-10 10:59"))).badges.map((b) => b.text)).toEqual(["1 in now", "1 no exit"]);
  });

  it("the staff view never shows numbers (they'd be about colleagues)", async () => {
    const p = plant();
    await ready(p);
    expect(await summaryFor(p.tenantId, "staff")).toEqual({ badges: [] });
  });

  it("only the platform's ticket gets an answer", async () => {
    const ask = (token: string | null) => summaryRoute(new Request("http://localhost:3006/api/plantops/summary", { headers: token ? { authorization: `Bearer ${token}` } : {} }));
    expect((await ask(null)).status).toBe(401);
    expect((await ask(await platform.summaryToken())).status).toBe(200);
    expect(await (await ask(await platform.summaryToken("order_capture"))).status).toBe(401);
  });
});

describe("support view", () => {
  it("every change is refused for PlantOps support (server side, whatever the screen shows)", async () => {
    const p = plant();
    await ready(p);
    const id = await markAt(p.worker, "in", "2026-09-14 09:00");
    signInAs(p.support);
    const tries: [string, Promise<Response>][] = [
      ["punch", punchRoute.POST(jsonReq("POST", "/api/punch", { k: "x", expect: "in", location: null }), undefined as never)],
      ["fix add", addRoute.POST(jsonReq("POST", "/api/fix/add", { user_id: p.worker.userId, day: "2026-09-14", kind: "out", date: "2026-09-14", time: "18:00", reason: "support try", expect: "0.0.0" }), undefined as never)],
      ["fix cancel", cancelRoute.POST(jsonReq("POST", "/api/fix/cancel", { punch_id: id, day: "2026-09-14", reason: "support try", expect: "0.0.0" }), undefined as never)],
      ["settings", settingsRoute.PUT(jsonReq("PUT", "/api/settings", { lat: 1, lng: 1, radius_m: 2000 }), undefined as never)],
      ["new QR", qrRoute.POST(jsonReq("POST", "/api/settings/qr", {}), undefined as never)],
      ["export", exportRoute.GET(jsonReq("GET", "/api/export?month=2026-09"), undefined as never)],
    ];
    for (const [what, res] of tries) {
      const r = await res;
      expect(r.status, what).toBe(403);
      expect((await r.json()).error, what).toBe("PlantOps support view is read-only");
    }
  });

  it("the proxy refuses every write with a support session too", async () => {
    platform.nextToken = await platform.supportToken();
    const { GET: supportEntry } = await import("@/app/sso/support/route");
    const res = await supportEntry(new NextRequest("http://localhost:3006/sso/support?code=abc"));
    const value = decodeURIComponent(new RegExp(`${kit.SUPPORT_COOKIE}=([^;]*)`).exec(res.headers.get("set-cookie") ?? "")![1]!);
    for (const path of ["/api/punch", "/api/fix/add", "/api/fix/cancel", "/api/settings/qr"]) {
      const r = await proxy(new NextRequest(`http://localhost:3006${path}`, { method: "POST", headers: { cookie: `${kit.SUPPORT_COOKIE}=${encodeURIComponent(value)}` } }));
      expect(r.status, path).toBe(403);
    }
  });

  it("every page support opens is logged and described for the owner", async () => {
    const p = plant();
    platform.contacts = [...contactsFor(p.worker)];
    await markAt(p.worker, "in", "2026-09-14 09:00");
    signInAs(p.support);
    await HomePage({ searchParams: Promise.resolve({}) });
    await StaffPage();
    await PersonDayPage({ params: Promise.resolve({ user: p.worker.userId, date: "2026-09-14" }) });
    await SettingsPage();
    await ChangesPage();
    const seen = (await listSupportViews(p.owner)).map((v) => v.what).sort();
    expect(seen).toEqual(["Recent changes", "a person's attendance", "the Today board", "the settings", "the staff list"].sort());
  });
});
