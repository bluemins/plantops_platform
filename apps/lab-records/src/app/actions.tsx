"use client";

import { useState, type ReactNode } from "react";
import { Button, ErrorText } from "@plantops/ui";
import { api } from "@/lib/api";

/** A button that POSTs to an action endpoint (after an optional confirm), then reloads the page. */
export function ActionButton({
  path,
  body,
  confirmText,
  variant = "primary",
  disabled,
  children,
}: {
  path: string;
  body?: Record<string, unknown>;
  confirmText?: string;
  variant?: "primary" | "secondary" | "danger";
  disabled?: boolean;
  children: ReactNode;
}) {
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  async function run() {
    if (confirmText && !confirm(confirmText)) return;
    setBusy(true);
    const r = await api(path, { body: body ?? {} });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    window.location.reload();
  }
  return (
    <div>
      <Button variant={variant} onClick={run} disabled={busy || disabled}>
        {children}
      </Button>
      <ErrorText>{error}</ErrorText>
    </div>
  );
}

/** A short text (note / reason) plus a button that sends it. */
export function TextAction({
  path,
  field,
  label,
  placeholder,
  button,
  minLength = 5,
  variant = "primary",
  confirmText,
}: {
  path: string;
  field: string;
  label: string;
  placeholder?: string;
  button: string;
  minLength?: number;
  variant?: "primary" | "secondary" | "danger";
  confirmText?: string;
}) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  async function run() {
    if (confirmText && !confirm(confirmText)) return;
    setBusy(true);
    const r = await api(path, { body: { [field]: text } });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    window.location.reload();
  }
  return (
    <div className="space-y-2">
      <label className="block">
        <span className="mb-1 block text-sm font-medium text-slate-700">{label}</span>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={2}
          maxLength={1000}
          placeholder={placeholder}
          className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-base focus:border-(--brand) focus:outline-none focus:ring-2 focus:ring-(--brand-ring)"
        />
      </label>
      <ErrorText>{error}</ErrorText>
      <Button variant={variant} onClick={run} disabled={busy || text.trim().length < minLength}>
        {button}
      </Button>
    </div>
  );
}
