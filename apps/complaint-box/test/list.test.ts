// Phase 5: the complaint list. Newest first, the default hides resolved ones, every filter and search, plant
// isolation (even when searching another plant's exact name / phone / reference), days open and amber, the
// tap-to-call link, and item counts from real complaints.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { phoneDisplay, telLink } from "@/lib/phone";
import { ComplaintInput, createComplaint } from "@/server/complaints";
import { changeStatus } from "@/server/followup";
import { daysOpen, listComplaints } from "@/server/inbox";
import { createItem, listItems } from "@/server/items";
import { startFakePlatform, type FakePlatform } from "./fake-platform";
import { asOwner, plant, refused } from "./helpers";

let platform: FakePlatform;
beforeAll(async () => {
  platform = await startFakePlatform();
  process.env.PLATFORM_URL = platform.url;
});
afterAll(() => platform.close());

const DAY = 24 * 60 * 60 * 1000;
type P = ReturnType<typeof plant>;
const log = async (p: P, itemId: string, over: Partial<Record<string, string>> = {}) =>
  createComplaint(p.desk, ComplaintInput.parse({ customer_name: "Ramesh", phone: "9876543210", place: "Kalinga Nagar", description: "Jar leaking from the cap", item_id: itemId, ...over }));
const refs = (rows: { ref: string }[]) => rows.map((r) => r.ref);

describe("the list", () => {
  let p: P;
  let jar: string;
  let tap: string;
  beforeAll(async () => {
    p = plant();
    jar = (await createItem(p.owner, { name: "20 L jar" })).id;
    tap = (await createItem(p.owner, { name: "Dispenser tap" })).id;
    await log(p, jar, { customer_name: "Ramesh Sahu", phone: "+91 98765 43210", place: "Kalinga Nagar" }); // C-0001
    const c2 = await log(p, tap, { customer_name: "Sita Das", phone: "7000012345", place: "Patia" }); // C-0002
    const c3 = await log(p, jar, { customer_name: "50%_off Store", phone: "6000098765", place: "Saheed Nagar" }); // C-0003
    await changeStatus(p.owner, c2.id, { to: "in_progress", expected: "open" });
    await changeStatus(p.owner, c3.id, { to: "resolved", expected: "open", text: "Replaced" });
  });

  it("newest first; by default only Open and In progress", async () => {
    expect(refs(await listComplaints(p.desk))).toEqual(["C-0002", "C-0001"]);
    expect(refs(await listComplaints(p.desk, { status: "all" }))).toEqual(["C-0003", "C-0002", "C-0001"]);
  });

  it("filters by status, item and date (India dates)", async () => {
    expect(refs(await listComplaints(p.desk, { status: "resolved" }))).toEqual(["C-0003"]);
    expect(refs(await listComplaints(p.desk, { status: "in_progress" }))).toEqual(["C-0002"]);
    expect(refs(await listComplaints(p.desk, { status: "open" }))).toEqual(["C-0001"]);
    expect(refs(await listComplaints(p.desk, { status: "all", item: jar }))).toEqual(["C-0003", "C-0001"]);
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
    const tomorrow = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date(Date.now() + DAY));
    expect(refs(await listComplaints(p.desk, { status: "all", from: today, to: today }))).toHaveLength(3);
    expect(await listComplaints(p.desk, { status: "all", from: tomorrow })).toEqual([]);
    expect(await listComplaints(p.desk, { status: "all", to: "2020-01-01" })).toEqual([]);
    expect(refs(await listComplaints(p.desk, { status: "all", from: "not-a-date", item: "nonsense" }))).toHaveLength(3); // ignored
  });

  it.each([
    ["C-0002", ["C-0002"]],
    ["c2", ["C-0002"]],
    ["0001", ["C-0002", "C-0001"]], // reference C-0001, and C-0002's mobile 7000012345 contains 0001
    ["sita", ["C-0002"]],
    ["SAHU", ["C-0001"]],
    ["98765", ["C-0003", "C-0001"]], // digits anywhere in the number
    ["+91 98765 43210", ["C-0001"]],
    ["patia", ["C-0002"]],
    ["nagar", ["C-0003", "C-0001"]],
    ["50%", ["C-0003"]],
    ["%", ["C-0003"]], // taken literally, not "anything"
    ["_", ["C-0003"]],
    ["nobody", []],
  ])("search %j", async (q, want) => {
    expect(refs(await listComplaints(p.desk, { status: "all", q }))).toEqual(want);
  });

  it("support can read the list; a store keeper can't", async () => {
    expect(refs(await listComplaints(p.support, { status: "all" }))).toHaveLength(3);
    expect((await refused(() => listComplaints(p.keeper))).status).toBe(403);
  });
});

describe("plant isolation", () => {
  it("another plant's complaints never appear, even when searching their exact name, phone or reference", async () => {
    const a = plant();
    const b = plant();
    await log(a, (await createItem(a.owner, { name: "Jar" })).id, { customer_name: "Unique Customer", phone: "8888812345", place: "Secret place" });
    expect(await listComplaints(b.owner, { status: "all" })).toEqual([]);
    for (const q of ["Unique Customer", "8888812345", "C-0001", "Secret"]) expect(await listComplaints(b.owner, { status: "all", q }), q).toEqual([]);
    expect(refs(await listComplaints(a.owner, { status: "all", q: "8888812345" }))).toEqual(["C-0001"]);
  });
});

describe("days open and amber", () => {
  it("counts from logging, or from the last reopening; amber after 3 days; resolved shows no days", async () => {
    const now = Date.now();
    expect(daysOpen("open", new Date(now - 2 * DAY), now)).toEqual({ days_open: 2, amber: false });
    expect(daysOpen("in_progress", new Date(now - 3 * DAY - 1000), now)).toEqual({ days_open: 3, amber: false });
    expect(daysOpen("open", new Date(now - 4 * DAY), now)).toEqual({ days_open: 4, amber: true });
    expect(daysOpen("resolved", new Date(now - 9 * DAY), now)).toEqual({ days_open: null, amber: false });
  });

  it("a complaint logged 5 days ago is amber; reopened today it starts again at 0", async () => {
    const p = plant();
    const c = await log(p, (await createItem(p.owner, { name: "Jar" })).id);
    await asOwner("update complaint_box.complaints set created_at = now() - interval '5 days' where id = $1", [c.id]);
    expect((await listComplaints(p.owner))[0]).toMatchObject({ days_open: 5, amber: true });
    await changeStatus(p.owner, c.id, { to: "resolved", expected: "open", text: "Replaced" });
    expect((await listComplaints(p.owner, { status: "all" }))[0]).toMatchObject({ days_open: null, amber: false });
    await changeStatus(p.owner, c.id, { to: "open", expected: "resolved", text: "Customer called again" });
    expect((await listComplaints(p.owner))[0]).toMatchObject({ days_open: 0, amber: false });
  });
});

describe("tap to call", () => {
  it("tel:+91 and the normalised number; plain text in the support view", () => {
    expect(telLink("9876543210")).toBe("tel:+919876543210");
    expect(phoneDisplay("9876543210")).toEqual({ text: "98765 43210", href: "tel:+919876543210" });
    expect(phoneDisplay("9876543210", true)).toEqual({ text: "98765 43210", href: null });
  });
});

describe("item counts", () => {
  it("come from real saved complaints, only this plant's", async () => {
    const a = plant();
    const b = plant();
    const jar = await createItem(a.owner, { name: "Jar" });
    await createItem(a.owner, { name: "Tap" });
    const theirJar = await createItem(b.owner, { name: "Jar" });
    await log(a, jar.id);
    await log(a, jar.id);
    await log(b, theirJar.id);
    expect((await listItems(a.owner)).map((i) => [i.name, i.complaint_count])).toEqual([
      ["Jar", 2],
      ["Tap", 0],
    ]);
  });
});
