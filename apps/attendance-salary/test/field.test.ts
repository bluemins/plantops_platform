// Field day log, Phase 2 (docs/FIELD_DAY_PHASE_PLAN.md; migration 0014): Field staff record start / visits / end on
// their own phone; the owner, Supervisors (read-only) and the person see it; nothing touches claims or pay. Real
// database and server functions, a fake platform (lookup tickets) and a fake Sales; dates relative to today.
import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { addDays, istDay, istMonth } from "@/lib/days";
import { fieldDayView, openDayFor, parseKm } from "@/lib/field";
import { recentChanges } from "@/server/audit";
import {
  addVisit,
  correctStartEnd,
  endDay,
  fieldCsv,
  fieldDay,
  fieldMonth,
  hasFieldDay,
  inTheField,
  metersFor,
  myFieldDay,
  readFieldPhoto,
  removeVisit,
  searchCustomers,
  sendShopLocation,
  startDay,
  uploadFieldPhoto,
} from "@/server/field";
import { saveSetting } from "@/server/salary-edit";
import type { AtUser } from "@/server/session";
import { startFakePlatform, type FakePlatform } from "./fake-platform";
import { asApp, atUser, contactsFor, dbError, plant, refusal, seedPlant } from "./helpers";

vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: () => {} }));

// ---------- a fake Sales ----------
interface FakeSales {
  url: string;
  mode: "ok" | "down";
  customers: { id: string; name: string; place: string; location: null | { at: string; by: string; source: string } }[];
  /** location saves received, by visit id (a resend of the same visit saves nothing more) */
  saved: Map<string, { customerId: string; body: Record<string, unknown> }>;
  searches: string[];
  close(): Promise<void>;
}
async function startFakeSales(): Promise<FakeSales> {
  const fake = { mode: "ok" as "ok" | "down", customers: [] as FakeSales["customers"], saved: new Map<string, { customerId: string; body: Record<string, unknown> }>(), searches: [] as string[] };
  const server: Server = createServer(async (req, res) => {
    const send = (code: number, body: unknown) => {
      res.writeHead(code, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (fake.mode === "down") return send(503, { error: "down" });
    if (!req.headers.authorization?.startsWith("Bearer fake-")) return send(401, { error: "no ticket" });
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const url = new URL(req.url ?? "", "http://x");
    if (url.pathname === "/api/plantops/customers") {
      const q = url.searchParams.get("q") ?? "";
      fake.searches.push(q);
      return send(200, { customers: fake.customers.filter((c) => c.name.toLowerCase().includes(q.toLowerCase())) });
    }
    const loc = /^\/api\/plantops\/customers\/([^/]+)\/location$/.exec(url.pathname);
    if (loc) {
      const body = JSON.parse(raw) as Record<string, unknown>;
      if (!fake.customers.some((c) => c.id === loc[1])) return send(404, { error: "Customer not found" });
      const already = fake.saved.has(body.visit_id as string);
      if (!already) fake.saved.set(body.visit_id as string, { customerId: loc[1]!, body });
      return send(200, { saved: true, already });
    }
    if (url.pathname === "/api/plantops/locations/by-visit") {
      const ids = (JSON.parse(raw) as { visit_ids: string[] }).visit_ids;
      return send(200, { saved: ids.filter((id) => fake.saved.has(id)) });
    }
    send(404, {});
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return Object.assign(fake, { url: `http://127.0.0.1:${(server.address() as { port: number }).port}`, close: () => new Promise<void>((r) => server.close(() => r())) });
}

let platform: FakePlatform;
let sales: FakeSales;
beforeAll(async () => {
  platform = await startFakePlatform();
  process.env.PLATFORM_URL = platform.url;
  sales = await startFakeSales();
});
afterAll(async () => {
  await platform.close();
  await sales.close();
});
beforeEach(() => {
  platform.salesUrl = sales.url;
  sales.mode = "ok";
});

const TODAY = istDay();
const YESTERDAY = addDays(TODAY, -1);
const THIS = istMonth();
const NOT_FOUND = /NEXT_HTTP_ERROR_FALLBACK;404|NEXT_NOT_FOUND|not found/i;
const JPEG = (size = 2048) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(size - 4, 7)]);
const here = { lat: 20.8742, lng: 86.4931, accuracy_m: 12 };

/** A plant with a Field staff worker (ticked this month), a worker not ticked, Office staff and a Supervisor. */
async function setup(opts: { tick?: boolean } = {}) {
  const p = plant();
  const office = atUser(p.tenantId, ["office_staff"], "Anita");
  const supervisor = atUser(p.tenantId, ["supervisor"], "Bikash");
  const other = atUser(p.tenantId, ["plant_staff"], "Manoj");
  platform.contacts = [...contactsFor(p.owner, p.ownerWorker, p.worker, p.keeper, office, supervisor, other)];
  await saveSetting(p.owner, { user_id: p.worker.userId, pay_basis: "monthly", monthly: "12000", shift_hours: 8, leave_days: 2, gets_overtime: false, from_month: THIS, joined_on: null, left_on: null, reason: null, expect: null, field_staff: opts.tick ?? true } as never);
  await saveSetting(p.owner, { user_id: other.userId, pay_basis: "monthly", monthly: "12000", shift_hours: 8, leave_days: 2, gets_overtime: false, from_month: THIS, joined_on: null, left_on: null, reason: null, expect: null, field_staff: false } as never);
  return { ...p, office, supervisor, other };
}

const photo = async (u: AtUser, forId?: string) => (await uploadFieldPhoto(u, JPEG(), { personId: forId ?? null })).id;
const start = async (u: AtUser, kmTyped = "45210.5", over: Record<string, unknown> = {}) => startDay(u, { ...here, place: "Plant gate", km: kmTyped, photo_id: await photo(u), ...over } as never);
const end = async (u: AtUser, kmTyped = "45294.8", over: Record<string, unknown> = {}) => endDay(u, { ...here, place: "Plant gate", km: kmTyped, photo_id: await photo(u), ...over } as never);
const visit = (u: AtUser, over: Record<string, unknown> = {}) => addVisit(u, { ...here, accuracy_m: 8, customer_id: null, customer_name: "New shop near bus stand", customer_place: null, phone: null, note: null, save_location: null, ...over } as never);

/** A start row for `date` straight in the database (yesterday's round: the app only starts today). */
async function startOn(u: AtUser, date: string, kmTenths = 100000) {
  const f = (await asApp(u.tenantId, `insert into attendance_salary.field_event_files (tenant_id, user_id, storage_key, content_type, size_bytes, sha256, created_by, created_by_name)
    values ('${u.tenantId}', '${u.userId}', 'tenant/${u.tenantId}/${randomUUID()}', 'image/jpeg', 100, '${"c".repeat(64)}', '${u.userId}', '${u.name}') returning id`)).rows[0]!.id as string;
  await asApp(u.tenantId, `insert into attendance_salary.field_events (tenant_id, user_id, user_name, on_date, kind, lat, lng, accuracy_m, km_tenths, photo_file_id, created_by, created_by_name, created_at)
    values ('${u.tenantId}', '${u.userId}', '${u.name}', '${date}', 'start', 20.87, 86.49, 10, ${kmTenths}, '${f}', '${u.userId}', '${u.name}', '${date}T09:00:00+05:30')`);
}

describe("the pure rules", () => {
  it("km as typed; the open day after midnight; the newest start / end counts, the first time is kept", () => {
    expect(parseKm("45210.5")).toBe(452105);
    expect(parseKm("45,210")).toBe(452100);
    for (const bad of ["", "1.25", "-3", "12345678", "abc"]) expect(parseKm(bad), bad).toBeNull();
    const s = { today: { started: false, ended: false }, yesterday: { started: true, ended: false } };
    expect(openDayFor("2026-11-18", "2026-11-17", s)).toBe("2026-11-17");
    expect(openDayFor("2026-11-18", "2026-11-17", { ...s, yesterday: { started: true, ended: true } })).toBeNull();
    expect(openDayFor("2026-11-18", "2026-11-17", { ...s, today: { started: true, ended: false } })).toBe("2026-11-18");
    const row = (id: string, kind: "start" | "end" | "visit", at: string, over = {}) =>
      ({ id, userId: "u", userName: "Ravi", onDate: "2026-11-17", kind, lat: 1, lng: 1, accuracyM: 10, placeText: null, kmTenths: kind === "visit" ? null : 100, photoFileId: null, correctsId: null, reason: null, customerId: null, customerName: kind === "visit" ? "Shop" : null, customerPlace: null, customerPhone: null, saveLocation: null, note: null, createdBy: "u", createdByName: "Ravi", at, ...over });
    const d = fieldDayView(
      "2026-11-17",
      [row("s1", "start", "2026-11-17T03:40:00Z", { kmTenths: 452105 }), row("v1", "visit", "2026-11-17T04:35:00Z"), row("v2", "visit", "2026-11-17T06:10:00Z", { accuracyM: 640 }), row("e1", "end", "2026-11-17T13:10:00Z", { kmTenths: 452948 }), row("s2", "start", "2026-11-17T13:20:00Z", { kmTenths: 452200, correctsId: "s1", reason: "typo" })],
      [{ eventId: "v1", reason: "wrong shop", createdByName: "Ravi", at: "2026-11-17T04:40:00Z" }],
    );
    expect(d.start!.id).toBe("s2");
    expect(d.startedAt).toBe("2026-11-17T03:40:00Z"); // the original time
    expect(d.kmTenths).toBe(452948 - 452200);
    expect(d.visits.map((v) => v.id)).toEqual(["v2"]);
    expect(d.timeline.find((t) => t.id === "s1")!.replaced).toBe(true);
    expect(d.timeline.find((t) => t.id === "v1")!.removed).toMatchObject({ reason: "wrong shop" });
    expect(d.anyRough).toBe(true);
    expect(d.notEnded).toBe(false);
  });
});

describe("the database checks", () => {
  it("a start needs km and a photo, a visit names a shop and has no km, a correction needs a reason, location all or none", async () => {
    const p = plant();
    const ids = await seedPlant(p.tenantId);
    const base = `tenant_id, user_id, user_name, on_date, created_by, created_by_name`;
    const vals = `'${p.tenantId}', '${ids.worker}', 'Ramu', '2026-11-17', '${ids.worker}', 'Ramu'`;
    const bad = async (cols: string, values: string, why: RegExp) =>
      expect(await dbError(asApp(p.tenantId, `insert into attendance_salary.field_events (${base}, ${cols}) values (${vals}, ${values})`))).toMatch(why);
    await bad(`kind, lat, lng, accuracy_m, km_tenths`, `'start', 1, 1, 5, 100`, /check/); // no photo
    await bad(`kind, lat, lng, accuracy_m, photo_file_id`, `'start', 1, 1, 5, '${ids.fieldFile}'`, /check/); // no km
    await bad(`kind, lat, lng, accuracy_m, km_tenths, customer_name`, `'visit', 1, 1, 5, 100, 'Shop'`, /check/); // km on a visit
    await bad(`kind, lat, lng, accuracy_m`, `'visit', 1, 1, 5`, /check/); // a visit with no shop
    await bad(`kind, lat, accuracy_m, customer_name`, `'visit', 1, 5, 'Shop'`, /check/); // lat without lng
    await bad(`kind, customer_name, customer_id, customer_phone`, `'visit', 'Shop', gen_random_uuid(), '9861023456'`, /check/); // phone with a customer
    await bad(`kind, customer_name, save_location`, `'visit', 'Shop', true`, /check/); // the tick on a typed shop
    await bad(`kind, km_tenths, photo_file_id, corrects_id`, `'start', 100, '${ids.fieldFile}', '${ids.fieldStart}'`, /check/); // a correction without a reason
    await bad(`kind, customer_name, corrects_id, reason`, `'visit', 'Shop', '${ids.fieldStart}', 'oops'`, /check/); // visits aren't corrected
    // a visit is removed once
    expect(await dbError(asApp(p.tenantId, `insert into attendance_salary.field_event_cancels (tenant_id, event_id, reason, created_by, created_by_name) values ('${p.tenantId}', '${ids.fieldVisit}', 'again', gen_random_uuid(), 'x')`))).toMatch(/unique|duplicate/);
    // plant B can't point at plant A's photo or row
    const b = plant();
    expect(await dbError(asApp(b.tenantId, `insert into attendance_salary.field_events (${base}, kind, km_tenths, photo_file_id) values ('${b.tenantId}', gen_random_uuid(), 'X', '2026-11-17', gen_random_uuid(), 'x', 'start', 100, '${ids.fieldFile}')`))).toMatch(/foreign key/);
    expect(await dbError(asApp(b.tenantId, `insert into attendance_salary.field_event_cancels (tenant_id, event_id, reason, created_by, created_by_name) values ('${b.tenantId}', '${ids.fieldVisit}', 'not yours', gen_random_uuid(), 'x')`))).toMatch(/foreign key/);
  });
});

describe("who may use it", () => {
  it("only Plant staff with the Field staff tick: not ticked → 404; Office staff → 404; an owner without Plant staff → refused", async () => {
    const p = await setup();
    expect(await hasFieldDay(p.worker)).toBe(true);
    expect(await hasFieldDay(p.other)).toBe(false);
    expect(await hasFieldDay(p.office)).toBe(false);
    expect((await refusal(() => start(p.other))).status).toBe(404);
    expect((await refusal(() => myFieldDay(p.other))).status).toBe(404);
    expect((await refusal(() => myFieldDay(p.office))).status).toBe(404);
    expect((await refusal(() => uploadFieldPhoto(p.office, JPEG()))).status).toBe(404);
    expect((await refusal(() => fieldMonth(p.office, p.worker.userId, null))).status).toBe(404);
    expect((await refusal(() => start(p.owner))).status).toBe(403); // no Plant staff: no own field day
    expect((await refusal(() => fieldDay(p.keeper, p.worker.userId, TODAY))).status).toBe(404);
  });

  it("a Supervisor and support read every field day; every write is refused; a worker can't read someone else's day", async () => {
    const p = await setup();
    await start(p.worker);
    expect((await fieldDay(p.supervisor, p.worker.userId, TODAY)).day.start!.kmTenths).toBe(452105);
    expect((await fieldDay(p.support, p.worker.userId, TODAY)).canFix).toBe(false);
    expect((await fieldMonth(p.supervisor, p.worker.userId, null)).canExport).toBe(false);
    const day = await fieldDay(p.owner, p.worker.userId, TODAY);
    for (const who of [p.supervisor, p.support]) {
      expect((await refusal(() => correctStartEnd(who, { event_id: day.day.start!.id, km: "45000", reason: "test" }))).status, who.name).toBeGreaterThanOrEqual(403);
      expect((await refusal(() => fieldCsv(who, p.worker.userId, THIS))).status, who.name).toBeGreaterThanOrEqual(403);
      expect((await refusal(() => startDay(who, {} as never))).status, who.name).toBeGreaterThanOrEqual(403);
    }
    expect((await refusal(() => fieldDay(p.other, p.worker.userId, TODAY))).status).toBe(404);
    // plant B's owner sees nothing of plant A
    const b = plant();
    expect((await refusal(() => fieldDay(b.owner, p.worker.userId, TODAY))).status).toBe(404);
  });
});

describe("start, visits, end", () => {
  it("today only and once; a visit or end before the start is refused; end below start refused; km by meter", async () => {
    const p = await setup();
    expect((await refusal(() => visit(p.worker))).message).toBe("Start your day first");
    expect((await refusal(() => end(p.worker))).message).toBe("Start your day first");
    const s = await start(p.worker);
    expect(s.on_date).toBe(TODAY);
    expect((await refusal(() => start(p.worker))).status).toBe(409);
    await visit(p.worker);
    expect((await refusal(() => end(p.worker, "45000"))).message).toMatch(/can't be below the start/);
    const e = await end(p.worker);
    expect(e.km_tenths).toBe(843);
    expect((await refusal(() => end(p.worker))).status).toBe(409);
    expect((await refusal(() => visit(p.worker))).status).toBe(409);
    const mine = await myFieldDay(p.worker);
    expect(mine.day.kmTenths).toBe(843);
    expect(mine.canStart).toBe(false);
  });

  it("no location → refused with help; a rough fix (±640 m) is saved and marked; the tick is refused on a rough fix", async () => {
    const p = await setup();
    expect((await refusal(() => start(p.worker, "100", { lat: null, lng: null, accuracy_m: null }))).message).toMatch(/No location/);
    await start(p.worker);
    const v = await visit(p.worker, { accuracy_m: 640 });
    expect(v.rough).toBe(true);
    expect((await myFieldDay(p.worker)).day.anyRough).toBe(true);
    expect((await refusal(() => visit(p.worker, { accuracy_m: 640, customer_id: randomUUID(), customer_name: "Sai Stores", save_location: true }))).message).toMatch(/too rough/);
  });

  it("a typed shop may have a phone (Indian mobile), never the tick; a customer has no phone", async () => {
    const p = await setup();
    await start(p.worker);
    await visit(p.worker, { phone: "+91 98610 23456" });
    expect((await myFieldDay(p.worker)).day.visits[0]!.customerPhone).toBe("9861023456");
    expect((await refusal(() => visit(p.worker, { phone: "12345" }))).message).toMatch(/Indian mobile/);
    expect((await refusal(() => visit(p.worker, { save_location: true }))).message).toMatch(/typed shop/);
    expect((await refusal(() => visit(p.worker, { customer_id: randomUUID(), phone: "9861023456" }))).message).toMatch(/only for a shop/);
  });

  it("after midnight: a visit and the End go to last night's open round; a new start today is still allowed", async () => {
    const p = await setup();
    await startOn(p.worker, YESTERDAY, 450000);
    expect(await hasFieldDay(p.worker)).toBe(true);
    expect((await myFieldDay(p.worker)).day.date).toBe(YESTERDAY);
    expect((await visit(p.worker)).on_date).toBe(YESTERDAY);
    const e = await end(p.worker, "45100");
    expect(e.on_date).toBe(YESTERDAY);
    expect(e.km_tenths).toBe(1000);
    // the round is closed; today starts fresh
    expect((await myFieldDay(p.worker)).canStart).toBe(true);
    expect((await start(p.worker, "45200")).on_date).toBe(TODAY);
  });

  it("photos: someone else's or an already used photo is refused; the storage limit counts claim and field photos", async () => {
    const p = await setup();
    const theirs = await photo(p.ownerWorker);
    expect((await refusal(() => start(p.worker, "100", { photo_id: theirs }))).message).toMatch(/photo of the meter again/);
    const mine = await photo(p.worker);
    await startDay(p.worker, { ...here, place: null, km: "100", photo_id: mine } as never);
    await visit(p.worker);
    expect((await refusal(() => endDay(p.worker, { ...here, place: null, km: "200", photo_id: mine } as never))).message).toMatch(/already saved/);
    expect((await readFieldPhoto(p.worker, mine)).contentType).toBe("image/jpeg");
    expect((await readFieldPhoto(p.supervisor, mine)).contentType).toBe("image/jpeg");
    expect((await refusal(() => readFieldPhoto(p.other, mine))).status).toBe(404);
    // a 1 MB plan: the claim photo already counted (seeded 1,234 bytes) plus field photos stop at the limit
    const q = await setup();
    platform.limits.set(q.tenantId, { attendance_salary: { storage_mb: 1 } });
    await asApp(q.tenantId, `insert into attendance_salary.salary_claims (tenant_id, user_id, user_name, kind, on_date, amount_paise, note, created_by, created_by_name) values ('${q.tenantId}', '${q.worker.userId}', 'Ramu', 'expense', '${TODAY}', 100, 'diesel x', '${q.worker.userId}', 'Ramu')`);
    const claimId = (await asApp(q.tenantId, `select id from attendance_salary.salary_claims limit 1`)).rows[0]!.id;
    await asApp(q.tenantId, `insert into attendance_salary.salary_claim_files (tenant_id, claim_id, storage_key, content_type, size_bytes, sha256, created_by, created_by_name) values ('${q.tenantId}', '${claimId}', 'tenant/x/${randomUUID()}', 'image/jpeg', ${1024 * 1024 - 1000}, '${"d".repeat(64)}', gen_random_uuid(), 'x')`);
    expect((await refusal(() => uploadFieldPhoto(q.worker, JPEG(2048)))).status).toBe(413);
  });
});

describe("mistakes", () => {
  it("correct a km: a new row with a reason, the newest counts, the old one stays replaced; end still ≥ start; audited", async () => {
    const p = await setup();
    await start(p.worker);
    await end(p.worker);
    const d = await fieldDay(p.owner, p.worker.userId, TODAY);
    expect((await refusal(() => correctStartEnd(p.worker, { event_id: d.day.end!.id, km: "45294", reason: "" }))).message).toMatch(/Write why/);
    expect((await refusal(() => correctStartEnd(p.worker, { event_id: d.day.end!.id, km: "45000", reason: "typo on the meter" }))).message).toMatch(/below the start/);
    await correctStartEnd(p.worker, { event_id: d.day.end!.id, km: "45300.0", reason: "typo on the meter" });
    const after = await fieldDay(p.owner, p.worker.userId, TODAY);
    expect(after.day.kmTenths).toBe(453000 - 452105);
    expect(after.day.timeline.filter((t) => t.replaced).map((t) => t.id)).toEqual([d.day.end!.id]);
    expect(after.day.end!.photoFileId).toBe(d.day.end!.photoFileId); // the photo kept
    // correcting the replaced one again: 409
    expect((await refusal(() => correctStartEnd(p.worker, { event_id: d.day.end!.id, km: "45301", reason: "again" }))).status).toBe(409);
    expect((await recentChanges(p.owner)).map((c) => c.text)).toContainEqual(expect.stringMatching(/^Corrected Ramu's field day end km on .+: 45,294\.8 → 45,300\.0 km: typo on the meter$/));
  });

  it("remove a visit: once, with a reason; the person on the same day only, the owner any day", async () => {
    const p = await setup();
    await startOn(p.worker, addDays(TODAY, -3));
    const old = (await asApp(p.tenantId, `insert into attendance_salary.field_events (tenant_id, user_id, user_name, on_date, kind, lat, lng, accuracy_m, customer_name, created_by, created_by_name)
      values ('${p.tenantId}', '${p.worker.userId}', 'Ramu', '${addDays(TODAY, -3)}', 'visit', 21.05, 86.50, 9, 'Old shop', '${p.worker.userId}', 'Ramu') returning id`)).rows[0]!.id as string;
    expect((await refusal(() => removeVisit(p.worker, { event_id: old, reason: "wrong shop" }))).message).toMatch(/same day only/);
    await removeVisit(p.owner, { event_id: old, reason: "wrong shop" });
    expect((await refusal(() => removeVisit(p.owner, { event_id: old, reason: "again" }))).status).toBe(409);
    await start(p.worker);
    const v = await visit(p.worker);
    await removeVisit(p.worker, { event_id: v.id, reason: "picked the wrong shop" });
    const mine = await myFieldDay(p.worker);
    expect(mine.day.visits).toEqual([]);
    expect(mine.day.removedVisits).toBe(1);
    expect((await refusal(() => removeVisit(p.other, { event_id: v.id, reason: "not mine" }))).status).toBe(404);
  });
});

describe("Sales: the customer search and the shop's location", () => {
  it("search answers through a ticket the browser never sees; Sales off or down → unavailable", async () => {
    const p = await setup();
    const sai = { id: randomUUID(), name: "Sai Stores", place: "Bhadrak", location: null };
    sales.customers = [sai];
    expect(await searchCustomers(p.worker, "sai")).toEqual({ available: true, customers: [sai] });
    expect(platform.tickets.at(-1)).toEqual({ tenantId: p.tenantId, to: "order_capture", scope: "customers" });
    sales.mode = "down";
    expect(await searchCustomers(p.worker, "sai")).toEqual({ available: false, customers: [] });
    platform.salesUrl = null;
    expect((await searchCustomers(p.worker, "sai")).available).toBe(false);
    expect((await refusal(() => searchCustomers(p.supervisor, "sai"))).status).toBe(404);
  });

  it("the tick sends the location once per visit; Try again never saves twice; the day pages read the state from Sales", async () => {
    const p = await setup();
    const sai = { id: randomUUID(), name: "Sai Stores", place: "Bhadrak", location: null };
    sales.customers = [sai];
    await start(p.worker);
    sales.mode = "down";
    const v = await visit(p.worker, { customer_id: sai.id, customer_name: "Sai Stores", customer_place: "Bhadrak", save_location: true });
    expect((await sendShopLocation(p.worker, v.id)).state).toBe("not_saved");
    sales.mode = "ok";
    expect((await myFieldDay(p.worker)).locations).toEqual({ [v.id]: "not_saved" });
    expect((await sendShopLocation(p.worker, v.id)).state).toBe("saved");
    expect((await sendShopLocation(p.worker, v.id)).state).toBe("saved");
    expect(sales.saved.size).toBe(1);
    expect(sales.saved.get(v.id)).toMatchObject({ customerId: sai.id, body: { visit_id: v.id, set_by_user_id: p.worker.userId, set_by_name: "Ramu", accuracy_m: 8 } });
    expect((await fieldDay(p.owner, p.worker.userId, TODAY)).locations).toEqual({ [v.id]: "saved" });
    // Sales off: the pages say "unknown", never a wrong "not saved"
    platform.salesUrl = null;
    expect((await fieldDay(p.owner, p.worker.userId, TODAY)).locations).toEqual({ [v.id]: "unknown" });
    // only the person who visited; never for a removed visit or one without the tick
    expect((await refusal(() => sendShopLocation(p.other, v.id))).status).toBe(404);
    const typed = await visit(p.worker);
    expect((await refusal(() => sendShopLocation(p.worker, typed.id))).status).toBe(400);
  });
});

describe("the owner's views", () => {
  it("month list, the Today board's In the field, the claims meter line, and the CSV (owner only, audited)", async () => {
    const p = await setup();
    await start(p.worker);
    await visit(p.worker, { note: "Met owner Prakash, wants 10 jars" });
    const field = await inTheField(p.tenantId);
    expect(field).toHaveLength(1);
    expect(field[0]).toMatchObject({ userId: p.worker.userId, name: "Ramu", lastVisit: { name: "New shop near bus stand" } });
    await end(p.worker);
    expect(await inTheField(p.tenantId)).toEqual([]);
    const m = await fieldMonth(p.owner, p.worker.userId, null);
    expect(m.days).toHaveLength(1);
    expect(m.days[0]).toMatchObject({ date: TODAY, kmTenths: 843, visits: 1, notEnded: false });
    expect(m.canExport).toBe(true);
    const meters = await metersFor(p.tenantId, [{ userId: p.worker.userId, date: TODAY }, { userId: p.other.userId, date: TODAY }]);
    expect(meters.get(`${p.worker.userId}:${TODAY}`)).toEqual({ kmTenths: 843, visits: 1 });
    expect(meters.has(`${p.other.userId}:${TODAY}`)).toBe(false);
    const { body } = await fieldCsv(p.owner, p.worker.userId, THIS);
    const lines = body.replace(/^﻿/, "").trim().split("\r\n");
    expect(lines[0]).toBe("Date,Person,Time,Kind,Shop,Place,Phone,Latitude,Longitude,Accuracy m,Km,Meeting notes,Removed,Replaced,Reason");
    expect(lines).toHaveLength(4);
    expect(lines[2]).toContain("Met owner Prakash");
    expect((await recentChanges(p.owner)).some((c) => /^Downloaded Ramu's .+ field visits CSV$/.test(c.text))).toBe(true);
  });
});
