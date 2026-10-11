"use client";

// The launcher bell (unread count + list) and the "Get alerts on this phone" card. Mockups: docs/notifications.md.
import { useCallback, useEffect, useState } from "react";
import { Button } from "@plantops/ui";
import { api } from "./api";
import { moduleLabel } from "./modules";
import { pushState, turnOff, turnOn, type PushState } from "./push-client";

type Item = { id: string; module: string; title: string; body: string; level: "push" | "bell"; created_at: string; read: boolean; open_url: string };
type Inbox = { unread: number; items: Item[] };

const REFRESH_MS = 60_000;
const DISMISS_KEY = "plantops.pushCardHiddenUntil";
const DISMISS_DAYS = 7;

const time = (iso: string) => new Date(iso).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });
function dayGroup(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date(Date.now() - 86_400_000);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

function BellIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
      <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
    </svg>
  );
}

/** Polls the inbox every minute and whenever the app comes back to the screen. */
function useInbox() {
  const [inbox, setInbox] = useState<Inbox>({ unread: 0, items: [] });
  const load = useCallback(() => {
    api<Inbox>("/api/notifications").then((r) => r.ok && setInbox(r.data));
  }, []);
  useEffect(() => {
    load();
    const timer = setInterval(load, REFRESH_MS);
    const onShow = () => document.visibilityState === "visible" && load();
    document.addEventListener("visibilitychange", onShow);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onShow);
    };
  }, [load]);
  return { inbox, reload: load };
}

/** Bell with the unread count; tapping opens the list (full screen on a phone). */
export function NotificationBell() {
  const { inbox, reload } = useInbox();
  const [open, setOpen] = useState(false);

  async function markAll() {
    await api("/api/notifications/read", { body: { all: true } });
    reload();
  }

  const groups: { label: string; items: Item[] }[] = [];
  for (const n of inbox.items) {
    const label = dayGroup(n.created_at);
    const g = groups.at(-1);
    if (g?.label === label) g.items.push(n);
    else groups.push({ label, items: [n] });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setOpen(true);
          reload();
        }}
        aria-label={inbox.unread ? `Notifications, ${inbox.unread} unread` : "Notifications"}
        className="relative flex h-11 w-11 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-900"
      >
        <BellIcon />
        {inbox.unread > 0 && (
          <span className="absolute -top-1 -right-1 flex h-5 min-w-5 items-center justify-center rounded-full border-2 border-slate-50 bg-red-700 px-1 text-xs font-bold text-white">
            {inbox.unread > 99 ? "99+" : inbox.unread}
          </span>
        )}
      </button>

      {open && (
        <div role="dialog" aria-modal="true" aria-label="Notifications" className="fixed inset-0 z-50 overflow-y-auto bg-slate-50 text-left">
          <div className="mx-auto w-full max-w-3xl space-y-3 px-4 py-6">
            <header className="flex items-center justify-between">
              <div className="flex items-center gap-1">
                <button type="button" aria-label="Close" onClick={() => setOpen(false)} className="flex h-11 w-11 items-center justify-center">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="m15 18-6-6 6-6" />
                  </svg>
                </button>
                <h2 className="text-2xl font-bold">Notifications</h2>
              </div>
              {inbox.unread > 0 && (
                <button type="button" onClick={markAll} className="min-h-11 px-2 text-sm font-semibold text-(--brand)">
                  Mark all read
                </button>
              )}
            </header>

            {!inbox.items.length && <p className="py-10 text-center text-slate-500">No notifications yet.</p>}
            {groups.map((g) => (
              <section key={g.label} className="space-y-2">
                <h3 className="px-1 pt-2 text-xs font-semibold tracking-wider text-slate-500 uppercase">{g.label}</h3>
                {g.items.map((n) => (
                  <a
                    key={n.id}
                    href={n.open_url}
                    className={`flex gap-3 rounded-2xl border border-slate-200 p-4 ${n.read ? "" : "bg-white"}`}
                  >
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex justify-between gap-2">
                        <span className={n.read ? "font-medium text-slate-700" : "font-bold"}>{n.title}</span>
                        <span className="text-xs whitespace-nowrap text-slate-500">{time(n.created_at)}</span>
                      </div>
                      {n.body && <p className="text-sm leading-snug text-slate-700">{n.body}</p>}
                      <p className="text-xs text-slate-500">{moduleLabel(n.module)}</p>
                    </div>
                    {!n.read && <span className="mt-1.5 h-2.5 w-2.5 flex-none rounded-full bg-(--brand)" aria-label="Unread" />}
                  </a>
                ))}
              </section>
            ))}

            <PushCard compact />
          </div>
        </div>
      )}
    </>
  );
}

function hiddenForNow() {
  try {
    return Number(localStorage.getItem(DISMISS_KEY) ?? 0) > Date.now();
  } catch {
    return false;
  }
}

/**
 * "Get alerts on this phone". Full card on the launcher until it's on (or "Not now" for a week); a one-line
 * status with Turn on / Turn off at the bottom of the bell list.
 */
export function PushCard({ compact = false }: { compact?: boolean }) {
  const [state, setState] = useState<PushState>();
  const [key, setKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [hidden, setHidden] = useState(true);

  useEffect(() => {
    setHidden(hiddenForNow());
    pushState().then((s) => {
      setState(s.state);
      setKey(s.publicKey);
    });
  }, []);

  async function on() {
    if (!key) return;
    setBusy(true);
    setState(await turnOn(key).catch(() => "off" as const));
    setBusy(false);
  }
  async function off() {
    setBusy(true);
    await turnOff();
    setState("off");
    setBusy(false);
  }
  function notNow() {
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now() + DISMISS_DAYS * 86_400_000));
    } catch {}
    setHidden(true);
  }

  if (!state || state === "unavailable") return null;

  if (compact) {
    return (
      <div className="flex items-center justify-between gap-2 border-t border-slate-200 pt-3 text-sm">
        <span className="text-slate-700">
          Phone notifications:{" "}
          <strong className={state === "on" ? "text-green-800" : "text-slate-700"}>
            {state === "on" ? "On for this phone" : state === "blocked" ? "Blocked on this phone" : state === "needs-install" ? "Add to Home Screen first" : "Off"}
          </strong>
        </span>
        {state === "on" && <Button variant="secondary" disabled={busy} onClick={off}>Turn off</Button>}
        {state === "off" && <Button disabled={busy} onClick={on}>Turn on</Button>}
      </div>
    );
  }

  if (state === "on" || hidden) return null;

  if (state === "needs-install") {
    return (
      <section className="space-y-3 rounded-2xl border-2 border-(--brand) bg-white p-4">
        <div>
          <p className="font-bold">Get alerts on this iPhone</p>
          <p className="text-sm text-slate-700">iPhone shows PlantOps alerts only when PlantOps is on your Home Screen. One-time setup:</p>
        </div>
        <ol className="list-decimal space-y-1 pl-5 text-sm">
          <li>Tap <strong>Share</strong> at the bottom of Safari</li>
          <li>Choose <strong>Add to Home Screen</strong></li>
          <li>Open PlantOps from the new icon, log in once, and tap <strong>Turn on</strong> there</li>
        </ol>
        <div className="flex items-center justify-between">
          <p className="text-xs text-slate-500">Needs iOS 16.4 or newer.</p>
          <button type="button" onClick={notNow} className="min-h-11 px-2 text-sm text-slate-600">Not now</button>
        </div>
      </section>
    );
  }

  if (state === "blocked") {
    return (
      <section className="space-y-1 rounded-2xl border border-orange-200 bg-orange-50 p-4">
        <p className="font-semibold text-orange-900">Alerts are blocked on this phone</p>
        <p className="text-sm text-orange-900">
          To allow them: open the phone&apos;s Settings › Notifications (iPhone) or the browser&apos;s site settings › Notifications (Android), find
          PlantOps and allow notifications.
        </p>
        <div className="text-right">
          <button type="button" onClick={notNow} className="min-h-11 px-2 text-sm text-orange-900">Hide</button>
        </div>
      </section>
    );
  }

  return (
    <section className="space-y-3 rounded-2xl bg-(--brand-soft) p-4">
      <div>
        <p className="font-semibold">Get alerts on this phone</p>
        <p className="text-sm text-slate-700">Low stock and the daily count, even when PlantOps is closed. Free, no SMS.</p>
      </div>
      <div className="flex gap-2">
        <Button disabled={busy} onClick={on}>{busy ? "Turning on..." : "Turn on"}</Button>
        <button type="button" onClick={notNow} className="min-h-11 px-3 text-sm text-slate-700">Not now</button>
      </div>
    </section>
  );
}
