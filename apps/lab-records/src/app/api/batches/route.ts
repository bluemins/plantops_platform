import { createBatch, CreateBatchInput } from "@/server/batches";
import { handle, json, readJson } from "@/server/http";
import { requireApiUser } from "@/server/session";

/** New batch (lab technician / lab lead). */
export const POST = handle(async (req) => {
  const user = await requireApiUser();
  return json(await createBatch(user, await readJson(req, CreateBatchInput)), { status: 201 });
});
