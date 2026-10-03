import { requireUser } from "@/server/auth";
import { handle, json } from "@/server/http";
import { accessibleModules } from "@/server/sso";

export const GET = handle(async (req) => {
  const u = await requireUser(req, { allowMustChange: true });
  return json({
    tenant_id: u.tenantId,
    user_id: u.userId,
    username: u.username,
    display_name: u.displayName,
    roles: u.roles,
    secret_kind: u.secretKind,
    must_change_secret: u.mustChangeSecret,
    modules: u.mustChangeSecret ? [] : await accessibleModules(u),
  });
});
