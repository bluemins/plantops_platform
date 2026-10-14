import { after } from "next/server";
import { addNote, NoteInput } from "@/server/handling";
import { handle, json, readJson, uuidParam } from "@/server/http";
import { kit } from "@/server/kit";
import { noteNotification } from "@/server/notify";
import { requireApiUser } from "@/server/session";

type Ctx = { params: Promise<{ id: string }> };

/** Add a note to a saved order, any status (owner and Order desk). Never changed or removed afterwards. */
export const POST = handle(async (req, ctx: Ctx) => {
  const user = await requireApiUser();
  const { event } = await addNote(user, uuidParam((await ctx.params).id), await readJson(req, NoteInput));
  after(() => kit.notify(user.tenantId, noteNotification(user, event)));
  return json({ ok: true });
});
