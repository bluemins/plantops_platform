import { after } from "next/server";
import { createItem, ItemInput } from "@/server/setup";
import { handle, json, readJson } from "@/server/http";
import { kit } from "@/server/kit";
import { setupNotification } from "@/server/notify";
import { requireApiUser } from "@/server/session";

/** Add an item to a section (owner or store keeper; only the owner may give it a limit). */
export const POST = handle(async (req) => {
  const user = await requireApiUser();
  const created = await createItem(user, await readJson(req, ItemInput));
  const note = setupNotification(user, { action: "add", name: created.name, section: created.section });
  if (note) after(() => kit.notify(user.tenantId, note));
  return json(created, { status: 201 });
});
