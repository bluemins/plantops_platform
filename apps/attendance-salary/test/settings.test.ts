// The plant's point, circle and QR (src/server/settings.ts): owner only, support read-only, audited, and the QR key is
// never stored or audited - the server works it out again for every print; a new QR stops the old one.
import { afterEach, describe, expect, it, vi } from "vitest";
import * as settingsRoute from "@/app/api/settings/route";
import * as qrRoute from "@/app/api/settings/qr/route";
import { checkKey, newQr, qrKeyFor, qrLinkFor, readSettings, saveSettings, settingsFor } from "@/server/settings";
import { withTenant } from "@/server/db";
import { asOwner, jsonReq, plant, refusal, signInAs } from "./helpers";

afterEach(() => vi.restoreAllMocks());

const point = { lat: 21.347, lng: 83.627 };
const put = (body: unknown) => settingsRoute.PUT(jsonReq("PUT", "/api/settings", body), undefined as never);
const row = (tenantId: string) => withTenant(tenantId, (tx) => readSettings(tx, tenantId));

describe("plant location and circle", () => {
  it("the owner sets them; the page shows who and when", async () => {
    const p = plant();
    expect(await settingsFor(p.owner)).toMatchObject({ lat: null, lng: null, radius_m: 200, qr_made_at: null });
    const v = await saveSettings(p.owner, { ...point, radius_m: 300 });
    expect(v).toMatchObject({ ...point, radius_m: 300, updated_by_name: "Sujata" });
    expect(await settingsFor(p.support)).toMatchObject({ ...point, radius_m: 300 }); // support may look
  });

  it("the circle is 50-2,000 m (route answers 400 outside it)", async () => {
    const p = plant();
    signInAs(p.owner);
    expect((await put({ ...point, radius_m: 49 })).status).toBe(400);
    expect((await put({ ...point, radius_m: 2001 })).status).toBe(400);
    expect((await put({ ...point, radius_m: 50 })).status).toBe(200);
    expect((await put({ ...point, radius_m: 2000 })).status).toBe(200);
    expect((await put({ lat: 91, lng: 83, radius_m: 200 })).status).toBe(400);
  });

  it("a worker or support can't change them, nor make a QR", async () => {
    const p = plant();
    for (const u of [p.worker, p.support]) {
      expect((await refusal(() => saveSettings(u, { ...point, radius_m: 200 }))).status).toBe(403);
      expect((await refusal(() => newQr(u))).status).toBe(403);
    }
    signInAs(p.worker);
    expect((await put({ ...point, radius_m: 200 })).status).toBe(403);
    expect((await qrRoute.POST(jsonReq("POST", "/api/settings/qr", {}), undefined as never)).status).toBe(403);
  });

  it("each change is audited (location, circle)", async () => {
    const p = plant();
    await saveSettings(p.owner, { ...point, radius_m: 200 });
    await saveSettings(p.owner, { ...point, radius_m: 500 });
    await saveSettings(p.owner, { lat: 21.4, lng: 83.6, radius_m: 500 });
    const { rows } = await asOwner<{ action: string }>("select action from attendance_salary.audit_log where tenant_id = $1 order by id", [p.tenantId]);
    expect(rows.map((r) => r.action)).toEqual(["settings.location", "settings.radius", "settings.radius", "settings.location"]);
  });

  it("plant B can't see plant A's settings", async () => {
    const a = plant();
    await saveSettings(a.owner, { ...point, radius_m: 300 });
    const b = plant();
    expect(await settingsFor(b.owner)).toMatchObject({ lat: null, radius_m: 200 });
  });
});

describe("the QR", () => {
  it("the key is the same on every reprint; a new QR changes it and the old one stops", async () => {
    const p = plant();
    const first = await newQr(p.owner);
    const link1 = await qrLinkFor(p.owner, "http://localhost:3006");
    expect(await qrLinkFor(p.owner, "http://localhost:3006")).toBe(link1); // reprint: same QR
    const k1 = new URL(link1!).searchParams.get("k")!;
    expect(k1).toBe(qrKeyFor(p.tenantId, new Date(first.qr_made_at!)));
    expect(checkKey(await row(p.tenantId), k1)).toBe("ok");

    await new Promise((r) => setTimeout(r, 5));
    await newQr(p.owner);
    const k2 = new URL((await qrLinkFor(p.owner, "http://localhost:3006"))!).searchParams.get("k")!;
    expect(k2).not.toBe(k1);
    expect(checkKey(await row(p.tenantId), k1)).toBe("bad"); // old prints stop
    expect(checkKey(await row(p.tenantId), k2)).toBe("ok");
  });

  it("another plant's key, junk or no key are refused; no QR yet says so", async () => {
    const a = plant();
    const b = plant();
    await newQr(a.owner);
    await newQr(b.owner);
    const kb = new URL((await qrLinkFor(b.owner, "http://x"))!).searchParams.get("k")!;
    expect(checkKey(await row(a.tenantId), kb)).toBe("bad");
    expect(checkKey(await row(a.tenantId), "junk")).toBe("bad");
    expect(checkKey(await row(a.tenantId), "")).toBe("missing");
    expect(checkKey(await row(a.tenantId), null)).toBe("missing");
    const c = plant();
    expect(checkKey(await row(c.tenantId), kb)).toBe("no_qr");
  });

  it("only the hash is stored, and neither the key nor the hash is in the audit log", async () => {
    const p = plant();
    await newQr(p.owner);
    const k = new URL((await qrLinkFor(p.owner, "http://x"))!).searchParams.get("k")!;
    const stored = await asOwner<{ all: string }>("select row_to_json(s)::text as all from attendance_salary.plant_settings s where tenant_id = $1", [p.tenantId]);
    expect(stored.rows[0]!.all).not.toContain(k);
    const audit = await asOwner<{ details: string; action: string }>("select action, details::text from attendance_salary.audit_log where tenant_id = $1", [p.tenantId]);
    expect(audit.rows.map((r) => r.action)).toEqual(["qr.new"]);
    expect(audit.rows[0]!.details).not.toContain(k);
    expect(audit.rows[0]!.details).not.toContain((await row(p.tenantId))!.qrKeyHash!);
  });

  it("the printed link uses the app's public address when set", async () => {
    const p = plant();
    await newQr(p.owner);
    process.env.MODULE_URL_ATTENDANCE_SALARY = "https://attendance.example.test";
    try {
      expect(await qrLinkFor(p.owner, "http://localhost:3006")).toMatch(/^https:\/\/attendance\.example\.test\/scan\?k=[\w-]{43}$/);
    } finally {
      delete process.env.MODULE_URL_ATTENDANCE_SALARY;
    }
  });
});
