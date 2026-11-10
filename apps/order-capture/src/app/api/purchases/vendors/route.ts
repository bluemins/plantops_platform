import { handle, json, readJson } from "@/server/http";
import { addVendor, VendorInput } from "@/server/purchase-entry";
import { requireApiUser } from "@/server/session";

/** Owner, Accounts: add a vendor. */
export const POST = handle(async (req) => {
  const user = await requireApiUser();
  return json(await addVendor(user, await readJson(req, VendorInput)));
});
