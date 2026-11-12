// Advances from Sales' cash book (docs/CASHBOOK_PHASE_PLAN.md section 9, C4; owner 2026-11-12). Sales sends each advance
// given from the cash box, each advance brought back ("Took back") and each cancelled cash-book advance here, with a key
// `atc_...` per plant in ATTEND_CASHBOOK_KEYS (only its SHA-256 is stored; the plant comes from the key's entry, never
// from the request). The same rules as the owner's own advance form: an active employee with a salary set, not before
// the first salary month, not in the future. `source_ref` (the cash book's number) makes a second send of the same
// thing return the row already saved. Rules decided by the owner (2026-11-12):
// - cash advances are entered in the cash book only (Attendance's own form stays for bank / UPI advances);
// - cash brought back for an advance whose month is already paid is refused ("already taken from that salary");
// - a cancelled cash-book advance is corrected for what is left (after payment it flows to the next month, as usual).
import { createHash, timingSafeEqual } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { isEmployee } from "@plantops/types";
import { addDays, istDay, validDay } from "@/lib/days";
import { firstSalaryMonth, paiseText, toPaise } from "@/lib/salary";
import { schema, withTenant, type AtTx } from "./db";
import { badRequest, clientIp, conflict, HttpError, notFound, rateLimit, unauthorized } from "./http";
import { kit } from "./kit";
import { dbNow, lockPerson } from "./marks";
import { isMonthPaid } from "./salary-pay";

const { salarySettings, salaryAdvances, auditLog } = schema;

/** ₹1 crore, the largest advance (the database checks it too). */
const MAX_PAISE = 1_000_000_000;

// ---------- keys ----------
const KeyEntry = z.object({ id: z.uuid(), tenant_id: z.uuid(), sha256: z.string().regex(/^[0-9a-f]{64}$/), label: z.string().min(1).max(80) }).strict();
export type CashbookKey = z.infer<typeof KeyEntry>;

/** "atc_" + 32 random bytes in base64url (43 characters). */
export const CASHBOOK_KEY_RE = /^atc_[A-Za-z0-9_-]{43}$/;
export const hashCashbookKey = (key: string) => createHash("sha256").update(key).digest("hex");

let parsedFrom: string | null = null;
let parsed: CashbookKey[] = [];
let parseProblem: string | null = null;
/** The configured keys. A broken ATTEND_CASHBOOK_KEYS switches the address off (logged, and shown by /health). */
export function cashbookKeys(): CashbookKey[] {
  const raw = process.env.ATTEND_CASHBOOK_KEYS ?? "";
  if (raw === parsedFrom) return parsed;
  parsedFrom = raw;
  parsed = [];
  parseProblem = null;
  if (!raw.trim()) return parsed;
  try {
    const keys = z.array(KeyEntry).parse(JSON.parse(raw));
    if (new Set(keys.map((k) => k.id)).size !== keys.length) throw new Error("two entries share an id");
    parsed = keys;
  } catch (err) {
    parseProblem = "ATTEND_CASHBOOK_KEYS is not valid, so cash book advances are off";
    console.error(`[attendance] ${parseProblem}:`, (err as Error).message);
  }
  return parsed;
}

/** What is wrong with ATTEND_CASHBOOK_KEYS (for /health); null = fine or not set. */
export function cashbookKeysProblem(): string | null {
  cashbookKeys();
  return parseProblem;
}

/** Which key sent this. Unknown / missing key = 401; more than 10 failures a minute from one address = 429. */
export function authenticateCashbook(req: Request): CashbookKey {
  const m = /^Bearer (\S+)$/.exec(req.headers.get("authorization") ?? "");
  const given = m && CASHBOOK_KEY_RE.test(m[1]!) ? Buffer.from(hashCashbookKey(m[1]!), "hex") : null;
  const key = given ? cashbookKeys().find((k) => timingSafeEqual(Buffer.from(k.sha256, "hex"), given)) : undefined;
  if (key) return key;
  console.warn("[attendance] cash book address: refused an unknown or missing key");
  rateLimit(`cashbook-auth:${clientIp(req)}`, 10, 60_000);
  throw unauthorized("Unknown or missing cash book key");
}

// ---------- the request ----------
const Ref = z.string().trim().min(1).max(40);
const Rupees = z.string().trim().regex(/^\d{1,8}(\.\d{1,2})?$/, "amount in rupees");
const Common = { source_ref: Ref, user_id: z.uuid(), by_id: z.uuid(), by_name: z.string().trim().min(1).max(100) };
export const CashbookInput = z.discriminatedUnion("action", [
  z.object({ action: z.literal("advance"), ...Common, on_date: z.string().refine(validDay, "Not a date"), amount: Rupees, note: z.string().trim().max(150).optional() }).strict(),
  /** cash brought back for an earlier cash-book advance (`of_ref`); `check: true` = only say whether it would be accepted */
  z.object({ action: z.literal("return"), ...Common, of_ref: Ref, amount: Rupees, check: z.boolean().optional() }).strict(),
  /** a cash-book advance cancelled in Sales: corrected for whatever is left of it */
  z.object({ action: z.literal("cancel"), ...Common, of_ref: Ref, reason: z.string().trim().min(3).max(200) }).strict(),
]);
export type CashbookInput = z.infer<typeof CashbookInput>;

export interface CashbookResult {
  /** the advance / correction row (null: a cancel with nothing left to correct, or a check) */
  id: string | null;
  /** true when this source_ref was already saved (a second send) */
  already: boolean;
}

const MONTH = (ym: string) => new Date(`${ym}-01T00:00:00Z`).toLocaleDateString("en-IN", { month: "short", year: "numeric", timeZone: "UTC" });

async function leftOf(tx: AtTx, tenantId: string, advanceId: string, amountPaise: number) {
  const rows = await tx.select({ amount: salaryAdvances.amountPaise }).from(salaryAdvances).where(and(eq(salaryAdvances.tenantId, tenantId), eq(salaryAdvances.correctsId, advanceId)));
  return amountPaise + rows.reduce((s, r) => s + r.amount, 0);
}

async function auditRow(tx: AtTx, tenantId: string, input: CashbookInput, action: "salary.advance" | "salary.correction", target: string, details: Record<string, unknown>) {
  await tx.insert(auditLog).values({ tenantId, actor: `cashbook:${input.by_id}`, action, target, details: { by: `${input.by_name} (cash book)`, ...details } });
}

/** Saves one advance / correction for the key's plant. Refusals are 4xx with a plain message Sales shows as it is. */
export async function receiveCashbook(key: CashbookKey, input: CashbookInput, now = new Date()): Promise<CashbookResult> {
  const t = key.tenant_id;
  rateLimit(`cashbook-key:${key.id}`, 60, 60_000);
  const amount = input.action === "cancel" ? null : toPaise(input.amount);
  if (amount !== null && (amount <= 0 || amount > MAX_PAISE)) throw badRequest(`The amount must be more than ₹0 and at most ${paiseText(MAX_PAISE)}`);

  // the person: an active employee of this plant (Plant staff), from the platform
  const contacts = await kit.contacts(t);
  if (contacts === null) throw new HttpError(503, "PlantOps can't be reached right now; try again in a minute");
  const person = contacts.find((c) => c.user_id === input.user_id && isEmployee(c.roles));

  return withTenant(t, async (tx) => {
    await lockPerson(tx, t, input.user_id);
    const [done] = await tx.select({ id: salaryAdvances.id, userId: salaryAdvances.userId }).from(salaryAdvances).where(and(eq(salaryAdvances.tenantId, t), eq(salaryAdvances.sourceRef, input.source_ref)));
    if (done) {
      if (done.userId !== input.user_id) throw conflict(`${input.source_ref} is already saved for someone else`);
      return { id: done.id, already: true };
    }
    const today = istDay(await dbNow(tx));

    if (input.action === "advance") {
      if (!person) throw badRequest("This person isn't one of the plant's employees (Plant staff) in Attendance");
      const name = person.display_name.slice(0, 100);
      const settings = (await tx.select().from(salarySettings).where(and(eq(salarySettings.tenantId, t), eq(salarySettings.userId, person.user_id)))).map((s) => ({ ...s, fromMonth: s.fromMonth.slice(0, 7) }));
      if (!settings.length) throw badRequest(`Set ${name}'s salary in Attendance first, then send it again`);
      const firstDay = `${firstSalaryMonth(settings)}-01`;
      if (input.on_date > today) throw badRequest("The date is in the future");
      if (input.on_date < firstDay) throw badRequest(`The date is before ${name}'s first salary month in Attendance (${MONTH(firstDay.slice(0, 7))})`);
      if (input.on_date < addDays(today, -62)) throw badRequest("The date is more than 2 months back");
      const note = [`Cash book ${input.source_ref}`, input.note].filter(Boolean).join(": ").slice(0, 200);
      const [row] = await tx
        .insert(salaryAdvances)
        .values({ tenantId: t, userId: person.user_id, userName: name, onDate: input.on_date, amountPaise: amount!, note, sourceRef: input.source_ref, createdBy: input.by_id, createdByName: `${input.by_name.slice(0, 85)} (cash book)` })
        .returning({ id: salaryAdvances.id });
      await auditRow(tx, t, input, "salary.advance", row!.id, { person: name, on: input.on_date, amount: amount!, note });
      return { id: row!.id, already: false };
    }

    // a return or a cancel: the cash-book advance it is about
    const [original] = await tx.select().from(salaryAdvances).where(and(eq(salaryAdvances.tenantId, t), eq(salaryAdvances.sourceRef, input.of_ref)));
    if (!original || original.userId !== input.user_id || original.amountPaise < 0) throw notFound(`${input.of_ref} isn't in Attendance`);
    const left = await leftOf(tx, t, original.id, original.amountPaise);
    const name = original.userName;

    if (input.action === "return") {
      if (await isMonthPaid(tx, t, original.userId, original.onDate.slice(0, 7)))
        throw conflict(`${input.of_ref} was already taken from ${name}'s ${MONTH(original.onDate.slice(0, 7))} salary (paid). Nothing to bring back.`);
      if (amount! > left) throw badRequest(left > 0 ? `Only ${paiseText(left)} of ${input.of_ref} is left to bring back` : `Nothing is left of ${input.of_ref}`);
      if (input.check) return { id: null, already: false };
      const reason = `Cash returned (${input.source_ref})`;
      const [row] = await tx
        .insert(salaryAdvances)
        .values({ tenantId: t, userId: original.userId, userName: name, onDate: original.onDate, amountPaise: -amount!, correctsId: original.id, reason, sourceRef: input.source_ref, createdBy: input.by_id, createdByName: `${input.by_name.slice(0, 85)} (cash book)` })
        .returning({ id: salaryAdvances.id });
      await auditRow(tx, t, input, "salary.correction", row!.id, { person: name, on: original.onDate, amount: -amount!, reason });
      return { id: row!.id, already: false };
    }

    // cancel: correct whatever is left (nothing left = nothing to do)
    if (left <= 0) return { id: null, already: false };
    const reason = `Cancelled in the cash book (${input.of_ref}): ${input.reason}`.slice(0, 300);
    const [row] = await tx
      .insert(salaryAdvances)
      .values({ tenantId: t, userId: original.userId, userName: name, onDate: original.onDate, amountPaise: -left, correctsId: original.id, reason, sourceRef: input.source_ref, createdBy: input.by_id, createdByName: `${input.by_name.slice(0, 85)} (cash book)` })
      .returning({ id: salaryAdvances.id });
    await auditRow(tx, t, input, "salary.correction", row!.id, { person: name, on: original.onDate, amount: -left, reason });
    return { id: row!.id, already: false };
  });
}
