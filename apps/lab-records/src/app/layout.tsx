import type { Metadata, Viewport } from "next";
import type { CSSProperties, ReactNode } from "react";
import { brandStyle } from "@plantops/ui/brand";
import { branding } from "@/server/platform";
import { currentUser } from "@/server/session";
import "./globals.css";

export const metadata: Metadata = { title: "Lab Records · PlantOps", description: "Batch tests and FSSAI lab records" };
export const viewport: Viewport = { width: "device-width", initialScale: 1 };

// Every screen uses the plant's brand colour and logo (Business details on the platform).
export default async function RootLayout({ children }: { children: ReactNode }) {
  const user = await currentUser();
  const b = user ? await branding(user.tenantId) : null;
  const style = b?.brand_color ? (brandStyle(b.brand_color) as CSSProperties) : undefined;
  return (
    <html lang="en">
      <body className="min-h-screen antialiased" style={style}>
        <main className="mx-auto w-full max-w-3xl px-4 py-6">{children}</main>
      </body>
    </html>
  );
}
