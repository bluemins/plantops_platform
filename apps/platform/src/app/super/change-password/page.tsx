"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, Card, ErrorText, TextField } from "@plantops/ui";
import { api } from "@/lib/api";

export default function SuperChangePasswordPage() {
  const router = useRouter();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string>();

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (next !== confirm) return setError("The two new passwords don't match");
    const r = await api("/api/super/change-password", { body: { current, next } });
    if (r.status === 401) return router.replace("/super/login");
    if (!r.ok) return setError(r.error);
    router.push("/super");
  }

  return (
    <div className="mx-auto max-w-sm">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Change password</h1>
        <Link href="/super" className="text-(--brand) font-medium">Back</Link>
      </div>
      <Card>
        <form onSubmit={submit} className="space-y-4">
          <TextField label="Current password" type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" required />
          <TextField label="New password (at least 10 characters)" type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" required />
          <TextField label="Repeat new password" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" required />
          <ErrorText>{error}</ErrorText>
          <Button type="submit" className="w-full">Save</Button>
        </form>
      </Card>
    </div>
  );
}
