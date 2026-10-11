import { after } from "next/server";
import { ItemPatch, updateItem } from "@/server/setup";
import { handle, json, readJson, uuidParam } from "@/server/http";
import { kit } from "@/server/kit";
import { setupNotification } from "@/server/notify";
import { requireApiUser } from "@/server/session";

type Ctx = { params: Promise<{ id: string }> };

/** Edit an item, move it, set its limit or switch it off / on. Owner-only parts are checked in updateItem. */
export const PATCH = handle(async (req, ctx: Ctx) => {
  const user = await requireApiUser();
  const r = await updateItem(user, uuidParam((await ctx.params).id), await readJson(req, ItemPatch));
  const note = r.changed ? setupNotification(user, { action: "update", name: r.name, before: r.before, fields: r.fields, status: r.status }) : null;
  if (note) after(() => kit.notify(user.tenantId, note));
  return json(r);
});
