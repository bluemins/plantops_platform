import { dropBody, DropError, dropJson, dropLimit, dropRoute } from "@/server/drop/api";
import { AnswerInput, answerPoll } from "@/server/drop/polls";
import { appSession } from "@/server/drop/session";
import { clientIp } from "@/server/http";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Drop: answer a poll once; the answer says how many points it earned and why. */
export const POST = dropRoute(async (req) => {
  dropLimit(`drop-answer-ip:${clientIp(req)}`, 60, 60_000);
  const s = await appSession(req);
  dropLimit(`drop-answer:${s.sessionId}`, 10, 60_000);
  const id = new URL(req.url).pathname.split("/").at(-2) ?? "";
  if (!UUID.test(id)) throw new DropError(404, "not_offered", "This poll was not found");
  return dropJson(await answerPoll(s, id, await dropBody(req, AnswerInput)), 201);
});
