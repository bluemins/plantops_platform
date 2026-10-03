// DEVELOPMENT-ONLY placeholder for module apps (Lab Records, Floor Stock, ...), until the real modules are
// built in Phase 3+. It does exactly what every real module must do on the platform side, using the shared
// helpers in packages/auth:
//   no session          -> send the user to the platform: /sso/start?module=<id>&next=<path>
//   /sso/callback?code  -> startModuleSession (exchange code, verify token, check access) -> session cookie
//   every request       -> refreshModuleSession (12 h shift, 5-minute re-check with the platform)
//   /api/plantops/summary -> tile numbers for the launcher (verifySummaryRequest)
//   plant look          -> fetchBranding + brandPalette (plant name, brand colour, logo)
// One process serves every module that has MODULE_URL_<ID> (localhost) + MODULE_SECRET_<ID> in .env,
// each on the port from its URL. Never deploy this.
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import path from "node:path";
import {
  fetchBranding,
  fetchLogo,
  openSession,
  refreshModuleSession,
  sealSession,
  SESSION_HOURS,
  startModuleSession,
  verifySummaryRequest,
  type ModuleCredentials,
  type ModuleSession,
} from "@plantops/auth";
import { MODULE_IDS, type ModuleId, type TenantBranding } from "@plantops/types";
import { brandPalette } from "@plantops/ui/brand";

const rootEnv = path.resolve(import.meta.dirname, "../../../.env");
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);
const platformUrl = process.env.PLATFORM_URL ?? "http://localhost:3000";

const LABELS: Record<ModuleId, string> = {
  lab_records: "Lab Records",
  floor_stock: "Floor Stock",
  preventive_mgmt: "Preventive Mgmt",
  amc: "AMC",
  attendance_salary: "Attendance & Salary",
  marketing_contacts: "Marketing Contacts",
};

const esc = (s: unknown) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

function page(res: ServerResponse, status: number, title: string, body: string, opts: { color?: string | null; headers?: Record<string, string> } = {}) {
  const p = brandPalette(opts.color);
  res.writeHead(status, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", ...opts.headers });
  res.end(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><style>
body{font-family:system-ui,sans-serif;background:#f4f6fb;color:#0f172a;margin:0;padding:24px 16px}
.card{max-width:520px;margin:0 auto;background:#fff;border:1px solid #e2e8f0;border-radius:16px;padding:20px}
.top{display:flex;align-items:center;gap:10px;margin-bottom:8px}.top img{height:40px;width:40px;object-fit:contain;border-radius:50%;border:1px solid #e2e8f0}
.tag{display:inline-block;background:#fef3c7;color:#92400e;border-radius:8px;padding:2px 8px;font-size:13px}
h1{color:${p.brand}}
a.btn{display:inline-block;margin:12px 8px 0 0;padding:12px 18px;border-radius:12px;background:${p.brand};color:${p.contrast};text-decoration:none;font-weight:600}
a.btn.secondary{background:#fff;color:#0f172a;border:1px solid #cbd5e1}
dt{font-weight:600;margin-top:8px}dd{margin:0;color:#334155;word-break:break-all}
</style></head><body><div class="card">${body}</div></body></html>`);
}

function getCookie(req: IncomingMessage, name: string) {
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return undefined;
}

/** Only paths inside this module (same rule as the platform's safeNext). */
const safeNext = (v: string | null) => (v && v.startsWith("/") && !v.startsWith("//") && !/[\\\s]/.test(v) && v.length <= 500 ? v : "/");

function serveModule(moduleId: ModuleId, creds: ModuleCredentials) {
  const label = LABELS[moduleId];
  const cookieName = `plantops_${moduleId}`; // modules on the same host must not share a cookie
  const keys = { jwksUrl: new URL("/.well-known/jwks.json", platformUrl).toString() };
  // A real module has its own random SESSION_SECRET; the placeholder derives one from its client secret.
  const sessionOpts = { secret: createHash("sha256").update(`dev-session:${creds.clientSecret}`).digest("hex"), moduleId };
  const banner = `<p class="tag">Placeholder module (development only)</p>`;
  const account = new URL("/home?launcher=1", platformUrl).toString();
  const brandCache = new Map<string, { at: number; value: TenantBranding }>();

  async function branding(tenantId: string) {
    const hit = brandCache.get(tenantId);
    if (hit && Date.now() - hit.at < 60_000) return hit.value;
    const value = await fetchBranding(creds, tenantId).catch(() => null);
    if (value) brandCache.set(tenantId, { at: Date.now(), value });
    return value;
  }

  const setCookie = async (s: ModuleSession) =>
    `${cookieName}=${encodeURIComponent(await sealSession(s, sessionOpts))}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_HOURS * 3600}`;
  const clearCookie = `${cookieName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
  const toPlatformLogin = (next: string) =>
    new URL(`/sso/start?module=${moduleId}&next=${encodeURIComponent(next)}`, platformUrl).toString();

  return async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    try {
      if (url.pathname === "/health") {
        res.writeHead(200, { "content-type": "application/json" });
        return res.end(JSON.stringify({ ok: true, module: moduleId }));
      }

      // Launcher tile numbers. Only the platform can call this (60-second signed request).
      if (url.pathname === "/api/plantops/summary") {
        const ask = await verifySummaryRequest(req.headers.authorization, { audience: moduleId, keys }).catch(() => null);
        if (!ask) {
          res.writeHead(401, { "content-type": "application/json" });
          return res.end(JSON.stringify({ error: "Not a valid platform request" }));
        }
        const badges =
          ask.view === "owner"
            ? [{ text: "Placeholder · 0 held today", tone: "warn" }]
            : [{ text: "Placeholder · 0 pending", tone: "info" }];
        res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
        return res.end(JSON.stringify({ badges }));
      }

      if (url.pathname === "/sso/callback") {
        const code = url.searchParams.get("code");
        if (!code) return page(res, 400, label, `${banner}<h1>${esc(label)}</h1><p>Missing code.</p>`);
        const session = await startModuleSession(creds, code, keys).catch((err: Error) => err);
        if (session instanceof Error) {
          return page(res, 403, label, `${banner}<h1>${esc(label)}</h1><p>Could not log you in: ${esc(session.message)}</p>
            <a class="btn" href="${esc(account)}">Back to PlantOps</a>`);
        }
        res.writeHead(302, { location: safeNext(url.searchParams.get("next")), "set-cookie": await setCookie(session) });
        return res.end();
      }

      if (url.pathname === "/logout") {
        res.writeHead(302, { location: account, "set-cookie": clearCookie });
        return res.end();
      }

      if (url.pathname === "/plant-logo") {
        const s = await openSession(getCookie(req, cookieName), sessionOpts);
        const b = s && (await branding(s.tenant_id));
        const logo = b?.logo_url ? await fetchLogo(creds, b.logo_url).catch(() => null) : null;
        if (!logo) {
          res.writeHead(404);
          return res.end();
        }
        res.writeHead(200, { "content-type": logo.type, "x-content-type-options": "nosniff", "cache-control": "private, max-age=300" });
        return res.end(Buffer.from(logo.data));
      }

      // Every other page needs a session. None (or the shift is over, or the user was disabled) -> platform.
      const opened = await openSession(getCookie(req, cookieName), sessionOpts);
      const refreshed = opened && (await refreshModuleSession(creds, opened));
      if (!refreshed) {
        res.writeHead(302, { location: toPlatformLogin(url.pathname + url.search), "set-cookie": clearCookie });
        return res.end();
      }
      const headers: Record<string, string> = refreshed.changed ? { "set-cookie": await setCookie(refreshed.session) } : {};
      const s = refreshed.session;
      const b = await branding(s.tenant_id);

      if (url.pathname !== "/") return page(res, 404, label, `${banner}<h1>${esc(label)}</h1><p>Not found.</p>`, { color: b?.brand_color, headers });

      const mode = s.roles.includes("tenant_admin") ? "Read-only summary (owner)" : "Data entry (staff)";
      const minutes = (ms: number) => `${Math.round(ms / 60_000)} min`;
      return page(
        res,
        200,
        label,
        `${banner}<div class="top">${b?.logo_url ? `<img src="/plant-logo" alt="">` : ""}<strong>${esc(b?.name ?? "")}</strong></div>
         <h1>${esc(label)}</h1><p>✅ Logged in through PlantOps.</p><dl>
           <dt>Access</dt><dd>${esc(mode)}</dd>
           <dt>Roles</dt><dd>${esc(s.roles.join(", "))}</dd>
           <dt>Plant brand colour</dt><dd>${esc(b?.brand_color ?? "not set (PlantOps blue)")}</dd>
           <dt>Session</dt><dd>logged in ${minutes(Date.now() - s.login_at)} ago · last checked with PlantOps ${minutes(Date.now() - s.checked_at)} ago
             (re-check every 5 min, ends after 12 h)</dd>
           <dt>Plant (tenant_id)</dt><dd>${esc(s.tenant_id)}</dd>
           <dt>User (user_id)</dt><dd>${esc(s.user_id)}</dd>
         </dl>
         <a class="btn" href="${esc(account)}">Account / PlantOps home</a>
         <a class="btn secondary" href="/logout">Log out of ${esc(label)}</a>`,
        { color: b?.brand_color, headers },
      );
    } catch (err) {
      page(res, 500, label, `${banner}<h1>${esc(label)}</h1><p>Something went wrong: ${esc((err as Error).message)}</p>
        <a class="btn" href="${esc(account)}">Back to PlantOps</a>`);
    }
  };
}

let started = 0;
for (const id of MODULE_IDS) {
  const key = id.toUpperCase();
  const moduleUrl = process.env[`MODULE_URL_${key}`];
  const secret = process.env[`MODULE_SECRET_${key}`];
  if (!moduleUrl || !secret) continue;
  const u = new URL(moduleUrl);
  const port = Number(u.port || 80);
  // Listen on all interfaces so phones on the same Wi-Fi can reach it (pnpm dev:lan); still dev-only.
  createServer(serveModule(id, { platformUrl, moduleId: id, clientSecret: secret })).listen(port, "0.0.0.0", () =>
    console.log(`[dev-module] ${LABELS[id]} placeholder on ${moduleUrl}`),
  );
  started++;
}
if (!started) console.log("[dev-module] No modules configured (set MODULE_URL_<ID> + MODULE_SECRET_<ID> in .env)");
