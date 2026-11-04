import { after } from "next/server";
import { BotError, checkPlant } from "@/server/bot";
import { authenticateCall, CallInput, callError, limitKey, recordCall } from "@/server/calls";
import { readBody } from "@/server/http";
import { sendCallAlert } from "@/server/notify";

const BODY_MAX = 1024;

/**
 * The order phone (MacroDroid): one incoming or missed call, `{ phone, event }`, with `Authorization: Bearer occ_…`.
 * 201 recorded; 200 for a repeat send or a "Not an order number" (so the phone stops retrying). "Customer called"
 * goes to Delivery staff after the answer.
 */
export async function POST(req: Request) {
  try {
    const key = authenticateCall(req);
    limitKey(key);
    if (!(req.headers.get("content-type") ?? "").startsWith("application/json")) throw new BotError(400, "bad_request", "Expected a JSON request");
    let body: unknown;
    try {
      body = JSON.parse((await readBody(req, BODY_MAX, "too big")).toString("utf8"));
    } catch {
      throw new BotError(400, "bad_request", "The body must be JSON of at most 1 KB");
    }
    const input = CallInput.safeParse(body);
    if (!input.success) {
      const issue = input.error.issues[0];
      throw new BotError(400, "bad_request", issue ? `${issue.path.join(".") || "body"}: ${issue.message}` : "Invalid request");
    }
    await checkPlant(key);
    const result = await recordCall(key, input.data);
    if (result.status === 201 && result.alert) {
      const alert = result.alert;
      after(() => sendCallAlert(key.tenant_id, alert));
    }
    return Response.json(result.body, { status: result.status });
  } catch (err) {
    return callError(err);
  }
}
