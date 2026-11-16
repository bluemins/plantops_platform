// Sales' Day report asks Complaint Box for one day (owner 2026-11-16): only with a platform lookup ticket for scope
// day_report; logged that day, open now with days open (over 3 days needs the owner); no phone numbers; another plant's
// complaints never mix in.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GET } from "@/app/api/plantops/day-report/route";
import { ComplaintInput, createComplaint } from "@/server/complaints";
import { complaintDayReport } from "@/server/day-report";
import { createItem } from "@/server/items";
import { startFakePlatform, type FakePlatform } from "./fake-platform";
import { asOwner, plant } from "./helpers";

let platform: FakePlatform;
beforeAll(async () => {
  platform = await startFakePlatform();
  process.env.PLATFORM_URL = platform.url;
});
afterAll(() => platform.close());

const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
const fields = { customer_name: "Ramesh", phone: "9876543210", place: "Kalinga Nagar", description: "Jar leaking from the cap" };
const ticket = (tenantId: string, scope = "day_report") => platform.sign({ purpose: "lookup", tenant_id: tenantId, from: "order_capture", scope }, "complaint_box", "60s");
const ask = async (date: string, token: string | null) => {
  const res = await GET(new Request(`http://localhost:3004/api/plantops/day-report?date=${date}`, { headers: token ? { authorization: `Bearer ${token}` } : {} }));
  return { status: res.status, body: await res.json() };
};

describe("Complaint Box's part of the Day report", () => {
  it("refused without a ticket or with another scope; a future date is 400", async () => {
    const p = plant();
    expect((await ask(today, null)).status).toBe(401);
    expect((await ask(today, await ticket(p.tenantId, "customers"))).status).toBe(401);
    expect((await ask("2999-01-01", await ticket(p.tenantId))).status).toBe(400);
  });

  it("logged today, open now with days open, the old one needs the owner; no phone numbers; only this plant", async () => {
    const p = plant();
    const item_id = (await createItem(p.owner, { name: "20 L jar" })).id;
    await createComplaint(p.desk, ComplaintInput.parse({ ...fields, item_id }));
    const old = await createComplaint(p.desk, ComplaintInput.parse({ ...fields, item_id, place: "Sason" }));
    await asOwner(`update complaint_box.complaints set created_at = now() - interval '5 days' where id = $1`, [old.id]);
    const other = plant();
    const otherItem = (await createItem(other.owner, { name: "Jar" })).id;
    await createComplaint(other.desk, ComplaintInput.parse({ ...fields, item_id: otherItem }));

    const r = await ask(today, await ticket(p.tenantId));
    expect(r.status).toBe(200);
    expect(r.body.summary).toBe("1 new · 2 open");
    expect(r.body.tone).toBe("warn");
    expect(r.body.rows).toContainEqual({ label: "Logged that day", value: "1" });
    expect(r.body.rows[3]).toMatchObject({ value: "20 L jar · Sason · 5 days open", tone: "warn" });
    expect(r.body.attention).toEqual([expect.stringMatching(/^1 complaint open over 3 days \(oldest C-\d{4}, 5 days\)$/)]);
    expect(JSON.stringify(r.body)).not.toContain("9876543210");
    expect((await complaintDayReport(other.tenantId, today, new Date())).summary).toBe("1 new · 1 open");
  });
});
