"use client";

export function PrintButton() {
  return (
    <button type="button" onClick={() => window.print()} className="min-h-11 rounded-xl bg-(--brand) px-5 font-semibold text-(--brand-contrast)">
      Print
    </button>
  );
}
