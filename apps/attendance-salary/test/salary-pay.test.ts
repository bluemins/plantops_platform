// Ticking a month Paid and undoing it (src/server/salary-pay.ts), the frozen figures on the Salary tab, and a worker's
// own slips (src/server/salary-slip.ts): only with "Can see own salary", only paid months, only their own. Plus the
// salary_paid notification. Case numbers follow the Phase 5 plan's list. September 2026 is over; payments are real.
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import * as payRoute from "@/app/api/salary/pay/route";
import * as undoRoute from "@/app/api/salary/pay/undo/route";
import HomePage from "@/app/page";
import MySalaryPage from "@/app/my/salary/page";
import MySlipPage from "@/app/my/salary/[month]/page";
import { describeChange } from "@/lib/changes";
import { istDay, istMonth, monthDays, addDays } from "@/lib/days";
import { saveVisibility } from "@/server/salary-edit";
import { payMonth, undoPayment } from "@/server/salary-pay";
import { canSeeOwnSalary, myPayments, mySlip } from "@/server/salary-slip";
import { salaryTab } from "@/server/salary-tab";
import type { AtUser } from "@/server/session";
import { startFakePlatform, type FakePlatform } from "./fake-platform";
import { asApp, asOwner, contactsFor, jsonReq, markAt, plant, refusal, signInAs, textOf } from "./helpers";

// next/server's after() runs once the answer is sent; here it runs at once and can be awaited
const pending: Promise<unknown>[] = [];
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: (fn: () => unknown) => void pending.push(Promise.resolve().then(fn)) }));
const settle = async () => {
  await Promise.all(pending.splice(0));
};

let platform: FakePlatform;
beforeAll(async () => {
  platform = await startFakePlatform();
  process.env.PLATFORM_URL = platform.url;
});
afterAll(() => platform.close());
afterEach(() => {
  vi.restoreAllMocks();
  platform.notifyStatus = 201;
});

const SEP = "2026-09";
const R = (rupees: number) => Math.round(rupees * 100);
const sent = (tenantId: string) => platform.notifications.filter((n) => n.tenantId === tenantId).map((n) => n.body);

async function setting(u: AtUser, fromMonth: string, rupees: number) {
  await asApp(
    u.tenantId,
    `insert into attendance_salary.salary_settings (tenant_id, user_id, user_name, from_month, monthly_paise, shift_minutes, paid_leave_halfdays, gets_overtime, created_by, created_by_name)
     values ('${u.tenantId}', '${u.userId}', '${u.name}', '${fromMonth}-01', ${R(rupees)}, 480, 0, false, gen_random_uuid(), 'Sujata')`,
  );
}

/**
 * A plant whose worker Ramu earns ₹12,000 from September with no paid leave: present 1-29 Sep, absent on the 30th,
 * so September is ₹11,600 (one unpaid day of ₹400).
 */
async function setup() {
  const p = plant();
  platform.contacts = [...contactsFor(p.owner, p.ownerWorker, p.worker, p.keeper)];
  await setting(p.worker, SEP, 12000);
  for (const d of monthDays(SEP).slice(0, 29)) {
    await markAt(p.worker, "in", `${d} 09:00`);
    await markAt(p.worker, "out", `${d} 17:00`);
  }
  const pay = (by: AtUser, over: Record<string, unknown> = {}) =>
    payMonth(by, { user_id: p.worker.userId, month: SEP, paid_on: "2026-09-30", note: "Cash", expect_remaining: R(11600), ...over } as never);
  const allow = async (on: boolean) => {
    const panelExpect = (await asOwner<{ id: string }>("select id from attendance_salary.salary_visibility where tenant_id = $1 and user_id = $2 order by created_at desc, id desc limit 1", [p.tenantId, p.worker.userId])).rows[0]?.id ?? null;
    await saveVisibility(p.owner, { user_id: p.worker.userId, can_see: on, expect: panelExpect });
  };
  return { p, pay, allow };
}

describe("marking a month paid", () => {
  it("1. the owner (also with Plant staff) may pay and undo; Plant staff, a store keeper and support may not", async () => {
    const { p, pay } = await setup();
    for (const u of [p.worker, p.keeper, p.support]) {
      expect((await refusal(() => pay(u))).status, u.name).toBe(403);
    }
    const { id } = await pay(p.ownerWorker);
    for (const u of [p.worker, p.keeper, p.support]) {
      expect((await refusal(() => undoPayment(u, { payment_id: id, reason: "wrong" }))).status, u.name).toBe(403);
    }
    await undoPayment(p.owner, { payment_id: id, reason: "paid the wrong amount" });
  });

  it("2. a second payment, a month not over, a future paid-on date, stale figures and someone not on salary are refused", async () => {
    const { p, pay } = await setup();
    expect(await refusal(() => pay(p.owner, { expect_remaining: R(12000) }))).toEqual({ status: 409, message: "The figures changed since the page loaded (now ₹11,600). The page has been refreshed: check it and try again." });
    expect((await refusal(() => pay(p.owner, { paid_on: addDays(istDay(), 1) }))).message).toBe("The paid-on date is in the future");
    await pay(p.owner);
    expect((await refusal(() => pay(p.owner))).message).toBe("Already marked paid by Sujata on 30 Sept");
    expect((await refusal(() => pay(p.owner, { user_id: p.ownerWorker.userId }))).status).toBe(404);
    expect((await refusal(() => pay(p.owner, { month: "2099-01" }))).status).toBe(404);
    const thisMonth = istMonth();
    if (istDay() < monthDays(thisMonth).at(-1)!) {
      await setting(p.worker, thisMonth, 12000);
      expect((await refusal(() => pay(p.owner, { month: thisMonth, paid_on: istDay() }))).message).toMatch(/can be marked paid from/);
    }
  });

  it("3. undo needs a reason and happens once; then the month can be paid again", async () => {
    const { p, pay } = await setup();
    const { id } = await pay(p.owner);
    signInAs(p.owner);
    const post = (reason: string) => undoRoute.POST(jsonReq("POST", "/api/salary/pay/undo", { payment_id: id, reason }), undefined as never);
    expect((await post(" no ")).status).toBe(400);
    expect((await post("paid the wrong amount")).status).toBe(201);
    expect((await post("again")).status).toBe(409);
    expect((await refusal(() => undoPayment(p.owner, { payment_id: crypto.randomUUID(), reason: "nothing" }))).status).toBe(404);
    const again = await pay(p.owner);
    expect(again.id).not.toBe(id);
  });
});

describe("the frozen figures", () => {
  it("4. a fix after payment leaves the paid row as it was, shows 'changed after payment' and adjusts October once", async () => {
    const { p, pay } = await setup();
    const { id } = await pay(p.owner);
    let tab = await salaryTab(p.owner, SEP);
    let row = tab.rows[0]!;
    expect(row.payment).toMatchObject({ id, paidOn: "2026-09-30", paidPaise: R(11600), byName: "Sujata", note: "Cash" });
    expect(row.result.remainingPaise).toBe(R(11600));
    expect(tab).toMatchObject({ paidPaise: R(11600), stillToPayPaise: 0 });

    // the owner later adds the missing day: September's live figure is now ₹12,000
    await markAt(p.worker, "in", "2026-09-30 09:00", { owner: "forgot to scan" });
    await markAt(p.worker, "out", "2026-09-30 17:00", { owner: "forgot to scan" });
    tab = await salaryTab(p.owner, SEP);
    row = tab.rows[0]!;
    expect(row.counts).toMatchObject({ present: 29, absent: 1 }); // frozen
    expect(row.result.remainingPaise).toBe(R(11600)); // frozen
    expect(row.changedPaise).toBe(R(400));
    const oct = (await salaryTab(p.owner, "2026-10")).rows[0]!;
    expect(oct.result.adjustmentPaise).toBe(R(400));
    expect(oct.adjustmentFrom).toBe(SEP);
  });

  it("5. a negative month is paid as ₹0 and its minus still carries", async () => {
    const { p } = await setup();
    await asApp(p.tenantId, `insert into attendance_salary.salary_advances (tenant_id, user_id, user_name, on_date, amount_paise, created_by, created_by_name) values ('${p.tenantId}', '${p.worker.userId}', 'Ramu', '2026-09-05', ${R(13700)}, gen_random_uuid(), 'Sujata')`);
    await payMonth(p.owner, { user_id: p.worker.userId, month: SEP, paid_on: "2026-09-30", note: null, expect_remaining: -R(2100) });
    const { rows } = await asOwner<{ paid_paise: string; remaining_paise: string }>("select paid_paise, remaining_paise from attendance_salary.salary_payments where tenant_id = $1", [p.tenantId]);
    expect(rows[0]).toEqual({ paid_paise: "0", remaining_paise: String(-R(2100)) });
    expect((await salaryTab(p.owner, "2026-10")).rows[0]!.result.carriedInPaise).toBe(R(2100));
  });
});

describe("the worker's own salary", () => {
  it("6. without permission: 404 everywhere and nothing about salary on their screens", async () => {
    const { p, pay } = await setup();
    await pay(p.owner);
    expect(await canSeeOwnSalary(p.worker)).toBe(false);
    expect((await refusal(() => myPayments(p.worker))).status).toBe(404);
    expect((await refusal(() => mySlip(p.worker, SEP))).status).toBe(404);
    signInAs(p.worker);
    await expect(MySalaryPage()).rejects.toThrow(/NEXT_HTTP_ERROR_FALLBACK;404|NEXT_NOT_FOUND/);
    const home = textOf(await HomePage({ searchParams: Promise.resolve({}) }));
    expect(home).not.toMatch(/₹|salary/i);
    const res = await payRoute.POST(jsonReq("POST", "/api/salary/pay", { user_id: p.worker.userId, month: SEP, paid_on: "2026-09-30", expect_remaining: 0 }), undefined as never);
    expect(res.status).toBe(403);
  });

  it("7. with permission: only paid months, only their own; gone at once when permission is off or the payment undone", async () => {
    const { p, pay, allow } = await setup();
    await allow(true);
    expect(await myPayments(p.worker)).toEqual([]);
    expect((await refusal(() => mySlip(p.worker, SEP))).status).toBe(404); // not paid yet
    const { id } = await pay(p.owner);
    const mine = await myPayments(p.worker);
    expect(mine.map((m) => [m.month, m.paidPaise, m.paidOn, m.byName])).toEqual([[SEP, R(11600), "2026-09-30", "Sujata"]]);
    const slip = await mySlip(p.worker, SEP);
    expect(slip.figures.result).toMatchObject({ earnedPaise: R(11600), unpaidHalves: 2, dayPayPaise: R(400) });
    expect(slip.figures.counts).toMatchObject({ present: 29, absent: 1 });
    expect((await refusal(() => mySlip(p.worker, "2026-10"))).status).toBe(404);
    expect((await refusal(() => mySlip(p.worker, "nonsense"))).status).toBe(404);

    // another worker of the plant with permission sees none of Ramu's months
    const other = { ...p.worker, userId: crypto.randomUUID(), name: "Gaja" };
    await saveVisibility(p.owner, { user_id: other.userId, can_see: true, expect: null }).catch(() => undefined); // not a known person: no row
    expect((await refusal(() => mySlip(other, SEP))).status).toBe(404);
    // support and an owner without Plant staff have no own slips
    expect((await refusal(() => myPayments(p.support))).status).toBe(404);
    expect((await refusal(() => myPayments(p.owner))).status).toBe(404);

    await allow(false);
    expect((await refusal(() => mySlip(p.worker, SEP))).status).toBe(404);
    await allow(true);
    expect((await mySlip(p.worker, SEP)).month).toBe(SEP);
    await undoPayment(p.owner, { payment_id: id, reason: "paid the wrong amount" });
    expect((await refusal(() => mySlip(p.worker, SEP))).status).toBe(404);
    expect(await myPayments(p.worker)).toEqual([]);
  });
});

describe("the salary_paid notification", () => {
  const post = (owner: AtUser, worker: AtUser, expect_remaining = R(11600)) => {
    signInAs(owner);
    return payRoute.POST(jsonReq("POST", "/api/salary/pay", { user_id: worker.userId, month: SEP, paid_on: "2026-09-30", note: "UPI", expect_remaining }), undefined as never);
  };

  it("8a. with permission: one, to the worker only; none on undo", async () => {
    const { p, allow } = await setup();
    await allow(true);
    const res = await post(p.owner, p.worker);
    expect(res.status).toBe(201);
    const { id } = await res.json();
    await settle();
    expect(sent(p.tenantId)).toEqual([
      {
        kind: "attendance_salary.salary_paid",
        title: "Your September salary is paid",
        body: "Tap to see how it was worked out",
        link: `/my/salary/${SEP}`,
        level: "push",
        dedupe_key: `paid:${id}`,
        also_user_ids: [p.worker.userId],
        only_listed: true,
        exclude_user_id: p.owner.userId,
      },
    ]);
    await undoPayment(p.owner, { payment_id: id, reason: "wrong month" });
    await settle();
    expect(sent(p.tenantId)).toHaveLength(1);
  });

  it("8b. without permission: no notification", async () => {
    const { p } = await setup();
    expect((await post(p.owner, p.worker)).status).toBe(201);
    await settle();
    expect(sent(p.tenantId)).toEqual([]);
  });

  it("8c. the platform down: the notification waits in the outbox", async () => {
    const { p, allow } = await setup();
    await allow(true);
    platform.notifyStatus = 503;
    expect((await post(p.owner, p.worker)).status).toBe(201);
    await settle();
    const { rows } = await asOwner<{ input: { kind: string } }>("select input from attendance_salary.notification_outbox where tenant_id = $1 and sent_at is null", [p.tenantId]);
    expect(rows.map((r) => r.input.kind)).toEqual(["attendance_salary.salary_paid"]);
  });
});

describe("audit", () => {
  it("9. paid and undone are in Recent changes, in plain words", async () => {
    const { p, pay } = await setup();
    const { id } = await pay(p.owner);
    await undoPayment(p.owner, { payment_id: id, reason: "paid the wrong amount" });
    const { rows } = await asOwner<{ action: string; details: Record<string, unknown> }>("select action, details from attendance_salary.audit_log where tenant_id = $1 and action like 'salary.%paid' order by id", [p.tenantId]);
    expect(rows.map((r) => describeChange(r.action, r.details))).toEqual([
      "Marked September 2026 paid for Ramu: ₹11,600 on 30 Sept (Cash)",
      "Undid September 2026 payment for Ramu: paid the wrong amount",
    ]);
  });
});

// ---------- per-day pay (docs/SALARY_EXTRAS_PHASE_PLAN.md Phase A2) ----------

describe("a per-day month on the worker's slip", () => {
  it("A2-9. paid and opened by the worker: '29 full = 29 days × ₹450'; no '÷ 30'", async () => {
    const p = plant();
    platform.contacts = [...contactsFor(p.owner, p.worker)];
    await asApp(
      p.tenantId,
      `insert into attendance_salary.salary_settings (tenant_id, user_id, user_name, from_month, pay_basis, monthly_paise, day_rate_paise, shift_minutes, paid_leave_halfdays, gets_overtime, created_by, created_by_name)
       values ('${p.tenantId}', '${p.worker.userId}', '${p.worker.name}', '${SEP}-01', 'per_day', null, ${R(450)}, 480, 0, false, gen_random_uuid(), 'Sujata')`,
    );
    for (const d of monthDays(SEP).slice(0, 29)) {
      await markAt(p.worker, "in", `${d} 09:00`);
      await markAt(p.worker, "out", `${d} 17:00`);
    }
    await saveVisibility(p.owner, { user_id: p.worker.userId, can_see: true, expect: null });
    await payMonth(p.owner, { user_id: p.worker.userId, month: SEP, paid_on: "2026-09-30", note: "Cash", expect_remaining: R(29 * 450) } as never);
    const slip = await mySlip(p.worker, SEP);
    expect(slip.figures).toMatchObject({ rules: 7, band: "PV_SALARY_DAY_STAFF", setting: { payBasis: "per_day", dayRatePaise: R(450) } });
    signInAs(p.worker);
    const text = textOf(await MySlipPage({ params: Promise.resolve({ month: SEP }) })).replace(/\s+/g, " ");
    expect(text).toContain("29 full = 29 days × ₹450");
    expect(text).toContain("₹13,050");
    expect(text).toContain("Day rate ₹450");
    expect(text).not.toMatch(/÷ 30|Paid leave used|Monthly salary/);
  });

  it("A2-10. a monthly slip is unchanged: salary, paid leave and '÷ 30'", async () => {
    const { p, pay, allow } = await setup();
    await allow(true);
    await pay(p.owner);
    signInAs(p.worker);
    const text = textOf(await MySlipPage({ params: Promise.resolve({ month: SEP }) })).replace(/\s+/g, " ");
    expect(text).toMatch(/Monthly salary/);
    expect(text).toMatch(/Paid leave used/);
    expect(text).toMatch(/₹12,000 ÷ 30/);
  });
});
