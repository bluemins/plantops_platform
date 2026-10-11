// The owner's Floor Stock settings (N4): when the "Today's stock count is not done yet" reminder goes out - a whole
// hour from 5 pm to 11 pm India time, or off. No row = 8 pm (the default since N1). Every change is audited and shows
// in Recent changes.
import { eq } from "drizzle-orm";
import { z } from "zod";
import { schema, withTenant, type StockTx } from "./db";
import { forbidden } from "./http";
import { actorOf, requireOwner, type StockUser } from "./session";

const { auditLog, plantSettings } = schema;

export const REMINDER_CHOICES = ["17:00", "18:00", "19:00", "20:00", "21:00", "22:00", "23:00", "off"] as const;
export type Reminder = (typeof REMINDER_CHOICES)[number];
export const DEFAULT_REMINDER: Reminder = "20:00";
export const SettingsInput = z.object({ count_reminder: z.enum(REMINDER_CHOICES) });

/** "8 pm" / "Off" for screens and the change log. */
export const reminderLabel = (r: string) => (r === "off" ? "Off" : `${Number(r.slice(0, 2)) - 12} pm`);

export async function reminderFor(tx: StockTx, tenantId: string): Promise<Reminder> {
  const [row] = await tx.select({ r: plantSettings.countReminder }).from(plantSettings).where(eq(plantSettings.tenantId, tenantId));
  return (row?.r as Reminder | undefined) ?? DEFAULT_REMINDER;
}

export async function getSettings(user: StockUser) {
  if (!user.canCount && !user.isSupport) throw forbidden();
  return withTenant(user.tenantId, async (tx) => ({ count_reminder: await reminderFor(tx, user.tenantId) }));
}

/** Owner only (like sections). */
export async function setSettings(user: StockUser, input: z.infer<typeof SettingsInput>) {
  requireOwner(user, "Only the plant owner can change the evening reminder");
  return withTenant(user.tenantId, async (tx) => {
    const before = await reminderFor(tx, user.tenantId);
    if (before === input.count_reminder) return { count_reminder: before };
    await tx
      .insert(plantSettings)
      .values({ tenantId: user.tenantId, countReminder: input.count_reminder, updatedBy: user.userId, updatedByName: user.name })
      .onConflictDoUpdate({ target: plantSettings.tenantId, set: { countReminder: input.count_reminder, updatedBy: user.userId, updatedByName: user.name, updatedAt: new Date() } });
    await tx.insert(auditLog).values({
      tenantId: user.tenantId,
      actor: actorOf(user),
      action: "setup.reminder",
      target: null,
      details: { by: user.name, from: reminderLabel(before), to: reminderLabel(input.count_reminder) },
    });
    return { count_reminder: input.count_reminder };
  });
}
