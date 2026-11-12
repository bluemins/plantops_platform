// The PlantOps staff app for Android (apps/staff-app, owner 2026-11-11) is a Trusted Web Activity: Android shows
// PlantOps full screen (no address bar) only on addresses that name the app here. Every app (platform + each module)
// serves this at /.well-known/assetlinks.json, outside the login gate. The fingerprint is public, not a secret.
//   STAFF_APP_PACKAGE  the app's package id (default life.bluemins.plantops)
//   STAFF_APP_SHA256   its signing-key SHA-256 fingerprint(s), comma-separated (e.g. our key + Play's key later)
// Not set = 404, as before the app existed.

export const STAFF_APP_DEFAULT_PACKAGE = "life.bluemins.plantops";
const FINGERPRINT = /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/;

/** The fingerprints from STAFF_APP_SHA256 (upper case, colon form), or an error naming the bad one. */
export function staffAppFingerprints(value: string | undefined): { ok: string[] } | { error: string } {
  const list = (value ?? "").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
  const bad = list.find((f) => !FINGERPRINT.test(f));
  return bad ? { error: `STAFF_APP_SHA256: "${bad}" is not a SHA-256 fingerprint (32 pairs like AB:CD:…)` } : { ok: list };
}

/** The answer for GET /.well-known/assetlinks.json. */
export function assetLinksResponse(env: Record<string, string | undefined> = process.env): Response {
  const fp = staffAppFingerprints(env.STAFF_APP_SHA256);
  if ("error" in fp) console.error(fp.error);
  const fingerprints = "ok" in fp ? fp.ok : [];
  if (fingerprints.length === 0) return new Response("Not found", { status: 404 });
  const body = [
    {
      relation: ["delegate_permission/common.handle_all_urls"],
      target: {
        namespace: "android_app",
        package_name: env.STAFF_APP_PACKAGE?.trim() || STAFF_APP_DEFAULT_PACKAGE,
        sha256_cert_fingerprints: fingerprints,
      },
    },
  ];
  return Response.json(body, { headers: { "cache-control": "public, max-age=3600" } });
}
