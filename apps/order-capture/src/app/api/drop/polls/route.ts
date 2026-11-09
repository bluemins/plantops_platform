import { createPoll, PollInput, pollsPage } from "@/server/drop/polls";
import { handle, json, readJson } from "@/server/http";
import { requireApiUser } from "@/server/session";

/** Drop polls (owner; support reads). */
export const GET = handle(async () => json(await pollsPage(await requireApiUser())));

/** Owner: publish a poll (never edited after; a new poll corrects it). */
export const POST = handle(async (req) => {
  const user = await requireApiUser();
  return json(await createPoll(user, await readJson(req, PollInput)));
});
