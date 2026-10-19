import { after } from "next/server";
import { sendPending } from "@/server/alerts";
import { CountInput, submitCount } from "@/server/counts";
import { handle, json, readJson } from "@/server/http";
import { kit } from "@/server/kit";
import { countNotification, viewerCountNotifications } from "@/server/notify";
import { requireApiUser } from "@/server/session";

/** Save today's (or yesterday's) count, or a correction of it (owner or store keeper). Locked once saved. */
export const POST = handle(async (req) => {
  const user = await requireApiUser();
  const saved = await submitCount(user, await readJson(req, CountInput));
  // emails and the owner's notification go out after the answer, so a slow service never holds up the store keeper
  if (saved.low_stock_emails > 0) after(() => sendPending(user.tenantId).catch((err) => console.error("[floor-stock] low-stock email:", (err as Error).message)));
  after(async () => {
    await kit.notify(user.tenantId, countNotification(user, saved));
    // each ticked Stock viewer: their own version, only their sections (kit.notify never throws; the lookup might)
    const forViewers = await viewerCountNotifications(user, saved).catch((err) => (console.error("[floor-stock] viewer alerts:", (err as Error).message), []));
    for (const n of forViewers) await kit.notify(user.tenantId, n);
  });
  return json(saved, { status: 201 });
});
