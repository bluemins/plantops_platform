import { after } from "next/server";
import { createPoll, PollInput, pollsPage } from "@/server/drop/polls";
import { queuePolls, sendWaiting } from "@/server/drop/push";
import { handle, json, readJson } from "@/server/http";
import { requireApiUser } from "@/server/session";

/** Drop polls (owner; support reads). */
export const GET = handle(async () => json(await pollsPage(await requireApiUser())));

/** Owner: publish a poll (never edited after; a new poll corrects it). */
export const POST = handle(async (req) => {
  const user = await requireApiUser();
  const poll = await createPoll(user, await readJson(req, PollInput));
  // a poll open now reaches the shops' phones at once; one opening later goes with the push job
  after(async () => {
    if ((await queuePolls(user.tenantId).catch(() => 0)) > 0) await sendWaiting(user.tenantId);
  });
  return json(poll);
});
