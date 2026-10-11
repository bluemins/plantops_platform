import { after } from "next/server";
import { handleUpload, json, uuidParam } from "@/server/http";
import { uploadComplaintFile } from "@/server/files";
import { kit } from "@/server/kit";
import { storageNotification, storageStepCrossed } from "@/server/notify";
import { requireApiUser } from "@/server/session";
import { MAX_VIDEO_BYTES } from "@/server/storage";

type Ctx = { params: Promise<{ id: string }> };

/** Add one photo or video to a saved complaint (or, with ?note=<id>, a photo to one of its notes): the raw file as the body. */
export const POST = handleUpload(MAX_VIDEO_BYTES, async (req, body, ctx: Ctx) => {
  const user = await requireApiUser();
  const note = new URL(req.url).searchParams.get("note");
  const f = await uploadComplaintFile(user, uuidParam((await ctx.params).id), body, { noteId: note ? uuidParam(note) : undefined });
  // owners are warned when this upload takes the plant past 80% / 95% of its plan's storage
  const step = f.storage && storageStepCrossed(f.storage.before, f.storage.after, f.storage.limit);
  if (step && f.storage) {
    const { after: used, limit } = f.storage;
    after(() => kit.notify(user.tenantId, storageNotification(step, used, limit)));
  }
  return json({ id: f.id, kind: f.kind, size: f.size }, { status: 201 });
});
