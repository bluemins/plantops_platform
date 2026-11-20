import { bulkChange, BulkInput } from "@/server/customer-bulk";
import { handle, json, readJson } from "@/server/http";
import { requireApiUser } from "@/server/session";

/** Owner only: one change (brands / place / payment terms / Drop) for many customers at once. */
export const POST = handle(async (req) => {
  const user = await requireApiUser();
  return json(await bulkChange(user, await readJson(req, BulkInput)));
});
