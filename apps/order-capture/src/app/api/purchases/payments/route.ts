import { after } from "next/server";
import { handle, json, readJson } from "@/server/http";
import { kit } from "@/server/kit";
import { payVendor, PayVendorInput, vendorPaymentNotification } from "@/server/purchase-entry";
import { requireApiUser } from "@/server/session";

/** Owner, Accounts: pay a vendor (oldest open bills first, or the ticked ones; the rest is an advance). */
export const POST = handle(async (req) => {
  const user = await requireApiUser();
  const done = await payVendor(user, await readJson(req, PayVendorInput));
  after(() => kit.notify(user.tenantId, vendorPaymentNotification(user, done)));
  return json(done);
});
