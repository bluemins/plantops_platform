// "Recent changes": audit rows in plain words for the owner ("Added OUT 18:30 on Tue, 14 Oct for Ramu: forgot to scan").
import { fmtDayLong, fmtMonth, istDay } from "./days";
import { fmtTime } from "./punch";
import { halvesText, hoursText, paiseText } from "./salary";

const show = (v: unknown) => (v === null || v === undefined || v === "" ? "—" : String(v));
const num = (v: unknown) => (typeof v === "number" ? v : 0);
/** "3 Oct" */
const shortDay = (v: unknown) => (typeof v === "string" ? fmtDayLong(v).replace(/^\w+, /, "") : "—");
/** "Nov 2026" */
const shortMonth = (v: unknown) => (typeof v === "string" ? fmtMonth(v).replace(/^(\w{3})\w*/, "$1") : "—");

/** "field duty 18 Oct, 42 km" / "expense ₹450 on 16 Oct": one claim in an audit row. */
const claimText = (d: Record<string, unknown>) =>
  d.kind === "field_duty" ? `field duty ${shortDay(d.on)}, ${num(d.km) / 10} km` : `expense ${paiseText(num(d.amount))} on ${shortDay(d.on)}`;

/** "₹12,000 · 8 h · overtime ₹60/h" (+ leave when not the usual 2 days, joined / last day): a salary setting. */
export function settingText(d: { monthly: number | null; day_rate?: number | null; km_rate?: number | null; da_day?: number | null; shift: number; leave: number; ot_rate: number | null; joined?: string | null; left?: string | null }) {
  const pay = d.day_rate != null ? `per day ${paiseText(d.day_rate)}` : paiseText(d.monthly ?? 0);
  const parts = [pay, `${hoursText(d.shift)} h`, d.ot_rate ? `overtime ${paiseText(d.ot_rate)}/h` : "no overtime"];
  if (d.day_rate == null && d.leave !== 4) parts.push(`leave ${halvesText(d.leave)} days`);
  if (d.km_rate) parts.push(`TA ${paiseText(d.km_rate)}/km`);
  if (d.da_day) parts.push(`DA ${paiseText(d.da_day)}/day`);
  if (d.joined) parts.push(`joined ${shortDay(d.joined)}`);
  if (d.left) parts.push(`last day ${shortDay(d.left)}`);
  return parts.join(" · ");
}

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
    case "salary.set":
      return `Salary for ${show(d.person)} from ${shortMonth(d.from)}: ${settingText({ monthly: typeof d.monthly === "number" ? d.monthly : null, day_rate: typeof d.day_rate === "number" ? d.day_rate : null, km_rate: typeof d.km_rate === "number" ? d.km_rate : null, da_day: typeof d.da_day === "number" ? d.da_day : null, shift: num(d.shift), leave: num(d.leave), ot_rate: typeof d.ot_rate === "number" ? d.ot_rate : null, joined: d.joined as string | null, left: d.left as string | null })}${d.reason ? `: ${show(d.reason)}` : ""}`;
    case "claim.sent":
      return `Claim from ${show(d.person)}: ${claimText(d)}: ${show(d.note)}${d.approved ? " (own claim, approved)" : ""}`;
    case "claim.entered":
      return `Claim entered for ${show(d.person)}: ${claimText(d)}: ${show(d.note)} (approved)`;
    case "claim.withdrawn":
      return `Claim withdrawn by ${show(d.person)}: ${claimText(d)}`;
    case "claim.approved":
      return `Claim approved for ${show(d.person)}: ${claimText(d)}`;
    case "claim.rejected":
      return `Claim not approved for ${show(d.person)}: ${claimText(d)}: ${show(d.reason)}`;
    case "claim.cancelled":
      return `Claim cancelled for ${show(d.person)}: ${claimText(d)}: ${show(d.reason)}`;
    case "salary.advance":
      return `Advance ${paiseText(num(d.amount))} to ${show(d.person)} on ${shortDay(d.on)}${d.note ? `: ${show(d.note)}` : ""}`;
    case "salary.correction":
      return `Advance corrected ${paiseText(num(d.amount))} (${show(d.person)}, ${shortDay(d.on)}): ${show(d.reason)}`;
    case "salary.visibility":
      return d.can_see ? `${show(d.person)} can now see own salary (paid months)` : `${show(d.person)} can no longer see own salary`;
    case "salary.paid":
      return `Marked ${typeof d.month === "string" ? fmtMonth(d.month) : "the month"} paid for ${show(d.person)}: ${paiseText(num(d.paid))} on ${shortDay(d.on)}${d.note ? ` (${show(d.note)})` : ""}`;
    case "salary.unpaid":
      return `Undid ${typeof d.month === "string" ? fmtMonth(d.month) : "the month"} payment for ${show(d.person)}: ${show(d.reason)}`;
    case "salary.export":
      return `Downloaded the ${typeof d.month === "string" ? fmtMonth(d.month) : "month"} salary CSV`;
    case "export.csv":
      return `Downloaded the ${typeof d.month === "string" ? fmtMonth(d.month) : "month"} CSV`;
    default:
      return action;
  }
}
