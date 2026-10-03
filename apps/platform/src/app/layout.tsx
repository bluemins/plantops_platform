import type { Metadata, Viewport } from "next";
import type { CSSProperties, ReactNode } from "react";
import { brandStyleForRequest } from "@/server/brand";
import "./globals.css";

export const metadata: Metadata = { title: "PlantOps", description: "Plant operations for RO / packaged drinking water plants" };
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
