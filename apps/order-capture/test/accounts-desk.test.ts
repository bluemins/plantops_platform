// Accounts desk (owner, 2026-11-23): stage counts, customer dues and who may open it.
import { describe, expect, it } from "vitest";
import { deskCounts, deskDues, deskStageRows, filterDues } from "@/lib/accounts-desk";
import type { FlowRow } from "@/lib/order-flow";
import type { RecBill, RecData } from "@/lib/receivables";
import { can } from "@/server/access";
import { ocUser, plant } from "./helpers";

const TODAY = "2026-11-23";
const flow = (x: Partial<FlowRow>): FlowRow =>
  ({ id: "1", ref: "O-0001", href: "/o/1", stage: "pending", entered: TODAY, delivered: null, customer_name: "Shop", customer_href: "/customers/a", place: "Bargarh", order_total: 100n, bill: null, due: 0n, amount: 100n, days: 0, overdue: false, paid_on: null, salesperson: "", ...x }) as FlowRow;
const party = (k: string) => ({ customer_key: `c:${k}`, customer_name: `Shop ${k}`, href: `/customers/${k}?tab=statement`, place: "Bargarh" });
const bill = (id: string, k: string, total: bigint, bill_date: string, due_date: string | null, salesperson: string | null = null): RecBill =>
  ({ ...party(k), id, number: id, bill_date, due_date, total, salesperson, vehicle: null });

describe("stage counts", () => {
  const rows = [
    flow({ stage: "pending" }),
    flow({ stage: "delivered" }),
    flow({ stage: "billed", overdue: true }),
    flow({ stage: "part", overdue: true }),
    flow({ stage: "billed" }),
    flow({ stage: "paid", paid_on: "2026-11-02" }),
    flow({ stage: "paid", paid_on: "2026-10-31" }),
  ];
  it("counts each stage; overdue overlaps billed and part; paid is this month only", () => {
    expect(deskCounts(rows, TODAY)).toEqual({ pending: 1, delivered: 1, billed: 2, part: 1, paid: 1, overdue: 2 });
  });
  it("searches by customer, place or order number", () => {
    const r = [flow({ stage: "delivered", ref: "O-0007", customer_name: "Asha" }), flow({ stage: "delivered", ref: "O-0008", place: "Sambalpur" })];
    expect(deskStageRows(r, "delivered", TODAY, "o-0007")).toHaveLength(1);
    expect(deskStageRows(r, "delivered", TODAY, "sambal")).toHaveLength(1);
  });
});

describe("customer dues", () => {
  const data: RecData = {
    bills: [
      bill("b1", "a", 10000n, "2026-10-01", "2026-10-15", "Dillip"),
      bill("b2", "a", 5000n, "2026-11-20", "2026-12-01"),
      bill("b3", "b", 20000n, "2026-11-22", "2026-12-10"),
      bill("b4", "c", 3000n, "2026-11-01", null),
    ],
    payments: [
      { ...party("a"), id: "p1", payment_date: "2026-11-05", amount: 4000n },
      { ...party("c"), id: "p2", payment_date: "2026-11-10", amount: 3500n },
    ],
    settles: [
      { bill_id: "b1", payment_id: "p1", amount: 4000n, on: "2026-11-05" },
      { bill_id: "b4", payment_id: "p2", amount: 3000n, on: "2026-11-10" },
    ],
  };
  const rows = deskDues(data, new Map([["a", "9000000001"]]), TODAY);

  it("adds up what is due and overdue; overdue customers first; a settled customer is left out", () => {
    expect(rows.map((r) => [r.key, r.due, r.overdue])).toEqual([
      ["c:a", 11000n, 6000n],
      ["c:b", 20000n, 0n],
    ]);
    expect(rows[0]).toMatchObject({ phone: "9000000001", last_paid: "2026-11-05", oldest_days: 53, href: "/customers/a" });
  });
  it("filters: only overdue, salesperson, phone", () => {
    expect(filterDues(rows, { overdue: true }).map((r) => r.key)).toEqual(["c:a"]);
    expect(filterDues(rows, { salesperson: "dillip" }).map((r) => r.key)).toEqual(["c:a"]);
    expect(filterDues(rows, { q: "90000 00001" }).map((r) => r.key)).toEqual(["c:a"]);
  });
  it("shows an advance held by a customer who still owes", () => {
    const d: RecData = { bills: [bill("x", "z", 1000n, "2026-11-01", null)], payments: [{ ...party("z"), id: "p", payment_date: "2026-11-02", amount: 500n }], settles: [] };
    expect(deskDues(d, new Map(), TODAY)[0]).toMatchObject({ due: 1000n, advance: 500n });
  });
});

describe("who may open it", () => {
  const p = plant();
  it("owner, Accounts and support only", () => {
    expect([p.owner, ocUser(p.owner.tenantId, ["accounts"]), p.support].every((u) => can(u, "accounts_desk"))).toBe(true);
    expect([p.desk, p.staff, p.keeper, ocUser(p.owner.tenantId, ["marketing_staff"]), ocUser(p.owner.tenantId, ["delivery_staff"]), ocUser(p.owner.tenantId, ["order_viewer"])].some((u) => can(u, "accounts_desk"))).toBe(false);
  });
});
