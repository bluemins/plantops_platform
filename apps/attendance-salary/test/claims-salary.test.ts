// Salary extras Phase B5 (docs/SALARY_EXTRAS_PHASE_PLAN.md "Where else it shows" + "Standard pieces"): TA / DA /
// expenses on the Salary tab, in the CSV and the checking panel, the mark-paid warning, the slip from the frozen
// figures, the month-end review count, the tile, support, the bill-photo backup and the storage warnings.
import { generateX25519Identity, identityToRecipient } from "age-encryption";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { S3Client } from "@plantops/module-kit/s3";
import { backupNewFiles, decryptBackup } from "@plantops/module-kit/backup";
import { POST as backupRoute } from "@/app/api/cron/backup/route";
import ClaimsPage from "@/app/claims/page";
import MySlipPage from "@/app/my/salary/[month]/page";
import { addMonths, istDay, istMonth } from "@/lib/days";
import { monthPay, panelInput } from "@/lib/salary";
import { decideClaim, sendClaim, uploadClaimPhoto } from "@/server/claims";
import { salaryReview, salaryReviewNotification, storageStepCrossed } from "@/server/notify";
import { saveVisibility } from "@/server/salary-edit";
import { payMonth } from "@/server/salary-pay";
import { mySlip } from "@/server/salary-slip";
import { salaryCsv, salaryTab, SALARY_CSV_HEADER } from "@/server/salary-tab";
import type { AtUser } from "@/server/session";
import { summaryFor } from "@/server/summary";
import { describeView, listSupportViews } from "@/server/support";
import { fileStorage } from "@/server/storage";
import { startFakePlatform, type FakePlatform } from "./fake-platform";
import { asApp, asOwner, atUser, contactsFor, ist, markAt, plant, refusal, signInAs, textOf } from "./helpers";

const pending: Promise<unknown>[] = [];
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: (fn: () => unknown) => void pending.push(Promise.resolve().then(fn)) }));

let platform: FakePlatform;
beforeAll(async () => {
  platform = await startFakePlatform();
  process.env.PLATFORM_URL = platform.url;
});
afterAll(() => platform.close());
afterEach(() => vi.restoreAllMocks());

const R = (rupees: number) => Math.round(rupees * 100);
const NOW = ist("2026-11-05 12:00"); // October is over
const oct = (n: number) => `2026-10-${String(n).padStart(2, "0")}`;
const sep = (n: number) => `2026-09-${String(n).padStart(2, "0")}`;
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(2044, 9)]);

async function setting(u: AtUser, fromMonth: string, rupees: number, over: { ot?: number; km?: number; da?: number; perDay?: number } = {}) {
  const v = {
    basis: over.perDay ? "'per_day'" : "'monthly'",
    monthly: over.perDay ? "null" : R(rupees),
    day: over.perDay ? R(over.perDay) : "null",
    leave: over.perDay ? 0 : 4,
  };
  await asApp(
    u.tenantId,
    `insert into attendance_salary.salary_settings (tenant_id, user_id, user_name, from_month, pay_basis, monthly_paise, day_rate_paise, shift_minutes, paid_leave_halfdays, gets_overtime, ot_rate_paise, km_rate_paise, da_day_paise, field_staff, created_by, created_by_name)
     values ('${u.tenantId}', '${u.userId}', '${u.name}', '${fromMonth}-01', ${v.basis}, ${v.monthly}, ${v.day}, 480, ${v.leave}, ${over.ot !== undefined}, ${over.ot !== undefined ? R(over.ot) : "null"},
             ${over.km !== undefined ? R(over.km) : "null"}, ${over.da !== undefined ? R(over.da) : "null"}, true, gen_random_uuid(), 'Sujata')`,
  );
}
async function work(u: AtUser, dates: string[], hours: number) {
  for (const d of dates) {
    await markAt(u, "in", `${d} 08:00`);
    await markAt(u, "out", `${d} ${String(8 + hours).padStart(2, "0")}:00`);
  }
}
const range = (a: number, b: number, f: (n: number) => string) => Array.from({ length: b - a + 1 }, (_, i) => f(a + i));
/** A claim written straight into the database (any date; the API's 31-day rule is tested in B3). */
async function claim(u: AtUser, kind: "field_duty" | "expense", onDate: string, value: number, status: "waiting" | "approved" | "rejected" = "approved", note = "for the plant") {
  const id = ((await asApp(
    u.tenantId,
    `insert into attendance_salary.salary_claims (tenant_id, user_id, user_name, kind, on_date, km_tenths, wants_da, amount_paise, note, created_by, created_by_name)
     values ('${u.tenantId}', '${u.userId}', '${u.name}', '${kind}', '${onDate}', ${kind === "field_duty" ? Math.round(value * 10) : "null"}, ${kind === "field_duty" ? "true" : "null"}, ${kind === "expense" ? R(value) : "null"}, '${note}', '${u.userId}', '${u.name}') returning id`,
  )).rows[0] as { id: string }).id;
  if (status !== "waiting") {
    await asApp(u.tenantId, `insert into attendance_salary.salary_claim_decisions (tenant_id, claim_id, decision, reason, created_by, created_by_name) values ('${u.tenantId}', '${id}', '${status}', ${status === "rejected" ? "'no bill'" : "null"}, gen_random_uuid(), 'Sujata')`);
  }
  return id;
}

/** Anmol = worked example B (₹12,136, one claim waiting); Ramu = per day ₹450 with no claims. */
async function claimsPlant() {
  const p = plant();
  const t = p.tenantId;
  const anmol = atUser(t, ["plant_staff"], "Anmol");
  const ramu = atUser(t, ["plant_staff"], "Ramu");
  platform.contacts = [...contactsFor(p.owner, anmol, ramu)];
  await setting(anmol, "2026-10", 12000, { ot: 60, km: 3, da: 150 });
  await work(anmol, range(1, 14, oct), 9);
  await work(anmol, range(15, 26, oct), 8);
  await work(anmol, [oct(27), oct(28)], 4); // short days: ½ day each (rule 21)
  await asApp(t, `insert into attendance_salary.salary_advances (tenant_id, user_id, user_name, on_date, amount_paise, created_by, created_by_name) values ('${t}', '${anmol.userId}', 'Anmol', '2026-10-10', ${R(3000)}, gen_random_uuid(), 'Sujata')`);
  for (const [d, km] of [[2, 30], [6, 28], [9, 35], [13, 31], [20, 26], [27, 32]] as const) await claim(anmol, "field_duty", oct(d), km);
  await claim(anmol, "expense", oct(9), 1200, "approved", "Pump repair parts");
  await claim(anmol, "expense", oct(16), 450, "approved", "Diesel for generator");
  await claim(anmol, "expense", oct(22), 300, "waiting");
  await claim(anmol, "expense", oct(24), 800, "rejected");
  await setting(ramu, "2026-10", 0, { perDay: 450 });
  await work(ramu, range(1, 20, oct), 8);
  return { p, anmol, ramu };
}

describe("the Salary tab with claims", () => {
  it("1. each row equals monthPay; TA / DA / expenses per row and in the totals; claims waiting for the banner", async () => {
    const { p } = await claimsPlant();
    const tab = await salaryTab(p.owner, "2026-10", NOW);
    for (const r of tab.rows) expect(r.result, r.name).toEqual(monthPay(r.input));
    const a = tab.rows.find((r) => r.name === "Anmol")!;
    expect(a.result).toMatchObject({ taPaise: R(546), daPaise: R(900), expensesPaise: R(1650), remainingPaise: R(12136) });
    expect(a).toMatchObject({ fieldDutyDays: 6, kmTenths: 1820, kmRatePaise: R(3), daDayPaise: R(150), claimsWaiting: 1 });
    const r = tab.rows.find((x) => x.name === "Ramu")!;
    expect(r.result).toMatchObject({ taPaise: 0, daPaise: 0, expensesPaise: 0, earnedPaise: R(20 * 450) });
    expect(tab.totals).toMatchObject({ taPaise: R(546), daPaise: R(900), expensesPaise: R(1650), remainingPaise: R(12136 + 9000) });
    expect(tab.claimsWaiting).toBe(1);
  });

  it("2. the CSV: eight claim columns, blank rates for someone without TA / DA", async () => {
    const { p } = await claimsPlant();
    const lines = (await salaryCsv(p.owner, "2026-10", NOW)).replace(/^﻿/, "").trim().split("\r\n");
    expect(lines[0]).toBe(SALARY_CSV_HEADER.join(","));
    const cells = (name: string) => {
      const c = lines.find((l) => l.startsWith(`${name},`))!.split(",");
      return (h: string) => c[SALARY_CSV_HEADER.indexOf(h)];
    };
    const cols = ["Field duty days", "Km", "TA rate", "TA", "DA rate", "DA", "Expenses", "Claims waiting", "Remaining"];
    expect(cols.map(cells("Anmol"))).toEqual(["6", "182", "3.00", "546.00", "150.00", "900.00", "1650.00", "1", "12136.00"]);
    expect(cols.map(cells("Ramu"))).toEqual(["0", "0", "", "0.00", "", "0.00", "0.00", "0", "9000.00"]);
  });

  it("3. the checking panel: typed TA / DA / expenses change 'yours'; the same monthPay", async () => {
    const { p } = await claimsPlant();
    const a = (await salaryTab(p.owner, "2026-10", NOW)).rows.find((r) => r.name === "Anmol")!;
    expect(monthPay(panelInput(a.input, {})).remainingPaise).toBe(R(12136));
    // the owner's notebook says 190 km (₹570) and no DA for the 27th: ₹24 more TA, ₹150 less DA
    expect(monthPay(panelInput(a.input, { ta: "570", da: "750" })).remainingPaise).toBe(R(12136 + 24 - 150));
    expect(monthPay(panelInput(a.input, { expenses: "1950" })).remainingPaise).toBe(R(12136 + 300)); // with the waiting ₹300
  });

  it("4. the mark-paid warning only when the person has claims waiting that month", async () => {
    const { p } = await claimsPlant();
    const rows = (await salaryTab(p.owner, "2026-10", NOW)).rows;
    expect(rows.find((r) => r.name === "Anmol")!.claimsWaiting).toBe(1); // the dialog shows "1 claim for October is still waiting…"
    expect(rows.find((r) => r.name === "Ramu")!.claimsWaiting).toBe(0); // no warning
  });
});

describe("paid months and the slip", () => {
  /** September (over, payable): Ramu ₹12,000 with TA / DA, field duty on 2 dates (60 km), one ₹450 expense, one waiting. */
  async function septemberPlant() {
    const p = plant();
    platform.contacts = [...contactsFor(p.owner, p.worker)];
    const w = p.worker;
    await setting(w, "2026-09", 12000, { km: 3, da: 150 });
    await work(w, range(1, 30, sep), 8);
    await claim(w, "field_duty", sep(3), 25);
    await claim(w, "field_duty", sep(17), 35);
    await claim(w, "expense", sep(12), 450, "approved", "Diesel for generator");
    const waiting = await claim(w, "expense", sep(25), 300, "waiting", "Tea for visitors");
    await saveVisibility(p.owner, { user_id: w.userId, can_see: true, expect: null });
    return { p, w, waiting };
  }

  it("5. the slip shows field duty, TA, DA and each expense from the frozen figures", async () => {
    const { p, w } = await septemberPlant();
    // 12,000 + TA 60 km × ₹3 = ₹180 + DA 2 × ₹150 = ₹300 + ₹450 = ₹12,930
    await payMonth(p.owner, { user_id: w.userId, month: "2026-09", paid_on: "2026-09-30", note: "UPI", expect_remaining: R(12930) } as never);
    const slip = await mySlip(w, "2026-09");
    expect(slip.figures).toMatchObject({ rules: 6, fieldDutyDays: 2, kmTenths: 600 });
    expect(slip.figures.claims.map((c) => [c.kind, c.onDate])).toEqual([["field_duty", sep(3)], ["expense", sep(12)], ["field_duty", sep(17)]]);
    signInAs(w);
    const text = textOf(await MySlipPage({ params: Promise.resolve({ month: "2026-09" }) })).replace(/\s+/g, " ");
    expect(text).toContain("Field duty 2 days · 60 km");
    expect(text).toContain("TA 60 km × ₹3 +₹180");
    expect(text).toContain("DA 2 days × ₹150 +₹300");
    expect(text).toMatch(/12 Sept · Diesel for generator \+ ?₹450/);
    expect(text).toContain("Expenses +₹450");
    expect(text).not.toContain("Tea for visitors"); // the waiting one isn't on the slip
    expect(text).toContain("₹12,930");
  });

  it("6. a claim approved after payment shows as 'Changed after payment' and goes to October once", async () => {
    const { p, w, waiting } = await septemberPlant();
    await payMonth(p.owner, { user_id: w.userId, month: "2026-09", paid_on: "2026-09-30", expect_remaining: R(12930) } as never);
    await decideClaim(p.owner, { claim_id: waiting, decision: "approve" });
    const sepRow = (await salaryTab(p.owner, "2026-09", NOW)).rows[0]!;
    expect(sepRow.changedPaise).toBe(R(300));
    expect(sepRow.result.remainingPaise).toBe(R(12930)); // the paid row keeps its frozen figures
    await setting(w, "2026-10", 12000, { km: 3, da: 150 });
    const octRow = (await salaryTab(p.owner, "2026-10", NOW)).rows[0]!;
    expect(octRow.result.adjustmentPaise).toBe(R(300));
    expect(octRow.adjustmentFrom).toBe("2026-09");
  });

  it("7. a slip frozen before claims (rules 2) has no field duty or expense lines", async () => {
    const p = plant();
    platform.contacts = [...contactsFor(p.owner, p.worker)];
    const w = p.worker;
    await setting(w, "2026-09", 12000);
    await saveVisibility(p.owner, { user_id: w.userId, can_see: true, expect: null });
    const v2 = {
      rules: 2,
      month: "2026-09",
      setting: { payBasis: "monthly", monthlyPaise: R(12000), dayRatePaise: null, shiftMinutes: 480, paidLeaveHalfdays: 4, getsOvertime: false, otRatePaise: null, joinedOn: null, leftOn: null },
      counted: { dates: [], monthLength: 30, fullMonth: true, complete: true },
      counts: { present: 30, half: 0, absent: 0, otMinutes: 0 },
      advances: [],
      adjustmentFrom: null,
      input: { payBasis: "monthly", dayRatePaise: null, present: 30, half: 0, absent: 0, otMinutes: 0, monthlyPaise: R(12000), fullMonth: true, paidLeaveHalfdays: 4, getsOvertime: false, otRatePaise: null, advancesPaise: 0, carriedInPaise: 0, adjustmentPaise: 0 },
      result: monthPay({ payBasis: "monthly", dayRatePaise: null, present: 30, half: 0, absent: 0, otMinutes: 0, monthlyPaise: R(12000), fullMonth: true, paidLeaveHalfdays: 4, getsOvertime: false, otRatePaise: null, advancesPaise: 0, taPaise: 0, daPaise: 0, expensesPaise: 0, carriedInPaise: 0, adjustmentPaise: 0 }),
    };
    const { taPaise: _a, daPaise: _b, expensesPaise: _c, ...oldResult } = v2.result;
    await asApp(
      p.tenantId,
      `insert into attendance_salary.salary_payments (tenant_id, user_id, user_name, month, paid_on, paid_paise, remaining_paise, figures, created_by, created_by_name)
       values ('${p.tenantId}', '${w.userId}', '${w.name}', '2026-09-01', '2026-09-30', ${R(12000)}, ${R(12000)}, '${JSON.stringify({ ...v2, result: oldResult })}', gen_random_uuid(), 'Sujata')`,
    );
    const slip = await mySlip(w, "2026-09");
    expect(slip.figures).toMatchObject({ claims: [], fieldDutyDays: 0, kmTenths: 0, result: { taPaise: 0, daPaise: 0, expensesPaise: 0 } });
    signInAs(w);
    const text = textOf(await MySlipPage({ params: Promise.resolve({ month: "2026-09" }) }));
    expect(text).not.toMatch(/Field duty|Expenses|TA |DA /);
  });
});

describe("standard pieces", () => {
  it("8. the month-end review says how many claims wait", async () => {
    expect(salaryReviewNotification("2026-10", 1, 2, 3).body).toBe("1 day with no exit to fix · 2 people without salary · 3 claims waiting");
    expect(salaryReviewNotification("2026-10", 0, 0, 1).body).toBe("1 claim waiting");
    expect(salaryReviewNotification("2026-10", 0, 0).body).toBe("All set: check the figures and mark them paid");
    const { p } = await claimsPlant();
    expect((await salaryReview(p.tenantId, ist("2026-10-31 07:00"))).claimsWaiting).toBe(1);
  });

  it("9. the owner's tile adds 'N claims waiting', still at most 3 badges", async () => {
    const { p, anmol } = await claimsPlant();
    await asApp(p.tenantId, `insert into attendance_salary.plant_settings (tenant_id, lat, lng, radius_m, qr_key_hash, qr_made_at, updated_by, updated_by_name) values ('${p.tenantId}', 20.3, 85.8, 200, '${"a".repeat(64)}', now(), gen_random_uuid(), 'Sujata')`);
    const s = await summaryFor(p.tenantId, "owner", ist("2026-11-05 12:00"));
    expect(s.badges.map((b) => b.text)).toContain("1 claim waiting");
    expect(s.badges.length).toBeLessThanOrEqual(3);
    expect((await summaryFor(p.tenantId, "staff")).badges).toEqual([]);
    expect(s.badges.some((b) => /₹/.test(b.text))).toBe(false); // no money on the launcher
    void anmol;
  });

  it("10. support sees the Claims tab (logged as 'the Claims tab') and can't decide, enter or send", async () => {
    const { p, anmol } = await claimsPlant();
    signInAs(p.support);
    const page = textOf(await ClaimsPage({ searchParams: Promise.resolve({ month: "2026-10" }) }));
    expect(page).toContain("October 2026");
    const views = await listSupportViews(p.owner);
    expect(views.map((v) => v.what)).toContain("the Claims tab");
    expect(describeView("/claim-photos/x")).toBe("a bill photo");
    const waiting = (await asOwner("select c.id from attendance_salary.salary_claims c where c.tenant_id = $1 and c.amount_paise = $2", [p.tenantId, R(300)])).rows[0] as { id: string };
    expect((await refusal(() => decideClaim(p.support, { claim_id: waiting.id, decision: "approve" }))).message).toBe("PlantOps support view is read-only");
    expect((await refusal(() => sendClaim(p.support, { kind: "expense", on_date: oct(1), km: null, amount: "1", note: "nope" }))).status).toBe(403);
    void anmol;
  });

  it("11. storage warnings at 80 % and 95 %, once each", () => {
    const MB = 1024 * 1024;
    expect(storageStepCrossed(0.79 * MB, 0.81 * MB, MB)).toBe(80);
    expect(storageStepCrossed(0.81 * MB, 0.9 * MB, MB)).toBeNull(); // already past 80 %
    expect(storageStepCrossed(0.9 * MB, 0.96 * MB, MB)).toBe(95);
    expect(storageStepCrossed(0.5 * MB, 0.97 * MB, MB)).toBe(95); // both at once: the higher one
    expect(storageStepCrossed(0.96 * MB, 0.99 * MB, MB)).toBeNull();
  });
});

describe("nightly bill-photo backup", () => {
  function memoryBucket() {
    const objects = new Map<string, Buffer>();
    const client: S3Client = {
      put: async (key, data) => void objects.set(key, Buffer.from(data)),
      get: async (key) => objects.get(key) ?? Promise.reject(new Error("404")),
      list: async (prefix) => [...objects.keys()].filter((k) => k.startsWith(prefix)),
    };
    return { objects, client };
  }

  it("12. new photos only, encrypted, under files/attendance_salary/; they decrypt to the same bytes", async () => {
    const identity = await generateX25519Identity();
    const recipient = await identityToRecipient(identity);
    const p = plant();
    platform.contacts = [...contactsFor(p.owner, p.worker)];
    await setting(p.worker, addMonths(istMonth(), -1), 12000); // on salary from last month, so today is inside it
    const c = await sendClaim(p.worker, { kind: "expense", on_date: istDay(), km: null, amount: "450", note: "Diesel" });
    const photo = await uploadClaimPhoto(p.worker, c.id, JPEG);
    const bucket = memoryBucket();
    const settings = { bucket: "plantops-backup", endpoint: "https://r2.example", region: "auto", accessKey: "a", secretKey: "s", recipient };
    const run = () => backupNewFiles("attendance_salary", fileStorage(), { settings, target: bucket.client });
    expect((await run()).status).toBe("ok");
    const { storage_key } = (await asOwner<{ storage_key: string }>("select storage_key from attendance_salary.salary_claim_files where id = $1", [photo.id])).rows[0]!;
    const copy = bucket.objects.get(`files/attendance_salary/${storage_key}.age`)!;
    expect(copy.includes(JPEG)).toBe(false);
    expect((await decryptBackup(copy, identity)).equals(JPEG)).toBe(true);
    expect(await run()).toMatchObject({ status: "ok", copied: 0 });
  });

  it("13. the route needs the CRON_SECRET; without BACKUP_BUCKET it says 'not set up'", async () => {
    const before = { secret: process.env.CRON_SECRET, bucket: process.env.BACKUP_BUCKET };
    try {
      process.env.CRON_SECRET = "attendance-backup-test-secret";
      delete process.env.BACKUP_BUCKET;
      const call = (secret?: string) => backupRoute(new Request("http://localhost:3006/api/cron/backup", { method: "POST", headers: secret ? { "x-cron-secret": secret } : {} }));
      expect((await call()).status).toBe(401);
      expect((await call("wrong")).status).toBe(401);
      const ok = await call("attendance-backup-test-secret");
      expect(ok.status).toBe(200);
      expect(await ok.json()).toEqual({ status: "not set up" });
    } finally {
      if (before.secret === undefined) delete process.env.CRON_SECRET;
      else process.env.CRON_SECRET = before.secret;
      if (before.bucket !== undefined) process.env.BACKUP_BUCKET = before.bucket;
    }
  });
});
