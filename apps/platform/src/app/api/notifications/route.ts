import { requireUser } from "@/server/auth";
import { handle, json } from "@/server/http";
import { listFor } from "@/server/notifications";

/** The logged-in user's own notifications (newest 30) and unread count, for the launcher bell. */
export const GET = handle(async (req) => json(await listFor(await requireUser(req))));
