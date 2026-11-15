// Field day log, Phases 3 + 4 (docs/FIELD_DAY_PHASE_PLAN.md mock-ups A1–A7, B1–B3, C1): the worker's My field day,
// the owner / Supervisor month list and day page, the Today board's "In the field" card and the Claims card line.
// Pages rendered as element trees; the shared timeline to HTML.
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { FieldTimeline } from "@/app/field-bits";
import MyFieldPage from "@/app/my/field/page";
import { FieldDayScreen } from "@/app/my/field/field-day";
import { myTabs } from "@/app/my-tabs";
import HomePage from "@/app/page";
import FieldMonthPage from "@/app/staff/[user]/field/page";
import FieldDayPage from "@/app/staff/[user]/field/[date]/page";
import { OwnerFix } from "@/app/staff/[user]/field/[date]/owner-fix";
import { TodayView } from "@/app/today";
import { OwnerClaimCard } from "@/app/claims/owner-claim";
import ClaimsPage from "@/app/claims/page";
import { istDay, istMonth } from "@/lib/days";
import { addVisit, endDay, fieldDay, removeVisit, startDay, uploadFieldPhoto } from "@/server/field";
import { sendClaim } from "@/server/claims";
import { saveSetting } from "@/server/salary-edit";
import type { AtUser } from "@/server/session";
import { startFakePlatform, type FakePlatform } from "./fake-platform";
import { asOwner, atUser, contactsFor, plant, signInAs, textOf } from "./helpers";

vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: () => {} }));

let platform: FakePlatform;
beforeAll(async () => {
  platform = await startFakePlatform();
  process.env.PLATFORM_URL = platform.url;
});
afterAll(() => platform.close());
beforeEach(() => vi.restoreAllMocks());

const TODAY = istDay();
const THIS = istMonth();
const NOT_FOUND = /NEXT_HTTP_ERROR_FALLBACK;404|NEXT_NOT_FOUND/;
const JPEG = () => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(2044, 7)]);
const here = { lat: 20.8742, lng: 86.4931, accuracy_m: 12 };

/** Every element of `type` in a page's element tree. */
function find(node: unknown, type: unknown): { props: Record<string, unknown> }[] {
  if (node == null || typeof node !== "object") return [];
  if (Array.isArray(node)) return node.flatMap((n) => find(n, type));
  const el = node as { type?: unknown; props?: Record<string, unknown> };
  return [...(el.type === type ? [el as { props: Record<string, unknown> }] : []), ...find(el.props?.children, type)];
}

async function setup() {
  const p = plant();
  const supervisor = atUser(p.tenantId, ["supervisor"], "Bikash");
  const office = atUser(p.tenantId, ["office_staff"], "Anita");
  platform.contacts = [...contactsFor(p.owner, p.worker, supervisor, office)];
  await saveSetting(p.owner, { user_id: p.worker.userId, pay_basis: "monthly", monthly: "12000", shift_hours: 8, leave_days: 2, gets_overtime: false, from_month: THIS, joined_on: null, left_on: null, reason: null, expect: null, field_staff: true, ta_rate: "3" } as never);
  return { ...p, supervisor, office };
}

/** A whole round for the worker: start, two visits (one removed), end. */
async function round(u: AtUser) {
  await startDay(u, { ...here, place: "Plant gate", km: "45210.5", photo_id: (await uploadFieldPhoto(u, JPEG())).id } as never);
  await addVisit(u, { ...here, accuracy_m: 8, customer_id: null, customer_name: "Sai Stores", customer_place: "Bhadrak", phone: null, note: "Met owner Prakash", save_location: null } as never);
  const wrong = await addVisit(u, { ...here, accuracy_m: 640, customer_id: null, customer_name: "Maa Tarini Hotel", customer_place: null, phone: null, note: null, save_location: null } as never);
  await removeVisit(u, { event_id: wrong.id, reason: "Wrong shop picked" });
  await endDay(u, { ...here, place: "Plant gate", km: "45294.8", photo_id: (await uploadFieldPhoto(u, JPEG())).id } as never);
}

describe("the worker's My field day", () => {
  it("the Field day tab and page only with the Field staff tick", async () => {
    const p = await setup();
    expect((await myTabs(p.worker)).field).toBe(true);
    signInAs(p.worker);
    const page = await MyFieldPage();
    const screen = find(page, FieldDayScreen)[0]!;
    expect((screen.props.v as { canStart: boolean }).canStart).toBe(true);
    // a Plant staff worker without the tick: no tab, page 404
    const other = atUser(p.tenantId, ["plant_staff"], "Manoj");
    expect((await myTabs(other)).field).toBe(false);
    signInAs(other);
    await expect(MyFieldPage()).rejects.toThrow(NOT_FOUND);
  });
});

describe("the owner's and Supervisor's screens", () => {
  it("the day page: timeline with Google Maps links, replaced / removed crossed out, photos, the claim line; owner fixes, Supervisor doesn't", async () => {
    const p = await setup();
    await round(p.worker);
    await sendClaim(p.worker, { kind: "field_duty", on_date: TODAY, km: "90", amount: null, note: "Bhadrak round" });
    signInAs(p.owner);
    const page = await FieldDayPage({ params: Promise.resolve({ user: p.worker.userId, date: TODAY }) });
    const text = (n: unknown) => textOf(n).replace(/\s+/g, " ");
    expect(text(page)).toMatch(/Ramu · Field day/);
    const tl = find(page, FieldTimeline)[0]!;
    expect(typeof tl.props.actions).toBe("function"); // the owner's Correct / Remove
    expect(text(page)).toMatch(/Field-duty claim for this day: 90 km \( ?waiting ?\)\. Meter: 84\.3 km/);
    const html = renderToStaticMarkup(FieldTimeline({ day: (await fieldDay(p.owner, p.worker.userId, TODAY)).day })!);
    expect(html).toContain("https://www.google.com/maps?q=20.874200,86.493100");
    expect(html).toMatch(/Removed by Ramu at .+Wrong shop picked/);
    expect(html).toContain("Met owner Prakash");
    expect(html).toContain("line-through");
    // the Supervisor: same page, no fix buttons, no claim line
    signInAs(p.supervisor);
    const sup = await FieldDayPage({ params: Promise.resolve({ user: p.worker.userId, date: TODAY }) });
    expect(find(sup, FieldTimeline)[0]!.props.actions).toBeUndefined();
    expect(find(sup, OwnerFix)).toEqual([]);
    expect(textOf(sup)).not.toMatch(/claim/i);
    // Office staff: not found
    signInAs(p.office);
    await expect(FieldDayPage({ params: Promise.resolve({ user: p.worker.userId, date: TODAY }) })).rejects.toThrow(NOT_FOUND);
  });

  it("the month list; the CSV link for the owner only; support views are logged", async () => {
    const p = await setup();
    await round(p.worker);
    signInAs(p.owner);
    const owner = await FieldMonthPage({ params: Promise.resolve({ user: p.worker.userId }), searchParams: Promise.resolve({}) });
    expect(textOf(owner)).toMatch(/Download visits CSV/);
    expect(textOf(owner).replace(/\s+/g, " ")).toMatch(/84\.3 km · 1 shop/);
    signInAs(p.supervisor);
    expect(textOf(await FieldMonthPage({ params: Promise.resolve({ user: p.worker.userId }), searchParams: Promise.resolve({}) }))).not.toMatch(/CSV/);
    signInAs(p.support);
    await FieldMonthPage({ params: Promise.resolve({ user: p.worker.userId }), searchParams: Promise.resolve({}) });
    await FieldDayPage({ params: Promise.resolve({ user: p.worker.userId, date: TODAY }) });
    const { rows } = await asOwner<{ path: string }>("select path from attendance_salary.support_views where tenant_id = $1 order by at", [p.tenantId]);
    expect(rows.map((r) => r.path)).toEqual([`/staff/${p.worker.userId}/field`, `/staff/${p.worker.userId}/field/${TODAY}`]);
  });

  it("the Today board's In the field card (owner and Supervisor, not Office staff); the Claims card's meter line", async () => {
    const p = await setup();
    await startDay(p.worker, { ...here, place: null, km: "100", photo_id: (await uploadFieldPhoto(p.worker, JPEG())).id } as never);
    await addVisit(p.worker, { ...here, customer_id: null, customer_name: "Sai Stores", customer_place: null, phone: null, note: null, save_location: null } as never);
    for (const [who, shows] of [[p.owner, true], [p.supervisor, true], [p.office, false]] as const) {
      signInAs(who);
      const view = find(await HomePage({ searchParams: Promise.resolve({}) }), TodayView)[0]!;
      const field = view.props.field as { name: string; lastVisit: { name: string } | null }[] | null;
      if (shows) expect(field, who.name).toEqual([expect.objectContaining({ name: "Ramu", lastVisit: expect.objectContaining({ name: "Sai Stores" }) })]);
      else expect(field, who.name).toBeNull();
    }
    await sendClaim(p.worker, { kind: "field_duty", on_date: TODAY, km: "90", amount: null, note: "Bhadrak round" });
    signInAs(p.owner);
    const cards = find(await ClaimsPage({ searchParams: Promise.resolve({}) }), OwnerClaimCard);
    expect(cards[0]!.props.meter).toEqual({ kmTenths: null, visits: 1 });
  });
});
