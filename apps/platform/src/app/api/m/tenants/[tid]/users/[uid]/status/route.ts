import { handle, json, uuidParam } from "@/server/http";
import { authenticateModule, getUserStatus } from "@/server/sso";

type Ctx = { params: Promise<{ tid: string; uid: string }> };

/** Server-to-server: modules re-check a user's current status and roles every few minutes. */
export const GET = handle(async (req, ctx: Ctx) => {
  await authenticateModule(req);
  const { tid, uid } = await ctx.params;
  return json(await getUserStatus(uuidParam(tid), uuidParam(uid)));
});
