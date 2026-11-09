import { closePoll } from "@/server/drop/polls";
import { handle, json, uuidParam } from "@/server/http";
import { requireApiUser } from "@/server/session";

type Ctx = { params: Promise<{ id: string }> };

/** Owner: close a poll now. */
export const POST = handle(async (_req, ctx: Ctx) => json(await closePoll(await requireApiUser(), uuidParam((await ctx.params).id))));
