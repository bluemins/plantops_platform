import { handle, json, readJson } from "@/server/http";
import { RatesInput, saveRates } from "@/server/rates";
import { requireApiUser } from "@/server/session";

/** Save units and default rates (owner only; checked in saveRates). */
export const PUT = handle(async (req) => {
  const user = await requireApiUser();
  return json(await saveRates(user, await readJson(req, RatesInput)));
});
