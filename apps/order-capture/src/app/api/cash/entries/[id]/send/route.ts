import { sendAgain } from "@/server/attendance-link";
import { handle, json, uuidParam } from "@/server/http";
import { requireApiUser } from "@/server/session";

type Ctx = { params: Promise<{ id: string }> };

/** Owner, Accounts: send an advance (or cash brought back for one) to Attendance again, after fixing what it refused. */
export const POST = handle(async (_req, ctx: Ctx) => {
  const user = await requireApiUser();
  return json(await sendAgain(user, uuidParam((await ctx.params).id)));
});
