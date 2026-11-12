import { authenticateCashbook, CashbookInput, receiveCashbook } from "@/server/cashbook";
import { handle, json, readJson } from "@/server/http";

/**
 * Sales' cash book (server to server, key atc_... in ATTEND_CASHBOOK_KEYS; outside the login proxy): an advance given
 * from the cash box, cash brought back for one, or a cancelled one. The plant comes from the key, never the body.
 */
export const POST = handle(async (req) => {
  const key = authenticateCashbook(req);
  const result = await receiveCashbook(key, await readJson(req, CashbookInput));
  return json(result, { status: result.already ? 200 : 201 });
});
