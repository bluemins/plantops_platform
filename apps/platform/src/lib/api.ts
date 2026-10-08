"use client";

/** Small fetch wrapper for screens: JSON in, JSON out, error message ready to show. */
export async function api<T = any>(path: string, opts: { method?: string; body?: unknown } = {}) {
  const method = opts.method ?? (opts.body === undefined ? "GET" : "POST");
  const res = await fetch(path, {
    method,
    headers: method === "GET" ? {} : { "content-type": "application/json" },
    body: method === "GET" ? undefined : JSON.stringify(opts.body ?? {}),
  });
  const data = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, data: data as T, error: (data?.error as string | undefined) ?? (res.ok ? undefined : "Something went wrong") };
}

export const ROLE_LABELS: Record<string, string> = {
  tenant_admin: "Owner",
  lab_technician: "Lab technician",
  lab_lead: "Lab lead",
  document_keeper: "Document keeper",
  store_keeper: "Store keeper",
  maintenance_technician: "Maintenance technician",
  plant_staff: "Plant staff",
};
