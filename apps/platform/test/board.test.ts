// Plant board (owner, 2026-11-14): every person of the plant reads and writes, any role; writer edits / removes own,
// owner removes any; anyone ticks done; plant A never sees plant B's cards; nothing is deleted.
import { beforeAll, describe, expect, it } from "vitest";
import * as boardRoute from "@/app/api/board/route";
import * as cardRoute from "@/app/api/board/[id]/route";
import * as summaryRoute from "@/app/api/board/summary/route";
import { addDays, indiaToday } from "@/server/board";
import { schema, withTenant } from "@/server/db";
import { asOwner, call, makePlant, makeStaff, type Handler } from "./helpers";

const GET = boardRoute.GET as Handler;
const POST = boardRoute.POST as Handler;
const PATCH = cardRoute.PATCH as Handler;
const DELETE = cardRoute.DELETE as Handler;

let A: Awaited<ReturnType<typeof makePlant>>;
let B: Awaited<ReturnType<typeof makePlant>>;
let worker: Awaited<ReturnType<typeof makeStaff>>; // Plant staff only: works in no module, still uses the board
let keeper: Awaited<ReturnType<typeof makeStaff>>;
const today = indiaToday();
const tomorrow = addDays(today, 1);

const add = (cookie: string, text: string, date = tomorrow) => call(POST, { cookie, body: { date, text } });
async function callDay(cookie: string, date: string) {
  const req = new Request(`http://localhost/api/board?date=${date}`, { headers: { cookie } });
  const res = await GET(req, {} as never);
  return { status: res.status, body: await res.json() };
}

beforeAll(async () => {
  A = await makePlant({ modules: ["floor_stock", "attendance_salary"], maxUsers: 10 });
  B = await makePlant({ modules: ["floor_stock"], maxUsers: 10 });
  worker = await makeStaff(A, "worker", ["plant_staff"]);
  keeper = await makeStaff(A, "keeper", ["store_keeper"]);
});

describe("Plant board", () => {
  it("anyone of the plant, any role, adds and reads cards", async () => {
    expect((await add(worker.cookie, "Clean the RO room")).status).toBe(201);
    expect((await add(keeper.cookie, "Load 50 box BM 1L in Mini")).status).toBe(201);
    expect((await add(A.adminCookie, "Diesel for the Pickup")).status).toBe(201);
    const day = await callDay(worker.cookie, tomorrow);
    expect(day.status).toBe(200);
    expect(day.body.cards.map((c: { text: string }) => c.text)).toEqual(["Clean the RO room", "Load 50 box BM 1L in Mini", "Diesel for the Pickup"]);
    expect(day.body.cards[0]).toMatchObject({ by: "worker", by_me: true, can_edit: true, can_remove: true });
    expect(day.body.cards[1]).toMatchObject({ by: "keeper", by_me: false, can_edit: false, can_remove: false });
  });

  it("not logged in -> 401; empty, too long or past-date cards are refused", async () => {
    expect((await call(POST, { body: { date: tomorrow, text: "x" } })).status).toBe(401);
    expect((await add(worker.cookie, "   ")).status).toBe(400);
    expect((await add(worker.cookie, "x".repeat(301))).status).toBe(400);
    expect((await add(worker.cookie, "late", addDays(today, -1))).status).toBe(400);
    expect((await add(worker.cookie, "far", addDays(today, 8))).status).toBe(400);
    expect((await callDay(worker.cookie, addDays(today, -8))).status).toBe(400);
  });

  it("only the writer edits; the edit is audited", async () => {
    const id = (await add(keeper.cookie, "Count caps")).body.id;
    expect((await call(PATCH, { method: "PATCH", cookie: worker.cookie, params: { id }, body: { text: "hacked" } })).status).toBe(403);
    expect((await call(PATCH, { method: "PATCH", cookie: A.adminCookie, params: { id }, body: { text: "owner edit" } })).status).toBe(403);
    expect((await call(PATCH, { method: "PATCH", cookie: keeper.cookie, params: { id }, body: { text: "Count caps and labels" } })).status).toBe(200);
    const card = (await callDay(keeper.cookie, tomorrow)).body.cards.find((c: { id: string }) => c.id === id);
    expect(card).toMatchObject({ text: "Count caps and labels", edited: true });
    const { rows } = await asOwner("select details from platform.audit_log where action = 'board.edit' and target = $1", [id]);
    expect(rows[0]!.details).toMatchObject({ before: "Count caps", after: "Count caps and labels" });
  });

  it("anyone ticks done and untick; the card says who", async () => {
    const id = (await add(keeper.cookie, "Wash jars")).body.id;
    expect((await call(PATCH, { method: "PATCH", cookie: worker.cookie, params: { id }, body: { done: true } })).status).toBe(200);
    let card = (await callDay(A.adminCookie, tomorrow)).body.cards.find((c: { id: string }) => c.id === id);
    expect(card).toMatchObject({ done: true, done_by: "worker" });
    await call(PATCH, { method: "PATCH", cookie: keeper.cookie, params: { id }, body: { done: false } });
    card = (await callDay(A.adminCookie, tomorrow)).body.cards.find((c: { id: string }) => c.id === id);
    expect(card).toMatchObject({ done: false, done_by: null });
  });

  it("writer removes own, owner removes any, others can't; the row stays (no delete) and is audited", async () => {
    const own = (await add(worker.cookie, "mine")).body.id;
    const other = (await add(keeper.cookie, "not yours")).body.id;
    expect((await call(DELETE, { method: "DELETE", cookie: worker.cookie, params: { id: other } })).status).toBe(403);
    expect((await call(DELETE, { method: "DELETE", cookie: worker.cookie, params: { id: own } })).status).toBe(200);
    expect((await call(DELETE, { method: "DELETE", cookie: A.adminCookie, params: { id: other } })).status).toBe(200);
    const ids = (await callDay(A.adminCookie, tomorrow)).body.cards.map((c: { id: string }) => c.id);
    expect(ids).not.toContain(own);
    expect(ids).not.toContain(other);
    const { rows } = await asOwner("select count(*)::int as n from platform.board_cards where id = any($1) and removed_at is not null", [[own, other]]);
    expect(rows[0]!.n).toBe(2);
    expect((await asOwner("select count(*)::int as n from platform.audit_log where action = 'board.remove' and target = any($1)", [[own, other]])).rows[0]!.n).toBe(2);
    // removed twice -> gone
    expect((await call(DELETE, { method: "DELETE", cookie: A.adminCookie, params: { id: own } })).status).toBe(404);
  });

  it("past days: the writer can no longer edit or remove; the owner still can remove", async () => {
    const { rows } = await asOwner<{ id: string }>(
      "insert into platform.board_cards (tenant_id, for_date, body, created_by) values ($1, $2, 'old plan', $3) returning id",
      [A.tenantId, addDays(today, -1), keeper.userId],
    );
    const id = rows[0]!.id;
    expect((await call(PATCH, { method: "PATCH", cookie: keeper.cookie, params: { id }, body: { text: "rewrite" } })).status).toBe(403);
    expect((await call(DELETE, { method: "DELETE", cookie: keeper.cookie, params: { id } })).status).toBe(403);
    expect((await call(PATCH, { method: "PATCH", cookie: worker.cookie, params: { id }, body: { done: true } })).status).toBe(200);
    expect((await call(DELETE, { method: "DELETE", cookie: A.adminCookie, params: { id } })).status).toBe(200);
  });

  it("plant B never sees or touches plant A's cards (API and RLS)", async () => {
    const id = (await add(keeper.cookie, "A only")).body.id;
    expect((await callDay(B.adminCookie, tomorrow)).body.cards).toEqual([]);
    expect((await call(PATCH, { method: "PATCH", cookie: B.adminCookie, params: { id }, body: { done: true } })).status).toBe(404);
    expect((await call(DELETE, { method: "DELETE", cookie: B.adminCookie, params: { id } })).status).toBe(404);
    expect(await withTenant(B.tenantId, (tx) => tx.select().from(schema.boardCards))).toEqual([]);
  });

  it("the app login can't delete cards or rewrite who wrote them", async () => {
    const denied = (p: Promise<unknown>) => p.then(() => "allowed", (e: { cause?: { code?: string } }) => e.cause?.code);
    expect(await denied(withTenant(A.tenantId, (tx) => tx.delete(schema.boardCards)))).toBe("42501"); // permission denied
    expect(await denied(withTenant(A.tenantId, (tx) => tx.update(schema.boardCards).set({ createdBy: A.adminUserId })))).toBe("42501");
  });

  it("launcher card numbers: open today and cards for tomorrow", async () => {
    const res = await call(summaryRoute.GET as Handler, { cookie: worker.cookie });
    expect(res.status).toBe(200);
    expect(res.body.state).toBe("ok");
    expect(res.body.badges.at(-1).text).toMatch(/for tomorrow$/);
    const empty = await call(summaryRoute.GET as Handler, { cookie: B.adminCookie });
    expect(empty.body.badges).toEqual([{ text: "Nothing for tomorrow yet", tone: "info" }]);
  });
});
