// Claims: field duty (km → TA, days → DA) and expenses (docs/SALARY_EXTRAS_PHASE_PLAN.md Part B). The rows are
// append-only: a claim never changes, and its status is its newest decision (none = waiting). The money rules are in
// src/lib/salary.ts (claimTotals); this file loads claims from the database.
import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { fileSha256, newStorageKey, sniffType } from "@plantops/module-kit/storage";
import { addDays, addMonths, istDay, istMonth, monthDays, validDay, validMonth } from "@/lib/days";
import { firstSalaryMonth, settingFor, toPaise, type Claim, type ClaimKind, type ClaimStatus } from "@/lib/salary";
import { can, requireAccess } from "./access";
import { audit } from "./audit";
import { schema, withTenant, type AtTx } from "./db";
import { badRequest, conflict, forbidden, HttpError, notFound } from "./http";
import { kit } from "./kit";
import { dbNow, lockPerson } from "./marks";
import { knownPerson } from "./people";
import type { AtUser } from "./session";
import { fileStorage, MAX_PHOTO_BYTES, MAX_PHOTOS } from "./storage";

const { salaryClaims, salaryClaimDecisions, salaryClaimFiles, salarySettings, supportViews } = schema;

/** One claim with its status and what the screens need around it. */
export interface ClaimRow extends Claim {
  userId: string;
  userName: string;
  /** who entered it: the person themselves, or the owner on their behalf (approved at once) */
  createdBy: string;
  createdByName: string;
  createdAt: Date;
  /** the decision that set the status (null while waiting) */
  decidedByName: string | null;
  decidedAt: Date | null;
  /** "not approved" / "cancelled" reason */
  reason: string | null;
  /** bill photos (expenses only) */
  photos: number;
}

/**
 * The status from a claim's decisions: cancelled (once, only after approved) beats the first decision; no decision =
 * waiting. Decided once and cancelled once are database rules, so this never depends on timestamps.
 */
export function statusOf(decisions: readonly { decision: Exclude<ClaimStatus, "waiting"> }[]): ClaimStatus {
  if (decisions.some((d) => d.decision === "cancelled")) return "cancelled";
  return decisions[0]?.decision ?? "waiting";
}

/** A plant's (or one person's) claims with their status, oldest date first; optionally only dates in [from, to]. */
export async function loadClaims(tx: AtTx, tenantId: string, opts: { personId?: string; from?: string; to?: string; ids?: string[] } = {}): Promise<ClaimRow[]> {
  const claims = await tx
    .select()
    .from(salaryClaims)
    .where(
      and(
        eq(salaryClaims.tenantId, tenantId),
        opts.personId ? eq(salaryClaims.userId, opts.personId) : sql`true`,
        opts.from ? sql`${salaryClaims.onDate} >= ${opts.from}` : sql`true`,
        opts.to ? sql`${salaryClaims.onDate} <= ${opts.to}` : sql`true`,
        opts.ids ? (opts.ids.length ? inArray(salaryClaims.id, opts.ids) : sql`false`) : sql`true`,
      ),
    )
    .orderBy(salaryClaims.onDate, salaryClaims.createdAt);
  if (claims.length === 0) return [];
  const ids = claims.map((c) => c.id);
  const decisions = await tx.select().from(salaryClaimDecisions).where(and(eq(salaryClaimDecisions.tenantId, tenantId), inArray(salaryClaimDecisions.claimId, ids)));
  const photos = await tx
    .select({ claimId: salaryClaimFiles.claimId, n: sql<number>`count(*)::int` })
    .from(salaryClaimFiles)
    .where(and(eq(salaryClaimFiles.tenantId, tenantId), inArray(salaryClaimFiles.claimId, ids)))
    .groupBy(salaryClaimFiles.claimId);
  const photoCount = new Map(photos.map((p) => [p.claimId, p.n]));
  return claims.map((c) => {
    const mine = decisions.filter((d) => d.claimId === c.id);
    const status = statusOf(mine);
    const setBy = status === "waiting" ? null : mine.find((d) => d.decision === status)!;
    return {
      id: c.id,
      userId: c.userId,
      userName: c.userName,
      kind: c.kind,
      onDate: c.onDate,
      kmTenths: c.kmTenths,
      amountPaise: c.amountPaise,
      note: c.note,
      status,
      createdBy: c.createdBy,
      createdByName: c.createdByName,
      createdAt: c.createdAt,
      decidedByName: setBy?.createdByName ?? null,
      decidedAt: setBy?.createdAt ?? null,
      reason: setBy?.reason ?? null,
      photos: photoCount.get(c.id) ?? 0,
    };
  });
}

// ---------- the rules of the plan ("Worker: My claims") ----------

/** A worker may date a claim up to this many days back (the owner: any date from the first salary month). */
export const DAYS_BACK = 31;
/** Photos may be added to a claim within this time of entering it, by whoever entered it. */
export const ADD_PHOTOS_WITHIN_MS = 24 * 60 * 60 * 1000;
/** ₹10 lakh, the largest expense (the database checks it too). */
const MAX_EXPENSE_PAISE = 100_000_000;
/** km as typed: 0-9,999.9, at most one decimal ("42", "42.5"). */
const KM_RE = /^\d{1,4}(\.\d)?$/;

const shortDay = (date: string) => new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`));
const by = (u: AtUser) => u.name.slice(0, 100);

/** One person's salary settings (months as "YYYY-MM"). */
async function settingsOf(tx: AtTx, tenantId: string, personId: string) {
  const rows = await tx.select().from(salarySettings).where(and(eq(salarySettings.tenantId, tenantId), eq(salarySettings.userId, personId)));
  return rows.map((r) => ({ ...r, fromMonth: r.fromMonth.slice(0, 7) }));
}

/** A claim's own rate check: field duty needs a TA or DA rate in that month's setting. */
const hasFieldDutyRate = (s: { kmRatePaise: number | null; daDayPaise: number | null } | null) => !!s && (s.kmRatePaise !== null || s.daDayPaise !== null);

/**
 * May a person send their OWN claims for a month (docs/ATTENDANCE_ROLES_PHASE_PLAN.md Phase C)? Only with the owner's
 * "Field staff" tick in that month's setting. An owner (who is also Plant staff) needs only a salary setting, as before.
 */
const mayClaim = (user: AtUser, s: { fieldStaff: boolean } | null) => !!s && (user.isOwner || s.fieldStaff);
const NOT_FIELD_STAFF = "Claims are only for field staff. Ask the owner.";

/** Has this person any claim on record (any status, whoever entered it)? Then My claims stays open to them. */
async function hasAnyClaim(tx: AtTx, tenantId: string, personId: string) {
  const [row] = await tx.select({ id: salaryClaims.id }).from(salaryClaims).where(and(eq(salaryClaims.tenantId, tenantId), eq(salaryClaims.userId, personId))).limit(1);
  return !!row;
}

/** The months a worker's new claim may be dated in: from 31 days back to this month. */
const windowMonths = (today: string) => [...new Set([addDays(today, -DAYS_BACK).slice(0, 7), today.slice(0, 7)])];

/**
 * My claims is open: an owner with any salary setting; anyone else ticked Field staff in a month they may still date a
 * claim in (this month, or last month within 31 days), or with a claim on record.
 */
async function myClaimsOpen(tx: AtTx, user: AtUser, settings: Awaited<ReturnType<typeof settingsOf>>, now: Date) {
  if (settings.length === 0) return false;
  if (user.isOwner) return true;
  return windowMonths(istDay(now)).some((m) => mayClaim(user, settingFor(settings, m))) || (await hasAnyClaim(tx, user.tenantId, user.userId));
}

export const ClaimInput = z.object({
  kind: z.enum(["field_duty", "expense"]),
  on_date: z.string().refine(validDay, "Pick a date"),
  /** field duty: km as typed */
  km: z.string().max(10).nullish(),
  /** expense: rupees as typed */
  amount: z.string().max(20).nullish(),
  note: z.string().max(400),
});

/**
 * Checks what the person typed and saves one claim (the caller holds the person's lock). `entered` = who typed it:
 * the person themselves, or the owner on their behalf. An owner's entry, and an owner's own claim (owner who is also
 * Plant staff), is approved at once (docs/SALARY_EXTRAS_PHASE_PLAN.md).
 */
export async function insertClaim(tx: AtTx, entered: AtUser, person: { userId: string; name: string }, input: z.infer<typeof ClaimInput>, opts: { earliest: string; today: string }) {
  const note = input.note.trim();
  if (note.length < 3 || note.length > 200) throw badRequest("Write what it was for (3 to 200 characters)");
  if (input.on_date > opts.today) throw badRequest("The date can't be in the future");
  if (input.on_date < opts.earliest) throw badRequest(entered.userId === person.userId && !entered.isOwner ? `The date can be at most ${DAYS_BACK} days back` : "The date is before the first salary month");
  const settings = await settingsOf(tx, entered.tenantId, person.userId);
  const setting = settingFor(settings, input.on_date.slice(0, 7));
  if (!setting) throw badRequest("No salary is set for that month, so no claim can be sent for it");
  // the person's own claim needs the Field staff tick in that month; the owner's entries for someone don't
  if (entered.userId === person.userId && !mayClaim(entered, setting)) throw badRequest(NOT_FIELD_STAFF);

  let kmTenths: number | null = null;
  let amountPaise: number | null = null;
  if (input.kind === "field_duty") {
    if (!hasFieldDutyRate(setting)) throw badRequest("No TA or DA rate is set for that month. Ask the owner.");
    const km = (input.km ?? "").trim();
    if (!KM_RE.test(km)) throw badRequest("Km: 0 to 9999.9, at most one decimal (42 or 42.5)");
    kmTenths = Math.round(Number(km) * 10);
    // one waiting-or-approved field duty per person and date
    const same = await loadClaims(tx, entered.tenantId, { personId: person.userId, from: input.on_date, to: input.on_date });
    if (same.some((c) => c.kind === "field_duty" && (c.status === "waiting" || c.status === "approved"))) {
      throw conflict(entered.userId === person.userId ? `You already sent field duty for ${shortDay(input.on_date)}` : `${person.name} already has field duty on ${shortDay(input.on_date)}`);
    }
  } else {
    const p = toPaise(input.amount ?? "");
    if (p === null || p <= 0) throw badRequest("Amount: write rupees like 450 or 450.50 (no commas)");
    if (p > MAX_EXPENSE_PAISE) throw badRequest("An expense is at most ₹10,00,000");
    amountPaise = p;
  }

  const [row] = await tx
    .insert(salaryClaims)
    .values({ tenantId: entered.tenantId, userId: person.userId, userName: person.name.slice(0, 100), kind: input.kind, onDate: input.on_date, kmTenths, amountPaise, note, createdBy: entered.userId, createdByName: by(entered) })
    .returning();
  const approvedAtOnce = entered.isOwner;
  if (approvedAtOnce) {
    await tx.insert(salaryClaimDecisions).values({ tenantId: entered.tenantId, claimId: row!.id, decision: "approved", createdBy: entered.userId, createdByName: by(entered) });
  }
  await audit(tx, entered, entered.userId === person.userId ? "claim.sent" : "claim.entered", row!.id, {
    person: person.name,
    kind: input.kind,
    on: input.on_date,
    km: kmTenths,
    amount: amountPaise,
    note,
    approved: approvedAtOnce,
  });
  return { claim: row!, approved: approvedAtOnce };
}

// ---------- the worker: My claims ----------

export interface MyClaimsView {
  month: string;
  prev: string | null;
  next: string | null;
  today: string;
  /** dates a new claim may have */
  earliest: string;
  /** "+ Field duty" is offered: may add claims this month and the setting has a TA or DA rate */
  fieldDuty: boolean;
  /** "+ Field duty" / "+ Expense" are offered: ticked Field staff this month (owners: a salary setting) */
  canAdd: boolean;
  /** a new claim may be dated in at least one month of the 31-day window (the new-claim page) */
  canAddAny: boolean;
  /** the person has a salary setting for this month */
  onSalary: boolean;
  /** newest date first; km and the amounts the person typed, never TA / DA rupees */
  claims: ClaimRow[];
  /** each claim's bill photos (ids, oldest first) */
  photos: Record<string, string[]>;
  approved: { fieldDutyDays: number; kmTenths: number; expensesPaise: number };
  waiting: number;
}

/**
 * Does this person have My claims at all? Ticked Field staff this month, or a claim on record (owners: any salary
 * setting). Without, there is no tab and the page is 404.
 */
export async function hasOwnClaims(user: AtUser, now: Date = new Date()): Promise<boolean> {
  if (!can(user, "claim_own")) return false;
  return withTenant(user.tenantId, async (tx) => myClaimsOpen(tx, user, await settingsOf(tx, user.tenantId, user.userId), now));
}

/** Your own claims for a month (your own only). 404 when My claims isn't open to you (above), a bad or future month. */
export async function myClaims(user: AtUser, month: string | null, now: Date = new Date()): Promise<MyClaimsView> {
  if (!can(user, "claim_own")) throw notFound();
  return withTenant(user.tenantId, async (tx) => {
    const settings = await settingsOf(tx, user.tenantId, user.userId);
    const first = firstSalaryMonth(settings);
    if (!first || !(await myClaimsOpen(tx, user, settings, now))) throw notFound();
    const today = istDay(now);
    const m = month ?? istMonth(now);
    if (!validMonth(m) || m > istMonth(now) || m < first) throw notFound();
    const days = monthDays(m);
    const claims = (await loadClaims(tx, user.tenantId, { personId: user.userId, from: days[0], to: days.at(-1) })).reverse();
    const approved = claims.filter((c) => c.status === "approved");
    const photos = Object.fromEntries(await photoIds(tx, user.tenantId, claims.map((c) => c.id)));
    const earliest = [addDays(today, -DAYS_BACK), `${first}-01`].sort().at(-1)!;
    const canAdd = mayClaim(user, settingFor(settings, m));
    return {
      month: m,
      prev: m > first ? addMonths(m, -1) : null,
      next: m < istMonth(now) ? addMonths(m, 1) : null,
      today,
      earliest,
      fieldDuty: canAdd && hasFieldDutyRate(settingFor(settings, m)),
      canAdd,
      canAddAny: windowMonths(today).some((x) => x >= first && mayClaim(user, settingFor(settings, x))),
      onSalary: settingFor(settings, m) !== null,
      claims,
      photos,
      approved: {
        fieldDutyDays: new Set(approved.filter((c) => c.kind === "field_duty").map((c) => c.onDate)).size,
        kmTenths: approved.reduce((sum, c) => sum + (c.kmTenths ?? 0), 0),
        expensesPaise: approved.reduce((sum, c) => sum + (c.amountPaise ?? 0), 0),
      },
      waiting: claims.filter((c) => c.status === "waiting").length,
    };
  });
}

/** The worker sends a claim for themselves: today back to 31 days, in a month with a salary setting. */
export async function sendClaim(user: AtUser, input: z.infer<typeof ClaimInput>) {
  requireAccess(user, "claim_own");
  return withTenant(user.tenantId, async (tx) => {
    await lockPerson(tx, user.tenantId, user.userId);
    const today = istDay(await dbNow(tx));
    const settings = await settingsOf(tx, user.tenantId, user.userId);
    const first = firstSalaryMonth(settings);
    if (!first) throw badRequest("No salary is set for you yet, so no claim can be sent");
    const earliest = [addDays(today, -DAYS_BACK), `${first}-01`].sort().at(-1)!;
    const { claim, approved } = await insertClaim(tx, user, { userId: user.userId, name: user.name }, input, { earliest, today });
    return { id: claim.id, approved, claim };
  });
}

/** The worker withdraws their own claim while it is still waiting. Anyone else's claim: 404. */
export async function withdrawClaim(user: AtUser, claimId: string) {
  requireAccess(user, "claim_own");
  return withTenant(user.tenantId, async (tx) => {
    await lockPerson(tx, user.tenantId, user.userId);
    const [c] = await loadClaims(tx, user.tenantId, { personId: user.userId, ids: [claimId] });
    if (!c) throw notFound("Claim not found");
    if (c.status !== "waiting") throw conflict(c.status === "withdrawn" ? "Already withdrawn" : `Already ${c.status === "rejected" ? "not approved" : c.status} by ${c.decidedByName ?? "the owner"}`);
    await tx.insert(salaryClaimDecisions).values({ tenantId: user.tenantId, claimId, decision: "withdrawn", createdBy: user.userId, createdByName: by(user) });
    await audit(tx, user, "claim.withdrawn", claimId, { person: c.userName, kind: c.kind, on: c.onDate, km: c.kmTenths, amount: c.amountPaise });
    return { id: claimId };
  });
}

// ---------- bill photos ----------

/** The plan's Attendance storage limit in bytes (super_admin sets MB; blank = unlimited). */
async function storageLimitBytes(tenantId: string) {
  const mb = (await kit.plan(tenantId))?.limits.modules.attendance_salary?.storage_mb;
  return mb ? mb * 1024 * 1024 : null;
}

/**
 * One bill photo for an expense: by whoever entered the claim, within 24 hours, at most 3, while it is still waiting
 * (or approved at entry, when the owner entered it). Type checked by content; the plan's storage limit.
 */
export async function uploadClaimPhoto(user: AtUser, claimId: string, data: Buffer, opts: { now?: number } = {}) {
  const now = opts.now ?? Date.now();
  if (!can(user, "claim_own") && !can(user, "claim_decide")) requireAccess(user, "claim_own");
  if (!data.length) throw badRequest("The photo is empty");
  const type = sniffType(data);
  if (!type || type === "application/pdf") throw new HttpError(415, "Only photos (JPG, PNG, WebP) can be added");
  if (data.length > MAX_PHOTO_BYTES) throw new HttpError(413, "Photos can be at most 10 MB");
  const limit = await storageLimitBytes(user.tenantId);

  return withTenant(user.tenantId, async (tx) => {
    const [c] = await loadClaims(tx, user.tenantId, { ids: [claimId] });
    // someone else's claim is "not found" for a worker; their own (entered by the owner) gets the plain reason below
    if (!c || (c.createdBy !== user.userId && c.userId !== user.userId && !can(user, "claim_view"))) throw notFound("Claim not found");
    if (c.createdBy !== user.userId) throw forbidden("Only the person who entered this claim can add its photos");
    if (c.kind !== "expense") throw badRequest("Photos are only for expenses");
    if (now - c.createdAt.getTime() > ADD_PHOTOS_WITHIN_MS) throw forbidden("Photos can only be added within 24 hours of sending");
    const approvedAtEntry = c.status === "approved" && c.decidedByName !== null && c.createdBy === user.userId && user.isOwner;
    if (c.status !== "waiting" && !approvedAtEntry) throw conflict(`This claim was already ${c.status === "rejected" ? "not approved" : c.status}; photos can't be added now`);

    // one upload per claim at a time, so two at once can't pass the limits together
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('attendance_salary.claim_files'), hashtext(${claimId}))`);
    const [{ n } = { n: 0 }] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(salaryClaimFiles)
      .where(and(eq(salaryClaimFiles.tenantId, user.tenantId), eq(salaryClaimFiles.claimId, claimId)));
    if (n >= MAX_PHOTOS) throw conflict(`This expense already has ${MAX_PHOTOS} photos`);

    let usedBefore = 0;
    if (limit !== null) {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('attendance_salary.storage'), hashtext(${user.tenantId}))`);
      const [used] = await tx.select({ n: sql<number>`coalesce(sum(${salaryClaimFiles.sizeBytes}), 0)::bigint` }).from(salaryClaimFiles).where(eq(salaryClaimFiles.tenantId, user.tenantId));
      usedBefore = Number(used?.n ?? 0);
      if (usedBefore + data.length > limit) throw new HttpError(413, "Storage full for your plan – ask PlantOps to extend it");
    }

    const key = newStorageKey(user.tenantId);
    await fileStorage().put(key, data, type);
    const [row] = await tx
      .insert(salaryClaimFiles)
      .values({ tenantId: user.tenantId, claimId, storageKey: key, contentType: type, sizeBytes: data.length, sha256: fileSha256(data), createdBy: user.userId, createdByName: by(user) })
      .returning();
    return { id: row!.id, size: row!.sizeBytes, storage: limit === null ? null : { before: usedBefore, after: usedBefore + data.length, limit } };
  });
}

/** A claim's photo ids, oldest first (for the screens). */
export async function photoIds(tx: AtTx, tenantId: string, claimIds: string[]) {
  if (claimIds.length === 0) return new Map<string, string[]>();
  const rows = await tx
    .select({ id: salaryClaimFiles.id, claimId: salaryClaimFiles.claimId })
    .from(salaryClaimFiles)
    .where(and(eq(salaryClaimFiles.tenantId, tenantId), inArray(salaryClaimFiles.claimId, claimIds)))
    .orderBy(salaryClaimFiles.createdAt);
  const out = new Map<string, string[]>();
  for (const r of rows) out.set(r.claimId, [...(out.get(r.claimId) ?? []), r.id]);
  return out;
}

/**
 * A photo's bytes: only to its claim's own person, the owner, or PlantOps support (the view is logged for the owner).
 * Every other request, including another plant's photo: 404.
 */
export async function readClaimPhoto(user: AtUser, fileId: string) {
  const row = await withTenant(user.tenantId, async (tx) => {
    const [f] = await tx
      .select({ storageKey: salaryClaimFiles.storageKey, contentType: salaryClaimFiles.contentType, claimId: salaryClaimFiles.claimId, owner: salaryClaims.userId })
      .from(salaryClaimFiles)
      .innerJoin(salaryClaims, and(eq(salaryClaims.tenantId, salaryClaimFiles.tenantId), eq(salaryClaims.id, salaryClaimFiles.claimId)))
      .where(and(eq(salaryClaimFiles.tenantId, user.tenantId), eq(salaryClaimFiles.id, fileId)));
    if (!f) return null;
    const own = f.owner === user.userId && can(user, "claim_own");
    if (!own && !can(user, "claim_view")) return null;
    if (user.isSupport) await tx.insert(supportViews).values({ tenantId: user.tenantId, superAdminId: user.userId, superAdminName: user.name, path: `/claim-photos/${fileId}` });
    return f;
  });
  if (!row) throw notFound("Photo not found");
  return { contentType: row.contentType, data: await fileStorage().get(row.storageKey) };
}

// ---------- the owner: Claims tab, decisions, entries for someone (docs/SALARY_EXTRAS_PHASE_PLAN.md "Owner: Claims tab") ----------

export type ClaimFilter = "waiting" | "approved" | "rejected" | "all";

/** A claim as the owner sees it: with TA / DA at that person's rates for the claim's month (null = no rate). */
export interface OwnerClaim extends ClaimRow {
  taPaise: number | null;
  daPaise: number | null;
  kmRatePaise: number | null;
  photoIds: string[];
}

/** TA / DA of one field-duty claim at the person's rates that month (the month's real totals are rules 16-17). */
async function withRates(tx: AtTx, tenantId: string, claims: ClaimRow[]): Promise<OwnerClaim[]> {
  const people = [...new Set(claims.map((c) => c.userId))];
  const settings = people.length
    ? (await tx.select().from(salarySettings).where(and(eq(salarySettings.tenantId, tenantId), inArray(salarySettings.userId, people)))).map((r) => ({ ...r, fromMonth: r.fromMonth.slice(0, 7) }))
    : [];
  const photos = await photoIds(tx, tenantId, claims.map((c) => c.id));
  return claims.map((c) => {
    const s = settingFor(settings.filter((x) => x.userId === c.userId), c.onDate.slice(0, 7));
    const duty = c.kind === "field_duty";
    return {
      ...c,
      kmRatePaise: s?.kmRatePaise ?? null,
      taPaise: duty && s?.kmRatePaise ? Math.round(((c.kmTenths ?? 0) * s.kmRatePaise) / 10) : null,
      daPaise: duty && s?.daDayPaise ? s.daDayPaise : null,
      photoIds: photos.get(c.id) ?? [],
    };
  });
}

/** How many claims wait for the owner, in every month (the "Claims (3)" tab). */
export async function waitingClaims(user: AtUser): Promise<number> {
  if (!can(user, "claim_view")) return 0;
  return withTenant(user.tenantId, async (tx) => {
    const [r] = await tx.execute<{ n: number }>(sql`
      select count(*)::int as n from ${salaryClaims} c
       where c.tenant_id = ${user.tenantId}
         and not exists (select 1 from ${salaryClaimDecisions} d where d.tenant_id = c.tenant_id and d.claim_id = c.id)`).then((x) => x.rows);
    return r?.n ?? 0;
  });
}

export interface ClaimsTab {
  month: string;
  prev: string;
  next: string | null;
  status: ClaimFilter;
  personId: string | null;
  /** people with claims this month (for the person filter), A-Z */
  people: { userId: string; name: string }[];
  claims: OwnerClaim[];
  /** this month's counts per filter */
  counts: Record<ClaimFilter, number>;
}

/** Owner and PlantOps support (read-only): one month's claims of everyone, filtered. 404 for a worker (access.ts). */
export async function claimsTab(user: AtUser, opts: { month?: string | null; status?: string | null; personId?: string | null } = {}, now: Date = new Date()): Promise<ClaimsTab> {
  requireAccess(user, "claim_view");
  const month = opts.month ?? istMonth(now);
  if (!validMonth(month) || month > istMonth(now)) throw notFound();
  const status: ClaimFilter = opts.status === "approved" || opts.status === "rejected" || opts.status === "all" ? opts.status : "waiting";
  return withTenant(user.tenantId, async (tx) => {
    const days = monthDays(month);
    const all = await loadClaims(tx, user.tenantId, { from: days[0], to: days.at(-1) });
    const people = [...new Map(all.map((c) => [c.userId, c.userName])).entries()].map(([userId, name]) => ({ userId, name })).sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }));
    const mine = opts.personId ? all.filter((c) => c.userId === opts.personId) : all;
    const match = (c: ClaimRow, f: ClaimFilter) => f === "all" || c.status === f;
    const shown = mine.filter((c) => match(c, status)).reverse(); // newest date first
    return {
      month,
      prev: addMonths(month, -1),
      next: month === istMonth(now) ? null : addMonths(month, 1),
      status,
      personId: opts.personId ?? null,
      people,
      claims: await withRates(tx, user.tenantId, shown),
      counts: { waiting: mine.filter((c) => match(c, "waiting")).length, approved: mine.filter((c) => match(c, "approved")).length, rejected: mine.filter((c) => match(c, "rejected")).length, all: mine.length },
    };
  });
}

/** One person's claims for a month, for their Staff page (owner and support). */
export async function personClaims(user: AtUser, personId: string, month: string): Promise<OwnerClaim[]> {
  requireAccess(user, "claim_view");
  return withTenant(user.tenantId, async (tx) => {
    const days = monthDays(month);
    return withRates(tx, user.tenantId, (await loadClaims(tx, user.tenantId, { personId, from: days[0], to: days.at(-1) })).reverse());
  });
}

export const DecideInput = z.object({
  claim_id: z.uuid(),
  decision: z.enum(["approve", "reject", "cancel"]),
  reason: z.string().max(400).nullish(),
});

/**
 * The owner decides: approve or not approve a WAITING claim, or cancel an APPROVED one (a reason for not approving and
 * for cancelling). Inside the person's lock, so a withdrawal or another owner's decision at the same moment gives 409.
 * Returns the worker's notification (none for an owner's own claim).
 */
export async function decideClaim(user: AtUser, input: z.infer<typeof DecideInput>) {
  requireAccess(user, "claim_decide");
  const reason = input.reason?.trim() || null;
  if (input.decision !== "approve" && (!reason || reason.length < 3 || reason.length > 300)) throw badRequest("Write a reason (3 to 300 characters). The person sees it.");
  return withTenant(user.tenantId, async (tx) => {
    const [first] = await loadClaims(tx, user.tenantId, { ids: [input.claim_id] });
    if (!first) throw notFound("Claim not found");
    await lockPerson(tx, user.tenantId, first.userId);
    const [c] = await loadClaims(tx, user.tenantId, { ids: [input.claim_id] }); // as it stands now, inside the lock
    const need = input.decision === "cancel" ? "approved" : "waiting";
    if (c!.status !== need) {
      const was = { waiting: "still waiting", approved: "approved", rejected: "not approved", withdrawn: "withdrawn", cancelled: "cancelled" }[c!.status];
      throw conflict(`Just changed: this claim was ${was}${c!.decidedByName ? ` by ${c!.decidedByName}` : ""}. The page has been refreshed.`);
    }
    const decision: "approved" | "rejected" | "cancelled" = input.decision === "approve" ? "approved" : input.decision === "reject" ? "rejected" : "cancelled";
    const [row] = await tx
      .insert(salaryClaimDecisions)
      .values({ tenantId: user.tenantId, claimId: c!.id, decision, reason: decision === "approved" ? null : reason, createdBy: user.userId, createdByName: by(user) })
      .returning();
    await audit(tx, user, `claim.${decision}`, c!.id, { person: c!.userName, kind: c!.kind, on: c!.onDate, km: c!.kmTenths, amount: c!.amountPaise, reason: decision === "approved" ? null : reason });
    return { id: row!.id, claim: c!, decision, reason: decision === "approved" ? null : reason };
  });
}

export const EnterInput = ClaimInput.extend({ user_id: z.uuid() });

/**
 * The owner enters a claim on someone's behalf (Staff → person): approved at once, any date from the person's first
 * salary month up to today. No "new claim" notification (it is the owner's own entry).
 */
export async function enterClaim(user: AtUser, input: z.infer<typeof EnterInput>) {
  requireAccess(user, "claim_decide");
  const person = await knownPerson(user, input.user_id);
  return withTenant(user.tenantId, async (tx) => {
    await lockPerson(tx, user.tenantId, person.userId);
    const today = istDay(await dbNow(tx));
    const first = firstSalaryMonth(await settingsOf(tx, user.tenantId, person.userId));
    if (!first) throw badRequest(`Set a salary for ${person.name} first`);
    const { claim } = await insertClaim(tx, user, { userId: person.userId, name: person.name }, input, { earliest: `${first}-01`, today });
    return { id: claim.id };
  });
}

export type { ClaimKind };

