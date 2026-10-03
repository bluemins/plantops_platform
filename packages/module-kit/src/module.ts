// Everything a PlantOps module app needs to plug into the platform (CLAUDE.md "Every module app must"), set up
// once per module with createModule({ moduleId, label, env }):
//   * credentials + the platform's public keys (a module can never mint tokens)
//   * the plant's branding / products / plan, cached for a minute
//   * the user session cookie (12 h, 5-minute platform re-check) and the separate read-only support cookie
//   * the proxy that keeps sessions fresh and sends people without one to the platform login
//   * the standard routes: login callback, support entry/exit, logout, plant logo
// Module-specific rules (who may enter data, approve, ...) stay in each app.
import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import {
  fetchAlertContacts,
  fetchBranding,
  fetchLogo,
  fetchSkus,
  fetchTenantPlan,
  openSession,
  openSupportSession,
  RECHECK_GRACE_MINUTES,
  refreshModuleSession,
  sealSession,
  sealSupportSession,
  SESSION_HOURS,
  startModuleSession,
  startSupportSession,
  type KeySource,
  type ModuleCredentials,
  type ModuleSession,
  type SupportSession,
} from "@plantops/auth";
import type { AlertContact, ModuleId, TenantBranding, TenantPlan, TenantSku } from "@plantops/types";
import { safeNext } from "./safe-next";

export interface ModuleEnv {
  platformUrl(): string;
  /** this module's client secret (the platform stores only its hash) */
  clientSecret(): string;
  /** signs this module's own cookies, ≥ 32 characters; never the platform's key */
  sessionSecret(): string;
  /** true when the module is served over https (Secure cookies) */
  secureCookies(): boolean;
}

export interface ModuleConfig {
  moduleId: ModuleId;
  label: string;
  env: ModuleEnv;
}

const CACHE_MS = 60_000;
type Cache<T> = Map<string, { at: number; value: T }>;

/** "500 ml × 24 (case)" style product name used on screens and records. */
export function productLabel(s: TenantSku) {
  const size = s.volume_ml >= 1000 ? `${s.volume_ml / 1000} L` : `${s.volume_ml} ml`;
  return s.units_per_pack > 1 ? `${s.name} (${size} × ${s.units_per_pack})` : `${s.name} (${size})`;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export function createModule(config: ModuleConfig) {
  const { moduleId, label, env } = config;
  const SESSION_COOKIE = `plantops_${moduleId}`; // modules on one host must not share a cookie
  /** super_admin's read-only support view: a separate cookie, never mixed up with a plant user's session */
  const SUPPORT_COOKIE = `plantops_${moduleId}_support`;

  // ---------- platform ----------
  const creds = (): ModuleCredentials => ({ platformUrl: env.platformUrl(), moduleId, clientSecret: env.clientSecret() });
  const keys = (): KeySource => ({ jwksUrl: new URL("/.well-known/jwks.json", env.platformUrl()).toString() });
  /** The platform's "Account / PlantOps home" screen (launcher), always reachable from the module. */
  const accountUrl = () => new URL("/home?launcher=1", env.platformUrl()).toString();
  /** Platform login that returns the user here with a one-time code (CLAUDE.md flow step 6). */
  const platformLoginUrl = (next: string) => new URL(`/sso/start?module=${moduleId}&next=${encodeURIComponent(next)}`, env.platformUrl()).toString();

  // Caches survive hot reloads in dev; one per module.
  const g = globalThis as unknown as Record<string, Cache<unknown> | undefined>;
  function cached<T>(name: string, load: (tenantId: string) => Promise<T>, fallback: T) {
    return async (tenantId: string): Promise<T> => {
      const cache = (g[`__${moduleId}_${name}`] ??= new Map()) as Cache<T>;
      const hit = cache.get(tenantId);
      if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;
      const value = await load(tenantId).catch(() => null);
      if (value !== null) cache.set(tenantId, { at: Date.now(), value });
      return value ?? hit?.value ?? fallback;
    };
  }
  /** The plant's look. Never breaks a page: null means default PlantOps colours. */
  const branding = cached<TenantBranding | null>("branding", (t) => fetchBranding(creds(), t), null);
  /** The plant's products. Empty if the platform is unreachable. */
  const products = cached<TenantSku[]>("skus", (t) => fetchSkus(creds(), t), []);
  /** The plant's plan (limits). null if the platform can't be reached and nothing is cached. */
  const plan = cached<TenantPlan | null>("plan", (t) => fetchTenantPlan(creds(), t), null);
  /** Owners + this module's staff (names, phones, emails, roles). null if the platform can't be reached. */
  const contacts = cached<AlertContact[] | null>("contacts", (t) => fetchAlertContacts(creds(), t), null);

  // ---------- cookies ----------
  const sessionOpts = () => ({ secret: env.sessionSecret(), moduleId });
  const sealCookie = (s: ModuleSession) => sealSession(s, sessionOpts());
  /** Signature, shift and module checks only (the proxy then re-checks with the platform). */
  const openCookie = (value: string | undefined) => openSession(value, sessionOpts());
  /** A valid session that was re-checked with the platform recently (the proxy does that every 5 minutes). */
  async function readSession(value: string | undefined, now = Date.now()): Promise<ModuleSession | null> {
    const s = await openCookie(value);
    if (!s || now - s.checked_at > RECHECK_GRACE_MINUTES * 60_000) return null;
    return s;
  }
  const baseCookie = () => ({ httpOnly: true, sameSite: "lax" as const, secure: env.secureCookies(), path: "/" });
  const sessionCookie = (value: string) => ({ name: SESSION_COOKIE, value, ...baseCookie(), maxAge: SESSION_HOURS * 3600 });
  const sealSupportCookie = (s: SupportSession) => sealSupportSession(s, sessionOpts());
  const openSupportCookie = (value: string | undefined) => openSupportSession(value, sessionOpts());
  const supportCookie = (value: string, expiresAt: number) => ({
    name: SUPPORT_COOKIE,
    value,
    ...baseCookie(),
    maxAge: Math.max(0, Math.floor((expiresAt - Date.now()) / 1000)),
  });

  /** Who is using the module right now: a support view (wins), a plant user, or nobody. Server components / routes only. */
  async function currentSession(): Promise<{ kind: "support"; support: SupportSession } | { kind: "user"; session: ModuleSession } | null> {
    const jar = await cookies();
    const support = await openSupportCookie(jar.get(SUPPORT_COOKIE)?.value);
    if (support) return { kind: "support", support };
    const session = await readSession(jar.get(SESSION_COOKIE)?.value);
    return session ? { kind: "user", session } : null;
  }

  // ---------- small plain page for the few moments without an app screen ----------
  function messagePage(status: number, message: string) {
    const body = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(label)}</title><style>body{font-family:system-ui,sans-serif;background:#f4f6fb;color:#0f172a;margin:0;padding:24px 16px}
.card{max-width:480px;margin:0 auto;background:#fff;border:1px solid #e2e8f0;border-radius:16px;padding:20px}
a{display:inline-block;margin-top:12px;padding:12px 18px;border-radius:12px;background:#1d4ed8;color:#fff;text-decoration:none;font-weight:600}</style></head>
<body><div class="card"><h1>${esc(label)}</h1><p>${esc(message)}</p><a href="${esc(accountUrl())}">Back to PlantOps</a></div></body></html>`;
    return new Response(body, { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
  }

  // ---------- proxy (runs before every page and API request) ----------
  /**
   * Keeps the session alive the way CLAUDE.md requires: ends it after one shift (12 h), re-checks the user with
   * the platform every 5 minutes, and sends anyone without a session to the platform login, which brings them
   * straight back. A support session may look (GET) but never change anything.
   */
  async function proxy(req: NextRequest) {
    const support = await openSupportCookie(req.cookies.get(SUPPORT_COOKIE)?.value);
    if (support) {
      if (req.method !== "GET" && req.method !== "HEAD") return NextResponse.json({ error: "PlantOps support view is read-only" }, { status: 403 });
      return NextResponse.next();
    }

    const cookie = req.cookies.get(SESSION_COOKIE)?.value;
    const opened = await openCookie(cookie);
    const refreshed = opened && (await refreshModuleSession(creds(), opened));
    if (!refreshed) {
      const here = req.nextUrl.pathname + req.nextUrl.search;
      const res = req.nextUrl.pathname.startsWith("/api/")
        ? NextResponse.json({ error: "Please log in again" }, { status: 401 })
        : NextResponse.redirect(platformLoginUrl(here));
      if (cookie) res.cookies.delete(SESSION_COOKIE);
      return res;
    }
    if (!refreshed.changed) return NextResponse.next();

    // Re-checked just now: pass the fresh cookie on to the page (request) and to the browser (response).
    const value = await sealCookie(refreshed.session);
    req.cookies.set(SESSION_COOKIE, value);
    const res = NextResponse.next({ request: { headers: req.headers } });
    res.cookies.set(sessionCookie(value));
    return res;
  }

  // ---------- standard routes ----------
  // Redirects use a relative Location: req.url is the server's own listening address (0.0.0.0 in phone mode,
  // an internal one behind a proxy), which the browser can't open.
  const relativeRedirect = (location: string) => new NextResponse(null, { status: 307, headers: { location } });

  /** /sso/callback?code&next: one-time code -> verified SSO token -> this module's 12-hour session. */
  async function callbackRoute(req: NextRequest) {
    const code = req.nextUrl.searchParams.get("code");
    if (!code) return messagePage(400, `This login link is incomplete. Please open ${label} from PlantOps again.`);
    try {
      const session = await startModuleSession(creds(), code, keys());
      const res = relativeRedirect(safeNext(req.nextUrl.searchParams.get("next")));
      res.cookies.set(sessionCookie(await sealCookie(session)));
      return res;
    } catch (err) {
      console.error(`[${moduleId}] login handoff failed:`, (err as Error).message);
      return messagePage(403, `Could not log you in to ${label} (the link may have expired or been used already). Please try again from PlantOps.`);
    }
  }

  /** /sso/support?code: super_admin's one-time code -> read-only support session (15 minutes). */
  async function supportRoute(req: NextRequest) {
    const code = req.nextUrl.searchParams.get("code");
    if (!code) return messagePage(400, "This support link is incomplete. Open it again from the PlantOps plant dashboard.");
    try {
      const s = await startSupportSession(creds(), code, keys());
      const res = relativeRedirect("/");
      res.cookies.set(supportCookie(await sealSupportCookie(s), s.expires_at));
      return res;
    } catch (err) {
      console.error(`[${moduleId}] support handoff failed:`, (err as Error).message);
      return messagePage(403, "Could not open the support view (the link may have expired or been used). Open it again from the plant dashboard.");
    }
  }

  /** Leaves the module (this module's session only) and goes back to PlantOps. */
  function logoutRoute() {
    const res = NextResponse.redirect(accountUrl());
    res.cookies.delete(SESSION_COOKIE);
    return res;
  }

  /** Ends the support view and goes back to the super_admin plant dashboard. */
  function supportExitRoute() {
    const res = NextResponse.redirect(new URL("/super/dashboard", env.platformUrl()));
    res.cookies.delete(SUPPORT_COOKIE);
    return res;
  }

  /** The viewer's own plant logo, fetched from the platform with this module's credentials. */
  async function plantLogoRoute() {
    const who = await currentSession();
    const tenantId = who?.kind === "support" ? who.support.tenant_id : who?.session.tenant_id;
    const b = tenantId ? await branding(tenantId) : null;
    const logo = b?.logo_url ? await fetchLogo(creds(), b.logo_url).catch(() => null) : null;
    if (!logo) return new Response(null, { status: 404 });
    return new Response(logo.data, { headers: { "content-type": logo.type, "x-content-type-options": "nosniff", "cache-control": "private, max-age=300" } });
  }

  return {
    moduleId,
    label,
    SESSION_COOKIE,
    SUPPORT_COOKIE,
    creds,
    keys,
    accountUrl,
    platformLoginUrl,
    branding,
    products,
    plan,
    contacts,
    sealCookie,
    openCookie,
    readSession,
    sessionCookie,
    sealSupportCookie,
    openSupportCookie,
    supportCookie,
    currentSession,
    messagePage,
    proxy,
    routes: { callback: callbackRoute, support: supportRoute, logout: logoutRoute, supportExit: supportExitRoute, plantLogo: plantLogoRoute },
  };
}

export type ModuleKit = ReturnType<typeof createModule>;
