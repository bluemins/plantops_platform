// Plant answers on real rows (docs/MORNING_REPORT_PHASE_PLAN.md Phase 1): the per-plant switch (D9), who may open it
// (owner; support reads with no Copy and no private cards, D8), plant isolation, and M2 equal to Receivables.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { copyFor, listCards, runCard } from "@/server/answers";
import { readRecParams, receivablesReport } from "@/server/reports";
import { asApp, ocUser, plant, refused } from "./helpers";

const TODAY = "2026-11-24";
const a = plant();
const b = plant();
const off = plant();
const before = process.env.PLANT_ANSWERS_PLANTS;

async function customer(t: string, name: string, phone: string) {
  const r = await asApp(t, `insert into order_capture.customers (tenant_id, name, phone_typed, phone, place, created_by, created_by_name)
    values ('${t}', '${name}', '${phone}', '${phone}', 'Bargarh', gen_random_uuid(), 'Sujata') returning id`);
  return (r.rows[0] as { id: string }).id;
}
let n = 0;
async function bill(t: string, cust: string, name: string, total: number, billDate: string, dueDate: string) {
  n += 1;
  await asApp(t, `insert into order_capture.bills (tenant_id, source, number, ref_no, bill_date, due_date, customer_id, customer_name, sub_total, total, created_by, created_by_name)
    values ('${t}', 'plantops', 'B-${String(n).padStart(4, "0")}', ${n}, '${billDate}', '${dueDate}', '${cust}', '${name}', ${total}, ${total}, gen_random_uuid(), 'Sujata')`);
}

beforeAll(async () => {
  process.env.PLANT_ANSWERS_PLANTS = ` ${a.tenantId.toUpperCase()}, ${b.tenantId} `;
  const sahoo = await customer(a.tenantId, "Sahoo Stores", "9000000001");
  const maa = await customer(a.tenantId, "Maa Tarini", "9000000002");
  await bill(a.tenantId, sahoo, "Sahoo Stores", 1200, "2026-09-01", "2026-09-15"); // 70 days late
  await bill(a.tenantId, maa, "Maa Tarini", 800, "2026-10-01", "2026-10-20"); // 35 days late
  await bill(a.tenantId, maa, "Maa Tarini", 500, "2026-11-10", "2026-11-20"); // 4 days: not counted
  const other = await customer(b.tenantId, "Plant B shop", "9000000003");
  await bill(b.tenantId, other, "Plant B shop", 9999, "2026-08-01", "2026-08-10");
  await customer(off.tenantId, "Off plant shop", "9000000004");
});
afterAll(() => {
  if (before === undefined) delete process.env.PLANT_ANSWERS_PLANTS;
  else process.env.PLANT_ANSWERS_PLANTS = before;
});

describe("switched on per plant (D9)", () => {
  it("a plant not listed gets 404, owner and support alike", async () => {
    expect((await refused(() => listCards(off.owner))).status).toBe(404);
    expect((await refused(() => runCard(off.owner, "M2", TODAY))).status).toBe(404);
    expect((await refused(() => runCard(off.support, "M2", TODAY))).status).toBe(404);
  });
  it("the setting ignores spaces and letter case", () => {
    expect(listCards(a.owner).length).toBe(27);
  });
});

describe("who may open it (D5, D8)", () => {
  it("every other role is refused", async () => {
    const others = [
      a.desk,
      a.staff,
      a.keeper,
      ocUser(a.tenantId, ["accounts"]),
      ocUser(a.tenantId, ["order_desk", "accounts"]),
      ocUser(a.tenantId, ["marketing_staff"]),
      ocUser(a.tenantId, ["delivery_staff"]),
      ocUser(a.tenantId, ["order_viewer"]),
    ];
    for (const u of others) {
      expect((await refused(() => listCards(u))).status).toBe(403);
      expect((await refused(() => runCard(u, "M2", TODAY))).status).toBe(403);
    }
  });
  it("the owner reads and copies", async () => {
    const r = await runCard(a.owner, "M2", TODAY);
    expect(copyFor(a.owner, r)).toContain("Sahoo Stores");
  });
  it("support reads, never copies, and never sees the private cards", async () => {
    const r = await runCard(a.support, "M2", TODAY);
    expect(r.facts.totals.bills).toBe(2);
    expect(copyFor(a.support, r)).toBeNull();
    const ids = listCards(a.support).map((c) => c.id);
    expect(ids).not.toContain("T1");
    expect(ids).not.toContain("J1");
    expect(listCards(a.owner).map((c) => c.id)).toContain("T3");
  });
  it("an unknown or unbuilt card is 404", async () => {
    expect((await refused(() => runCard(a.owner, "Z9", TODAY))).status).toBe(404);
    expect((await refused(() => runCard(a.owner, "M1", TODAY))).status).toBe(404);
    expect((await refused(() => runCard(a.owner, "T1", TODAY))).status).toBe(404);
  });
});

describe("M2 on real bills", () => {
  it("over 30 days only, largest first, phones from the customer list; how it was made", async () => {
    const r = await runCard(a.owner, "M2", TODAY);
    expect(r.facts.rows.map((x) => [x.customer, x.bill_numbers, x.oldest_days, x.due, x.phone])).toEqual([
      ["Sahoo Stores", "B-0001", 70, 1200_00n, "9000000001"],
      ["Maa Tarini", "B-0002", 35, 800_00n, "9000000002"],
    ]);
    expect(r).toMatchObject({ asOf: TODAY, missing: [], preparedBy: { by: "rules", rules: 1, wording: 1 } });
    expect(r.sentence).toBe("2 bills from 2 customers are over 30 days late, ₹2,000 in all. Call Sahoo Stores first: ₹1,200, 70 days late.");
  });
  it("matches Receivables → Aging Summary (31–45 + Over 45) to the paisa", async () => {
    const r = await runCard(a.owner, "M2", TODAY);
    const { table } = await receivablesReport(a.owner, readRecParams("aging", { as_of: "custom", date: TODAY, interval: "15" }, TODAY), TODAY);
    expect((table.total[4] as bigint) + (table.total[5] as bigint)).toBe(r.facts.totals.due);
  });
  it("plant B's owner sees only plant B's bills", async () => {
    const r = await runCard(b.owner, "M2", TODAY);
    expect(r.facts.rows.map((x) => x.customer)).toEqual(["Plant B shop"]);
    expect(JSON.stringify(r.facts, (_, v) => (typeof v === "bigint" ? String(v) : v))).not.toMatch(/Sahoo|Maa Tarini/);
  });
  it("a plant with no bills says so, never an error", async () => {
    const empty = plant();
    process.env.PLANT_ANSWERS_PLANTS += `,${empty.tenantId}`;
    const r = await runCard(empty.owner, "M2", TODAY);
    expect(r.facts.rows).toEqual([]);
    expect(r.missing).toEqual(["No bills in Sales yet."]);
    expect(r.sentence).toMatch(/^No bills are over 30 days late/);
  });
});
