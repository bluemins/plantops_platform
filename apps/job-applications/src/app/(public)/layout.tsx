import { Figtree } from "next/font/google";
import type { ReactNode } from "react";

// The job page's font from the mock-ups. next/font copies it into the app at build time: job seekers' phones never
// ask Google for it.
const figtree = Figtree({ subsets: ["latin"], weight: ["400", "500", "600", "700", "800"], display: "swap" });

/** Public job page (no login): full width on phones, a phone-width column on bigger screens. */
export default function PublicLayout({ children }: { children: ReactNode }) {
  return <div className={`${figtree.className} mx-auto min-h-screen w-full max-w-xl bg-[#f4f6fb] text-slate-900`}>{children}</div>;
}
