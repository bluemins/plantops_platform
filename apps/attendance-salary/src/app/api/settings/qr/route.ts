import { handle, json } from "@/server/http";
import { requireApiUser } from "@/server/session";
import { newQr } from "@/server/settings";

/** Owner: make a new QR. Every old print stops at once. */
export const POST = handle(async () => json(await newQr(await requireApiUser())));
