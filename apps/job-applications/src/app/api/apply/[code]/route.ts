import { after } from "next/server";
import { clientIp, HttpError, json, readBody } from "@/server/http";
import { MAX_BODY_BYTES } from "@/lib/apply";
import { StorageFull, submitApplication } from "@/server/apply";
import { env } from "@/server/env";
import { kit } from "@/server/kit";
import { newApplicationNotification, ownerIds, storageNotification, storageStepCrossed } from "@/server/notify";
import { PlatformUnavailable, resolvePublicPlant } from "@/server/public";

type Ctx = { params: Promise<{ code: string }> };

/** Only a page of this app may send: the browser's Origin must be our own address (public address or this host). */
function sameOrigin(req: Request) {
  const origin = req.headers.get("origin");
  if (!origin) return false;
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? new URL(req.url).host;
  const proto = req.headers.get("x-forwarded-proto") ?? new URL(req.url).protocol.replace(":", "");
  const ours = [env.publicUrl ? new URL(env.publicUrl).origin : null, host ? `${proto}://${host}` : null].filter(Boolean);
  return ours.includes(origin);
}

/**
 * The public form's send (no login, no cookies): one multipart request with the fields and the resume. The plant
 * comes from the address only. Every rule is in src/server/apply.ts.
 */
export async function POST(req: Request, ctx: Ctx) {
  try {
    if (!sameOrigin(req)) throw new HttpError(403, "Please send the form from the job page.");
    const type = (req.headers.get("content-type") ?? "").toLowerCase();
    if (!type.startsWith("multipart/form-data")) throw new HttpError(415, "Please send the form from the job page.");
    const tooBig = "The files are too big. Send one PDF up to 5 MB, or up to 3 photos.";
    if (Number(req.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) throw new HttpError(413, tooBig);

    const plant = await resolvePublicPlant((await ctx.params).code);
    if (!plant) throw new HttpError(404, "This page is not available");

    const body = await readBody(req, MAX_BODY_BYTES, tooBig);
    let form: FormData;
    try {
      form = await new Response(new Uint8Array(body), { headers: { "content-type": req.headers.get("content-type")! } }).formData();
    } catch {
      throw new HttpError(400, "Please send the form from the job page.");
    }
    const fields: Record<string, string> = {};
    for (const [k, v] of form.entries()) if (typeof v === "string" && k !== "resume") fields[k] = v.slice(0, 2000);
    const parts = form.getAll("resume").filter((v): v is File => typeof v !== "string");
    if (parts.length > 3) throw new HttpError(400, "At most 3 photos.");
    const files = await Promise.all(parts.map(async (p) => Buffer.from(await p.arrayBuffer())));

    const sent = await submitApplication(plant, { fields, files, ip: clientIp(req) });

    // after the answer: never blocks the applicant, never throws (kit.notify keeps it for the daily job if needed)
    after(async () => {
      if (sent.saved) await kit.notify(plant.tenantId, newApplicationNotification(sent.saved));
      const step = sent.storage && storageStepCrossed(sent.storage.before, sent.storage.after, sent.storage.limit);
      if (sent.storage && step) await kit.notify(plant.tenantId, storageNotification(step, sent.storage.after, sent.storage.limit, await ownerIds(plant.tenantId)));
    });
    return json({ ref: sent.ref, name: sent.name, phone: sent.phone }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    if (err instanceof StorageFull) {
      const { used, limit } = err;
      const plant = await resolvePublicPlant((await ctx.params).code).catch(() => null);
      if (plant) after(async () => void (await kit.notify(plant.tenantId, storageNotification("full", used, limit, await ownerIds(plant.tenantId)))));
    }
    if (err instanceof PlatformUnavailable) return json({ error: "Please try again in a few minutes." }, { status: 503 });
    if (err instanceof HttpError) return json({ error: err.message }, { status: err.status });
    console.error("[job_applications] apply failed:", err);
    return json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
}
