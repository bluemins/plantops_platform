// The field day timeline (docs/FIELD_DAY_PHASE_PLAN.md mock-ups A3 and B3): start → visits → end, each with its time,
// Google Maps link and ±accuracy; replaced readings and removed visits crossed out with who / why. Used by the worker's
// My field day and the owner / Supervisor day page. No hooks: it renders on the server or inside a client screen.
import type { ReactNode } from "react";
import { fmtKm, mapsUrl, type FieldDayView, type TimelineItem } from "@/lib/field";
import { fmtTime } from "@/lib/punch";

export type LocationStates = Record<string, "saved" | "not_saved" | "unknown">;

const pill = "inline-block rounded-full px-2 py-0.5 text-xs font-semibold";

function Where({ t }: { t: TimelineItem }) {
  const parts: ReactNode[] = [];
  const place = t.kind === "visit" ? t.customerPlace : t.placeText;
  if (place) parts.push(place);
  if (t.customerPhone) parts.push(t.customerPhone.replace(/^(\d{5})(\d{5})$/, "$1 $2"));
  if (t.accuracyM !== null) parts.push(`±${t.accuracyM} m`);
  return (
    <span>
      {parts.join(" · ")}
      {t.lat !== null && t.lng !== null && (
        <>
          {parts.length > 0 && " · "}
          <a href={mapsUrl(t.lat, t.lng)} target="_blank" rel="noreferrer" className="font-semibold text-(--brand)">
            Google Maps
          </a>
        </>
      )}
    </span>
  );
}

/** One line per row, oldest first. `actions` adds buttons under a row (Correct / Remove / Try again). */
export function FieldTimeline({ day, locations = {}, actions }: { day: FieldDayView; locations?: LocationStates; actions?: (t: TimelineItem) => ReactNode }) {
  if (day.timeline.length === 0) return null;
  return (
    <ol className="space-y-0">
      {day.timeline.map((t, i) => {
        const crossed = t.replaced || !!t.removed;
        const dot = crossed ? "bg-slate-300" : t.kind === "visit" ? "bg-(--brand)" : "bg-slate-900";
        const loc = t.kind === "visit" && t.saveLocation && !t.removed ? locations[t.id] : undefined;
        return (
          <li key={t.id} className="grid grid-cols-[3.25rem_0.875rem_1fr] gap-2">
            <span className="pt-0.5 text-right text-xs text-slate-600 tabular-nums">{fmtTime(t.at)}</span>
            <span className="relative" aria-hidden="true">
              {i < day.timeline.length - 1 && <span className="absolute top-1 bottom-0 left-1.5 w-0.5 bg-slate-200" />}
              <span className={`absolute top-1 left-0.5 h-2.5 w-2.5 rounded-full ${dot}`} />
            </span>
            <div className="min-w-0 space-y-1 pb-3.5">
              <p className={`text-[15px] font-semibold break-words ${crossed ? "text-slate-500 line-through" : ""}`}>
                {t.kind === "start" ? (
                  <>Started · {fmtKm(t.kmTenths!)} km</>
                ) : t.kind === "end" ? (
                  <>Ended · {fmtKm(t.kmTenths!)} km</>
                ) : (
                  t.customerName
                )}{" "}
                {t.kind === "visit" && !crossed && <span className={`${pill} bg-slate-100 font-normal text-slate-600 no-underline`}>{t.customerId ? "customer" : "typed"}</span>}{" "}
                {t.rough && !crossed && <span className={`${pill} bg-amber-100 text-amber-900`}>rough ±{t.accuracyM} m</span>}
              </p>
              <p className="text-sm text-slate-600">
                <Where t={t} />
                {loc === "saved" && " · 📍 saved as shop location"}
                {loc === "not_saved" && <span className="text-amber-800"> · shop location not saved</span>}
              </p>
              {t.correctsId && <p className="text-xs text-slate-600">Corrected by {t.createdByName}: “{t.reason}”</p>}
              {t.replaced && <p className="text-xs text-slate-600">Replaced by a newer reading</p>}
              {t.removed && (
                <p className="text-xs text-slate-600">
                  Removed by {t.removed.by} at {fmtTime(t.removed.at)}: “{t.removed.reason}”
                </p>
              )}
              {t.note && !t.removed && <p className="rounded-lg bg-slate-50 px-2.5 py-1.5 text-sm break-words text-slate-800">{t.note}</p>}
              {actions?.(t)}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/** "84.3 km · 3 shops · 9 h 28 m" for a day's summary card. */
export function daySummary(day: FieldDayView) {
  const shops = `${day.visits.length} ${day.visits.length === 1 ? "shop" : "shops"}${day.removedVisits ? ` (${day.removedVisits} removed)` : ""}`;
  return { km: day.kmTenths === null ? null : `${fmtKm(day.kmTenths)} km`, shops };
}
