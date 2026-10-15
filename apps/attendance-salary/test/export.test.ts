// The month CSV (src/server/export.ts), the owner's person pages and Recent changes.
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import * as exportRoute from "@/app/api/export/route";
import PersonMonthPage from "@/app/staff/[user]/page";
import { describeChange } from "@/lib/changes";
import { recentChanges } from "@/server/audit";
import { monthCsv } from "@/server/export";
import { addFix, cancelFix, dayStamp } from "@/server/fixes";
import { newQr, saveSettings } from "@/server/settings";
import { startFakePlatform, type FakePlatform } from "./fake-platform";
import { atUser, contactsFor, jsonReq, markAt, plant, refusal, signInAs } from "./helpers";

let platform: FakePlatform;
beforeAll(async () => {
  platform = await startFakePlatform();
  process.env.PLATFORM_URL = platform.url;
});
afterAll(() => platform.close());
afterEach(() => vi.restoreAllMocks());

/** CSV text -> rows of cells (quotes, doubled quotes and empty cells handled). */
function parse(text: string) {
  return text
    .replace(/^\uFEFF/, "")
    .trim()
    .split("\r\n")
    .map((line) => {
      const cells: string[] = [];
      let cur = "";
      let quoted = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i]!;
        if (quoted) {
          if (ch === '"' && line[i + 1] === '"') (cur += '"'), i++;
          else if (ch === '"') quoted = false;
          else cur += ch;
        } else if (ch === '"') quoted = true;
        else if (ch === ",") cells.push(cur), (cur = "");
        else cur += ch;
      }
      cells.push(cur);
      return cells;
    });
}

describe("month CSV", () => {
  it("one row per person per day, with the plan's columns; a night shift on the day it started", async () => {
    const p = plant();
    const anmol = atUser(p.tenantId, ["plant_staff"], "Anmol");
    platform.contacts = [...contactsFor(p.owner, p.worker, anmol)];
    await markAt(p.worker, "in", "2026-09-01 09:00");
    await markAt(p.worker, "out", "2026-09-01 17:40");
    await markAt(p.worker, "in", "2026-09-02 09:10"); // no exit
    await markAt(p.worker, "in", "2026-09-03 09:00");
    await markAt(p.worker, "out", "2026-09-03 18:30", { owner: "forgot to scan" });
    await markAt(p.worker, "in", "2026-09-30 22:00");
    await markAt(p.worker, "out", "2026-10-01 06:00");

    const rows = parse(await monthCsv(p.owner, "2026-09"));
    expect(rows[0]).toEqual(["Name", "Date", "First IN", "Last OUT", "Worked", "Worked minutes", "Blocks", "No exit", "No entry", "Changed"]);
    expect(rows).toHaveLength(1 + 2 * 30); // Anmol (nothing marked) and Ramu, every day of September
    const ramu = (d: string) => rows.find((r) => r[0] === "Ramu" && r[1] === d);
    expect(ramu("2026-09-01")).toEqual(["Ramu", "2026-09-01", "9:00", "17:40", "8h 40m", "520", "1", "", "", ""]);
    expect(ramu("2026-09-02")).toEqual(["Ramu", "2026-09-02", "9:10", "", "", "0", "0", "yes", "", ""]);
    expect(ramu("2026-09-03")).toEqual(["Ramu", "2026-09-03", "9:00", "18:30", "9h 30m", "570", "1", "", "", "yes"]);
    expect(ramu("2026-09-30")).toEqual(["Ramu", "2026-09-30", "22:00", "6:00", "8h 00m", "480", "1", "", "", ""]);
    expect(rows.find((r) => r[0] === "Anmol" && r[1] === "2026-09-15")).toEqual(["Anmol", "2026-09-15", "", "", "", "0", "0", "", "", ""]);
  });

  it("someone who left still appears for a month they worked; a name can't run as a formula", async () => {
    const p = plant();
    const tricky = atUser(p.tenantId, ["plant_staff"], '=HYPERLINK("http://x","y")');
    const gone = atUser(p.tenantId, ["plant_staff"], "Reeta");
    platform.contacts = [...contactsFor(tricky)];
    await markAt(gone, "in", "2026-09-05 09:00");
    await markAt(gone, "out", "2026-09-05 17:00");
    const text = await monthCsv(p.owner, "2026-09");
    expect(text).toContain(`"'=HYPERLINK(""http://x"",""y"")"`);
    expect(parse(text).filter((r) => r[0] === "Reeta")).toHaveLength(30);
  });

  it("owner only (worker and support refused), audited, future month 404, only this plant's people", async () => {
    const a = plant();
    const b = plant();
    platform.contacts = [...contactsFor(a.worker)];
    await markAt(b.worker, "in", "2026-09-05 09:00");
    expect((await refusal(() => monthCsv(a.worker, "2026-09"))).status).toBe(403);
    expect((await refusal(() => monthCsv(a.support, "2026-09"))).status).toBe(403);
    expect((await refusal(() => monthCsv(a.owner, "2099-01"))).status).toBe(404);
    signInAs(a.owner);
    const res = await exportRoute.GET(jsonReq("GET", "/api/export?month=2026-09"), undefined as never);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="attendance-2026-09.csv"');
    const text = await res.text();
    expect(text).not.toContain(b.worker.userId);
    expect(parse(text).map((r) => r[0]).filter((n) => n !== "Name")).toEqual(Array(30).fill("Ramu"));
    expect((await recentChanges(a.owner))[0]!.text).toBe("Downloaded the September 2026 CSV");
  });
});

describe("person pages", () => {
  it("a worker can't open /staff/<anyone> (404); the owner can't open an unknown person (404)", async () => {
    const p = plant();
    platform.contacts = [...contactsFor(p.worker)];
    signInAs(p.worker);
    const open = (id: string) => PersonMonthPage({ params: Promise.resolve({ user: id }), searchParams: Promise.resolve({}) });
    expect((await refusal(() => open(p.ownerWorker.userId))).message).toMatch(/NEXT_HTTP_ERROR_FALLBACK;404|NEXT_NOT_FOUND/);
    vi.restoreAllMocks();
    signInAs(p.owner);
    expect((await refusal(() => open(crypto.randomUUID()))).message).toMatch(/NEXT_HTTP_ERROR_FALLBACK;404|NEXT_NOT_FOUND/);
  });
});

describe("Recent changes", () => {
  it("settings, QR, fixes and downloads in plain words, newest first; owner and support only", async () => {
    const p = plant();
    platform.contacts = [...contactsFor(p.worker)];
    await saveSettings(p.owner, { lat: 21.347, lng: 83.627, radius_m: 200 });
    await saveSettings(p.owner, { lat: 21.347, lng: 83.627, radius_m: 500 });
    await newQr(p.owner);
    const inId = await markAt(p.worker, "in", "2026-09-13 09:05");
    await addFix(p.owner, { user_id: p.worker.userId, day: "2026-09-14", kind: "out", date: "2026-09-14", time: "18:30", reason: "forgot to scan", expect: await dayStamp(p.owner, p.worker.userId, "2026-09-14") });
    await cancelFix(p.owner, { punch_id: inId, day: "2026-09-13", reason: "scanned twice", expect: await dayStamp(p.owner, p.worker.userId, "2026-09-13") });
    const texts = (await recentChanges(p.support)).map((c) => c.text);
    expect(texts).toEqual([
      "Cancelled IN 9:05 on Sun, 13 Sept for Ramu: scanned twice",
      "Added OUT 18:30 on Mon, 14 Sept for Ramu: forgot to scan",
      "New QR made (old prints stopped working)",
      "Circle 200 m → 500 m",
      "Circle set to 200 m",
      "Plant location set",
    ]);
    expect((await refusal(() => recentChanges(p.worker))).status).toBe(403);
    expect(describeChange("something.else", {})).toBe("something.else");
  });
});
