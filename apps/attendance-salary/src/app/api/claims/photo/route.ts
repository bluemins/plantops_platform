import { after } from "next/server";
import { uploadClaimPhoto } from "@/server/claims";
import { handleUpload, json, uuidParam } from "@/server/http";
import { kit } from "@/server/kit";
import { storageNotification, storageStepCrossed } from "@/server/notify";
import { requireApiUser } from "@/server/session";
import { MAX_PHOTO_BYTES } from "@/server/storage";

/** One bill photo for an expense claim (?claim=<id>): the raw photo as the body, already shrunk on the phone. */
export const POST = handleUpload(MAX_PHOTO_BYTES, async (req, body) => {
  const user = await requireApiUser();
  const claimId = uuidParam(new URL(req.url).searchParams.get("claim") ?? "");
  const f = await uploadClaimPhoto(user, claimId, body);
  // owners are warned when this upload takes the plant past 80% / 95% of its plan's storage
  const step = f.storage ? storageStepCrossed(f.storage.before, f.storage.after, f.storage.limit) : null;
  if (step && f.storage) {
    const { after: used, limit } = f.storage;
    after(() => kit.notify(user.tenantId, storageNotification(step, used, limit)));
  }
  return json({ id: f.id, size: f.size }, { status: 201 });
});
