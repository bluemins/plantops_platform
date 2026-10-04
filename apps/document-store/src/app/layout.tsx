import type { Metadata, Viewport } from "next";
import type { CSSProperties, ReactNode } from "react";
import { brandStyle } from "@plantops/ui/brand";
import { kit } from "@/server/kit";
import { getLocale } from "@/server/locale";
import { currentUser } from "@/server/session";
import { LanguageProvider } from "./language-provider";
import "./globals.css";

export const metadata: Metadata = { title: "Document Store · PlantOps", description: "Licences and certificates with expiry reminders" };
export const viewport: Viewport = { width: "device-width", initialScale: 1 };

// Every screen uses the plant's brand colour and logo (Business details on the platform).
export default async function RootLayout({ children }: { children: ReactNode }) {
  const [user, locale] = await Promise.all([currentUser(), getLocale()]);
  const b = user ? await kit.branding(user.tenantId) : null;
  const style = b?.brand_color ? (brandStyle(b.brand_color) as CSSProperties) : undefined;
  return (
    <html lang={locale}>
      <body className="min-h-screen antialiased" style={style}>
        <LanguageProvider locale={locale}>
          <main className="mx-auto w-full max-w-5xl px-4 py-6">{children}</main>
        </LanguageProvider>
      </body>
    </html>
  );
}
