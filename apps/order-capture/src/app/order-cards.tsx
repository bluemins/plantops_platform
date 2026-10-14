"use client";

import { useState } from "react";
import { productsText } from "@/lib/history";
import { money } from "@/lib/money";
import { whatsappText } from "@/lib/whatsapp";
import type { ListRow } from "@/server/list";
import { PhoneLink } from "./parts";

const day = (iso: string) => new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short" }).format(new Date(iso));

/**
 * The order cards of one tab. On Pending, people who may copy (owner, Order desk, plant staff) get a tick box per
 * order, Select all / Clear, and a bar to copy the ticked orders as one WhatsApp message (mock-up v0.14). Ticks live
 * on this page only: nothing is saved, the orders stay Pending.
 */
export function OrderCards({ orders, tickable, plainPhones }: { orders: ListRow[]; tickable: boolean; plainPhones: boolean }) {
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [copy, setCopy] = useState<"idle" | "copied" | "show">("idle");
  const picked = orders.filter((o) => ticked.has(o.id));
  const text = picked.length ? whatsappText(picked) : "";

  const toggle = (id: string) =>
    setTicked((t) => {
      const next = new Set(t);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const tickAll = (on: boolean) => {
    setTicked(new Set(on ? orders.map((o) => o.id) : []));
    setCopy("idle");
  };

  async function copyNow() {
    try {
      await navigator.clipboard.writeText(text);
      setCopy("copied");
      setTimeout(() => setCopy("idle"), 2500);
    } catch {
      setCopy("show"); // plain http on a phone: no clipboard access, so let them select it
    }
  }

  return (
    <>
      {tickable && (
        <div className="flex items-center justify-between gap-2 text-sm text-slate-500">
          <span>Tick orders to copy · {ticked.size} ticked</span>
          <span className="flex gap-4">
            <button type="button" onClick={() => tickAll(true)} className="min-h-11 font-semibold text-(--brand)">
              Select all
            </button>
            <button type="button" onClick={() => tickAll(false)} className="min-h-11 font-semibold text-(--brand)">
              Clear
            </button>
          </span>
        </div>
      )}
      <ul className="space-y-3">
        {orders.map((o) => {
          const on = ticked.has(o.id);
          return (
            <li key={o.id} className={`flex overflow-hidden rounded-xl border bg-white ${on ? "border-(--brand) ring-1 ring-(--brand)" : o.age?.amber ? "border-amber-400" : "border-slate-200"}`}>
              {tickable && (
                <label className="grid w-12 shrink-0 cursor-pointer place-items-center border-r border-slate-100 bg-slate-50">
                  <input type="checkbox" checked={on} onChange={() => toggle(o.id)} className="h-6 w-6 accent-(--brand)" aria-label={`Tick ${o.ref} ${o.customer}`} />
                </label>
              )}
              <div className="relative min-w-0 flex-1 space-y-1.5 px-4 py-3">
                <div className="flex items-center justify-between gap-2">
                  {/* the whole card opens the order; the phone link sits above it */}
                  <a href={`/o/${o.id}`} className="font-semibold break-words after:absolute after:inset-0 after:content-['']">
                    {o.customer}
                  </a>
                  {o.age ? (
                    <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-sm ${o.age.amber ? "bg-amber-100 font-semibold text-amber-900" : "bg-slate-100 text-slate-700"}`}>{o.age.text}</span>
                  ) : (
                    <span className="shrink-0 text-sm text-slate-500">
                      {o.status === "delivered" ? "Delivered" : "Cancelled"} {day(o.status_changed_at)}
                    </span>
                  )}
                </div>
                <p className="text-sm text-slate-600">
                  {o.place} · {o.ref} · by {o.entered_by}
                </p>
                <p className="relative z-10 w-fit text-sm">
                  <PhoneLink phone={o.phone} plain={plainPhones} prefix="+91 " />
                </p>
                {o.note && <p className="line-clamp-1 text-sm break-words text-amber-900">📝 {o.note}</p>}
                <div className="flex justify-between gap-3">
                  <span className="min-w-0 break-words">{productsText(o.lines)}</span>
                  {o.total !== null && <span className="shrink-0 font-semibold">{money(o.total)}</span>}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
      {tickable && picked.length > 0 && (
        // sticky, not fixed: it rides the bottom of the screen while the list scrolls, then stops above the links below
        <div className="sticky bottom-0 z-20 -mx-4 border-t border-slate-200 bg-white px-4 pt-3 pb-4">
          <div className="space-y-2">
            {copy === "show" && (
              <textarea readOnly value={text} rows={8} onFocus={(e) => e.currentTarget.select()} className="w-full rounded-xl border border-slate-300 p-3 font-mono text-sm" aria-label="WhatsApp message" />
            )}
            <button type="button" onClick={copyNow} className="min-h-14 w-full rounded-xl bg-green-700 px-5 text-lg font-semibold text-white hover:bg-green-800">
              {copy === "copied" ? "✓ Copied" : copy === "show" ? "Select the text above and copy it" : `Copy ${picked.length} order${picked.length === 1 ? "" : "s"} as WhatsApp message`}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
