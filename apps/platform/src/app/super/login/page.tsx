"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, ErrorText, TextField } from "@plantops/ui";
import { api } from "@/lib/api";

export default function SuperLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string>();

  async function submit(e: FormEvent) {
    e.preventDefault();
    const r = await api("/api/super/login", { body: { email, password } });
    if (!r.ok) return setError(r.error);
    router.push("/super");
  }

  return (
    <div className="mx-auto max-w-sm">
      <h1 className="mb-6 text-2xl font-bold">PlantOps admin</h1>
      <Card>
        <form onSubmit={submit} className="space-y-4">
          <TextField label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required />
          <TextField label="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
          <ErrorText>{error}</ErrorText>
          <Button type="submit" className="w-full">Log in</Button>
        </form>
      </Card>
    </div>
  );
}
