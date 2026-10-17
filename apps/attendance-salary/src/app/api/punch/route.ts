import { after } from "next/server";
import { handle, json, readJson } from "@/server/http";
import { kit } from "@/server/kit";
import { MarkRefused, punch, PunchInput } from "@/server/marks";
import { sendScanAlert } from "@/server/notify";
import { requireApiUser } from "@/server/session";

/** Mark IN / OUT from the scanned QR. A refusal answers its plain message plus a `code` for the scan screen. */
export const POST = handle(async (req) => {
  const user = await requireApiUser();
  const input = await readJson(req, PunchInput);
  try {
    const saved = await punch(user, input);
    // the supervisors' bell ("Bindu IN 08:02"), after the answer; never for a refused scan
    after(() => sendScanAlert(user.tenantId, { id: saved.id, kind: saved.kind, at: new Date(saved.at), personId: user.userId, personName: user.name }, user, false));
    return json(saved, { status: 201 });
  } catch (err) {
    if (err instanceof MarkRefused) {
      const notice = err.notice;
      if (notice) after(() => kit.notify(user.tenantId, notice)); // the owners' "outside" bell, after the answer
      return json({ error: err.message, code: err.code, ...err.extra }, { status: err.status });
    }
    throw err;
  }
});
