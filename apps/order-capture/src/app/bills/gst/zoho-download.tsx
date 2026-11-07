"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, ErrorText } from "@plantops/ui";

/** Downloads the Zoho file. "new" marks the bills sent, so the page reloads to move them to "Sent". */
export function ZohoDownload({ which, count, label }: { which: "new" | "again"; count: number; label: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function download() {
    setBusy(true);
    setError(undefined);
    try {
      const res = await fetch("/api/bills/zoho", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ which }) });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? "The file couldn't be made. Try again.");
      }
      const blob = await res.blob();
      const name = /filename="([^"]+)"/.exec(res.headers.get("content-disposition") ?? "")?.[1] ?? "zoho-invoices.csv";
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      a.click();
      URL.revokeObjectURL(url);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (which === "again")
    return (
      <div>
        <button className="min-h-10 text-sm font-semibold text-(--brand)" disabled={busy || count === 0} onClick={download}>
          {busy ? "Making the file..." : label}
        </button>
        <ErrorText>{error}</ErrorText>
      </div>
    );
  return (
    <div className="space-y-1">
      <Button className="w-full" disabled={busy || count === 0} onClick={download}>{busy ? "Making the file..." : label}</Button>
      <ErrorText>{error}</ErrorText>
    </div>
  );
}
