// Plant board (owner, 2026-11-14): one whiteboard per plant that every logged-in person sees and writes on, whatever
// their role. Staff plan the next day on it. Rules approved by the owner:
// - anyone adds a card for today or up to 7 days ahead
// - the writer edits / removes their own card (today or later); the owner removes any card
// - anyone ticks a card done or not done; the card shows who ticked it
// - no notifications; edits and removals go to the audit log; nothing is deleted
import { and, asc, eq, gte, isNull, lte, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";
import { audit } from "./audit";
import type { CurrentUser } from "./auth";
import { schema, withTenant } from "./db";
import { badRequest, forbidden, notFound } from "./http";

const { boardCards, users } = schema;

/** How far the board looks back and ahead (days from today, India date). */
export const BOARD_BACK_DAYS = 7;
export const BOARD_AHEAD_DAYS = 7;

/** Today's date in India as YYYY-MM-DD. */
export const indiaToday = (now = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(now);

/** YYYY-MM-DD plus n days (calendar arithmetic, no time zone involved). */
export function addDays(day: string, n: number) {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-11-15");
const Body = z.string().trim().min(1, "Write something first").max(300, "Keep it under 300 characters");

export const NewCardInput = z.object({ date: Day, text: Body });
export const ChangeCardInput = z.union([
  z.object({ text: Body }).strict(),
  z.object({ done: z.boolean() }).strict(),
]);

const isOwner = (u: CurrentUser) => u.roles.includes("tenant_admin");

function inWindow(day: string, today: string) {
  return day >= addDays(today, -BOARD_BACK_DAYS) && day <= addDays(today, BOARD_AHEAD_DAYS);
}

export interface BoardCard {
  id: string;
  text: string;
  by: string;
  by_me: boolean;
  created_at: string;
  edited: boolean;
  done: boolean;
  done_by: string | null;
  done_at: string | null;
  can_edit: boolean;
  can_remove: boolean;
}

/** The cards for one day (oldest first), plus what this person may do with each. */
export async function boardDay(user: CurrentUser, day: string, now = new Date()) {
  const today = indiaToday(now);
  if (!Day.safeParse(day).success) throw badRequest("Use a date like 2026-11-15");
  if (!inWindow(day, today)) throw badRequest(`The board shows ${BOARD_BACK_DAYS} days back and ${BOARD_AHEAD_DAYS} days ahead`);
  const writer = alias(users, "writer");
  const ticker = alias(users, "ticker");
  const rows = await withTenant(user.tenantId, (tx) =>
    tx
      .select({ card: boardCards, by: writer.displayName, doneByName: ticker.displayName })
      .from(boardCards)
      .innerJoin(writer, eq(writer.id, boardCards.createdBy))
      .leftJoin(ticker, eq(ticker.id, boardCards.doneBy))
      .where(and(eq(boardCards.tenantId, user.tenantId), eq(boardCards.forDate, day), isNull(boardCards.removedAt)))
      .orderBy(asc(boardCards.createdAt)),
  );
  const open = day >= today;
  const cards: BoardCard[] = rows.map(({ card, by, doneByName }) => {
    const mine = card.createdBy === user.userId;
    return {
      id: card.id,
      text: card.body,
      by,
      by_me: mine,
      created_at: card.createdAt.toISOString(),
      edited: !!card.editedAt,
      done: !!card.doneAt,
      done_by: card.doneAt ? (doneByName ?? null) : null,
      done_at: card.doneAt?.toISOString() ?? null,
      can_edit: mine && open,
      can_remove: (mine && open) || isOwner(user),
    };
  });
  return { date: day, today, can_add: open && day <= addDays(today, BOARD_AHEAD_DAYS), cards };
}

/** Adds a card for today or a day ahead (up to a week). */
export async function addCard(user: CurrentUser, input: z.infer<typeof NewCardInput>, now = new Date()) {
  const today = indiaToday(now);
  if (input.date < today) throw badRequest("Cards can be added for today or a day ahead only");
  if (input.date > addDays(today, BOARD_AHEAD_DAYS)) throw badRequest(`Cards can be added up to ${BOARD_AHEAD_DAYS} days ahead`);
  return withTenant(user.tenantId, async (tx) => {
    const [{ count } = { count: 0 }] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(boardCards)
      .where(and(eq(boardCards.tenantId, user.tenantId), eq(boardCards.forDate, input.date), isNull(boardCards.removedAt)));
    if (count >= 200) throw badRequest("This day already has 200 cards");
    const [row] = await tx
      .insert(boardCards)
      .values({ tenantId: user.tenantId, forDate: input.date, body: input.text, createdBy: user.userId })
      .returning({ id: boardCards.id });
    return { id: row!.id };
  });
}

/** Edits the text (writer only, today or later) or ticks / unticks done (anyone, inside the board's window). */
export async function changeCard(user: CurrentUser, id: string, input: z.infer<typeof ChangeCardInput>, now = new Date()) {
  const today = indiaToday(now);
  return withTenant(user.tenantId, async (tx) => {
    const [card] = await tx
      .select()
      .from(boardCards)
      .where(and(eq(boardCards.tenantId, user.tenantId), eq(boardCards.id, id), isNull(boardCards.removedAt)))
      .for("update");
    if (!card || !inWindow(card.forDate, today)) throw notFound("This card is no longer on the board");
    if ("text" in input) {
      if (card.createdBy !== user.userId) throw forbidden("Only the person who wrote this card can change it");
      if (card.forDate < today) throw forbidden("Cards for past days can't be changed");
      if (input.text === card.body) return { ok: true };
      await tx.update(boardCards).set({ body: input.text, editedAt: new Date() }).where(eq(boardCards.id, id));
      await audit(tx, {
        tenantId: user.tenantId,
        actor: `user:${user.userId}`,
        action: "board.edit",
        target: id,
        details: { for_date: card.forDate, before: card.body, after: input.text },
      });
    } else if (input.done !== !!card.doneAt) {
      await tx
        .update(boardCards)
        .set(input.done ? { doneBy: user.userId, doneAt: new Date() } : { doneBy: null, doneAt: null })
        .where(eq(boardCards.id, id));
    }
    return { ok: true };
  });
}

/** Takes a card off the board (the writer for today or later; the owner any card). The row stays, audited. */
export async function removeCard(user: CurrentUser, id: string, now = new Date()) {
  const today = indiaToday(now);
  return withTenant(user.tenantId, async (tx) => {
    const [card] = await tx
      .select()
      .from(boardCards)
      .where(and(eq(boardCards.tenantId, user.tenantId), eq(boardCards.id, id), isNull(boardCards.removedAt)))
      .for("update");
    if (!card || !inWindow(card.forDate, today)) throw notFound("This card is no longer on the board");
    const mine = card.createdBy === user.userId;
    if (!isOwner(user) && !(mine && card.forDate >= today)) {
      throw forbidden(mine ? "Cards for past days can't be removed" : "Only the writer or the owner can remove this card");
    }
    await tx.update(boardCards).set({ removedBy: user.userId, removedAt: new Date() }).where(eq(boardCards.id, id));
    await audit(tx, {
      tenantId: user.tenantId,
      actor: `user:${user.userId}`,
      action: "board.remove",
      target: id,
      details: { for_date: card.forDate, text: card.body, writer: card.createdBy },
    });
    return { ok: true };
  });
}

/** Numbers for the launcher card: cards for today and tomorrow (open ones). */
export async function boardSummary(user: CurrentUser, now = new Date()) {
  const today = indiaToday(now);
  const tomorrow = addDays(today, 1);
  const rows = await withTenant(user.tenantId, (tx) =>
    tx
      .select({ day: boardCards.forDate, count: sql<number>`count(*)::int`, open: sql<number>`count(*) filter (where ${boardCards.doneAt} is null)::int` })
      .from(boardCards)
      .where(and(eq(boardCards.tenantId, user.tenantId), gte(boardCards.forDate, today), lte(boardCards.forDate, tomorrow), isNull(boardCards.removedAt)))
      .groupBy(boardCards.forDate),
  );
  const of = (d: string) => rows.find((r) => r.day === d) ?? { count: 0, open: 0 };
  const t = of(today);
  const n = of(tomorrow);
  // Same shape as a module tile's numbers, so the launcher draws it the same way.
  const badges: { text: string; tone: "info" | "warn" | "ok" }[] = [];
  if (t.count) badges.push({ text: t.open ? `${t.open} open today` : "Today all done", tone: t.open ? "warn" : "ok" });
  badges.push({ text: n.count ? `${n.count} for tomorrow` : "Nothing for tomorrow yet", tone: "info" });
  return { state: "ok" as const, today: t, tomorrow: n, badges };
}
