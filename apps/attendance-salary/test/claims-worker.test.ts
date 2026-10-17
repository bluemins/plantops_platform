// Salary extras Phase B3 (docs/SALARY_EXTRAS_PHASE_PLAN.md "Worker: My claims"): a worker sends field duty and
// expenses for themselves, adds bill photos and withdraws a waiting claim; the owners get "new claim". Real database,
// real routes; dates relative to today (the server uses the database clock).
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import * as claimsRoute from "@/app/api/claims/route";
import * as photoRoute from "@/app/api/claims/photo/route";
import * as withdrawRoute from "@/app/api/claims/withdraw/route";
import * as photoFile from "@/app/claim-photos/[id]/route";
import MyClaimsPage from "@/app/my/claims/page";
import { myTabs } from "@/app/my-tabs";
import { describeChange } from "@/lib/changes";
import { addDays, addMonths, istDay, istMonth } from "@/lib/days";
import { myClaims, sendClaim, uploadClaimPhoto, withdrawClaim } from "@/server/claims";
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
const LAST_MONTH = addMonths(istMonth(), -1);
const sent = (tenantId: string) => platform.notifications.filter((n) => n.tenantId === tenantId).map((n) => n.body);

/** A JPEG / PNG / PDF by their first bytes (the server checks content, not names). */
const JPEG = (size = 2048) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(size - 4, 7)]);
const PDF = Buffer.from("%PDF-1.4\n%fake\n");

/** A salary setting from last month (so 31 days back is inside it), with TA / DA rates or none. */
async function setting(u: AtUser, rates: { km: number; da: number } | null = { km: 3, da: 150 }, fromMonth = LAST_MONTH) {
  await asApp(
    u.tenantId,
    `insert into attendance_salary.salary_settings (tenant_id, user_id, user_name, from_month, monthly_paise, shift_minutes, gets_overtime, km_rate_paise, da_day_paise, created_by, created_by_name)
     values ('${u.tenantId}', '${u.userId}', '${u.name}', '${fromMonth}-01', ${R(12000)}, 480, false, ${rates ? R(rates.km) : "null"}, ${rates ? R(rates.da) : "null"}, gen_random_uuid(), 'Sujata')`,
  );
}
const duty = (over: Record<string, unknown> = {}) => ({ kind: "field_duty" as const, on_date: TODAY, km: "42", amount: null, note: "Cuttack delivery", ...over });
const expense = (over: Record<string, unknown> = {}) => ({ kind: "expense" as const, on_date: TODAY, km: null, amount: "450", note: "Diesel for generator", ...over });
const upload = (user: AtUser, claimId: string, body: Buffer, type = "image/jpeg") => {
  signInAs(user);
  return photoRoute.POST(new Request(`http://localhost/api/claims/photo?claim=${claimId}`, { method: "POST", headers: { "content-type": type }, body: new Uint8Array(body) }), undefined as never);
};
const decide = (u: AtUser, claimId: string, decision: string, reason: string | null = null) =>
  asApp(u.tenantId, `insert into attendance_salary.salary_claim_decisions (tenant_id, claim_id, decision, reason, created_by, created_by_name) values ('${u.tenantId}', '${claimId}', '${decision}', ${reason ? `'${reason}'` : "null"}, gen_random_uuid(), 'Sujata')`);

function setup() {
  const p = plant();
  platform.contacts = [...contactsFor(p.owner, p.ownerWorker, p.worker, p.keeper)];
  return p;
}

describe("who may send", () => {
  it("1. a worker sends their own field duty and expense (201); the owners get one 'new claim' each", async () => {
    const p = setup();
    await setting(p.worker);
    signInAs(p.worker);
    const a = await claimsRoute.POST(jsonReq("POST", "/api/claims", duty()), undefined as never);
    const b = await claimsRoute.POST(jsonReq("POST", "/api/claims", expense()), undefined as never);
    expect([a.status, b.status]).toEqual([201, 201]);
    const [da, eb] = [(await a.json()) as { id: string; approved: boolean }, (await b.json()) as { id: string }];
    expect(da.approved).toBe(false);
    await settle();
    const notes = sent(p.tenantId);
    expect(notes).toHaveLength(2);
    expect(notes[0]).toMatchObject({ kind: "attendance_salary.claim_new", link: "/claims?status=waiting", level: "push", dedupe_key: `claim:${da.id}`, body: "Cuttack delivery", exclude_user_id: p.worker.userId });
    expect(notes[0]!.title).toMatch(/^Field duty from Ramu: \d+ \w+, 42 km$/);
    expect(notes[1]).toMatchObject({ title: "Expense from Ramu: ₹450", dedupe_key: `claim:${eb.id}` });
    expect(notes.some((n) => "also_user_ids" in n)).toBe(false); // the platform picks the owners
  });

  it("2. an owner who is also Plant staff: their own claim counts as approved at once, and nobody is notified", async () => {
    const p = setup();
    await setting(p.ownerWorker);
    signInAs(p.ownerWorker);
    const res = await claimsRoute.POST(jsonReq("POST", "/api/claims", expense()), undefined as never);
    expect(await res.json()).toMatchObject({ approved: true });
    await settle();
    expect(sent(p.tenantId)).toEqual([]);
    expect((await myClaims(p.ownerWorker, null)).claims[0]).toMatchObject({ status: "approved", decidedByName: p.ownerWorker.name });
  });

  it("3. an owner without Plant staff, a store keeper and PlantOps support can't send claims", async () => {
    const p = setup();
    for (const [who, status] of [[p.owner, 403], [p.keeper, 403], [p.support, 403]] as const) {
      expect((await refusal(() => sendClaim(who, expense()))).status, who.name).toBe(status);
    }
    expect((await refusal(() => sendClaim(p.support, expense()))).message).toBe("PlantOps support view is read-only");
  });
});

describe("the claim's own rules", () => {
  it("4. dates: never in the future, at most 31 days back, only in a month with a salary setting", async () => {
    const p = setup();
    await setting(p.worker);
    expect((await refusal(() => sendClaim(p.worker, expense({ on_date: addDays(TODAY, 1) })))).message).toBe("The date can't be in the future");
    expect((await refusal(() => sendClaim(p.worker, expense({ on_date: addDays(TODAY, -32) })))).message).toBe("The date can be at most 31 days back");
    expect((await sendClaim(p.worker, expense({ on_date: addDays(TODAY, -31) }))).approved).toBe(false);
    expect((await refusal(() => sendClaim(p.worker, expense({ on_date: "2026-02-30" })))).status).toBe(400);
    // salary only from this month: last month is refused even within 31 days
    const q = setup();
    await setting(q.worker, { km: 3, da: 150 }, istMonth());
    const lastMonthDay = `${LAST_MONTH}-28`;
    if (lastMonthDay >= addDays(TODAY, -31)) {
      expect((await refusal(() => sendClaim(q.worker, expense({ on_date: lastMonthDay })))).status).toBe(400);
    }
    // nobody without a salary setting can send anything
    const r = setup();
    expect((await refusal(() => sendClaim(r.worker, expense()))).message).toBe("No salary is set for you yet, so no claim can be sent");
  });

  it("5. field duty needs a TA or DA rate that month; km 0-9,999.9 with one decimal; 0 km is fine", async () => {
    const p = setup();
    await setting(p.worker, null);
    expect((await refusal(() => sendClaim(p.worker, duty()))).message).toBe("No TA or DA rate is set for that month. Ask the owner.");
    await sendClaim(p.worker, expense()); // expenses need no rate
    const q = setup();
    await setting(q.worker);
    for (const km of ["42.55", "-1", "10000", "", "4 2", "1,2"]) {
      expect((await refusal(() => sendClaim(q.worker, duty({ km })))).status, km).toBe(400);
    }
    await sendClaim(q.worker, duty({ km: "0", on_date: addDays(TODAY, -1) }));
    await sendClaim(q.worker, duty({ km: "9999.9" }));
  });

  it("6. one field duty per date (409) unless the earlier one was withdrawn; expenses as many as needed", async () => {
    const p = setup();
    await setting(p.worker);
    const first = await sendClaim(p.worker, duty());
    const again = await refusal(() => sendClaim(p.worker, duty({ km: "10" })));
    expect(again.status).toBe(409);
    expect(again.message).toMatch(/^You already sent field duty for \d+ \w+$/);
    await withdrawClaim(p.worker, first.id);
    await sendClaim(p.worker, duty({ km: "10" }));
    for (let i = 0; i < 3; i++) await sendClaim(p.worker, expense());
    expect((await myClaims(p.worker, null)).claims.filter((c) => c.kind === "expense")).toHaveLength(3);
  });

  it("7. amounts and notes: > ₹0, ≤ ₹10 lakh, 2 decimals; a note of 3-200 characters", async () => {
    const p = setup();
    await setting(p.worker);
    for (const amount of ["0", "-5", "450.123", "1,000", "1000000.01", ""]) {
      expect((await refusal(() => sendClaim(p.worker, expense({ amount })))).status, amount).toBe(400);
    }
    await sendClaim(p.worker, expense({ amount: "1000000" }));
    await sendClaim(p.worker, expense({ amount: "0.5" }));
    for (const note of ["ab", "  a  ", "x".repeat(201)]) expect((await refusal(() => sendClaim(p.worker, expense({ note })))).status, note).toBe(400);
  });

  it("8. what is saved: the person, the date, km in tenths / paise; audited for Recent changes", async () => {
    const p = setup();
    await setting(p.worker);
    await sendClaim(p.worker, duty({ km: "42.5" }));
    const { rows } = await asOwner("select user_id, user_name, kind, km_tenths, amount_paise, created_by from attendance_salary.salary_claims where tenant_id = $1", [p.tenantId]);
    expect(rows[0]).toEqual({ user_id: p.worker.userId, user_name: "Ramu", kind: "field_duty", km_tenths: 425, amount_paise: null, created_by: p.worker.userId });
    const audit = (await asOwner("select action, details from attendance_salary.audit_log where tenant_id = $1", [p.tenantId])).rows as { action: string; details: Record<string, unknown> }[];
    expect(describeChange(audit[0]!.action, audit[0]!.details)).toMatch(/^Claim from Ramu: field duty \d+ \w+, 42.5 km: Cuttack delivery$/);
  });
});

describe("withdraw", () => {
  it("9. only your own waiting claim; someone else's is 404; a decided one is 409", async () => {
    const p = setup();
    await setting(p.worker);
    const other = { ...p.worker, userId: crypto.randomUUID(), name: "Gaja" };
    await setting(other);
    const mine = await sendClaim(p.worker, expense());
    const theirs = await sendClaim(other, expense());
    expect((await refusal(() => withdrawClaim(p.worker, theirs.id))).status).toBe(404);
    signInAs(p.worker);
    expect((await withdrawRoute.POST(jsonReq("POST", "/api/claims/withdraw", { claim_id: mine.id }), undefined as never)).status).toBe(200);
    expect((await refusal(() => withdrawClaim(p.worker, mine.id))).message).toBe("Already withdrawn");
    const approved = await sendClaim(p.worker, expense());
    await decide(p.worker, approved.id, "approved");
    expect((await refusal(() => withdrawClaim(p.worker, approved.id))).status).toBe(409);
    await settle();
    expect(sent(p.tenantId).filter((n) => String(n.title).includes("withdrawn"))).toEqual([]); // no notification for a withdrawal
  });
});

describe("bill photos", () => {
  it("10. a JPEG is stored for your own waiting expense; a PDF 415; over 10 MB 413; a fourth photo 409", async () => {
    const p = setup();
    await setting(p.worker);
    const c = await sendClaim(p.worker, expense());
    for (let i = 0; i < 3; i++) expect((await upload(p.worker, c.id, JPEG())).status).toBe(201);
    expect((await upload(p.worker, c.id, JPEG())).status).toBe(409);
    const d = await sendClaim(p.worker, expense());
    expect((await upload(p.worker, d.id, PDF, "application/pdf")).status).toBe(415);
    expect((await upload(p.worker, d.id, JPEG(10 * 1024 * 1024 + 1))).status).toBe(413);
    expect((await myClaims(p.worker, null)).claims.find((x) => x.id === c.id)!.photos).toBe(3);
  });

  it("11. not on field duty, not someone else's (404), not after 24 h, not once decided", async () => {
    const p = setup();
    await setting(p.worker);
    const f = await sendClaim(p.worker, duty());
    expect((await refusal(() => uploadClaimPhoto(p.worker, f.id, JPEG()))).message).toBe("Photos are only for expenses");
    const other = { ...p.worker, userId: crypto.randomUUID(), name: "Gaja" };
    await setting(other);
    const theirs = await sendClaim(other, expense());
    expect((await refusal(() => uploadClaimPhoto(p.worker, theirs.id, JPEG()))).status).toBe(404);
    const c = await sendClaim(p.worker, expense());
    expect((await refusal(() => uploadClaimPhoto(p.worker, c.id, JPEG(), { now: Date.now() + 25 * 3600 * 1000 }))).status).toBe(403);
    await decide(p.worker, c.id, "rejected", "no bill");
    expect((await refusal(() => uploadClaimPhoto(p.worker, c.id, JPEG()))).status).toBe(409);
    expect((await refusal(() => uploadClaimPhoto(p.support, c.id, JPEG()))).status).toBe(403);
  });

  it("12. the plan's storage limit: full → 413; crossing 80 % warns the owners once", async () => {
    const p = setup();
    await setting(p.worker);
    platform.limits.set(p.tenantId, { attendance_salary: { storage_mb: 1 } });
    const c = await sendClaim(p.worker, expense());
    expect((await upload(p.worker, c.id, JPEG(500 * 1024))).status).toBe(201); // 49 %
    expect((await upload(p.worker, c.id, JPEG(350 * 1024))).status).toBe(201); // 83 %: past 80 %
    expect((await upload(p.worker, c.id, JPEG(300 * 1024))).status).toBe(413); // would pass 100 %
    await settle();
    const warn = sent(p.tenantId).filter((n) => n.kind === "attendance_salary.storage");
    expect(warn).toEqual([expect.objectContaining({ title: "Attendance storage 80 % full", dedupe_key: "storage:80:1", link: "/claims" })]);
  });

  it("13. a photo is served to its own person and the owner (200); another worker gets 404; support is logged", async () => {
    const p = setup();
    await setting(p.worker);
    const c = await sendClaim(p.worker, expense());
    const up = (await (await upload(p.worker, c.id, JPEG())).json()) as { id: string };
    const get = (u: AtUser) => (signInAs(u), photoFile.GET(new Request(`http://localhost/claim-photos/${up.id}`), { params: Promise.resolve({ id: up.id }) }));
    const own = await get(p.worker);
    expect(own.status).toBe(200);
    expect(own.headers.get("content-type")).toBe("image/jpeg");
    expect((await get(p.owner)).status).toBe(200);
    const colleague = { ...p.worker, userId: crypto.randomUUID(), name: "Gaja" };
    expect((await get(colleague)).status).toBe(404);
    expect((await get(p.keeper)).status).toBe(404);
    expect((await get(plant().owner)).status).toBe(404); // another plant's owner
    expect((await get(p.support)).status).toBe(200);
    const { rows } = await asOwner("select path from attendance_salary.support_views where tenant_id = $1", [p.tenantId]);
    expect(rows.map((r) => r.path)).toContain(`/claim-photos/${up.id}`);
  });
});

describe("My claims", () => {
  it("14. the tab only with a salary setting; the page lists your own claims with km and your amounts, never TA / DA rupees", async () => {
    const p = setup();
    signInAs(p.worker);
    expect(await myTabs(p.worker)).toEqual({ attendanceHref: "/", claims: false, salary: false }); // no tabs at all
    await expect(MyClaimsPage({ searchParams: Promise.resolve({}) })).rejects.toThrow(/NEXT_HTTP_ERROR_FALLBACK;404|NEXT_NOT_FOUND/);

    await setting(p.worker);
    const f = await sendClaim(p.worker, duty());
    await decide(p.worker, f.id, "approved");
    await sendClaim(p.worker, expense({ on_date: addDays(TODAY, -1) }));
    const other = { ...p.worker, userId: crypto.randomUUID(), name: "Gaja" };
    await setting(other);
    await sendClaim(other, expense({ amount: "777", note: "Gaja's lunch" }));

    expect(await myTabs(p.worker)).toEqual({ attendanceHref: "/", claims: true, salary: false }); // no "Can see own salary"
    expect((await myTabs(p.ownerWorker)).claims).toBe(false); // no salary setting for them
    const page = textOf(await MyClaimsPage({ searchParams: Promise.resolve({}) })).replace(/\s+/g, " ");
    expect(page).toContain("42 km");
    expect(page).toContain("₹450");
    expect(page).toContain("+ Field duty");
    expect(page).toMatch(/field duty 1 day · 42 km/);
    expect(page).not.toMatch(/₹126|₹150|TA |DA /); // 42 km × ₹3 and the DA: never shown to the worker
    expect(page).not.toContain("777"); // nobody else's claims
    expect(page).not.toContain("Gaja");
  });

  it("15. future and too-early months 404; no '+ Field duty' in a month without a TA / DA rate", async () => {
    const p = setup();
    await setting(p.worker, null);
    expect((await refusal(() => myClaims(p.worker, addMonths(istMonth(), 1)))).status).toBe(404);
    expect((await refusal(() => myClaims(p.worker, addMonths(LAST_MONTH, -1)))).status).toBe(404);
    expect((await refusal(() => myClaims(p.owner, null))).status).toBe(404); // an owner without Plant staff
    const v = await myClaims(p.worker, null);
    expect(v).toMatchObject({ fieldDuty: false, onSalary: true });
    signInAs(p.worker);
    expect(textOf(await MyClaimsPage({ searchParams: Promise.resolve({}) }))).not.toContain("+ Field duty");
  });
});

describe("the new-claim notification when the platform is down", () => {
  it("16. kept in the outbox (503) and not sent twice", async () => {
    const p = setup();
    await setting(p.worker);
    platform.notifyStatus = 503;
    signInAs(p.worker);
    const res = await claimsRoute.POST(jsonReq("POST", "/api/claims", expense()), undefined as never);
    expect(res.status).toBe(201); // the claim is saved whatever happens to the notification
    await settle();
    const { rows } = await asOwner("select input from attendance_salary.notification_outbox where tenant_id = $1", [p.tenantId]);
    expect(rows.map((r) => (r.input as { kind: string }).kind)).toEqual(["attendance_salary.claim_new"]);
  });
});
