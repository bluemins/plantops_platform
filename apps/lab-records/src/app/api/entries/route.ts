import { createEntry, EntryInput } from "@/server/entries";
import { handle, json, readJson } from "@/server/http";
import { requireApiUser } from "@/server/session";

/** Saves a daily test or a Form 1-4 record: version 1, locked at once (lab technician / lab lead). */
export const POST = handle(async (req) => {
  const user = await requireApiUser();
  return json(await createEntry(user, await readJson(req, EntryInput)), { status: 201 });
});
