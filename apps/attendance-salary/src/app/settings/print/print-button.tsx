"use client";

/** Opens the browser's print dialog (print, or save as PDF). */
export function PrintButton() {
  return (
    <button type="button" onClick={() => window.print()} className="min-h-11 rounded-xl bg-(--brand) px-5 font-bold text-(--brand-contrast)">
      Print
    </button>
  );
}
