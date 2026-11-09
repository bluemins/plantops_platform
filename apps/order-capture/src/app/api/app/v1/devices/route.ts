import { dropBody, dropJson, dropLimit, dropRoute } from "@/server/drop/api";
import { DeviceInput, registerDevice } from "@/server/drop/push";
import { appSession } from "@/server/drop/session";
import { clientIp } from "@/server/http";

/** Drop: this phone's push token for this login (sent after login and whenever Firebase gives a new one). */
export const POST = dropRoute(async (req) => {
  dropLimit(`drop-device-ip:${clientIp(req)}`, 30, 60_000);
  const s = await appSession(req);
  dropLimit(`drop-device:${s.sessionId}`, 5, 60_000);
  return dropJson(await registerDevice(s, await dropBody(req, DeviceInput)));
});
