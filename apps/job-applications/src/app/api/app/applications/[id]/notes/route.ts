import { addNote, NoteInput } from "@/server/applications";
import { handle, json, readJson } from "@/server/http";
import { requireApiUser } from "@/server/session";

type Ctx = { params: Promise<{ id: string }> };

/** Add a note (owner, HR desk). Notes are never changed or deleted. */
export const POST = handle(async (req, ctx: Ctx) => {
  const user = await requireApiUser();
  return json(await addNote(user, (await ctx.params).id, (await readJson(req, NoteInput)).text), { status: 201 });
});
