import { handle, json } from "@/server/http";
import { publicJwks } from "@/server/sso";

/** Public keys modules use to verify SSO tokens. Safe to publish. */
export const GET = handle(async () => json(publicJwks(), { headers: { "cache-control": "public, max-age=300" } }));
