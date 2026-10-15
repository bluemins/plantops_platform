// One person's month and day from real marks (src/server/calendar.ts), and who may look: your own needs see_own,
// anyone else's needs see_everyone (owner, support); otherwise 404.
import { describe, expect, it } from "vitest";
import { istMonth } from "@/lib/days";
import { dayFor, monthFor } from "@/server/calendar";
import type { AtUser } from "@/server/session";
import { asApp, plant, refusal } from "./helpers";

/** A mark for `u` at an India time ("2026-09-30 22:00"); `source` owner needs a reason. */
async function at(u: AtUser, kind: "in" | "out", when: string, opts: { owner?: string } = {}) {
  const t = `'${when}:00+05:30'`;
  const sql = opts.owner
    ? `insert into attendance_salary.punches (tenant_id, user_id, user_name, kind, at, source, reason, created_by, created_by_name) values ('${u.tenantId}', '${u.userId}', '${u.name}', '${kind}', ${t}, 'owner', '${opts.owner}', gen_random_uuid(), 'Sujata') returning id`
    : `insert into attendance_salary.punches (tenant_id, user_id, user_name, kind, at, source, distance_m, accuracy_m, created_by, created_by_name) values ('${u.tenantId}', '${u.userId}', '${u.name}', '${kind}', ${t}, 'scan', 30, 10, '${u.userId}', '${u.name}') returning id`;
  return ((await asApp(u.tenantId, sql)).rows[0] as { id: string }).id;
}
const cancel = (u: AtUser, punchId: string, reason: string) =>
  asApp(u.tenantId, `insert into attendance_salary.punch_cancels (tenant_id, punch_id, reason, created_by, created_by_name) values ('${u.tenantId}', '${punchId}', '${reason}', gen_random_uuid(), 'Sujata')`);

describe("a worker's own month and day", () => {
  it("works out September from the marks, including a night shift into October and an owner fix", async () => {
    const p = plant();
    const w = p.worker;
    await at(w, "in", "2026-09-01 09:00");
    await at(w, "out", "2026-09-01 17:00");
    await at(w, "in", "2026-09-02 09:10"); // no exit: next mark is an IN
    await at(w, "in", "2026-09-03 09:00");
    await at(w, "out", "2026-09-03 18:30", { owner: "forgot to scan" });
    const stray = await at(w, "out", "2026-09-04 12:00");
    await cancel(w, stray, "scanned by mistake");
    await at(w, "in", "2026-09-30 22:00"); // night shift across the month end
    await at(w, "out", "2026-10-01 06:00");

    const sep = await monthFor(w, w.userId, "2026-09");
    const get = (d: string) => sep.days.find((x) => x.date === d)!;
    expect(sep.days).toHaveLength(30);
    expect(get("2026-09-01")).toMatchObject({ minutes: 480, noExit: false });
    expect(get("2026-09-02")).toMatchObject({ minutes: 0, noExit: true });
    expect(get("2026-09-03")).toMatchObject({ minutes: 570, changed: true });
    expect(get("2026-09-04")).toMatchObject({ minutes: 0, changed: true, noEntry: false });
    expect(get("2026-09-30")).toMatchObject({ minutes: 480 });
    expect(sep.next).toBe("2026-10");
    expect(sep.name).toBe(w.name);

    // October 1st: the night shift's end doesn't show as an OUT without IN there
    const oct1 = await dayFor(w, w.userId, "2026-10-01");
    expect(oct1.day).toMatchObject({ minutes: 0, noEntry: false });
    expect(oct1.day.entries).toEqual([]);
    const sep30 = await dayFor(w, w.userId, "2026-09-30");
    expect(sep30.day.blocks[0]).toMatchObject({ status: "done", nextDay: true, minutes: 480 });
  });

  it("this month has no 'next' arrow; a future month or date, or a bad one, is 404", async () => {
    const p = plant();
    expect((await monthFor(p.worker, p.worker.userId, null)).next).toBeNull();
    expect((await monthFor(p.worker, p.worker.userId, null)).month).toBe(istMonth());
    for (const m of ["2099-01", "2026-13", "junk"]) expect((await refusal(() => monthFor(p.worker, p.worker.userId, m))).status, m).toBe(404);
    for (const d of ["2099-01-01", "2026-02-30", "x"]) expect((await refusal(() => dayFor(p.worker, p.worker.userId, d))).status, d).toBe(404);
  });
});

describe("who may look", () => {
  it("a worker can never load another person's day or month (404, not 'forbidden')", async () => {
    const p = plant();
    await at(p.ownerWorker, "in", "2026-09-01 09:00");
    for (const fn of [() => dayFor(p.worker, p.ownerWorker.userId, "2026-09-01"), () => monthFor(p.worker, p.ownerWorker.userId, "2026-09")]) {
      expect(await refusal(fn)).toEqual({ status: 404, message: "Not found", code: undefined });
    }
  });

  it("the owner and support may look at anyone (for Phase 5); a store keeper can't even see their own", async () => {
    const p = plant();
    await at(p.worker, "in", "2026-09-01 09:00");
    await at(p.worker, "out", "2026-09-01 17:00");
    expect((await dayFor(p.owner, p.worker.userId, "2026-09-01")).day.minutes).toBe(480);
    expect((await dayFor(p.support, p.worker.userId, "2026-09-01")).day.minutes).toBe(480);
    expect((await refusal(() => dayFor(p.keeper, p.keeper.userId, "2026-09-01"))).status).toBe(404);
  });

  it("plant B never sees plant A's marks, even with the same person id", async () => {
    const a = plant();
    await at(a.worker, "in", "2026-09-01 09:00");
    await at(a.worker, "out", "2026-09-01 17:00");
    const b = plant();
    expect((await refusal(() => dayFor(b.owner, a.worker.userId, "2026-09-01"))).status).toBe(404); // not a person of plant B
  });
});
