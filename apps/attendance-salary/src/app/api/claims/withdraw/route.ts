import { z } from "zod";
import { withdrawClaim } from "@/server/claims";
import { handle, json, readJson } from "@/server/http";
import { requireApiUser } from "@/server/session";

/** A worker withdraws their own claim while it is still waiting (409 once the owner decided). */
export const POST = handle(async (req) => {
  const user = await requireApiUser();
  const { claim_id } = await readJson(req, z.object({ claim_id: z.uuid() }));
  return json(await withdrawClaim(user, claim_id));
});
