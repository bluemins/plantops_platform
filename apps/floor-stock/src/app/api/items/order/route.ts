import { after } from "next/server";
import { ItemOrder, reorderItems } from "@/server/setup";
import { handle, json, readJson } from "@/server/http";
import { kit } from "@/server/kit";
import { setupNotification } from "@/server/notify";
import { requireApiUser } from "@/server/session";

/** New order of the items in one section (owner or store keeper). */
export const POST = handle(async (req) => {
  const user = await requireApiUser();
  const r = await reorderItems(user, await readJson(req, ItemOrder));
  const note = setupNotification(user, { action: "reorder", section: r.section });
  if (note) after(() => kit.notify(user.tenantId, note));
  return json(r);
});
