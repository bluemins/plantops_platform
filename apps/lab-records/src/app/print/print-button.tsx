"use client";

export function PrintButton() {
  return (
    <button onClick={() => window.print()} className="min-h-12 rounded-xl bg-(--brand) px-6 font-semibold text-(--brand-contrast)">
      🖨 Print / Save as PDF
    </button>
  );
}
