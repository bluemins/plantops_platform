// The Sales customer API (docs/CUSTOMER_APP_PHASE_PLAN.md). Every call says which app it is (x-drop-app) and carries
// the session token; on the phone it goes through Android's own HTTP (capacitor.config.ts). Errors come back as
// { error: { code, message } }; no connection = "offline".
export const API = (import.meta.env.VITE_DROP_API_URL ?? "https://orders.bluemins.life").replace(/\/$/, "");
export const APP_ID = "drop";

export type ApiResult<T> = { ok: true; data: T } | { ok: false; status: number; code: string; message: string };

export async function call<T>(path: string, opts: { token?: string | null; body?: unknown } = {}): Promise<ApiResult<T>> {
  let res: Response;
  try {
    res = await fetch(`${API}${path}`, {
      method: opts.body === undefined ? "GET" : "POST",
      headers: {
        "x-drop-app": APP_ID,
        ...(opts.body === undefined ? {} : { "content-type": "application/json" }),
        ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
      },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    });
  } catch {
    return { ok: false, status: 0, code: "offline", message: "" };
  }
  const json = (await res.json().catch(() => null)) as (T & { error?: { code: string; message: string } }) | null;
  if (res.ok && json) return { ok: true, data: json };
  return { ok: false, status: res.status, code: json?.error?.code ?? "unavailable", message: json?.error?.message ?? "" };
}

// ---------- the answers (as Sales sends them) ----------
export type Look = { name: string; brand_color: string | null; has_logo: boolean; support: { phone: string; hours: string | null } | null };
export type HomeLine = { product: string; size: string; unit: string; qty: number; free: number };
export type Home = {
  shop: { name: string };
  orders: { status: "received" | "delivered"; date: string; time: string | null; lines: HomeLine[] }[];
  dues: { brand: string; paise: number }[];
  boxes: Record<string, { this_month: { total: number; sizes: { size: string; boxes: number }[] }; last_month: { total: number }; this_year: { total: number; last_year_same_days: number } }> | null;
  support: { phone: string; hours: string | null } | null;
  points: { balance: number; next: { label: string; missing: number } | null } | null;
};
export type Points = {
  on: boolean;
  balance: number;
  ends_on: string | null;
  redeem_open: boolean;
  opens_on: string | null;
  rewards: { id: string; label: string; size: string; points: number; can_use: boolean; why_not: string | null }[];
  open_request: { label: string; state: string } | null;
  record: { month: string; purchases: number; polls: number; boxes: { label: string; state: string; date: string }[] }[];
};
export type Polls = {
  points_each: number;
  this_week: { counted: boolean };
  polls: { id: string; question: string; choices: string[]; other_allowed: boolean; closes_at: string }[];
  answered: { count: number; points: number };
};
