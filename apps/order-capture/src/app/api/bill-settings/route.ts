import { BillSettingsInput, setBillSettings } from "@/server/bill-make";
import { handle, json, readJson } from "@/server/http";
import { requireApiUser } from "@/server/session";

/** Owner: the usual "rates include GST", terms and customer notes for new bills. */
export const PUT = handle(async (req) => {
  const user = await requireApiUser();
  return json(await setBillSettings(user, await readJson(req, BillSettingsInput)));
});
