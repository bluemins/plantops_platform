// Small shared pieces of the Drop look: the coloured header with waves, section titles, big buttons.
import type { ReactNode } from "react";
import { Waves } from "./art";

/** A brand-coloured header that ends in the two-layer wave; content sits above the art. */
export function BrandHeader({ children, art, className = "" }: { children: ReactNode; art?: ReactNode; className?: string }) {
  return (
    <div className={`relative overflow-hidden bg-brand text-on-brand ${className}`}>
      {art}
      <div className="relative">{children}</div>
      <Waves />
    </div>
  );
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return <h2 className="mx-5 mt-6 mb-2.5 font-display text-xl font-bold">{children}</h2>;
}

const BIG = "flex h-14 items-center justify-center gap-2 rounded-2xl font-display text-lg font-bold transition-opacity active:opacity-80 disabled:cursor-default";
/** Filled brand button (the main action on a screen). */
export const solid = `${BIG} bg-brand text-on-brand disabled:bg-well disabled:text-[#6b7790]`;
/** Outlined brand button. */
export const outline = `${BIG} border-2 border-brand bg-white text-link`;
/** Smaller buttons (cards, dialogs). */
export const smallSolid = "h-11 rounded-[14px] bg-brand px-5 font-display text-[17px] font-bold text-on-brand active:opacity-80 disabled:bg-well disabled:text-[#6b7790]";
export const smallGrey = "h-12 rounded-[14px] bg-well font-display text-[17px] font-bold text-ink active:opacity-80";
