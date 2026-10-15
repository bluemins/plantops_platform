// "Recent changes": audit rows in plain words for the owner ("Added OUT 18:30 on Tue, 14 Oct for Ramu: forgot to scan").
import { fmtDayLong, fmtMonth, istDay } from "./days";
import { fmtTime } from "./punch";

const show = (v: unknown) => (v === null || v === undefined || v === "" ? "—" : String(v));
const when = (iso: unknown) => (typeof iso === "string" ? `${fmtTime(iso)} on ${fmtDayLong(istDay(new Date(iso)))}` : "—");

/** One audit row as a sentence. */
export function describeChange(action: string, d: Record<string, unknown>): string {
  switch (action) {
    case "settings.location":
      return d.from ? "Plant location changed" : "Plant location set";
    case "settings.radius":
      return d.from == null ? `Circle set to ${show(d.to)} m` : `Circle ${show(d.from)} m → ${show(d.to)} m`;
    case "qr.new":
      return "New QR made (old prints stopped working)";
    case "fix.add":
      return `Added ${show(d.kind).toUpperCase()} ${when(d.at)} for ${show(d.person)}: ${show(d.reason)}`;
    case "fix.cancel":
      return `Cancelled ${show(d.kind).toUpperCase()} ${when(d.at)} for ${show(d.person)}: ${show(d.reason)}`;
    case "export.csv":
      return `Downloaded the ${typeof d.month === "string" ? fmtMonth(d.month) : "month"} CSV`;
    default:
      return action;
  }
}
