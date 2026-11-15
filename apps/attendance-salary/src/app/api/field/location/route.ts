import { z } from "zod";
import { sendShopLocation } from "@/server/field";
import { handle, json, readJson } from "@/server/http";
import { requireApiUser } from "@/server/session";

/** "Try again": sends a visit's location to Sales as the shop's location (once per visit, never twice). */
export const POST = handle(async (req) => {
  const user = await requireApiUser();
  const { visit_id } = await readJson(req, z.object({ visit_id: z.uuid() }));
  return json(await sendShopLocation(user, visit_id));
});
