import { handle, json, uuidParam } from "@/server/http";
import { authenticateModule, getAlertContacts } from "@/server/sso";

type Ctx = { params: Promise<{ tid: string }> };

/** Server-to-server: owners + the calling module's staff with their phone numbers, for alerts (WhatsApp). */
export const GET = handle(async (req, ctx: Ctx) => {
  const moduleId = await authenticateModule(req);
  return json(await getAlertContacts(moduleId, uuidParam((await ctx.params).tid)));
});
