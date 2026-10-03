import type { CSSProperties, ReactNode } from "react";
import { brandStyle, DEFAULT_BRAND } from "@plantops/ui";

/** super_admin screens are always PlantOps blue, even if a plant session exists in the same browser. */
export default function SuperLayout({ children }: { children: ReactNode }) {
  return <div style={brandStyle(DEFAULT_BRAND) as CSSProperties}>{children}</div>;
}
