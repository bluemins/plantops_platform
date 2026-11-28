import { z } from "zod";
import { handle, json, readJson } from "@/server/http";
import { markAction } from "@/server/morning-report";
import { requireApiUser } from "@/server/session";

const MarkInput = z.object({ date: z.string().max(10), action_no: z.number().int().min(1).max(7), mark: z.enum(["useful", "not_useful"]) });

/** Owner: Useful / Not useful on one action of a morning report (P5-d). The latest tap counts. */
export const POST = handle(async (req) => {
  const user = await requireApiUser();
  return json(await markAction(user, await readJson(req, MarkInput)), { status: 201 });
});
