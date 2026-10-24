import { redirect } from "next/navigation";
import { Card } from "@plantops/ui";
import { can } from "@/server/access";
import { kit } from "@/server/kit";
import { reminderPilot, type PilotView } from "@/server/reminders";
import type { SkipReason } from "@/server/schema";
import { requirePageUser } from "@/server/session";
import { Header } from "../header";
import { BackLink } from "../parts";

const SKIP_TEXT: Record<SkipReason, string> = {
  holdout: "Held back (no-message group)",
  no_consent: "Not agreed to reminders",
  newer_order: "Ordered again before the day",
  recent_reminder: "Had a reminder in the last 14 days",
  customer_off: "Customer switched off",
  pilot_full: "Pilot already full",
  budget: "Budget used up",
  pilot_ended: "Pilot over",
};

const pct = (n: number, of: number) => (of ? `${Math.round((n / of) * 100)} %` : "–");
const rupees = (paise: number) => `₹${(paise / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

/** Owner (and PlantOps support, read-only): the WhatsApp reorder-reminder pilot, group counts only. */
export default async function RemindersPage() {
  const user = await requirePageUser("/reminders");
  if (!can(user, "reminder_pilot")) redirect("/");
  const [plant, p] = await Promise.all([kit.branding(user.tenantId), reminderPilot(user)]);
  return (
    <div className="space-y-5">
      <Header user={user} plant={plant} />
      <BackLink />
      <h1 className="text-2xl font-bold">Reminder pilot</h1>
      <p className="text-slate-600">
        One WhatsApp reminder 15 days after a delivery, only to customers who agreed. 3 in 10 of them are held back at random, so you can see whether
        reminders really bring orders back.
      </p>
      <Status p={p} />
      <Checks p={p} />
      <Card>
        <h2 className="mb-2 font-semibold">Did they order again?</h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-slate-500">
              <th className="py-1 font-normal">Group</th>
              <th className="py-1 font-normal">Customers</th>
              <th className="py-1 font-normal">Within 7 days</th>
              <th className="py-1 font-normal">Within 14 days</th>
            </tr>
          </thead>
          <tbody>
            {(
              [
                ["Got a reminder", p.reordered.remind],
                ["Held back", p.reordered.holdout],
              ] as const
            ).map(([label, r]) => (
              <tr key={label} className="border-t border-slate-100">
                <td className="py-2">{label}</td>
                <td className="py-2">{r.base}</td>
                <td className="py-2">
                  {r.d7} ({pct(r.d7, r.base)})
                </td>
                <td className="py-2">
                  {r.d14} ({pct(r.d14, r.base)})
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-2 text-xs text-slate-500">Small numbers: a pointer, not proof.</p>
      </Card>
      <Card>
        <h2 className="mb-2 font-semibold">Reminders that were due</h2>
        <ul className="space-y-1 text-sm">
          <li>Sent: {p.sent}</li>
          {p.failed > 0 && <li className="text-red-700">Failed: {p.failed}</li>}
          {p.waiting > 0 && <li>Being sent / unclear: {p.waiting}</li>}
          {(Object.keys(p.skipped) as SkipReason[]).map((k) => (
            <li key={k}>
              {SKIP_TEXT[k]}: {p.skipped[k]}
            </li>
          ))}
          <li className="font-semibold">Due in all: {p.due}</li>
        </ul>
      </Card>
    </div>
  );
}

function Status({ p }: { p: PilotView }) {
  const missing = [!p.on && "ORDER_REMINDERS is not on", !p.start && "no start date (REMINDER_PILOT_START)", !p.template && "no approved reminder template set"].filter(Boolean);
  return (
    <Card>
      <p className={`font-semibold ${missing.length ? "text-amber-700" : "text-emerald-700"}`}>{missing.length ? "Not sending" : "Sending, daily at 10:30 am"}</p>
      {missing.length > 0 && <p className="text-sm text-slate-600">Why: {missing.join("; ")}.</p>}
      <ul className="mt-2 space-y-1 text-sm text-slate-700">
        {p.start && (
          <li>
            Pilot: {p.start} to {p.end}
          </li>
        )}
        <li>Customers who agreed: {p.agreed}</li>
        <li>
          In the pilot: {p.groups.remind + p.groups.holdout} of {p.customers_max} ({p.groups.remind} get reminders, {p.groups.holdout} held back)
        </li>
        <li>
          Cost so far (estimate): {rupees(p.sent * p.cost_paise)} of {rupees(p.budget_paise)}
        </li>
      </ul>
    </Card>
  );
}

/** The agreed stop / pause rules as plain checks (contract checklist 6). */
function Checks({ p }: { p: PilotView }) {
  const optOutRate = p.sent ? p.opt_outs / p.sent : 0;
  const rows: [string, boolean][] = [
    [p.refused ? `Twilio refused a reminder: stopped (${p.refused})` : "Twilio accepts the reminders", !p.refused],
    [`Stopped reminders: ${p.opt_outs} of ${p.sent} sent${p.sent >= 20 && optOutRate > 0.05 ? " — over 5 %: pause and review" : ""}`, !(p.sent >= 20 && optOutRate > 0.05)],
    [`Budget used: ${pct(p.sent * p.cost_paise, p.budget_paise)}`, p.sent * p.cost_paise < p.budget_paise],
  ];
  return (
    <Card>
      <h2 className="mb-2 font-semibold">Stop rules</h2>
      <ul className="space-y-1 text-sm">
        {rows.map(([text, ok]) => (
          <li key={text} className={ok ? "text-slate-700" : "font-semibold text-red-700"}>
            {ok ? "✓" : "✗"} {text}
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-slate-500">Also stop at once after 2 complaints about the messages, or if one reaches someone who should not get it: set ORDER_REMINDERS to off.</p>
    </Card>
  );
}
