// Push notifications on the phone (docs/CUSTOMER_APP_PHASE_PLAN.md Phase 6): after login the app asks once to allow
// notifications, signs this phone up with Sales (POST /api/app/v1/devices: the Firebase token for this login), and a
// tapped push opens its tab. Logout ends the login on the server, which stops its pushes. Only on the phone.
import { Capacitor } from "@capacitor/core";
import { PushNotifications } from "@capacitor/push-notifications";
import { call } from "./api";

export type PushTab = "home" | "points" | "polls";
const TABS: PushTab[] = ["home", "points", "polls"];

/** Starts pushes for this login; returns a stop function (listeners removed). Never throws. */
export function startPush(token: string, openTab: (tab: PushTab) => void): () => void {
  if (!Capacitor.isNativePlatform()) return () => {};
  const handles: Promise<{ remove: () => Promise<void> }>[] = [];
  let stopped = false;
  void (async () => {
    try {
      handles.push(
        PushNotifications.addListener("registration", (t) => {
          if (!stopped) void call("/api/app/v1/devices", { token, body: { token: t.value } });
        }),
        PushNotifications.addListener("pushNotificationActionPerformed", (a) => {
          const tab = (a.notification.data as { tab?: string } | undefined)?.tab;
          if (TABS.includes(tab as PushTab)) openTab(tab as PushTab);
        }),
      );
      await PushNotifications.createChannel({ id: "drop", name: "Orders, polls and points", importance: 4, visibility: 1 }).catch(() => {});
      let perm = await PushNotifications.checkPermissions();
      if (perm.receive === "prompt" || perm.receive === "prompt-with-rationale") perm = await PushNotifications.requestPermissions();
      if (perm.receive === "granted" && !stopped) await PushNotifications.register();
    } catch {
      /* no Google Play services or no google-services.json in this build: the app works without pushes */
    }
  })();
  return () => {
    stopped = true;
    for (const h of handles) void h.then((x) => x.remove());
  };
}
