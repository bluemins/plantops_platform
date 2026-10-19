// Office staff's "Mark for someone" (docs/ATTENDANCE_ROLES_PHASE_PLAN.md "Office staff", mock-up 1): IN / OUT now for
// a person without a smartphone, from the office phone. No QR: Office staff is a trusted role, and the office phone's
// location still proves the desk is at the plant. The server decides the time and IN / OUT exactly as for a scan; the
// mark counts like a scan (never "changed"). Never for yourself: everyone scans the QR for their own attendance.
// A Supervisor uses the same screen for the Office staff only (owner, 2026-10-19).
import { z } from "zod";
import { distanceM, fmtDistance } from "@/lib/geo";
import { fmtTime, isDoubleTap, MAX_ACCURACY_M, nextKind, type Kind } from "@/lib/punch";
import { requireAccess } from "./access";
import { audit } from "./audit";
import { schema, withTenant } from "./db";
import { forbidden } from "./http";
import { dbNow, lastValidMark, lockPerson, MarkRefused } from "./marks";
import { knownPerson, reachableEmployees } from "./people";
import { readSettings } from "./settings";
import type { AtUser } from "./session";

const { punches } = schema;

export const SELF_MESSAGE = "Scan the QR for your own attendance";

export interface DeskPerson {
  userId: string;
  name: string;
  next: Kind;
  /** "IN since 08:05 · by Ramesh", "OUT at 14:10", "Not in today" */
  state: string;
  self: boolean;
}

/** The people Office staff may mark (every active employee; a Supervisor: the Office staff), with their state now; yourself greyed out. */
export async function deskList(user: AtUser): Promise<{ people: DeskPerson[]; locationSet: boolean; platformDown: boolean }> {
  requireAccess(user, "mark_for");
  const staff = await reachableEmployees(user);
  return withTenant(user.tenantId, async (tx) => {
    const settings = await readSettings(tx, user.tenantId);
    const now = await dbNow(tx);
    const people: DeskPerson[] = [];
    for (const p of staff.active) {
      const row = await lastValidMark(tx, user.tenantId, p.userId);
      const next = nextKind(row, now);
      const by = row && row.source !== "scan" ? ` · by ${row.byName}` : "";
      const state = next === "out" ? `IN since ${fmtTime(row!.at)}${by}` : row && row.kind === "out" && sameIstDay(row.at, now) ? `OUT at ${fmtTime(row.at)}` : "Not in today";
      people.push({ userId: p.userId, name: p.name, next, state, self: p.userId === user.userId });
    }
    return { people, locationSet: settings?.lat != null, platformDown: staff.platformDown };
  });
}

const sameIstDay = (a: Date, b: Date) => fmtIstDay(a) === fmtIstDay(b);
const fmtIstDay = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(d);

export const DeskInput = z.object({
  user_id: z.uuid(),
  expect: z.enum(["in", "out"]),
  location: z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180), accuracy: z.number().min(0).max(1_000_000) }).nullable(),
}); // the time, the plant and the distance are the server's, never the browser's

/** Office staff (a Supervisor: for Office staff only) mark IN / OUT now for an active employee (not themselves), at the plant. */
export async function deskMark(user: AtUser, input: z.infer<typeof DeskInput>) {
  requireAccess(user, "mark_for");
  if (input.user_id === user.userId) throw forbidden(SELF_MESSAGE);
  const person = await knownPerson(user, input.user_id, { activeOnly: true });
  return withTenant(user.tenantId, async (tx) => {
    await lockPerson(tx, user.tenantId, person.userId);
    const settings = await readSettings(tx, user.tenantId);
    if (settings?.lat == null || settings.lng == null) throw new MarkRefused(400, "The owner hasn't set the plant location yet.", "no_location_set");
    if (!input.location) throw new MarkRefused(400, "Allow location on this phone to mark for someone.", "no_location");
    if (input.location.accuracy > MAX_ACCURACY_M) {
      throw new MarkRefused(400, `Location too rough (±${fmtDistance(input.location.accuracy)}). Step outside and try again.`, "too_rough");
    }
    const [last, now] = await Promise.all([lastValidMark(tx, user.tenantId, person.userId), dbNow(tx)]);
    const kind = nextKind(last, now);
    const state = () => ({ next: kind, state: kind === "out" ? `IN since ${fmtTime(last!.at)}` : "Not in" });
    if (isDoubleTap(last, now)) throw new MarkRefused(409, `${person.name} was already marked at ${fmtTime(last!.at)}.`, "double", state());
    if (kind !== input.expect) {
      throw new MarkRefused(409, kind === "out" ? `${person.name} is already IN since ${fmtTime(last!.at)}.` : `${person.name} is already OUT.`, "changed", state());
    }
    const distance = distanceM({ lat: Number(settings.lat), lng: Number(settings.lng) }, input.location);
    if (distance > settings.radiusM) {
      throw new MarkRefused(403, `This phone is ${fmtDistance(distance)} from the plant. Mark at the plant.`, "outside", { distance_m: Math.round(distance) });
    }
    const [row] = await tx
      .insert(punches)
      .values({
        tenantId: user.tenantId,
        userId: person.userId,
        userName: person.name.slice(0, 100),
        kind,
        at: now,
        source: "desk",
        distanceM: Math.round(distance),
        accuracyM: Math.round(input.location.accuracy),
        createdBy: user.userId,
        createdByName: user.name.slice(0, 100),
      })
      .returning({ id: punches.id, kind: punches.kind, at: punches.at });
    await audit(tx, user, "mark.desk", row!.id, { person: person.name, kind, at: now.toISOString() });
    return { id: row!.id, kind: row!.kind, at: row!.at.toISOString(), person };
  });
}
