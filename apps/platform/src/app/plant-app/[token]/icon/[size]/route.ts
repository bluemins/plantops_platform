import { createElement } from "react";
import { ImageResponse } from "next/og";
import { ICON_SIZES, imageSize, plantApp, readAppToken, type IconSize } from "@/server/app-icon";

type Ctx = { params: Promise<{ token: string; size: string }> };

/** Share of the square the logo may fill: Android crops a maskable icon to a circle, so it gets a wider margin. */
const FILL: Record<IconSize, number> = { "180": 0.8, "192": 0.8, "512": 0.8, "512m": 0.6 };

/** One plant's app icon: its logo on a white square. No usable logo = the PlantOps icon. Signed link, no login. */
export async function GET(_req: Request, ctx: Ctx) {
  const { token, size } = await ctx.params;
  if (!(size in ICON_SIZES)) return new Response("Not found", { status: 404 });
  const tenantId = readAppToken(token);
  const app = tenantId ? await plantApp(tenantId) : null;
  if (!app) return new Response("Not found", { status: 404 });

  const px = ICON_SIZES[size as IconSize];
  const dims = app.logo && imageSize(app.logo.data, app.logo.type);
  if (!app.logo || !dims || !dims.width || !dims.height) {
    return new Response(null, { status: 307, headers: { location: px === 512 ? "/icon-512.png" : "/icon-192.png" } });
  }
  const box = px * FILL[size as IconSize];
  const scale = Math.min(box / dims.width, box / dims.height);
  const src = `data:${app.logo.type};base64,${app.logo.data.toString("base64")}`;
  return new ImageResponse(
    createElement(
      "div",
      { style: { width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "#ffffff" } },
      createElement("img", { src, width: Math.round(dims.width * scale), height: Math.round(dims.height * scale) }),
    ),
    // the logo version is in the link, so the same link always means the same picture
    { width: px, height: px, headers: { "cache-control": "public, max-age=31536000, immutable" } },
  );
}
