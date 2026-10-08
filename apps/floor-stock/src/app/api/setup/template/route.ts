import { applyTemplate } from "@/server/setup";
import { handle, json } from "@/server/http";
import { requireApiUser } from "@/server/session";

/** First start: create the generic starter sections and items (owner only, only while the plant has none). */
export const POST = handle(async () => {
  const user = await requireApiUser();
  return json(await applyTemplate(user), { status: 201 });
});
