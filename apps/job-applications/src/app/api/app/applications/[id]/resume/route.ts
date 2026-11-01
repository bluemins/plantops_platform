import { after } from "next/server";
import { MAX_FILE_BYTES } from "@/lib/apply";
import { addResumePage } from "@/server/add";
import { handleUpload, json } from "@/server/http";
import { kit } from "@/server/kit";
import { ownerIds, storageNotification, storageStepCrossed } from "@/server/notify";
import { requireApiUser } from "@/server/session";

type Ctx = { params: Promise<{ id: string }> };

/** One resume page (the file itself as the body: a PDF or one photo), owner and HR desk. */
export const POST = handleUpload(MAX_FILE_BYTES, async (_req, body, ctx: Ctx) => {
  const user = await requireApiUser();
  const added = await addResumePage(user, (await ctx.params).id, body);
  const s = added.storage;
  const step = s && storageStepCrossed(s.before, s.after, s.limit);
  if (s && step) after(async () => void (await kit.notify(user.tenantId, storageNotification(step, s.after, s.limit, await ownerIds(user.tenantId)))));
  return json({ pageNo: added.pageNo }, { status: 201 });
});
