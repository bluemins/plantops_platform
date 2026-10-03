import { requireUser } from "@/server/auth";
import { handle, json } from "@/server/http";
import { buildLauncher } from "@/server/launcher";

/** The tile screen for the logged-in plant user. Until they set their own PIN/password, only that flag. */
export const GET = handle(async (req) => {
  const user = await requireUser(req, { allowMustChange: true });
  if (user.mustChangeSecret) return json({ must_change_secret: true });
  return json({ must_change_secret: false, ...(await buildLauncher(user)) });
});
