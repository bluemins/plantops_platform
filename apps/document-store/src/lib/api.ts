"use client";

/** Small fetch wrapper for screens: JSON in, JSON out, error message ready to show. */
export async function api<T = unknown>(path: string, opts: { method?: string; body?: unknown } = {}) {
  const method = opts.method ?? (opts.body === undefined ? "GET" : "POST");
  const res = await fetch(path, {
    method,
    headers: method === "GET" ? {} : { "content-type": "application/json" },
    body: method === "GET" ? undefined : JSON.stringify(opts.body ?? {}),
  });
  const data = await res.json().catch(() => null);
  if (res.status === 401) window.location.reload(); // session over: the proxy sends them to the login
  return { ok: res.ok, status: res.status, data: data as T, error: (data?.error as string | undefined) ?? (res.ok ? undefined : "Something went wrong") };
}

export const MAX_FILE_MB = 10;

/** Uploads one file as-is (the server checks its real type and size) and returns its id. */
export async function uploadFile(file: File): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  if (file.size > MAX_FILE_MB * 1024 * 1024) return { ok: false, error: `The file is larger than ${MAX_FILE_MB} MB` };
  const res = await fetch("/api/files", {
    method: "POST",
    headers: { "content-type": file.type || "application/octet-stream", "x-file-name": encodeURIComponent(file.name) },
    body: file,
  });
  const data = await res.json().catch(() => null);
  if (res.status === 401) window.location.reload();
  return res.ok ? { ok: true, id: data.id } : { ok: false, error: data?.error ?? "Upload failed" };
}
