import type { CSSProperties, ReactNode } from "react";
import { brandStyle } from "@plantops/ui/brand";
import { kit } from "@/server/kit";
import { currentUser } from "@/server/session";

// The plant's own screens (owner, HR desk, PlantOps support) use the plant's brand colour (Business details).
export default async function AppLayout({ children }: { children: ReactNode }) {
  const user = await currentUser();
  const b = user ? await kit.branding(user.tenantId) : null;
  const style = b?.brand_color ? (brandStyle(b.brand_color) as CSSProperties) : undefined;
  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-6" style={style}>
      {children}
    </main>
  );
}
