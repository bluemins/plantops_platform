// Phase 7: the launcher tile numbers. "N open" (info) / "No open complaints" (ok), "N open over 3 days" (warn),
// "N new today" (ok); "Item list not set up yet" before anything else; only this plant's complaints.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ComplaintInput, createComplaint } from "@/server/complaints";
import { changeStatus } from "@/server/followup";
import { createItem } from "@/server/items";
import { summaryFor } from "@/server/summary";
import { startFakePlatform, type FakePlatform } from "./fake-platform";
import { asOwner, plant } from "./helpers";

let platform: FakePlatform;
beforeAll(async () => {
  platform = await startFakePlatform();
  process.env.PLATFORM_URL = platform.url;
});
afterAll(() => platform.close());

const fields = { customer_name: "Ramesh", phone: "9876543210", place: "Kalinga Nagar", description: "Jar leaking from the cap" };
const backdate = (id: string, days: number) => asOwner(`update complaint_box.complaints set created_at = now() - interval '${days} days' where id = $1`, [id]);

describe("tile numbers", () => {
  it("before the item list exists: one warning", async () => {
    expect(await summaryFor(plant().tenantId, "owner")).toEqual({ badges: [{ text: "Item list not set up yet", tone: "warn" }] });
  });

  it("items but no complaints: 'No open complaints'", async () => {
    const p = plant();
    await createItem(p.owner, { name: "Jar" });
    expect(await summaryFor(p.tenantId, "staff")).toEqual({ badges: [{ text: "No open complaints", tone: "ok" }] });
  });

  it("a mixed plant: open (+ in progress), open over 3 days, new today; resolved and other plants not counted", async () => {
    const p = plant();
    const item_id = (await createItem(p.owner, { name: "Jar" })).id;
    const log = () => createComplaint(p.desk, ComplaintInput.parse({ ...fields, item_id }));
    const old = await log(); // open, 5 days
    const older = await log(); // in progress, 4 days
    const done = await log(); // resolved, 9 days
    await log(); // open, today
    const three = await log(); // open, 3 days: not "over 3 days" yet (same as the amber cards)
    await backdate(old.id, 5);
    await backdate(older.id, 4);
    await backdate(done.id, 9);
    await backdate(three.id, 3);
    await changeStatus(p.owner, older.id, { to: "in_progress", expected: "open" });
    await changeStatus(p.owner, done.id, { to: "resolved", expected: "open", text: "Replaced" });
    const other = plant();
    const theirs = await createComplaint(other.desk, ComplaintInput.parse({ ...fields, item_id: (await createItem(other.owner, { name: "Jar" })).id }));
    await backdate(theirs.id, 8);

    const s = await summaryFor(p.tenantId, "owner");
    expect(s).toEqual({
      badges: [
        { text: "4 open", tone: "info" },
        { text: "2 open over 3 days", tone: "warn" },
        { text: "1 new today", tone: "ok" },
      ],
    });
    expect(s.badges.length).toBeLessThanOrEqual(3);
    for (const b of s.badges) expect(b.text.length).toBeLessThanOrEqual(40);
    expect(await summaryFor(p.tenantId, "staff")).toEqual(s); // the same for staff
  });

  it("a reopened complaint counts its days from the reopening", async () => {
    const p = plant();
    const c = await createComplaint(p.desk, ComplaintInput.parse({ ...fields, item_id: (await createItem(p.owner, { name: "Jar" })).id }));
    await backdate(c.id, 10);
    expect((await summaryFor(p.tenantId, "owner")).badges.map((b) => b.text)).toEqual(["1 open", "1 open over 3 days"]);
    await changeStatus(p.owner, c.id, { to: "resolved", expected: "open", text: "Replaced" });
    await changeStatus(p.owner, c.id, { to: "open", expected: "resolved", text: "Called again" });
    expect((await summaryFor(p.tenantId, "owner")).badges.map((b) => b.text)).toEqual(["1 open"]);
  });
});
