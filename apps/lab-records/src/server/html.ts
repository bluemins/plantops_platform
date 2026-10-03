// A tiny plain page for the few moments there is no app screen yet (e.g. a failed login handoff).
import { accountUrl, MODULE_LABEL } from "./platform";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export function messagePage(status: number, message: string) {
  const body = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${MODULE_LABEL}</title><style>body{font-family:system-ui,sans-serif;background:#f4f6fb;color:#0f172a;margin:0;padding:24px 16px}
.card{max-width:480px;margin:0 auto;background:#fff;border:1px solid #e2e8f0;border-radius:16px;padding:20px}
a{display:inline-block;margin-top:12px;padding:12px 18px;border-radius:12px;background:#1d4ed8;color:#fff;text-decoration:none;font-weight:600}</style></head>
<body><div class="card"><h1>${MODULE_LABEL}</h1><p>${esc(message)}</p><a href="${esc(accountUrl())}">Back to PlantOps</a></div></body></html>`;
  return new Response(body, { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}
