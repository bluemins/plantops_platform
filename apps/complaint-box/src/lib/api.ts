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
