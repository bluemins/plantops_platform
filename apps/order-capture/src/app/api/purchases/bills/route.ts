import { after } from "next/server";
import { handle, json, readJson } from "@/server/http";
import { kit } from "@/server/kit";
import { PurchaseBillInput, purchaseBillNotification, recordPurchaseBill } from "@/server/purchase-entry";
import { requireApiUser } from "@/server/session";

/** Owner, Accounts: record a vendor's bill (optionally paid now). Owners get a bell after the answer. */
export const POST = handle(async (req) => {
  const user = await requireApiUser();
  const done = await recordPurchaseBill(user, await readJson(req, PurchaseBillInput));
  after(() => kit.notify(user.tenantId, purchaseBillNotification(user, done)));
  return json(done);
});
