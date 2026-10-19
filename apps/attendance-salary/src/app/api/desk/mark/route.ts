import { DeskInput, deskMark } from "@/server/desk";
import { handle, json, readJson } from "@/server/http";
import { MarkRefused } from "@/server/marks";
import { sendScanAlert } from "@/server/notify";
import { requireApiUser } from "@/server/session";
import { after } from "next/server";

/** Office staff (a Supervisor: Office staff only): "Mark for someone" (IN / OUT now from the office phone). A refusal answers its message and a `code`. */
export const POST = handle(async (req) => {
  const user = await requireApiUser();
  const input = await readJson(req, DeskInput);
  try {
    const { person, ...saved } = await deskMark(user, input);
    // the supervisors' bell ("Bindu IN 08:02 · by Ramesh"), after the answer
    after(() => sendScanAlert(user.tenantId, { id: saved.id, kind: saved.kind, at: new Date(saved.at), personId: person.userId, personName: person.name }, user, true));
    return json({ ...saved, name: person.name }, { status: 201 });
  } catch (err) {
    if (err instanceof MarkRefused) return json({ error: err.message, code: err.code, ...err.extra }, { status: err.status });
    throw err;
  }
});
