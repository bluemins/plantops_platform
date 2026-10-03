"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, ErrorText, PinInput, TextField } from "@plantops/ui";
import { api } from "@/lib/api";
import { safeNext } from "@/lib/safe-next";

export default function ChangeSecretPage() {
  const router = useRouter();
  const [kind, setKind] = useState<"pin" | "password">();
  const [mustChange, setMustChange] = useState(false);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string>();

  useEffect(() => {
    api("/api/auth/me").then((r) => {
      if (!r.ok) return router.replace("/login");
      setKind(r.data.secret_kind);
      setMustChange(r.data.must_change_secret);
    });
  }, [router]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (next !== confirm) return setError("The two new entries don't match");
    const res = await api("/api/auth/change-secret", { body: { current, next } });
    if (!res.ok) return setError(res.error);
    window.location.assign(safeNext(new URLSearchParams(window.location.search).get("next")) ?? "/home");
  }

  if (!kind) return null;
  // Plain function (not a component) so inputs keep focus while typing.
  const field = (label: string, value: string, set: (v: string) => void) =>
    kind === "pin" ? (
      <PinInput label={label} value={value} onChange={(e) => set(e.target.value)} required />
    ) : (
      <TextField label={label} type="password" value={value} onChange={(e) => set(e.target.value)} required />
    );
  const word = kind === "pin" ? "PIN" : "password";
  return (
    <div className="mx-auto max-w-sm">
      <h1 className="mb-2 text-2xl font-bold">Set your own {word}</h1>
      {mustChange && <p className="mb-4 text-slate-600">You logged in with a temporary {word}. Choose your own to continue.</p>}
      <Card>
        <form onSubmit={submit} className="space-y-4">
          {field(`Current ${word}`, current, setCurrent)}
          {field(kind === "pin" ? "New 6-digit PIN" : "New password (at least 10 characters)", next, setNext)}
          {field(`Repeat new ${word}`, confirm, setConfirm)}
          <ErrorText>{error}</ErrorText>
          <Button type="submit" className="w-full">Save</Button>
        </form>
      </Card>
    </div>
  );
}
