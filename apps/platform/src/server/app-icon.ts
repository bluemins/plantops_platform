// The installed app ("Add to Home Screen") in each plant's own look (owner, 2026-10-13): the plant's name under the
// icon and its logo as the icon. Before login, and for super_admin, it stays PlantOps.
//   * Phones fetch the install details (manifest) and icons WITHOUT the login cookie, so those addresses can't need a
//     login. Each plant gets a signed link instead: /plant-app/<tenant id>.<logo version>.<signature>/…, signed with a
//     key derived from the platform's SSO private key (no new setting). Only someone who had a plant's page knows it,
//     and it shows only the plant's name, colour and logo, which that plant's screens show anyway.
//   * The logo version is in the link, so a new logo means a new link (no stale icon from a cache).
//   * The icon is the logo on a white square with a margin (Android crops "maskable" icons to a circle). WebP logos
//     can't be drawn by next/og, so a plant with a WebP logo keeps the PlantOps icon.
import { createHash, createHmac } from "node:crypto";
import { eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { getCurrentUser, SESSION_COOKIE } from "./auth";
import { safeEqual } from "./crypto";
import { schema, withTenant } from "./db";
import { env } from "./env";

const { tenants, tenantProfiles } = schema;

export const PLANTOPS_APP = { name: "PlantOps", color: "#1d4ed8" };
/** Icon sizes the platform serves: 180 = iPhone, 192 / 512 = Android, "512m" = Android's maskable (cropped) icon. */
export const ICON_SIZES = { "180": 180, "192": 192, "512": 512, "512m": 512 } as const;
export type IconSize = keyof typeof ICON_SIZES;

let key: Buffer | undefined;
function signingKey() {
  key ??= createHash("sha256").update("plantops app icon v1:").update(String(env.ssoPrivateJwk.d)).digest();
  return key;
}
const sign = (body: string) => createHmac("sha256", signingKey()).update(body).digest("base64url").slice(0, 32);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The signed link part for one plant and logo version (0 = no logo). */
export function appToken(tenantId: string, logoVersion: number) {
  const body = `${tenantId}.${logoVersion}`;
  return `${body}.${sign(body)}`;
}

/** The plant id from a link part, or null when it isn't one the platform signed. */
export function readAppToken(token: string): string | null {
  const [tenantId, version, sig, extra] = token.split(".");
  if (!tenantId || !version || !sig || extra !== undefined || !UUID.test(tenantId) || !/^\d{1,15}$/.test(version)) return null;
  return safeEqual(sig, sign(`${tenantId}.${version}`)) ? tenantId : null;
}

export interface PlantApp {
  name: string;
  color: string;
  /** null = no usable logo (none, or WebP): the PlantOps icon */
  logo: { data: Buffer; type: "image/png" | "image/jpeg" } | null;
  logoVersion: number;
}

export function plantApp(tenantId: string): Promise<PlantApp | null> {
  return withTenant(tenantId, async (tx) => {
    const [row] = await tx
      .select({ name: tenants.name, color: tenantProfiles.brandColor, logo: tenantProfiles.logo, type: tenantProfiles.logoType, at: tenantProfiles.logoUpdatedAt })
      .from(tenants)
      .leftJoin(tenantProfiles, eq(tenantProfiles.tenantId, tenants.id))
      .where(eq(tenants.id, tenantId));
    if (!row) return null;
    const usable = row.logo && (row.type === "image/png" || row.type === "image/jpeg");
    return {
      name: row.name,
      color: row.color ?? PLANTOPS_APP.color,
      logo: usable ? { data: row.logo!, type: row.type as "image/png" | "image/jpeg" } : null,
      logoVersion: usable && row.at ? row.at.getTime() : 0,
    };
  });
}

/** For the page's <head>: the logged-in plant user's app (name + signed link), or null for PlantOps. Never throws. */
export async function plantAppForRequest(): Promise<{ name: string; token: string } | null> {
  try {
    const value = (await cookies()).get(SESSION_COOKIE)?.value;
    if (!value) return null;
    const req = new Request("http://localhost/", { headers: { cookie: `${SESSION_COOKIE}=${encodeURIComponent(value)}` } });
    const user = await getCurrentUser(req);
    if (!user) return null;
    const app = await plantApp(user.tenantId);
    return app ? { name: app.name, token: appToken(user.tenantId, app.logoVersion) } : null;
  } catch {
    return null;
  }
}

/** The install details (Web App Manifest). `base` = where the icons live: "" for PlantOps, "/plant-app/<token>" for a plant. */
export function manifestFor(app: { name: string; color: string }, iconBase: string) {
  const icon = (size: IconSize, purpose: "any" | "maskable") => {
    const px = ICON_SIZES[size];
    return { src: iconBase ? `${iconBase}/icon/${size}` : `/icon-${px}.png`, sizes: `${px}x${px}`, type: "image/png", purpose };
  };
  return {
    name: app.name,
    short_name: app.name.length <= 12 ? app.name : app.name.slice(0, 12).trim(),
    description: "Plant operations for RO / packaged drinking water plants",
    id: "/home",
    start_url: "/home",
    scope: "/",
    display: "standalone",
    background_color: "#f8fafc",
    theme_color: app.color,
    icons: [icon("192", "any"), icon("512", "any"), icon("512m", "maskable")],
  };
}

/** Width and height of a PNG or JPEG, read from its header (null if it can't be read). */
export function imageSize(data: Buffer, type: "image/png" | "image/jpeg"): { width: number; height: number } | null {
  if (type === "image/png") {
    if (data.length < 24) return null;
    return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
  }
  let i = 2;
  while (i + 9 < data.length) {
    if (data[i] !== 0xff) return null;
    const marker = data[i + 1]!;
    const len = data.readUInt16BE(i + 2);
    // SOF0–SOF15 hold the size (not DHT c4, JPG c8, DAC cc)
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: data.readUInt16BE(i + 5), width: data.readUInt16BE(i + 7) };
    }
    i += 2 + len;
  }
  return null;
}
