// DEVELOPMENT-ONLY placeholder for module apps (Lab Records, Floor Stock, ...), until the real modules are
// built in Phase 3+. It does exactly what every real module must do on the SSO side:
//   /sso/callback?code=...  -> exchange the one-time code with the platform (server-to-server, module secret)
//                           -> verify the token with the platform's public key -> check module access
//                           -> start its own session (cookie) -> show who is logged in
// One process serves every module that has MODULE_URL_<ID> (localhost) + MODULE_SECRET_<ID> in .env,
// each on the port from its URL. Never deploy this.
import { existsSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import path from "node:path";
import { canAccessModule, exchangeCode, fetchUserStatus, verifyToken, type ModuleCredentials } from "@plantops/auth";
import { MODULE_IDS, type ModuleId, type TokenPayload } from "@plantops/types";

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

function page(res: ServerResponse, status: number, title: string, body: string, headers: Record<string, string> = {}) {
  res.writeHead(status, { "content-type": "text/html; charset=utf-8", ...headers });
  res.end(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><style>
body{font-family:system-ui,sans-serif;background:#f4f6fb;color:#0f172a;margin:0;padding:24px 16px}
.card{max-width:520px;margin:0 auto;background:#fff;border:1px solid #e2e8f0;border-radius:16px;padding:20px}
.tag{display:inline-block;background:#fef3c7;color:#92400e;border-radius:8px;padding:2px 8px;font-size:13px}
a.btn{display:inline-block;margin-top:12px;padding:12px 18px;border-radius:12px;background:#1d4ed8;color:#fff;text-decoration:none;font-weight:600}
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

function serveModule(moduleId: ModuleId, creds: ModuleCredentials) {
  const label = LABELS[moduleId];
  const cookieName = `plantops_${moduleId}`; // modules on the same host must not share a cookie
  const keys = { jwksUrl: new URL("/.well-known/jwks.json", platformUrl).toString() };
  const banner = `<p class="tag">Placeholder module (development only)</p><h1>${esc(label)}</h1>`;

  return async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    try {
      if (url.pathname === "/health") {
        res.writeHead(200, { "content-type": "application/json" });
        return res.end(JSON.stringify({ ok: true, module: moduleId }));
      }

      if (url.pathname === "/sso/callback") {
        const code = url.searchParams.get("code");
        if (!code) return page(res, 400, label, `${banner}<p>Missing code.</p>`);
        const token = await exchangeCode(creds, code); // fails for used/expired/foreign codes
        const payload = await verifyToken(token, { audience: moduleId, keys });
        if (!canAccessModule(payload.roles, payload.enabled_modules, moduleId)) {
          return page(res, 403, label, `${banner}<p>You don't have access to this module.</p>`);
        }
        const cookie = `${cookieName}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${15 * 60}`;
        res.writeHead(302, { location: "/", "set-cookie": cookie });
        return res.end();
      }

      if (url.pathname === "/logout") {
        res.writeHead(302, { location: "/", "set-cookie": `${cookieName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0` });
        return res.end();
      }

      if (url.pathname === "/") {
        const token = getCookie(req, cookieName);
        let payload: TokenPayload | null = null;
        if (token) payload = await verifyToken(token, { audience: moduleId, keys }).catch(() => null);
        if (!payload) {
          return page(
            res,
            200,
            label,
            `${banner}<p>You are not logged in to ${esc(label)}.</p>
             <p>Open it from PlantOps after logging in. (Opening this link directly and being sent through the
             PlantOps login automatically is part of Phase 2.)</p>
             <a class="btn" href="${esc(new URL("/login", platformUrl))}">Go to PlantOps login</a>`,
          );
        }
        // A real module re-checks this every few minutes; the placeholder does it on every page load.
        const status = await fetchUserStatus(creds, payload.tenant_id, payload.user_id);
        const mode = payload.roles.includes("tenant_admin") ? "Read-only summary (owner)" : "Data entry (staff)";
        return page(
          res,
          200,
          label,
          `${banner}<p>✅ Logged in through PlantOps SSO.</p><dl>
             <dt>Access</dt><dd>${esc(mode)}</dd>
             <dt>Roles</dt><dd>${esc(payload.roles.join(", "))}</dd>
             <dt>Plant (tenant_id)</dt><dd>${esc(payload.tenant_id)}</dd>
             <dt>User (user_id)</dt><dd>${esc(payload.user_id)}</dd>
             <dt>Enabled modules</dt><dd>${esc(payload.enabled_modules.join(", "))}</dd>
             <dt>Token valid until</dt><dd>${esc(new Date(payload.exp * 1000).toLocaleTimeString())}</dd>
             <dt>Live status from platform</dt><dd>${status.active ? "active" : "DISABLED"}, roles: ${esc(status.roles.join(", "))}</dd>
           </dl>
           <a class="btn" href="${esc(new URL("/home", platformUrl))}">Back to PlantOps</a>
           <a class="btn" style="background:#475569" href="/logout">Log out of ${esc(label)}</a>`,
        );
      }

      page(res, 404, label, `${banner}<p>Not found.</p>`);
    } catch (err) {
      page(
        res,
        401,
        label,
        `${banner}<p>Login to ${esc(label)} failed: ${esc((err as Error).message)}</p>
         <a class="btn" href="${esc(new URL("/home", platformUrl))}">Back to PlantOps</a>`,
      );
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
  if (!["localhost", "127.0.0.1"].includes(u.hostname)) continue;
  const port = Number(u.port || 80);
  createServer(serveModule(id, { platformUrl, moduleId: id, clientSecret: secret })).listen(port, () =>
    console.log(`[dev-module] ${LABELS[id]} placeholder on ${moduleUrl}`),
  );
  started++;
}
if (!started) console.log("[dev-module] No modules configured (set MODULE_URL_<ID> + MODULE_SECRET_<ID> in .env)");
