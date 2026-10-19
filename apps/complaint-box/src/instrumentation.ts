// Server errors go to the platform's error log (STABILITY_PLAN B-09). Next calls register() once at server start
// (importing the kit registers its error sender) and onRequestError() for every error it catches itself.
import type { Instrumentation } from "next";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") await import("@/server/kit");
}

export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { kit } = await import("@/server/kit");
  await kit.onRequestError(err, request, context);
};
