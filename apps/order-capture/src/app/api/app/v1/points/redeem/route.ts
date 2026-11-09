import { after } from "next/server";
import { dropBody, dropJson, dropLimit, dropRoute } from "@/server/drop/api";
import { redeem, redeemNotification, RedeemInput } from "@/server/drop/points";
import { appSession } from "@/server/drop/session";
import { clientIp } from "@/server/http";
import { kit } from "@/server/kit";

/** Drop: ask for a free box with points. The owners (and ticked Order desk) hear about it after the answer. */
export const POST = dropRoute(async (req) => {
  dropLimit(`drop-redeem-ip:${clientIp(req)}`, 30, 60_000);
  const s = await appSession(req);
  dropLimit(`drop-redeem:${s.sessionId}`, 10, 60_000);
  const out = await redeem(s, await dropBody(req, RedeemInput));
  if (out.created) after(() => kit.notify(s.app.tenantId, redeemNotification(s.name, out.label, out.points, out.id)));
  return dropJson({ ...out.view, asked: { label: out.label, points: out.points } }, out.created ? 201 : 200);
});
