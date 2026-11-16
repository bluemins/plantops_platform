// Sales' Day report asks Floor Stock for one day's count (owner 2026-11-16): only with a platform lookup ticket for scope
// day_report; a date up to today; made, sold, low and "check the count" as the day page works them out; another plant's
// count never mixes in.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GET } from "@/app/api/plantops/day-report/route";
import { addDays } from "@/lib/days";
import { submitCount } from "@/server/counts";
import { stockDayReport } from "@/server/day-report";
import { startFakePlatform, type FakePlatform } from "./fake-platform";
import { at, fullCount, stockPlant, TODAY } from "./stock-plant";

let platform: FakePlatform;
beforeAll(async () => {
  platform = await startFakePlatform();
  process.env.PLATFORM_URL = platform.url;
});
afterAll(() => platform.close());

const ticket = (tenantId: string, scope = "day_report", aud: "floor_stock" | "order_capture" = "floor_stock") =>
  platform.sign({ purpose: "lookup", tenant_id: tenantId, from: "order_capture", scope }, aud, "60s");
const ask = async (date: string, token: string | null) => {
  const res = await GET(new Request(`http://localhost:3002/api/plantops/day-report?date=${date}`, { headers: token ? { authorization: `Bearer ${token}` } : {} }));
  return { status: res.status, body: await res.json() };
};

describe("Floor Stock's part of the Day report", () => {
  it("refused without a lookup ticket, with another scope or for another module; a future date is 400", async () => {
    const p = await stockPlant();
    expect((await ask("2026-10-08", null)).status).toBe(401);
    expect((await ask("2026-10-08", await ticket(p.tenantId, "salary_totals"))).status).toBe(401);
    expect((await ask("2026-10-08", await ticket(p.tenantId, "day_report", "order_capture"))).status).toBe(401);
    expect((await ask("2999-01-01", await ticket(p.tenantId))).status).toBe(400);
    expect((await ask("8 Oct", await ticket(p.tenantId))).status).toBe(400);
    const ok = await ask("2026-10-08", await ticket(p.tenantId));
    expect(ok.status).toBe(200);
    expect(ok.body).toEqual({ summary: "No count that day", tone: "warn", rows: [], attention: ["No stock count that day"] });
  });

  it("a counted day: when and by whom, made, sold, low and what needs the owner", async () => {
    const p = await stockPlant();
    await submitCount(p.keeper, fullCount(p, addDays(TODAY, -1), { made: 0, box: 20, label: 5, roll: 2 }), at(addDays(TODAY, -1)));
    await submitCount(p.keeper, fullCount(p, TODAY, { made: 120, box: 5, label: 1, roll: 1 }), new Date(`${TODAY}T18:40:00+05:30`));
    const r = await stockDayReport(p.tenantId, TODAY, at(TODAY));
    expect(r.summary).toMatch(/^Counted \d{1,2}:\d{2} [ap]m · 1 low$/); // the database's own time of the save
    expect(r.tone).toBe("bad");
    expect(r.rows[0]!.label).toBe("Counted");
    expect(r.rows.find((x) => x.label === "Made")!.value).toBe("120 box");
    expect(r.rows.find((x) => x.label === "Sold (worked out)")!.value).toBe("135 box");
    expect(r.rows.find((x) => x.label === "Low")!.tone).toBe("bad");
    expect(r.attention[0]).toMatch(/^1 stock item low: /);
    // another plant has no count that day (and it's still that day)
    const other = await stockPlant();
    expect((await stockDayReport(other.tenantId, TODAY, at(TODAY))).summary).toBe("Count not done yet");
  });

  it("today before the count: 'not done yet'", async () => {
    const p = await stockPlant();
    expect(await stockDayReport(p.tenantId, TODAY, at(TODAY))).toMatchObject({ summary: "Count not done yet", attention: ["Today's stock count is not done"] });
  });
});
