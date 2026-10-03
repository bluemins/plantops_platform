"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Button, Card, ErrorText, PinInput, TextField } from "@plantops/ui";
import { api } from "@/lib/api";
import { safeNext } from "@/lib/safe-next";

const PLANT_KEY = "plantops.plantCode";

export default function LoginPage() {
  const [plantCode, setPlantCode] = useState("");
  const [username, setUsername] = useState("");
  const [secret, setSecret] = useState("");
  const [owner, setOwner] = useState(false);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  // Staff type the plant code once; the phone remembers it.
  useEffect(() => {
    try {
      setPlantCode(localStorage.getItem(PLANT_KEY) ?? "");
    } catch {}
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    const res = await api<{ must_change_secret: boolean }>("/api/auth/login", {
      body: { plant_code: plantCode, username, secret },
    });
    setBusy(false);
    if (!res.ok) return setError(res.error);
    try {
      localStorage.setItem(PLANT_KEY, plantCode.trim().toUpperCase());
    } catch {}
    // Back to where the user was going (e.g. a module link on their phone), else the launcher.
    // Full page load so the plant's brand colour applies.
    const next = safeNext(new URLSearchParams(window.location.search).get("next"));
    if (res.data.must_change_secret) return window.location.assign(`/change-secret${next ? `?next=${encodeURIComponent(next)}` : ""}`);
    window.location.assign(next ?? "/home");
  }

  return (
    <div className="mx-auto max-w-sm">
      <h1 className="mb-6 text-3xl font-bold">
        Plant<span className="text-blue-700">Ops</span>
      </h1>
      <Card>
        <form onSubmit={submit} className="space-y-4">
          <TextField label="Plant code" value={plantCode} onChange={(e) => setPlantCode(e.target.value)} autoCapitalize="characters" required />
          <TextField label="Username" value={username} onChange={(e) => setUsername(e.target.value)} autoCapitalize="none" autoComplete="username" required />
          <div className="grid grid-cols-2 gap-2">
            <Button type="button" variant={owner ? "secondary" : "primary"} onClick={() => setOwner(false)}>
              Staff (PIN)
            </Button>
            <Button type="button" variant={owner ? "primary" : "secondary"} onClick={() => setOwner(true)}>
              Owner
            </Button>
          </div>
          {owner ? (
            <TextField label="Password" type="password" value={secret} onChange={(e) => setSecret(e.target.value)} autoComplete="current-password" required />
          ) : (
            <PinInput label="6-digit PIN" value={secret} onChange={(e) => setSecret(e.target.value)} required />
          )}
          <ErrorText>{error}</ErrorText>
          <Button type="submit" disabled={busy} className="w-full">
            {busy ? "Logging in..." : "Log in"}
          </Button>
        </form>
      </Card>
      <p className="mt-4 text-center text-sm text-slate-500">Forgot your PIN? Ask your plant owner to reset it.</p>
    </div>
  );
}
