import { handle, json, uuidParam } from "@/server/http";
import { unreadCount } from "@/server/notifications";
import { authenticateModule } from "@/server/sso";

type Ctx = { params: Promise<{ tid: string; uid: string }> };

/** Server-to-server: how many unread notifications this person has, for the bell in a module's header. */
export const GET = handle(async (req, ctx: Ctx) => {
  await authenticateModule(req);
  const { tid, uid } = await ctx.params;
  return json({ unread: await unreadCount(uuidParam(tid), uuidParam(uid)) });
});
