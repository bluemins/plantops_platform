import { after } from "next/server";
import { handle, json, readJson, uuidParam } from "@/server/http";
import { kit } from "@/server/kit";
import { CancelPurchaseInput, cancelPurchaseBill, purchaseCancelNotification } from "@/server/purchase-entry";
import { requireApiUser } from "@/server/session";

type Ctx = { params: Promise<{ id: string }> };

/** Owner: cancel a purchase bill with a reason (what was paid on it goes back as advance). */
export const POST = handle(async (req, ctx: Ctx) => {
  const user = await requireApiUser();
  const done = await cancelPurchaseBill(user, uuidParam((await ctx.params).id), await readJson(req, CancelPurchaseInput));
  after(() => kit.notify(user.tenantId, purchaseCancelNotification(user, "bill", done)));
  return json({ ok: true });
});
