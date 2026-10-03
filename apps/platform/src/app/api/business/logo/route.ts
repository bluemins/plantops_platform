import { requireUser } from "@/server/auth";
import { getOwnLogo, logoResponse } from "@/server/business";
import { handle } from "@/server/http";

/** The logged-in user's own plant logo. */
export const GET = handle(async (req) => logoResponse(await getOwnLogo(await requireUser(req))));
