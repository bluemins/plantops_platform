"use client";

// Turning phone notifications on / off in the browser (Web Push). The service worker (public/sw.js) shows them.
import { api } from "./api";

/**
 * on / off: normal. needs-install: iPhone in Safari (only an app added to the Home Screen gets notifications).
 * blocked: the person refused once; only the phone's settings can undo it. unavailable: old browser, or the
 * server has no push keys yet - the card is simply not shown.
 */
export type PushState = "on" | "off" | "needs-install" | "blocked" | "unavailable";

const isIos = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const isInstalled = () => window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;

function keyBytes(base64url: string) {
  const b64 = (base64url + "=".repeat((4 - (base64url.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}
function sameKey(a: ArrayBuffer | null | undefined, b: Uint8Array) {
  if (!a) return false;
  const x = new Uint8Array(a);
  return x.length === b.length && x.every((v, i) => v === b[i]);
}

async function registration() {
  return navigator.serviceWorker.register("/sw.js");
}

export async function pushState(): Promise<{ state: PushState; publicKey: string | null }> {
  try {
    if (!("serviceWorker" in navigator)) return { state: "unavailable", publicKey: null };
    if (!("PushManager" in window) || !("Notification" in window)) {
      return { state: isIos() && !isInstalled() ? "needs-install" : "unavailable", publicKey: null };
    }
    const reg = await registration();
    const sub = await reg.pushManager.getSubscription();
    const r = await api<{ public_key: string | null; subscribed: boolean }>(`/api/push${sub ? `?endpoint=${encodeURIComponent(sub.endpoint)}` : ""}`);
    const publicKey = r.ok ? r.data.public_key : null;
    if (!publicKey) return { state: "unavailable", publicKey: null };
    if (Notification.permission === "denied") return { state: "blocked", publicKey };
    return { state: sub && r.data.subscribed && Notification.permission === "granted" ? "on" : "off", publicKey };
  } catch {
    return { state: "unavailable", publicKey: null };
  }
}

/** Must run from a tap (phones only ask for permission then). */
export async function turnOn(publicKey: string): Promise<PushState> {
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return permission === "denied" ? "blocked" : "off";
  const reg = await registration();
  const key = keyBytes(publicKey);
  let sub = await reg.pushManager.getSubscription();
  // made with an older key pair (keys were changed): it can't be reused
  if (sub && !sameKey(sub.options.applicationServerKey, key)) {
    await sub.unsubscribe();
    sub = null;
  }
  sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  const r = await api("/api/push", { body: sub.toJSON() });
  return r.ok ? "on" : "off";
}

/** This phone stops getting this person's notifications (turn off, and before logout on a shared phone). */
export async function turnOff() {
  try {
    if (!("serviceWorker" in navigator)) return;
    const reg = await navigator.serviceWorker.getRegistration("/");
    const sub = await reg?.pushManager.getSubscription();
    if (!sub) return;
    await api("/api/push", { method: "DELETE", body: { endpoint: sub.endpoint } });
    await sub.unsubscribe();
  } catch {
    // never block a logout
  }
}

export type TestResult = "sent" | "gone" | "failed" | "not_set_up" | "not_found" | "error";

/** "Send a test to this phone": asks the server to push one message to this device only. */
export async function sendTest(): Promise<TestResult> {
  try {
    const reg = await navigator.serviceWorker.getRegistration("/");
    const sub = await reg?.pushManager.getSubscription();
    if (!sub) return "not_found";
    const r = await api<{ result: TestResult }>("/api/push/test", { body: { endpoint: sub.endpoint } });
    return r.ok ? r.data.result : "error";
  } catch {
    return "error";
  }
}
