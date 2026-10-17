// Salary extras Phase B4 (docs/SALARY_EXTRAS_PHASE_PLAN.md "Owner: Claims tab"): TA / DA rates in the Salary box, the
// Claims tab, approve / not approve / cancel, owner entries (approved at once) and "your claim was …" to the worker.
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import * as decideRoute from "@/app/api/claims/decide/route";
import * as enterRoute from "@/app/api/claims/enter/route";
import ClaimsPage from "@/app/claims/page";
import { OwnerNav } from "@/app/owner-nav";
import { describeChange } from "@/lib/changes";
import { addDays, addMonths, istDay, istMonth } from "@/lib/days";
import { claimsTab, decideClaim, enterClaim, myClaims, personClaims, sendClaim, uploadClaimPhoto, waitingClaims, withdrawClaim } from "@/server/claims";
import { saveSetting, salaryPanel } from "@/server/salary-edit";
import type { AtUser } from "@/server/session";
import { startFakePlatform, type FakePlatform } from "./fake-platform";
import { asApp, asOwner, contactsFor, jsonReq, plant, refusal, signInAs, textOf } from "./helpers";

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

const R = (rupees: number) => Math.round(rupees * 100);
const TODAY = istDay();
const THIS = istMonth();
const FROM = addMonths(THIS, -2); // on salary from two months back
const sent = (tenantId: string) => platform.notifications.filter((n) => n.tenantId === tenantId).map((n) => n.body);
const JPEG = () => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(1020, 7)]);

/** Owner, owner + Plant staff, worker Ramu, store keeper; Ramu (and the owner + Plant staff) on salary with TA ₹3 / DA ₹150. */
async function setup(rates: { km: number | null; da: number | null } = { km: 3, da: 150 }) {
  const p = plant();
  platform.contacts = [...contactsFor(p.owner, p.ownerWorker, p.worker, p.keeper)];
  for (const u of [p.worker, p.ownerWorker]) {
    await asApp(
      u.tenantId,
      `insert into attendance_salary.salary_settings (tenant_id, user_id, user_name, from_month, monthly_paise, shift_minutes, gets_overtime, km_rate_paise, da_day_paise, field_staff, reason, created_by, created_by_name)
       values ('${u.tenantId}', '${u.userId}', '${u.name}', '${FROM}-01', ${R(12000)}, 480, false, ${rates.km ? R(rates.km) : "null"}, ${rates.da ? R(rates.da) : "null"}, ${!!(rates.km || rates.da)}, 'set up', gen_random_uuid(), 'Sujata')`,
    );
  }
  return p;
}
const duty = (over: Record<string, unknown> = {}) => ({ kind: "field_duty" as const, on_date: TODAY, km: "42", amount: null, note: "Cuttack delivery", ...over });
const expense = (over: Record<string, unknown> = {}) => ({ kind: "expense" as const, on_date: TODAY, km: null, amount: "450", note: "Diesel for generator", ...over });
const decide = (u: AtUser, claim_id: string, decision: "approve" | "reject" | "cancel", reason: string | null = null) => {
  signInAs(u);
  return decideRoute.POST(jsonReq("POST", "/api/claims/decide", { claim_id, decision, reason }), undefined as never);
};

describe("TA / DA rates in the Salary box", () => {
  const save = (by: AtUser, w: string, over: Record<string, unknown>) =>
    saveSetting(by, { user_id: w, monthly: "12000", shift_hours: 8, leave_days: 2, gets_overtime: false, from_month: THIS, joined_on: null, left_on: null, reason: null, expect: null, field_staff: true, ...over } as never);

  it("1. typed rupees (2.50 works), blank = none; 0, over ₹1,000 a km or over ₹1 lakh a day refused; history and Recent changes text", async () => {
    const p = plant();
    platform.contacts = [...contactsFor(p.owner, p.worker)];
    const w = p.worker.userId;
    for (const [ta, da] of [["0", null], ["1000.01", null], [null, "0"], [null, "100000.01"], ["2.555", null], ["3,0", null]] as const) {
      expect((await refusal(() => save(p.owner, w, { ta_rate: ta, da_rate: da }))).status, `${ta} ${da}`).toBe(400);
    }
    await save(p.owner, w, { ta_rate: "2.50", da_rate: "150" });
    const panel = await salaryPanel(p.owner, w, THIS);
    expect(panel.history[0]).toMatchObject({ kmRatePaise: 250, daDayPaise: R(150) });
    await save(p.owner, w, { ta_rate: "", da_rate: null, expect: panel.expect.setting });
    expect((await salaryPanel(p.owner, w, THIS)).history[0]).toMatchObject({ kmRatePaise: null, daDayPaise: null });
    const audit = (await asOwner("select action, details from attendance_salary.audit_log where tenant_id = $1 order by id", [p.tenantId])).rows as { action: string; details: Record<string, unknown> }[];
    expect(describeChange(audit[0]!.action, audit[0]!.details)).toMatch(/: ₹12,000 · 8 h · no overtime · TA ₹2.50\/km · DA ₹150\/day · field staff$/);
    expect(describeChange(audit[1]!.action, audit[1]!.details)).not.toMatch(/TA|DA/);
    // a store keeper or support can't set them
    expect((await refusal(() => save(p.support, w, { ta_rate: "3" }))).status).toBe(403);
  });
});

describe("the Claims tab", () => {
  it("2. owner and support see everyone's claims with TA / DA at each person's rates; a worker gets 404", async () => {
    const p = await setup();
    const f = await sendClaim(p.worker, duty());
    await sendClaim(p.worker, expense());
    const tab = await claimsTab(p.owner);
    expect(tab).toMatchObject({ month: THIS, status: "waiting", counts: { waiting: 2, approved: 0, rejected: 0, all: 2 } });
    const card = tab.claims.find((c) => c.id === f.id)!;
    expect(card).toMatchObject({ taPaise: R(126), daPaise: R(150), kmRatePaise: R(3), userName: "Ramu" });
    expect((await claimsTab(p.support)).claims).toHaveLength(2);
    expect((await refusal(() => claimsTab(p.worker))).status).toBe(404);
    expect((await refusal(() => claimsTab(p.keeper))).status).toBe(403);
    signInAs(p.worker);
    await expect(ClaimsPage({ searchParams: Promise.resolve({}) })).rejects.toThrow(/NEXT_HTTP_ERROR_FALLBACK;404|NEXT_NOT_FOUND/);
    expect(await waitingClaims(p.owner)).toBe(2);
    expect(await waitingClaims(p.worker)).toBe(0);
    expect(textOf(OwnerNav({ user: p.owner, current: "claims", claimsWaiting: 2 }))).toContain("Claims (2)");
    expect(textOf(OwnerNav({ user: p.worker, current: "today" }))).not.toContain("Claims");
    // a future month is 404
    expect((await refusal(() => claimsTab(p.owner, { month: addMonths(THIS, 1) }))).status).toBe(404);
  });

  it("3. no TA rate → 'no TA rate'; filters by status and by person; waiting counts every month", async () => {
    const p = await setup({ km: null, da: 150 });
    const f = await sendClaim(p.worker, duty());
    expect((await claimsTab(p.owner)).claims[0]).toMatchObject({ taPaise: null, daPaise: R(150) });
    const old = await sendClaim(p.worker, expense({ on_date: addDays(TODAY, -31) }));
    await decide(p.owner, f.id, "approve");
    expect((await claimsTab(p.owner, { status: "approved" })).claims.map((c) => c.id)).toEqual([f.id]);
    expect((await claimsTab(p.owner, { status: "all", personId: p.ownerWorker.userId })).claims).toEqual([]);
    expect(await waitingClaims(p.owner)).toBe(1); // the 31-days-back one, possibly last month
    expect((await claimsTab(p.owner, { month: old.claim.onDate.slice(0, 7), status: "waiting" })).claims.map((c) => c.id)).toContain(old.id);
  });
});

describe("approve / not approve / cancel", () => {
  it("4. every allowed move, with a reason where needed; the worker hears each one, nobody else", async () => {
    const p = await setup();
    const a = await sendClaim(p.worker, expense());
    const b = await sendClaim(p.worker, duty());
    await settle();
    platform.notifications.length = 0;
    expect((await decide(p.owner, a.id, "approve")).status).toBe(201);
    expect((await decide(p.owner, b.id, "reject", "Wrong km, send again")).status).toBe(201);
    expect((await decide(p.ownerWorker, a.id, "cancel", "Paid in cash already")).status).toBe(201);
    await settle();
    const notes = sent(p.tenantId);
    expect(notes.map((n) => n.title)).toEqual([
      expect.stringMatching(/^Your expense on \d+ \w+ was approved$/),
      expect.stringMatching(/^Your field duty on \d+ \w+ was not approved: Wrong km, send again$/),
      expect.stringMatching(/^Your expense on \d+ \w+ was cancelled: Paid in cash already$/),
    ]);
    for (const n of notes) expect(n).toMatchObject({ kind: "attendance_salary.claim_decided", also_user_ids: [p.worker.userId], only_listed: true, link: `/my/claims?m=${THIS}`, level: "push" });
    expect(new Set(notes.map((n) => n.dedupe_key)).size).toBe(3);
    expect(notes[0]!.body).toBe("₹450 · Diesel for generator");
    expect(notes.some((n) => /₹126|₹150|TA|DA/.test(String(n.title) + String(n.body)))).toBe(false); // the km claim says km only
    const mine = await myClaims(p.worker, null);
    expect(Object.fromEntries(mine.claims.map((c) => [c.id, [c.status, c.reason]]))).toEqual({ [a.id]: ["cancelled", "Paid in cash already"], [b.id]: ["rejected", "Wrong km, send again"] });
  });

  it("5. refused moves: 409 when not waiting / not approved (also right after the worker withdrew); no reason → 400", async () => {
    const p = await setup();
    const c = await sendClaim(p.worker, expense());
    expect((await refusal(() => decideClaim(p.owner, { claim_id: c.id, decision: "reject", reason: "no" }))).status).toBe(400);
    expect((await refusal(() => decideClaim(p.owner, { claim_id: c.id, decision: "reject" }))).status).toBe(400);
    expect((await refusal(() => decideClaim(p.owner, { claim_id: c.id, decision: "cancel", reason: "too early" }))).status).toBe(409);
    await withdrawClaim(p.worker, c.id);
    const stale = await refusal(() => decideClaim(p.owner, { claim_id: c.id, decision: "approve" }));
    expect(stale).toMatchObject({ status: 409, message: "Just changed: this claim was withdrawn by Ramu. The page has been refreshed." });
    const d = await sendClaim(p.worker, expense());
    await decideClaim(p.owner, { claim_id: d.id, decision: "approve" });
    expect((await refusal(() => decideClaim(p.ownerWorker, { claim_id: d.id, decision: "approve" }))).message).toMatch(/^Just changed: this claim was approved by /);
    expect((await refusal(() => decideClaim(p.owner, { claim_id: d.id, decision: "reject", reason: "changed my mind" }))).status).toBe(409);
    await decideClaim(p.owner, { claim_id: d.id, decision: "cancel", reason: "double entry" });
    expect((await refusal(() => decideClaim(p.owner, { claim_id: d.id, decision: "cancel", reason: "again" }))).status).toBe(409);
    expect((await refusal(() => decideClaim(p.owner, { claim_id: crypto.randomUUID(), decision: "approve" }))).status).toBe(404);
  });

  it("6. only the owner decides: Plant staff, a store keeper and support are refused", async () => {
    const p = await setup();
    const c = await sendClaim(p.worker, expense());
    expect((await refusal(() => decideClaim(p.worker, { claim_id: c.id, decision: "approve" }))).status).toBe(403);
    expect((await refusal(() => decideClaim(p.keeper, { claim_id: c.id, decision: "approve" }))).status).toBe(403);
    expect((await refusal(() => decideClaim(p.support, { claim_id: c.id, decision: "approve" }))).message).toBe("PlantOps support view is read-only");
    // another plant's owner can't touch it either
    expect((await refusal(() => decideClaim(plant().owner, { claim_id: c.id, decision: "approve" }))).status).toBe(404);
  });

  it("7. audited for Recent changes in plain words", async () => {
    const p = await setup();
    const c = await sendClaim(p.worker, duty({ km: "42.5" }));
    await decideClaim(p.owner, { claim_id: c.id, decision: "approve" });
    await decideClaim(p.owner, { claim_id: c.id, decision: "cancel", reason: "wrong day" });
    const rows = (await asOwner("select action, details from attendance_salary.audit_log where tenant_id = $1 and action like 'claim.%' order by id", [p.tenantId])).rows as { action: string; details: Record<string, unknown> }[];
    expect(rows.map((r) => describeChange(r.action, r.details))).toEqual([
      expect.stringMatching(/^Claim from Ramu: field duty \d+ \w+, 42.5 km: Cuttack delivery$/),
      expect.stringMatching(/^Claim approved for Ramu: field duty \d+ \w+, 42.5 km$/),
      expect.stringMatching(/^Claim cancelled for Ramu: field duty \d+ \w+, 42.5 km: wrong day$/),
    ]);
  });
});

describe("owner entries (Staff → person)", () => {
  it("8. approved at once, any date from the first salary month to today; no 'new claim'; the worker sees it", async () => {
    const p = await setup();
    signInAs(p.owner);
    const longAgo = `${FROM}-02`; // more than 31 days back: fine for the owner
    const res = await enterRoute.POST(jsonReq("POST", "/api/claims/enter", { ...duty({ on_date: longAgo }), user_id: p.worker.userId }), undefined as never);
    expect(res.status).toBe(201);
    const { id } = (await res.json()) as { id: string };
    await settle();
    expect(sent(p.tenantId)).toEqual([]);
    const theirs = await myClaims(p.worker, FROM);
    expect(theirs.claims.find((c) => c.id === id)).toMatchObject({ status: "approved", createdByName: p.owner.name, decidedByName: p.owner.name });
    expect((await personClaims(p.owner, p.worker.userId, FROM)).map((c) => c.id)).toContain(id);
    expect((await refusal(() => enterClaim(p.owner, { ...expense({ on_date: `${addMonths(FROM, -1)}-28` }), user_id: p.worker.userId }))).message).toBe("The date is before the first salary month");
    expect((await refusal(() => enterClaim(p.owner, { ...expense({ on_date: addDays(TODAY, 1) }), user_id: p.worker.userId }))).status).toBe(400);
    // still one field duty per date, whoever enters it
    expect((await refusal(() => enterClaim(p.owner, { ...duty({ on_date: longAgo }), user_id: p.worker.userId }))).message).toMatch(/^Ramu already has field duty on /);
    const audit = (await asOwner("select action, details from attendance_salary.audit_log where tenant_id = $1 and action = 'claim.entered'", [p.tenantId])).rows as { action: string; details: Record<string, unknown> }[];
    expect(describeChange(audit[0]!.action, audit[0]!.details)).toMatch(/^Claim entered for Ramu: field duty \d+ \w+, 42 km: Cuttack delivery \(approved\)$/);
  });

  it("9. the owner adds a bill photo to their own entry; workers, store keepers and support can't enter; unknown people 404", async () => {
    const p = await setup();
    const { id } = await enterClaim(p.owner, { ...expense(), user_id: p.worker.userId });
    expect((await uploadClaimPhoto(p.owner, id, JPEG())).size).toBe(1024);
    expect((await refusal(() => uploadClaimPhoto(p.worker, id, JPEG()))).message).toBe("Only the person who entered this claim can add its photos");
    for (const who of [p.worker, p.keeper, p.support]) expect((await refusal(() => enterClaim(who, { ...expense(), user_id: p.worker.userId }))).status, who.name).toBe(403);
    expect((await refusal(() => enterClaim(p.owner, { ...expense(), user_id: crypto.randomUUID() }))).status).toBe(404);
  });

  it("10. an owner who is also Plant staff cancelling their own claim: no notification to themselves", async () => {
    const p = await setup();
    const own = await sendClaim(p.ownerWorker, expense());
    expect(own.approved).toBe(true);
    await settle();
    platform.notifications.length = 0;
    expect((await decide(p.ownerWorker, own.id, "cancel", "typed twice")).status).toBe(201);
    await settle();
    expect(sent(p.tenantId)).toEqual([]);
  });
});
