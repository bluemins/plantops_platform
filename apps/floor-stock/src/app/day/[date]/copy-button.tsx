"use client";

import { useState } from "react";
import { Button } from "@plantops/ui";

/** "Copy as WhatsApp message": copies the count in the group-message layout; shows the text if copying fails. */
export function CopyButton({ text }: { text: string }) {
  const [state, setState] = useState<"idle" | "copied" | "show">("idle");
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setState("copied");
      setTimeout(() => setState("idle"), 2500);
    } catch {
      setState("show"); // plain http on a phone: no clipboard access, so let them select it
    }
  }
  return (
    <div className="space-y-2">
      <Button variant="secondary" onClick={copy}>
        {state === "copied" ? "✓ Copied" : "Copy as WhatsApp message"}
      </Button>
      {state === "show" && (
        <textarea readOnly value={text} rows={10} onFocus={(e) => e.currentTarget.select()} className="w-full rounded-xl border border-slate-300 p-3 font-mono text-sm" aria-label="WhatsApp message" />
      )}
    </div>
  );
}
