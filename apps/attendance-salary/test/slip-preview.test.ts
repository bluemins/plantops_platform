// Owner's "See as worker" (owner 2026-10-24): the person's slip exactly as the worker sees it, before and after the
// month is paid; owner and support only.
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import MySlipPage from "@/app/my/salary/[month]/page";
import { slipCard } from "@/app/slip-card";
import SlipPreviewPage from "@/app/staff/[user]/slip/[month]/page";
import { monthDays } from "@/lib/days";
import { saveVisibility } from "@/server/salary-edit";
import { payMonth } from "@/server/salary-pay";
import { mySlip, slipPreview } from "@/server/salary-slip";
import type { AtUser } from "@/server/session";
import { startFakePlatform, type FakePlatform } from "./fake-platform";
import { asApp, asOwner, atUser, contactsFor, markAt, plant, refusal, signInAs, textOf } from "./helpers";

const pending: Promise<unknown>[] = [];
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: (fn: () => unknown) => void pending.push(Promise.resolve().then(fn)) }));

let platform: FakePlatform;
beforeAll(async () => {
  platform = await startFakePlatform();
  process.env.PLATFORM_URL = platform.url;
});
afterAll(() => platform.close());
afterEach(() => vi.restoreAllMocks());

const SEP = "2026-09";
const R = (rupees: number) => Math.round(rupees * 100);
const flat = (s: string) => s.replace(/\s+/g, " ");

/** Ramu earns ₹12,000 from September, no paid leave; present 1-29 Sep, absent on the 30th: ₹11,600; a ₹1,000 advance. */
async function setup() {
  const p = plant();
  platform.contacts = [...contactsFor(p.owner, p.worker)];
  await asApp(
    p.tenantId,
    `insert into attendance_salary.salary_settings (tenant_id, user_id, user_name, from_month, monthly_paise, shift_minutes, paid_leave_halfdays, gets_overtime, created_by, created_by_name)
     values ('${p.tenantId}', '${p.worker.userId}', '${p.worker.name}', '${SEP}-01', ${R(12000)}, 480, 0, false, gen_random_uuid(), 'Sujata')`,
  );
  await asApp(
    p.tenantId,
    `insert into attendance_salary.salary_advances (tenant_id, user_id, user_name, on_date, amount_paise, note, created_by, created_by_name)
     values ('${p.tenantId}', '${p.worker.userId}', '${p.worker.name}', '2026-09-10', ${R(1000)}, 'Festival', gen_random_uuid(), 'Sujata')`,
  );
  for (const d of monthDays(SEP).slice(0, 29)) {
    await markAt(p.worker, "in", `${d} 09:00`);
    await markAt(p.worker, "out", `${d} 17:00`);
  }
  const allow = async (on: boolean) => {
    const expect = (await asOwner<{ id: string }>("select id from attendance_salary.salary_visibility where tenant_id = $1 and user_id = $2 order by created_at desc, id desc limit 1", [p.tenantId, p.worker.userId])).rows[0]?.id ?? null;
    await saveVisibility(p.owner, { user_id: p.worker.userId, can_see: on, expect });
  };
  const pay = () => payMonth(p.owner, { user_id: p.worker.userId, month: SEP, paid_on: "2026-09-30", note: "Cash", expect_remaining: R(10600) } as never);
  return { p, allow, pay };
}

const previewText = async (viewer: AtUser, personId: string) => {
  signInAs(viewer);
  return flat(textOf(await SlipPreviewPage({ params: Promise.resolve({ user: personId, month: SEP }) })));
};

describe("See as worker", () => {
  it("1. before payment: the slip with today's figures, 'Not paid yet' and a note that the worker can't see it", async () => {
    const { p } = await setup();
    const prev = await slipPreview(p.owner, p.worker.userId, SEP);
    expect(prev).toMatchObject({ name: "Ramu", canSee: false, complete: true, payment: { preview: true, remainingPaise: R(10600) } });
    const text = await previewText(p.owner, p.worker.userId);
    expect(text).toMatch(/Preview: Ramu ?'s slip for September 2026 as they see it/);
    expect(text).toContain("is not ticked: Ramu can't see any salary");
    expect(text).toContain("Not paid yet");
    expect(text).toContain("Monthly salary");
    expect(text).toContain("10 Sept · Festival");
    expect(text).toMatch(/Paid to you ₹10,600/);
    expect(text).toContain("Paid on … by …");
  });

  it("2. after payment with the tick: exactly the card the worker's own slip page shows", async () => {
    const { p, allow, pay } = await setup();
    await allow(true);
    const before = await slipPreview(p.owner, p.worker.userId, SEP);
    await pay();
    const prev = await slipPreview(p.owner, p.worker.userId, SEP);
    const slip = await mySlip(p.worker, SEP);
    const card = (x: Parameters<typeof slipCard>[0]) => flat(textOf(slipCard(x)));
    expect(card({ month: SEP, figures: prev.figures, payment: prev.payment })).toBe(card({ month: SEP, figures: slip.figures, payment: slip }));
    // the preview before paying had the same figures that "Mark paid" then saved
    expect(before.figures.result).toEqual(slip.figures.result);
    expect(await previewText(p.owner, p.worker.userId)).toContain("is ticked: they can see this slip now");
    signInAs(p.worker);
    expect(flat(textOf(await MySlipPage({ params: Promise.resolve({ month: SEP }) })))).toContain(card({ month: SEP, figures: slip.figures, payment: slip }));
  });

  it("3. support may look; a worker, a store keeper and Office staff may not; no salary or a future month is 404", async () => {
    const { p } = await setup();
    expect((await slipPreview(p.support, p.worker.userId, SEP)).name).toBe("Ramu");
    expect((await refusal(() => slipPreview(p.worker, p.worker.userId, SEP))).status).toBe(403);
    expect((await refusal(() => slipPreview(p.keeper, p.worker.userId, SEP))).status).toBe(403);
    const office = atUser(p.tenantId, ["office_staff"], "Asha");
    expect((await refusal(() => slipPreview(office, p.worker.userId, SEP))).status).toBe(404);
    expect((await refusal(() => slipPreview(p.owner, p.keeper.userId, SEP))).status).toBe(404);
    expect((await refusal(() => slipPreview(p.owner, p.worker.userId, "2099-01"))).status).toBe(404);
    expect((await refusal(() => slipPreview(p.owner, p.worker.userId, "2026-08"))).status).toBe(404);
  });
});
