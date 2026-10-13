import type { Metadata, Viewport } from "next";
import type { CSSProperties, ReactNode } from "react";
import { plantAppForRequest } from "@/server/app-icon";
import { brandStyleForRequest } from "@/server/brand";
import "./globals.css";

/**
 * A logged-in plant user installs their plant's app (its name and logo, src/server/app-icon.ts); anyone else PlantOps.
 * iPhone: "Add to Home Screen" opens it as its own app, which is what allows phone notifications there.
 */
export async function generateMetadata(): Promise<Metadata> {
  const app = await plantAppForRequest();
  const base = app ? `/plant-app/${app.token}` : null;
  const name = app?.name ?? "PlantOps";
  return {
    title: "PlantOps",
    description: "Plant operations for RO / packaged drinking water plants",
    manifest: base ? `${base}/manifest.webmanifest` : "/manifest.webmanifest",
    appleWebApp: { capable: true, title: name, statusBarStyle: "default" },
    icons: base ? { icon: `${base}/icon/192`, apple: `${base}/icon/180` } : { icon: "/icon-192.png", apple: "/icon-192.png" },
  };
}
export const viewport: Viewport = { width: "device-width", initialScale: 1 };

// A logged-in plant user's screens use their plant's brand colour (set in Business details).
export default async function RootLayout({ children }: { children: ReactNode }) {
  const brand = await brandStyleForRequest();
  return (
    <html lang="en">
      <body className="min-h-screen antialiased" style={brand as CSSProperties | undefined}>
        <main className="mx-auto w-full max-w-3xl px-4 py-6">{children}</main>
      </body>
    </html>
  );
}
