// Plant board (owner, 2026-11-14): one whiteboard per plant that every logged-in person sees and writes on, whatever
// their role. Staff plan the next day on it. Rules approved by the owner:
// - anyone adds a card for today or up to 7 days ahead
// - the writer edits their own card (today or later, or any day while it is still open)
// - only the owner or a Supervisor closes (ticks done), reopens or removes a card; the card shows who did it (owner,
//   2026-11-15)
// - a card not closed by the end of its day carries forward: Today also shows every earlier open card (and the ones
//   closed today), tagged with its own date; the row keeps its date (owner, 2026-11-15)
// - a removed card stays visible on its day, crossed out, with who removed it and when (owner, 2026-11-15)
// - no notifications; edits and removals go to the audit log; nothing is deleted
// - priority Urgent / Normal / Low: the writer picks it when adding; afterwards only the owner or a Supervisor changes
//   it (owner, 2026-11-16)
// - only the owner or a Supervisor makes a card for specific people; such a card is seen only by those people, its
//   writer and the plant's owners, also in the launcher numbers; the people are fixed once saved (owner, 2026-11-16)
import { and, asc, eq, gte, inArray, isNull, lt, lte, or, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";
import { audit } from "./audit";
import type { CurrentUser } from "./auth";
import { schema, withTenant } from "./db";
import { badRequest, forbidden, notFound } from "./http";

const { boardCards, boardCardPeople, users } = schema;

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

export const PRIORITIES = ["urgent", "normal", "low"] as const;
export type Priority = (typeof PRIORITIES)[number];
const PriorityIn = z.enum(PRIORITIES, { message: "Pick Urgent, Normal or Low" });

export const NewCardInput = z.object({
  date: Day,
  text: Body,
  priority: PriorityIn.default("normal"),
  /** Only for these people (owner / Supervisor only); empty or missing = the whole plant. */
  people: z.array(z.string().uuid()).max(30, "Pick at most 30 people").default([]),
});
export const ChangeCardInput = z.union([
  z.object({ text: Body }).strict(),
  z.object({ done: z.boolean() }).strict(),
  z.object({ priority: PriorityIn }).strict(),
]);

const isOwner = (u: CurrentUser) => u.roles.includes("tenant_admin");
/** Who may close (tick done), reopen or remove a card: the owner or a Supervisor (owner, 2026-11-15). */
const canClose = (u: CurrentUser) => isOwner(u) || u.roles.includes("supervisor");
/** The writer may still edit: the card's day hasn't passed, or it is still open (carried forward). */
const stillLive = (card: { forDate: string; doneAt: Date | null }, today: string) => card.forDate >= today || !card.doneAt;

/**
 * Which cards this person may see: owners see every card; everyone else sees cards for the whole plant (no people
 * picked), cards they wrote, and cards picked for them.
 */
function visibleTo(user: CurrentUser): SQL | undefined {
  if (isOwner(user)) return undefined;
  return sql`(${boardCards.createdBy} = ${user.userId}
    or not exists (select 1 from platform.board_card_people p where p.card_id = ${boardCards.id})
    or exists (select 1 from platform.board_card_people p where p.card_id = ${boardCards.id} and p.user_id = ${user.userId}))`;
}

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
  edited_at: string | null;
  done: boolean;
  done_by: string | null;
  done_at: string | null;
  /** The card's own date when it is shown on Today as carried forward from an earlier day. */
  carried_from: string | null;
  removed: boolean;
  removed_by: string | null;
  removed_at: string | null;
  priority: Priority;
  /** The people the card is for (empty = the whole plant). */
  for_people: { id: string; name: string }[];
  can_edit: boolean;
  can_remove: boolean;
  can_close: boolean;
  can_set_priority: boolean;
}

/**
 * The cards for one day (oldest first), plus what this person may do with each. On Today, `carried` lists the earlier
 * days' cards still open (any age) and those closed today.
 */
export async function boardDay(user: CurrentUser, day: string, now = new Date()) {
  const today = indiaToday(now);
  if (!Day.safeParse(day).success) throw badRequest("Use a date like 2026-11-15");
  if (!inWindow(day, today)) throw badRequest(`The board shows ${BOARD_BACK_DAYS} days back and ${BOARD_AHEAD_DAYS} days ahead`);
  const writer = alias(users, "writer");
  const ticker = alias(users, "ticker");
  const remover = alias(users, "remover");
  const select = (where: ReturnType<typeof and>) =>
    withTenant(user.tenantId, (tx) =>
      tx
        .select({ card: boardCards, by: writer.displayName, doneByName: ticker.displayName, removedByName: remover.displayName })
        .from(boardCards)
        .innerJoin(writer, eq(writer.id, boardCards.createdBy))
        .leftJoin(ticker, eq(ticker.id, boardCards.doneBy))
        .leftJoin(remover, eq(remover.id, boardCards.removedBy))
        .where(and(eq(boardCards.tenantId, user.tenantId), where, visibleTo(user)))
        .orderBy(asc(boardCards.forDate), asc(boardCards.createdAt)),
    );
  const rows = await select(eq(boardCards.forDate, day));
  const carriedRows =
    day === today
      ? await select(
          and(
            lt(boardCards.forDate, today),
            or(
              // still open
              and(isNull(boardCards.doneAt), isNull(boardCards.removedAt)),
              // closed today
              and(isNull(boardCards.removedAt), sql`(${boardCards.doneAt} at time zone 'Asia/Kolkata')::date = ${today}::date`),
              // removed today while still open
              and(isNull(boardCards.doneAt), sql`(${boardCards.removedAt} at time zone 'Asia/Kolkata')::date = ${today}::date`),
            ),
          ),
        )
      : [];
  const ids = [...rows, ...carriedRows].map((r) => r.card.id);
  const peopleRows = ids.length
    ? await withTenant(user.tenantId, (tx) =>
        tx
          .select({ cardId: boardCardPeople.cardId, id: users.id, name: users.displayName })
          .from(boardCardPeople)
          .innerJoin(users, eq(users.id, boardCardPeople.userId))
          .where(and(eq(boardCardPeople.tenantId, user.tenantId), inArray(boardCardPeople.cardId, ids)))
          .orderBy(asc(users.displayName)),
      )
    : [];
  const peopleOf = (cardId: string) => peopleRows.filter((p) => p.cardId === cardId).map(({ id, name }) => ({ id, name }));
  const toCard = ({ card, by, doneByName, removedByName }: (typeof rows)[number], carried: boolean): BoardCard => {
    const mine = card.createdBy === user.userId;
    const removed = !!card.removedAt;
    const live = !removed && stillLive(card, today);
    return {
      id: card.id,
      text: card.body,
      by,
      by_me: mine,
      created_at: card.createdAt.toISOString(),
      edited: !!card.editedAt,
      edited_at: card.editedAt?.toISOString() ?? null,
      done: !!card.doneAt,
      done_by: card.doneAt ? (doneByName ?? null) : null,
      done_at: card.doneAt?.toISOString() ?? null,
      carried_from: carried ? card.forDate : null,
      removed,
      removed_by: removed ? (removedByName ?? null) : null,
      removed_at: card.removedAt?.toISOString() ?? null,
      priority: card.priority,
      for_people: peopleOf(card.id),
      can_edit: mine && live,
      can_remove: !removed && canClose(user),
      can_close: !removed && canClose(user),
      can_set_priority: live && canClose(user),
    };
  };
  return {
    date: day,
    today,
    can_add: day >= today && day <= addDays(today, BOARD_AHEAD_DAYS),
    can_close: canClose(user),
    carried: carriedRows.map((r) => toCard(r, true)),
    cards: rows.map((r) => toCard(r, false)),
    // the people an owner or Supervisor can pick for a card (active users of this plant)
    people: canClose(user) ? await plantPeople(user) : [],
  };
}

async function plantPeople(user: CurrentUser) {
  return withTenant(user.tenantId, (tx) =>
    tx
      .select({ id: users.id, name: users.displayName })
      .from(users)
      .where(and(eq(users.tenantId, user.tenantId), eq(users.status, "active")))
      .orderBy(asc(users.displayName)),
  );
}

/** The card if this person may see it (and it is still on the board), locked for the change; else 404. */
async function cardFor(tx: Parameters<Parameters<typeof withTenant>[1]>[0], user: CurrentUser, id: string, today: string) {
  const [card] = await tx
    .select()
    .from(boardCards)
    .where(and(eq(boardCards.tenantId, user.tenantId), eq(boardCards.id, id), isNull(boardCards.removedAt), visibleTo(user)))
    .for("update");
  if (!card || !(inWindow(card.forDate, today) || !card.doneAt)) throw notFound("This card is no longer on the board");
  return card;
}

/** Adds a card for today or a day ahead (up to a week), optionally for specific people (owner / Supervisor only). */
export async function addCard(user: CurrentUser, input: z.infer<typeof NewCardInput>, now = new Date()) {
  const today = indiaToday(now);
  if (input.date < today) throw badRequest("Cards can be added for today or a day ahead only");
  if (input.date > addDays(today, BOARD_AHEAD_DAYS)) throw badRequest(`Cards can be added up to ${BOARD_AHEAD_DAYS} days ahead`);
  const people = [...new Set(input.people)];
  if (people.length && !canClose(user)) throw forbidden("Only the owner or a supervisor can make a card for specific people");
  return withTenant(user.tenantId, async (tx) => {
    const [{ count } = { count: 0 }] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(boardCards)
      .where(and(eq(boardCards.tenantId, user.tenantId), eq(boardCards.forDate, input.date), isNull(boardCards.removedAt)));
    if (count >= 200) throw badRequest("This day already has 200 cards");
    const [row] = await tx
      .insert(boardCards)
      .values({ tenantId: user.tenantId, forDate: input.date, body: input.text, priority: input.priority, createdBy: user.userId })
      .returning({ id: boardCards.id });
    if (people.length) {
      const found = await tx
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.tenantId, user.tenantId), eq(users.status, "active"), inArray(users.id, people)));
      if (found.length !== people.length) throw badRequest("Someone you picked is not an active user of this plant");
      await tx
        .insert(boardCardPeople)
        .values(people.map((userId) => ({ tenantId: user.tenantId, cardId: row!.id, userId, addedBy: user.userId })));
    }
    return { id: row!.id };
  });
}

/**
 * Edits the text (writer only, while the card is live), closes / reopens it or changes its priority (owner or
 * Supervisor only).
 */
export async function changeCard(user: CurrentUser, id: string, input: z.infer<typeof ChangeCardInput>, now = new Date()) {
  const today = indiaToday(now);
  return withTenant(user.tenantId, async (tx) => {
    const card = await cardFor(tx, user, id, today);
    if ("priority" in input) {
      if (!canClose(user)) throw forbidden("Only the owner or a supervisor can change the priority");
      if (!stillLive(card, today)) throw forbidden("Closed cards for past days can't be changed");
      if (input.priority === card.priority) return { ok: true };
      await tx.update(boardCards).set({ priority: input.priority }).where(eq(boardCards.id, id));
      await audit(tx, {
        tenantId: user.tenantId,
        actor: `user:${user.userId}`,
        action: "board.priority",
        target: id,
        details: { for_date: card.forDate, before: card.priority, after: input.priority },
      });
    } else if ("text" in input) {
      if (card.createdBy !== user.userId) throw forbidden("Only the person who wrote this card can change it");
      if (!stillLive(card, today)) throw forbidden("Closed cards for past days can't be changed");
      if (input.text === card.body) return { ok: true };
      await tx.update(boardCards).set({ body: input.text, editedAt: new Date() }).where(eq(boardCards.id, id));
      await audit(tx, {
        tenantId: user.tenantId,
        actor: `user:${user.userId}`,
        action: "board.edit",
        target: id,
        details: { for_date: card.forDate, before: card.body, after: input.text },
      });
    } else if (!canClose(user)) {
      throw forbidden("Only the owner or a supervisor can close a card");
    } else if (input.done !== !!card.doneAt) {
      await tx
        .update(boardCards)
        .set(input.done ? { doneBy: user.userId, doneAt: new Date() } : { doneBy: null, doneAt: null })
        .where(eq(boardCards.id, id));
    }
    return { ok: true };
  });
}

/** Takes a card off the board (owner or Supervisor only). The row stays, shown crossed out, and is audited. */
export async function removeCard(user: CurrentUser, id: string, now = new Date()) {
  const today = indiaToday(now);
  return withTenant(user.tenantId, async (tx) => {
    const card = await cardFor(tx, user, id, today);
    if (!canClose(user)) throw forbidden("Only the owner or a supervisor can remove a card");
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

/** Numbers for the launcher card: open cards for today (incl. carried forward) and cards for tomorrow. */
export async function boardSummary(user: CurrentUser, now = new Date()) {
  const today = indiaToday(now);
  const tomorrow = addDays(today, 1);
  const rows = await withTenant(user.tenantId, (tx) =>
    tx
      .select({ day: boardCards.forDate, count: sql<number>`count(*)::int`, open: sql<number>`count(*) filter (where ${boardCards.doneAt} is null)::int` })
      .from(boardCards)
      .where(and(eq(boardCards.tenantId, user.tenantId), gte(boardCards.forDate, today), lte(boardCards.forDate, tomorrow), isNull(boardCards.removedAt), visibleTo(user)))
      .groupBy(boardCards.forDate),
  );
  const [{ carried } = { carried: 0 }] = await withTenant(user.tenantId, (tx) =>
    tx
      .select({ carried: sql<number>`count(*)::int` })
      .from(boardCards)
      .where(and(eq(boardCards.tenantId, user.tenantId), lt(boardCards.forDate, today), isNull(boardCards.doneAt), isNull(boardCards.removedAt), visibleTo(user))),
  );
  const of = (d: string) => rows.find((r) => r.day === d) ?? { count: 0, open: 0 };
  const own = of(today);
  const t = { count: own.count + carried, open: own.open + carried };
  const n = of(tomorrow);
  // Same shape as a module tile's numbers, so the launcher draws it the same way.
  const badges: { text: string; tone: "info" | "warn" | "ok" }[] = [];
  if (t.count) badges.push({ text: t.open ? `${t.open} open today` : "Today all done", tone: t.open ? "warn" : "ok" });
  badges.push({ text: n.count ? `${n.count} for tomorrow` : "Nothing for tomorrow yet", tone: "info" });
  return { state: "ok" as const, today: t, tomorrow: n, badges };
}
