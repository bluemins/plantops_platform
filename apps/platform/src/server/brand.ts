import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import { brandStyle } from "@plantops/ui";
import { getCurrentUser, SESSION_COOKIE } from "./auth";
import { schema, withTenant } from "./db";

/** The plant's brand colour, or null if it hasn't set one. */
export function plantBrandColor(tenantId: string) {
  return withTenant(tenantId, async (tx) => {
    const [row] = await tx
      .select({ color: schema.tenantProfiles.brandColor })
      .from(schema.tenantProfiles)
      .where(eq(schema.tenantProfiles.tenantId, tenantId));
    return row?.color ?? null;
  });
}

/**
 * CSS variables for the current request: the logged-in plant user's brand colour, otherwise PlantOps blue.
 * Never breaks a page - any problem just means the default colours.
 */
export async function brandStyleForRequest(): Promise<Record<string, string> | undefined> {
  try {
    const value = (await cookies()).get(SESSION_COOKIE)?.value;
    if (!value) return undefined;
    const req = new Request("http://localhost/", { headers: { cookie: `${SESSION_COOKIE}=${encodeURIComponent(value)}` } });
    const user = await getCurrentUser(req);
    if (!user) return undefined;
    const color = await plantBrandColor(user.tenantId);
    return color ? brandStyle(color) : undefined;
  } catch {
    return undefined;
  }
}
