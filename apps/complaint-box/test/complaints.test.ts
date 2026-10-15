// Phase 4: logging a complaint. Every field rule, the Indian-mobile rule, items of the right plant only, plant and
// reporter from the session (never the browser), references per plant that stay unique when phones save together.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { formatRef, normalisePhone } from "@/lib/phone";
import { ComplaintInput, createComplaint } from "@/server/complaints";
import { createItem, updateItem } from "@/server/items";
import { kit } from "@/server/kit";
import { startFakePlatform, type FakePlatform } from "./fake-platform";
import { asOwner, plant, refused } from "./helpers";

// next/server's after() only works inside a real request; here it just runs (the notification itself is tested in notify.test.ts)
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: (fn: () => unknown) => void Promise.resolve().then(fn) }));
const { POST: postComplaint } = await import("@/app/api/complaints/route");

let platform: FakePlatform;
beforeAll(async () => {
  platform = await startFakePlatform();
  process.env.PLATFORM_URL = platform.url;
});
afterAll(() => platform.close());

const good = { customer_name: "Ramesh", phone: "+91 98765 43210", place: "Kalinga Nagar", batch_text: "B-12 / 08 Oct", description: "Jar leaking from the cap" };
const withItem = async (p: ReturnType<typeof plant>, name = "20 L jar") => (await createItem(p.owner, { name })).id;
const row = async (id: string) =>
  (await asOwner("select tenant_id, ref_no, customer_name, phone, phone_typed, place, item_name, batch_text, description, reported_by, reported_by_name, status from complaint_box.complaints where id = $1", [id])).rows[0];

describe("the customer's mobile number", () => {
  it.each([
    ["9876543210", "9876543210"],
    ["+91 98765 43210", "9876543210"],
    ["+91-98765-43210", "9876543210"],
    ["919876543210", "9876543210"],
    ["09876543210", "9876543210"],
    ["98765.43210", "9876543210"],
    ["(+91) 6000012345", "6000012345"],
    [" 7000012345 ", "7000012345"],
  ])("%j -> %s", (typed, want) => {
    expect(normalisePhone(typed)).toBe(want);
  });

  it.each(["5876543210", "987654321", "98765432101", "+1 9876543210", "+91 5876543210", "9876abc210", "", "0091 9876543210", "91987654321"])("%j is refused", (typed) => {
    expect(normalisePhone(typed)).toBeNull();
  });

  it("a bad number is refused on save with a plain message", async () => {
    const p = plant();
    expect(await refused(async () => createComplaint(p.desk, ComplaintInput.parse({ ...good, phone: "12345", item_id: await withItem(p) })))).toEqual({
      status: 400,
      message: "Please enter the customer's 10-digit mobile number",
    });
  });

  it("references look like C-0001", () => {
    expect([formatRef(1), formatRef(42), formatRef(9999), formatRef(10000)]).toEqual(["C-0001", "C-0042", "C-9999", "C-10000"]);
  });
});

describe("every field rule", () => {
  const item_id = randomUUID();
  const ok = (over: Record<string, unknown>) => ComplaintInput.safeParse({ ...good, item_id, ...over }).success;

  it.each([
    ["name of 1 character", { customer_name: " R " }, false],
    ["name of 2", { customer_name: "Ra" }, true],
    ["name of 101", { customer_name: "x".repeat(101) }, false],
    ["no phone", { phone: "  " }, false],
    ["phone of 31 characters", { phone: "9".repeat(31) }, false],
    ["place of 1", { place: "X" }, false],
    ["place of 201", { place: "x".repeat(201) }, false],
    ["no item", { item_id: "" }, false],
    ["batch of 61", { batch_text: "x".repeat(61) }, false],
    ["no batch", { batch_text: undefined }, true],
    ["description of 9", { description: "Leaking!!" }, false],
    ["description of 10", { description: "Leaking!!!" }, true],
    ["description of 2001", { description: "x".repeat(2001) }, false],
  ])("%s -> %s", (_, over, expected) => {
    expect(ok(over)).toBe(expected);
  });

  it("an empty batch is saved as none; text is trimmed; the typed and normalised phone are both kept", async () => {
    const p = plant();
    const { id } = await createComplaint(p.desk, ComplaintInput.parse({ ...good, customer_name: "  Ramesh  ", batch_text: "  ", item_id: await withItem(p) }));
    expect(await row(id)).toMatchObject({ customer_name: "Ramesh", batch_text: null, phone: "9876543210", phone_typed: "+91 98765 43210", status: "open" });
  });
});

describe("the item", () => {
  it("must be an active item of the same plant; its name is copied into the complaint", async () => {
    const p = plant();
    const jar = await withItem(p);
    const old = await withItem(p, "Old cap");
    await updateItem(p.owner, old, { status: "off" });
    const theirs = await withItem(plant());
    expect((await refused(() => createComplaint(p.desk, ComplaintInput.parse({ ...good, item_id: old })))).status).toBe(400);
    expect(await refused(() => createComplaint(p.desk, ComplaintInput.parse({ ...good, item_id: theirs })))).toEqual({ status: 400, message: "Please choose an item from the list" });
    expect((await refused(() => createComplaint(p.desk, ComplaintInput.parse({ ...good, item_id: randomUUID() })))).status).toBe(400);
    const { id } = await createComplaint(p.desk, ComplaintInput.parse({ ...good, item_id: jar }));
    await updateItem(p.owner, jar, { name: "20 L jar (blue cap)" });
    expect((await row(id))!.item_name).toBe("20 L jar");
  });
});

describe("who may log a complaint", () => {
  it("owner and complaint desk; never plant staff alone, support or a store keeper", async () => {
    const p = plant();
    const item_id = await withItem(p);
    const input = ComplaintInput.parse({ ...good, item_id });
    for (const u of [p.owner, p.desk, p.staff]) expect((await createComplaint(u, input)).ref).toMatch(/^C-\d{4}$/);
    expect(await refused(() => createComplaint(p.support, input))).toEqual({ status: 403, message: "PlantOps support view is read-only" });
    expect((await refused(() => createComplaint(p.keeper, input))).status).toBe(403);
    expect((await refused(() => createComplaint(p.general, input))).status).toBe(403);
  });
});

describe("references", () => {
  it("five phones saving at once get C-0001 to C-0005; another plant starts at C-0001", async () => {
    const p = plant();
    const input = ComplaintInput.parse({ ...good, item_id: await withItem(p) });
    const refs = await Promise.all([p.desk, p.staff, p.owner, p.desk, p.staff].map((u) => createComplaint(u, input)));
    expect(refs.map((r) => r.ref).sort()).toEqual(["C-0001", "C-0002", "C-0003", "C-0004", "C-0005"]);
    const q = plant();
    expect((await createComplaint(q.desk, ComplaintInput.parse({ ...good, item_id: await withItem(q) }))).ref).toBe("C-0001");
  });
});

describe("POST /api/complaints", () => {
  it("plant, reporter, reference and status come from the session and the database, never the browser", async () => {
    const p = plant();
    const item_id = await withItem(p);
    const otherPlant = randomUUID();
    const spy = vi.spyOn(kit, "currentSession");
    try {
      spy.mockResolvedValue({ kind: "user", session: { tenant_id: p.tenantId, user_id: p.desk.userId, display_name: "Atharv", roles: ["complaint_desk"], enabled_modules: ["complaint_box"], login_at: Date.now(), checked_at: Date.now() } } as never);
      const body = { ...good, item_id, tenant_id: otherPlant, reported_by: randomUUID(), reported_by_name: "Someone else", ref_no: 999, status: "resolved", created_at: "2020-01-01" };
      const res = await postComplaint(new Request("http://localhost:3004/api/complaints", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), undefined as never);
      expect(res.status).toBe(201);
      const { id, ref } = (await res.json()) as { id: string; ref: string };
      expect(ref).toBe("C-0001");
      expect(await row(id)).toMatchObject({ tenant_id: p.tenantId, ref_no: 1, reported_by: p.desk.userId, reported_by_name: "Atharv", status: "open" });
      expect((await asOwner("select count(*)::int as n from complaint_box.complaints where tenant_id = $1", [otherPlant])).rows[0]).toEqual({ n: 0 });
      // a form post (not JSON) is refused - another website can't submit for a logged-in user
      const form = await postComplaint(new Request("http://localhost:3004/api/complaints", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "customer_name=x" }), undefined as never);
      expect(form.status).toBe(415);
    } finally {
      spy.mockRestore();
    }
  });
});
