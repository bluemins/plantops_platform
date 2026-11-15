import { after } from "next/server";
import { uploadFieldPhoto } from "@/server/field";
import { handleUpload, json, uuidParam } from "@/server/http";
import { kit } from "@/server/kit";
import { storageNotification, storageStepCrossed } from "@/server/notify";
import { requireApiUser } from "@/server/session";
import { MAX_PHOTO_BYTES } from "@/server/storage";

/** A meter photo (raw body, shrunk on the phone) before its start / end; `?for=<person>` = the owner correcting someone's. */
export const POST = handleUpload(MAX_PHOTO_BYTES, async (req, body) => {
  const user = await requireApiUser();
  const forId = new URL(req.url).searchParams.get("for");
  const f = await uploadFieldPhoto(user, body, { personId: forId ? uuidParam(forId) : null });
  // owners are warned when this upload takes the plant past 80% / 95% of its plan's storage
  const step = f.storage ? storageStepCrossed(f.storage.before, f.storage.after, f.storage.limit) : null;
  if (step && f.storage) {
    const { after: used, limit } = f.storage;
    after(() => kit.notify(user.tenantId, storageNotification(step, used, limit)));
  }
  return json({ id: f.id, size: f.size }, { status: 201 });
});
