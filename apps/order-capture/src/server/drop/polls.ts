// Drop polls on the server (docs/CUSTOMER_APP_PHASE_PLAN.md "Polls tab", Phase 4; rules: src/lib/polls.ts).
//   * owner: new poll (never edited after), close early, results split by place and buying size, CSV with each shop's
//     real boxes; support reads
//   * the app: open polls of the shop's brands not answered yet, and answering once (poll points decided when saved)
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { csv, csvTime } from "@plantops/module-kit/csv";
import { brandKey } from "@/lib/brand";
import { shiftMonths } from "@/lib/customer-page";
import { addDays } from "@/lib/customer-insights";
import { settingOn, startDateOf } from "@/lib/points";
import { answerPoints, OTHER, pollResults, pollState, REASON_TEXT, sizeOf, SIZE_LABEL, weekStart as weekStartOf, type PollReason } from "@/lib/polls";
import { requireAccess } from "../access";
import { audit } from "../audit";
import { schema, withTenant, type OcTx } from "../db";
import { badRequest, conflict, notFound } from "../http";
import { kit } from "../kit";
import { istToday } from "../ledger";
import type { OcUser } from "../session";
import { DropError } from "./api";
import { boxesByShop, totalBoxes } from "./boxes";
import { dropAppOfPlant } from "./config";
import { brandChoices } from "./manage";
import { settingsRows } from "./points";
import { productMatcher } from "./products";
import type { AppSession } from "./session";

const { customers, orders, pollAnswers, polls } = schema;

const IST = "Asia/Kolkata";
const istDate = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: IST }).format(d);
/** The start of an India date, as a time. */
const istMidnight = (day: string) => new Date(`${day}T00:00:00+05:30`);

type PollRow = typeof polls.$inferSelect;
const stateOf = (p: PollRow, now: Date) => pollState({ opens_at: p.opensAt, closes_at: p.closesAt, closed_early_at: p.closedEarlyAt }, now);

// ---------- owner ----------

export async function pollsPage(user: OcUser, now = new Date()) {
  requireAccess(user, "drop_polls_view");
  const app = dropAppOfPlant(user.tenantId);
  return withTenant(user.tenantId, async (tx) => {
    const rows = await tx.select().from(polls).where(eq(polls.tenantId, user.tenantId)).orderBy(desc(polls.opensAt)).limit(200);
    const counts = rows.length
      ? await tx
          .select({ pollId: pollAnswers.pollId, n: sql<number>`count(*)::int` })
          .from(pollAnswers)
          .where(and(eq(pollAnswers.tenantId, user.tenantId), inArray(pollAnswers.pollId, rows.map((r) => r.id))))
          .groupBy(pollAnswers.pollId)
      : [];
    const n = new Map(counts.map((c) => [c.pollId, c.n]));
    const brands = app ? [app.brand, ...(await brandChoices(tx, user.tenantId, app.brand))] : [];
    return {
      set_up: app !== null,
      main_brand: app?.brand ?? null,
      brands,
      today: istToday(),
      polls: rows.map((p) => ({ id: p.id, question: p.question, state: stateOf(p, now), opens_at: p.opensAt.toISOString(), closes_at: p.closesAt.toISOString(), brands: p.brands, answers: n.get(p.id) ?? 0 })),
    };
  });
}

const YMD = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "A date like 2026-12-01");
export const PollInput = z.object({
  question: z.string().trim().min(3, "The question needs at least 3 letters").max(150, "A question has at most 150 characters"),
  choices: z.array(z.string().trim().min(1, "A choice can't be empty").max(60, "A choice has at most 60 characters")).min(2, "At least 2 choices").max(6, "At most 6 choices"),
  other_allowed: z.boolean(),
  brands: z.array(z.string().trim().min(1).max(40)).min(1, "Pick at least one brand").max(10),
  opens_on: YMD,
  closes_on: YMD,
});

/** Owner: publish a poll. Today opens it now; a later day at its start. It closes at the end of `closes_on`. */
export async function createPoll(user: OcUser, input: z.infer<typeof PollInput>, now = new Date()) {
  requireAccess(user, "drop_polls");
  const app = dropAppOfPlant(user.tenantId);
  if (!app) throw badRequest("The Drop app isn't set up for this plant yet.");
  const today = istDate(now);
  if (input.opens_on < today) throw badRequest("A poll can't open on a past day.");
  if (input.closes_on < input.opens_on) throw badRequest("The poll must close on or after the day it opens.");
  if (new Set(input.choices.map((c) => c.toLowerCase())).size !== input.choices.length) throw badRequest("Each choice must be different.");
  return withTenant(user.tenantId, async (tx) => {
    const allowed = new Map([app.brand, ...(await brandChoices(tx, user.tenantId, app.brand))].map((b) => [brandKey(b), b]));
    const brands = [...new Set(input.brands.map((b) => allowed.get(brandKey(b)) ?? null))];
    if (brands.includes(null)) throw badRequest("One of the brands is not a brand on Rates.");
    const opensAt = input.opens_on === today ? now : istMidnight(input.opens_on);
    const [row] = await tx
      .insert(polls)
      .values({
        tenantId: user.tenantId,
        question: input.question,
        choices: input.choices,
        otherAllowed: input.other_allowed,
        brands: brands as string[],
        opensAt,
        closesAt: istMidnight(addDays(input.closes_on, 1)),
        createdBy: user.userId,
        createdByName: user.name,
      })
      .returning({ id: polls.id });
    await audit(tx, user, "drop.poll_add", row!.id, { question: input.question, choices: input.choices, opens_on: input.opens_on, closes_on: input.closes_on, brands });
    return { id: row!.id };
  });
}

/** Owner: close a poll now (once). */
export async function closePoll(user: OcUser, id: string, now = new Date()) {
  requireAccess(user, "drop_polls");
  return withTenant(user.tenantId, async (tx) => {
    const [p] = await tx.select().from(polls).where(and(eq(polls.tenantId, user.tenantId), eq(polls.id, id))).for("update");
    if (!p) throw notFound("Poll not found");
    if (stateOf(p, now) === "closed") throw conflict("This poll is already closed.");
    await tx.update(polls).set({ closedEarlyAt: now, closedEarlyBy: user.userId, closedEarlyByName: user.name }).where(and(eq(polls.tenantId, user.tenantId), eq(polls.id, id)));
    await audit(tx, user, "drop.poll_close", id, { question: p.question });
    return { ok: true };
  });
}

/** The poll with its answers, each with the shop's place and main-brand boxes in the 3 months before the poll opened. */
async function pollWithAnswers(tx: OcTx, tenantId: string, id: string) {
  const [p] = await tx.select().from(polls).where(and(eq(polls.tenantId, tenantId), eq(polls.id, id)));
  if (!p) throw notFound("Poll not found");
  const answers = await tx
    .select({ a: pollAnswers, shop: customers.name, place: customers.place })
    .from(pollAnswers)
    .innerJoin(customers, and(eq(customers.tenantId, pollAnswers.tenantId), eq(customers.id, pollAnswers.customerId)))
    .where(and(eq(pollAnswers.tenantId, tenantId), eq(pollAnswers.pollId, id)))
    .orderBy(pollAnswers.createdAt);
  const to = istDate(p.opensAt);
  const from = addDays(shiftMonths(to, -3), 1);
  const main = dropAppOfPlant(tenantId)?.brand ?? "";
  const { of } = await productMatcher(tx, tenantId, await kit.products(tenantId));
  const boxes = answers.length ? await boxesByShop(tx, tenantId, of, main, from, to) : new Map<string, Map<string, number>>();
  return { p, answers, boxes, window: { from, to }, main };
}

export async function pollDetail(user: OcUser, id: string, now = new Date()) {
  requireAccess(user, "drop_polls_view");
  return withTenant(user.tenantId, async (tx) => {
    const { p, answers, boxes, window } = await pollWithAnswers(tx, user.tenantId, id);
    const results = pollResults(
      p.choices,
      p.otherAllowed,
      answers.map(({ a, place }) => ({ choice: a.choice, other_text: a.otherText, place, boxes: totalBoxes(boxes.get(a.customerId)) })),
    );
    return {
      id: p.id,
      question: p.question,
      choices: p.choices,
      other_allowed: p.otherAllowed,
      brands: p.brands,
      state: stateOf(p, now),
      opens_at: p.opensAt.toISOString(),
      closes_at: p.closesAt.toISOString(),
      closed_early_by: p.closedEarlyByName,
      created_by: p.createdByName,
      window,
      results,
    };
  });
}

/** Owner: one row per answer, with the shop's real main-brand boxes per product (what they say vs what they buy). */
export async function pollCsv(user: OcUser, id: string) {
  requireAccess(user, "drop_polls");
  return withTenant(user.tenantId, async (tx) => {
    const { p, answers, boxes, window } = await pollWithAnswers(tx, user.tenantId, id);
    const products = [...new Set([...boxes.values()].flatMap((m) => [...m.keys()]))].sort((a, b) => a.localeCompare(b));
    const answerText = (c: number) => (c === OTHER ? "Other" : (p.choices[c] ?? ""));
    const rows: unknown[][] = [
      ["Shop", "Place", "Phone", "Answer", "Other text", "Points", "Answered at", "Buying size", `Boxes ${window.from} to ${window.to}`, ...products],
      ...answers.map(({ a, shop, place }) => {
        const m = boxes.get(a.customerId);
        const total = totalBoxes(m);
        return [shop, place, a.phone, answerText(a.choice), a.otherText ?? "", a.points, csvTime(a.createdAt), SIZE_LABEL[sizeOf(total)], total, ...products.map((x) => m?.get(x) ?? 0)];
      }),
    ];
    await audit(tx, user, "export.poll_csv", id, { question: p.question, answers: answers.length });
    return { body: csv(rows), name: `poll-${istDate(p.opensAt)}.csv` };
  });
}

// ---------- the app ----------

const sees = (p: PollRow, brands: string[]) => p.brands.some((b) => brands.some((x) => brandKey(x) === brandKey(b)));

export async function appPolls(s: AppSession, now = new Date()) {
  const t = s.app.tenantId;
  const today = istDate(now);
  return withTenant(t, async (tx) => {
    const settings = await settingsRows(tx, t);
    const start = startDateOf(settings);
    const pointsEach = start && today >= start ? (settingOn(settings, today)?.poll_points ?? 0) : 0;
    const open = (await tx.select().from(polls).where(and(eq(polls.tenantId, t), sql`${polls.opensAt} <= ${now}`, sql`${polls.closesAt} > ${now}`, sql`${polls.closedEarlyAt} is null`)).orderBy(desc(polls.opensAt))).filter((p) => sees(p, s.brands));
    const mine = await tx.select().from(pollAnswers).where(and(eq(pollAnswers.tenantId, t), eq(pollAnswers.customerId, s.customerId)));
    const answered = new Set(mine.map((a) => a.pollId));
    const monday = istMidnight(weekStartOf(today));
    return {
      points_each: pointsEach,
      this_week: { counted: mine.some((a) => a.pointsReason === "counted" && a.createdAt >= monday) },
      polls: open.filter((p) => !answered.has(p.id)).map((p) => ({ id: p.id, question: p.question, choices: p.choices, other_allowed: p.otherAllowed, closes_at: p.closesAt.toISOString() })),
      answered: { count: mine.length, points: mine.reduce((sum, a) => sum + a.points, 0) },
    };
  });
}


export const AnswerInput = z.object({ choice: z.number().int().min(OTHER).max(5), other: z.string().trim().max(100).optional() });

/** The app: answer a poll once. Poll points are decided now and kept with the answer. */
export async function answerPoll(s: AppSession, pollId: string, input: z.infer<typeof AnswerInput>, now = new Date()) {
  const t = s.app.tenantId;
  const today = istDate(now);
  return withTenant(t, async (tx) => {
    // one answer at a time per shop, so two phones can't both get this week's points
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('order_capture.poll'), hashtext(${s.customerId}))`);
    const [p] = await tx.select().from(polls).where(and(eq(polls.tenantId, t), eq(polls.id, pollId)));
    if (!p) throw new DropError(404, "not_offered", "This poll was not found");
    if (!sees(p, s.brands)) throw new DropError(409, "not_allowed", "This poll is not for your shop");
    if (stateOf(p, now) !== "open") throw new DropError(409, "not_allowed", "This poll is closed");
    if (input.choice === OTHER ? !p.otherAllowed || !input.other : input.choice >= p.choices.length || input.other)
      throw new DropError(400, "bad_request", input.choice === OTHER ? "Please write your answer" : "Invalid answer");
    const [done] = await tx.select({ id: pollAnswers.id }).from(pollAnswers).where(and(eq(pollAnswers.tenantId, t), eq(pollAnswers.pollId, pollId), eq(pollAnswers.customerId, s.customerId)));
    if (done) throw new DropError(409, "not_allowed", "You already answered this poll");

    const settings = await settingsRows(tx, t);
    const start = startDateOf(settings);
    const counted = await tx
      .select({ at: pollAnswers.createdAt })
      .from(pollAnswers)
      .where(and(eq(pollAnswers.tenantId, t), eq(pollAnswers.customerId, s.customerId), eq(pollAnswers.pointsReason, "counted")));
    const [last] = await tx
      .select({ at: sql<Date>`max(${orders.deliveredAt})` })
      .from(orders)
      .where(and(eq(orders.tenantId, t), eq(orders.customerId, s.customerId), eq(orders.status, "delivered")));
    const lastAt = last?.at ? new Date(last.at) : null;
    const { points, reason } = answerPoints({
      pointsOn: !!start && today >= start,
      pollPoints: settingOn(settings, today)?.poll_points ?? 0,
      today,
      countedOn: counted.map((c) => istDate(c.at)),
      lastDeliveredOn: lastAt ? istDate(lastAt) : null,
    });
    await tx.insert(pollAnswers).values({
      tenantId: t,
      pollId,
      customerId: s.customerId,
      phone: s.phone,
      choice: input.choice,
      otherText: input.choice === OTHER ? input.other! : null,
      points,
      pointsReason: reason as PollReason,
    });
    return { points, reason, message: REASON_TEXT[reason](points) };
  });
}
