// The platform's server errors go to its error log (STABILITY_PLAN B-09): onRequestError is called for every error
// Next catches itself (screens, server actions, the proxy, routes outside handle()).
import type { Instrumentation } from "next";

const KIND = { render: "page", action: "action", proxy: "proxy", route: "api" } as const;

export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { logPlatformError } = await import("@/server/errors");
  const headers = new Headers();
  for (const [k, v] of Object.entries(request.headers)) if (v !== undefined) headers.set(k, Array.isArray(v) ? v.join(", ") : v);
  await logPlatformError(err, new Request(new URL(request.path, "http://platform.local"), { method: request.method, headers }), KIND[context.routeType] ?? "api");
};
