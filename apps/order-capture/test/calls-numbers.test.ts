// Phone calls Phase 4 (docs/CALLS_PHASE_PLAN.md "Owner's numbers", mock-up screen 5): the worked day (12 calls, 5 missed,
// 8 numbers, 7 attended, 1 waiting, 2 new; Raju 5, Anmol 2), the definitions, periods at India midnight, numbers on
// "Not an order number" left out, tenant isolation, who may see it, and the support view's log line.
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { callsNumbers, periodFor } from "@/server/calls-numbers";
import { attendCall, AttendInput, dayStart, istDay, setIgnored } from "@/server/calls-tab";
import { recordCall, type CallKey } from "@/server/calls";
import { describeView } from "@/server/support";
import { asApp, ocUser, plant, refused } from "./helpers";

const today = istDay(new Date());
const todayStart = dayStart(today).getTime();
const minute = (m: number) => new Date(todayStart + m * 60_000); // minutes after India midnight today

function phonePlant() {
  const p = plant();
  const key: CallKey = { id: randomUUID(), tenant_id: p.tenantId, sha256: "0".repeat(64), label: "Order phone" };
  const ring = (phone: string, event: "incoming" | "missed", when: Date) => recordCall(key, { phone, event }, when);
  return { ...p, key, ring, raju: ocUser(p.tenantId, ["delivery_staff"], "Raju"), anmol: ocUser(p.tenantId, ["delivery_staff"], "Anmol") };
}
const customer = (tenantId: string, phone: string, name: string, place: string) =>
  asApp(tenantId, `insert into order_capture.customers (tenant_id, name, phone_typed, phone, place, created_by, created_by_name) values ('${tenantId}', '${name}', '${phone}', '${phone}', '${place}', gen_random_uuid(), 'Atharv')`);

const A = "9861023456"; // Ramesh, rang 3 times (2 missed)
const B = "9861011111"; // Gita, 2 (1 missed)
const C = "9861022222"; // 2
const E = "7008144562"; // missed, wrong number
const F = "9123456780"; // waiting
const G = "9000000011"; // new customer
const H = "9000000012"; // new customer

describe("the mock-up's worked day", () => {
  it("12 calls, 5 missed, 8 numbers, 7 attended, 1 waiting, 2 new; Rang most; Attended by Raju 5 / Anmol 2", async () => {
    const p = phonePlant();
    await customer(p.tenantId, A, "Ramesh Sahoo", "Kuakhia");
    await customer(p.tenantId, B, "Gita Mohanty", "Jajpur Road");
    await customer(p.tenantId, C, "Sanjay Das", "Badachana");
    const landline = "01123456789"; // a landline, missed, attended without a customer
    // A: two missed (incoming + missed joined) and one answered
    await p.ring(A, "incoming", minute(10));
    await p.ring(A, "missed", minute(10.5));
    await p.ring(A, "incoming", minute(13));
    await p.ring(A, "missed", minute(13.5));
    await p.ring(A, "incoming", minute(16));
    await p.ring(B, "missed", minute(11)); // lone missed
    await p.ring(B, "incoming", minute(20));
    await p.ring(C, "incoming", minute(12));
    await p.ring(C, "incoming", minute(25));
    await p.ring(landline, "incoming", minute(14));
    await p.ring(landline, "missed", minute(14.5));
    await p.ring(E, "missed", minute(15));
    await p.ring(F, "incoming", minute(17));
    await p.ring(G, "incoming", minute(18));
    await p.ring(H, "incoming", minute(19));

    for (const phone of [A, B, C]) await attendCall(p.raju, { phone });
    await attendCall(p.raju, AttendInput.parse({ phone: G, name: "Pradeep Nayak", place: "Dharmasala" }));
    await attendCall(p.raju, AttendInput.parse({ phone: H, name: "Mamata Rout", place: "Kuakhia" }));
    await attendCall(p.anmol, { phone: landline });
    await attendCall(p.anmol, { phone: E, wrong_number: true });

    const n = await callsNumbers(p.owner, periodFor({}));
    expect(n.totals).toEqual({ calls: 12, missed: 5, numbers: 8, attended: 7, waiting: 1, new: 2 });
    expect(n.days).toEqual([{ day: today, calls: 12, missed: 5, numbers: 8, attended: 7, new: 2 }]);
    expect(n.rang_most.slice(0, 3)).toEqual([
      { name: "Ramesh Sahoo · Kuakhia", calls: 3 },
      { name: "Sanjay Das · Badachana", calls: 2 },
      { name: "Gita Mohanty · Jajpur Road", calls: 2 },
    ]);
    expect(n.rang_most).toHaveLength(8);
    expect(n.attended_by).toEqual([
      { name: "Raju", numbers: 5 },
      { name: "Anmol", numbers: 2 },
    ]);
  });
});

describe("definitions", () => {
  it("a ring after Attended makes the number waiting again", async () => {
    const p = phonePlant();
    await p.ring(F, "incoming", minute(1));
    await attendCall(p.raju, AttendInput.parse({ phone: F, wrong_number: true }));
    await p.ring(F, "incoming", minute(5));
    const n = await callsNumbers(p.owner, periodFor({}));
    expect(n.totals).toMatchObject({ calls: 2, numbers: 1, attended: 0, waiting: 1 });
  });

  it("a number attended the next morning counts attended for the day it rang", async () => {
    const p = phonePlant();
    const yesterday = istDay(new Date(todayStart - 12 * 3600_000));
    await p.ring(F, "incoming", new Date(todayStart - 60 * 60_000)); // 23:00 yesterday
    await attendCall(p.raju, AttendInput.parse({ phone: F, wrong_number: true })); // attended now (today)
    const n = await callsNumbers(p.owner, periodFor({ from: yesterday, to: today }));
    expect(n.days.find((d) => d.day === yesterday)).toMatchObject({ calls: 1, numbers: 1, attended: 1 });
    expect(n.totals).toMatchObject({ numbers: 1, attended: 1, waiting: 0 });
    expect(n.attended_by).toEqual([{ name: "Raju", numbers: 1 }]);
  });

  it("India midnight: 23:59 IST belongs to yesterday, 00:01 IST to today", async () => {
    const p = phonePlant();
    await p.ring(F, "incoming", new Date(todayStart - 60_000));
    await p.ring(G, "incoming", new Date(todayStart + 60_000));
    expect((await callsNumbers(p.owner, periodFor({}))).totals.calls).toBe(1);
    const yesterday = istDay(new Date(todayStart - 1));
    expect((await callsNumbers(p.owner, periodFor({ from: yesterday, to: yesterday }))).totals.calls).toBe(1);
  });

  it("numbers on Not an order number are left out; plant B sees none of A's numbers", async () => {
    const p = phonePlant();
    await p.ring(F, "incoming", minute(1));
    await p.ring(G, "incoming", minute(2));
    await setIgnored(p.owner, { action: "add", phone: G, label: "Brother" });
    expect((await callsNumbers(p.owner, periodFor({}))).totals).toMatchObject({ calls: 1, numbers: 1 });
    const b = plant();
    expect((await callsNumbers(b.owner, periodFor({}))).totals).toEqual({ calls: 0, missed: 0, numbers: 0, attended: 0, waiting: 0, new: 0 });
  });
});

describe("periods", () => {
  const at = new Date("2026-11-05T06:30:00Z"); // Thursday 5 Nov, 12:00 IST
  it("today, this week from Monday, this month, picked dates", () => {
    expect(periodFor({}, at)).toEqual({ key: "today", from: "2026-11-05", to: "2026-11-05" });
    expect(periodFor({ p: "week" }, at)).toEqual({ key: "week", from: "2026-11-02", to: "2026-11-05" });
    expect(periodFor({ p: "week" }, new Date("2026-11-08T06:30:00Z"))).toEqual({ key: "week", from: "2026-11-02", to: "2026-11-08" }); // Sunday
    expect(periodFor({ p: "month" }, at)).toEqual({ key: "month", from: "2026-11-01", to: "2026-11-05" });
    expect(periodFor({ from: "2026-10-01", to: "2026-10-31" }, at)).toEqual({ key: "dates", from: "2026-10-01", to: "2026-10-31" });
  });

  it("a wrong, reversed, future or longer-than-92-days range falls back to today", () => {
    for (const q of [{ from: "x", to: "2026-11-01" }, { from: "2026-11-03", to: "2026-11-01" }, { from: "2026-11-01", to: "2026-11-09" }, { from: "2026-01-01", to: "2026-11-01" }])
      expect(periodFor(q, at).key).toBe("today");
  });
});

describe("who sees it", () => {
  it("owner and support; Order desk and Delivery staff refused; support views are logged as Calls numbers", async () => {
    const p = phonePlant();
    expect((await callsNumbers(p.support, periodFor({}))).totals.calls).toBe(0);
    for (const u of [p.desk, p.raju, p.staff]) expect((await refused(() => callsNumbers(u, periodFor({})))).status).toBe(403);
    expect(describeView("/calls/numbers")).toBe("Calls numbers");
    expect(describeView("/calls")).toBe("Calls");
  });
});
