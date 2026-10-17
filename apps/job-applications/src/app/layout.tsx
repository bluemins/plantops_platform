import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = { title: "Job applications · PlantOps", description: "Job openings and applications" };
export const viewport: Viewport = { width: "device-width", initialScale: 1 };

// Shared by the public job page and the plant's own screens. Nothing here reads a session: the public page must never
// depend on (or set) a login cookie. Each group adds its own layout: (app) the plant's colour and page padding,
// (public) the job page's font and full-width look.
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
