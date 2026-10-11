import { NotificationInput } from "@plantops/types";
import { handle, json, later, readJson, uuidParam } from "@/server/http";
import { notifyOwners, sendPrepared } from "@/server/notifications";
import { authenticateModule } from "@/server/sso";

type Ctx = { params: Promise<{ tid: string }> };

/**
 * Server-to-server: a module reports an event; the platform picks the recipients (the plant's active owners in
 * N1, minus exclude_user_id). Phones are notified after the answer, so the module is never held up.
 */
export const POST = handle(async (req, ctx: Ctx) => {
  const moduleId = await authenticateModule(req);
  const tenantId = uuidParam((await ctx.params).tid);
  const input = await readJson(req, NotificationInput);
  const r = await notifyOwners(moduleId, tenantId, input);
  if (r.messages.size) later(() => sendPrepared(tenantId, r.messages));
  return json({ recipients: r.recipients, created: r.created }, { status: 201 });
});
