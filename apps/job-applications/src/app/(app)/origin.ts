import { headers } from "next/headers";

/** The address this page was opened on (for the public link when MODULE_URL_JOB_APPLICATIONS isn't set). */
export async function requestOrigin() {
  const h = await headers();
  return `${h.get("x-forwarded-proto") ?? "http"}://${h.get("x-forwarded-host") ?? h.get("host")}`;
}
