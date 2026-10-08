import { after } from "next/server";
import { sendPending } from "@/server/alerts";
import { CountInput, submitCount } from "@/server/counts";
import { handle, json, readJson } from "@/server/http";
import { requireApiUser } from "@/server/session";

/** Save today's (or yesterday's) count, or a correction of it (owner or store keeper). Locked once saved. */
export const POST = handle(async (req) => {
  const user = await requireApiUser();
  const saved = await submitCount(user, await readJson(req, CountInput));
  // low-stock emails go out after the answer, so a slow mail server never holds up the store keeper
  if (saved.low_stock_emails > 0) after(() => sendPending(user.tenantId).catch((err) => console.error("[floor-stock] low-stock email:", (err as Error).message)));
  return json(saved, { status: 201 });
});
