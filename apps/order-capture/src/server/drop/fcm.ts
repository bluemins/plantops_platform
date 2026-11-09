// Sending one push to one phone through Firebase Cloud Messaging (HTTP v1), without Google's SDK
// (docs/CUSTOMER_APP_PHASE_PLAN.md Phase 6). The service-account key (FCM_SERVICE_ACCOUNT) signs a short JWT with
// Node's crypto; Google swaps it for an access token (cached until 5 minutes before it ends). A broken key switches
// pushes off (listed by /health), never half on.
import { createSign } from "node:crypto";
import { z } from "zod";
import { env } from "../env";

const Key = z.object({ project_id: z.string().min(1), client_email: z.string().email(), private_key: z.string().includes("PRIVATE KEY"), token_uri: z.string().url().optional() });
type FcmKey = z.infer<typeof Key>;

let parsedFrom: string | null = null;
let key: FcmKey | null = null;
let problem: string | null = null;
let token: { value: string; until: number } | null = null;

function read() {
  const raw = env.fcmServiceAccount;
  if (raw === parsedFrom) return;
  parsedFrom = raw;
  key = null;
  problem = null;
  token = null;
  if (!raw.trim()) return;
  try {
    key = Key.parse(JSON.parse(raw));
  } catch {
    problem = "FCM_SERVICE_ACCOUNT is not a valid Firebase service-account key (JSON), so Drop pushes are off";
    console.error(`[order-capture] ${problem}`);
  }
}

/** true when a key is set and readable */
export function fcmOn() {
  read();
  return key !== null;
}

/** What is wrong with the push key (for /health); null = fine or not set. */
export function fcmProblem() {
  read();
  return problem;
}

const b64 = (x: string | Buffer) => Buffer.from(x).toString("base64url");

async function accessToken(k: FcmKey, now = Date.now()): Promise<string> {
  if (token && token.until > now) return token.value;
  const aud = env.fcmTokenUrl || k.token_uri || "https://oauth2.googleapis.com/token";
  const iat = Math.floor(now / 1000);
  const head = b64(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64(JSON.stringify({ iss: k.client_email, scope: "https://www.googleapis.com/auth/firebase.messaging", aud, iat, exp: iat + 3600 }));
  const signature = createSign("RSA-SHA256").update(`${head}.${claims}`).sign(k.private_key).toString("base64url");
  const res = await fetch(aud, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${head}.${claims}.${signature}` }),
    signal: AbortSignal.timeout(10_000),
  });
  const json = (await res.json().catch(() => null)) as { access_token?: string; expires_in?: number } | null;
  if (!res.ok || !json?.access_token) throw new AuthError(`Google refused the key (${res.status})`);
  token = { value: json.access_token, until: now + Math.max(60, (json.expires_in ?? 3600) - 300) * 1000 };
  return token.value;
}

class AuthError extends Error {}

export type PushMessage = { token: string; title: string; body: string; tab: string };
/** sent | gone (the phone has no app / token any more) | auth (key refused: alert) | bad (this message can't go) | retry */
export type PushResult = { ok: true } | { ok: false; kind: "gone" | "auth" | "bad" | "retry" | "off"; error: string };

export async function sendPush(m: PushMessage): Promise<PushResult> {
  read();
  if (!key) return { ok: false, kind: "off", error: "Pushes are not set up (FCM_SERVICE_ACCOUNT)" };
  let bearer: string;
  try {
    bearer = await accessToken(key);
  } catch (err) {
    return err instanceof AuthError ? { ok: false, kind: "auth", error: err.message } : { ok: false, kind: "retry", error: "Google could not be reached" };
  }
  let res: Response;
  try {
    res = await fetch(`${env.fcmApiUrl}/v1/projects/${encodeURIComponent(key.project_id)}/messages:send`, {
      method: "POST",
      headers: { authorization: `Bearer ${bearer}`, "content-type": "application/json" },
      body: JSON.stringify({
        message: {
          token: m.token,
          notification: { title: m.title, body: m.body },
          data: { tab: m.tab },
          android: { priority: "high", notification: { channel_id: "drop", icon: "ic_stat_drop" } },
        },
      }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return { ok: false, kind: "retry", error: "Firebase could not be reached" };
  }
  if (res.ok) return { ok: true };
  const json = (await res.json().catch(() => null)) as { error?: { status?: string; message?: string; details?: { errorCode?: string }[] } } | null;
  const codes = [json?.error?.status ?? "", ...(json?.error?.details ?? []).map((d) => d.errorCode ?? "")];
  const error = `Firebase ${res.status} ${codes.filter(Boolean).join(" ")}`.trim().slice(0, 300);
  if (res.status === 404 || codes.includes("UNREGISTERED")) return { ok: false, kind: "gone", error };
  if (res.status === 401 || res.status === 403) {
    token = null;
    return { ok: false, kind: "auth", error };
  }
  if (res.status === 400) return /registration token/i.test(json?.error?.message ?? "") ? { ok: false, kind: "gone", error } : { ok: false, kind: "bad", error };
  return { ok: false, kind: "retry", error };
}
