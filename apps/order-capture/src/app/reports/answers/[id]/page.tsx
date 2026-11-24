import { notFound, redirect } from "next/navigation";
import { cardById, type FieldDef } from "@/lib/answers/cards";
import { fieldsOf, formatValue, type Row } from "@/lib/answers/facts";
import { can } from "@/server/access";
import { answersOn, copyFor, runCard } from "@/server/answers";
import { kit } from "@/server/kit";
import { requirePageUser } from "@/server/session";
import { Header } from "../../../header";
import { BackLink, PhoneLink } from "../../../parts";
import { CopyWhatsapp } from "../../../cash/van/van-parts";

type Props = { params: Promise<{ id: string }> };
const box = "rounded-2xl border border-slate-200 bg-white p-4";
const at = (iso: string) =>
  new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));

/** One value on screen: the customer links to their page, a phone can be tapped. */
function Cell({ f, r, plain }: { f: FieldDef; r: Row; plain: boolean }) {
  const v = r[f.key] ?? null;
  if (f.kind === "phone") return v ? <PhoneLink phone={String(v)} plain={plain} /> : <span className="text-slate-400">—</span>;
  if (f.key === "customer" && typeof r.href === "string") return <a href={r.href} className="font-semibold text-(--brand)">{formatValue(f.kind, v)}</a>;
  return <>{formatValue(f.kind, v)}</>;
}

/** One answer card (mock-up 4): the sentence, the facts, as-of and source, Copy for the owner. Owner (support reads). */
export default async function AnswerPage({ params }: Props) {
  const { id: raw } = await params;
  const id = raw.toUpperCase();
  const user = await requirePageUser(`/reports/answers/${id}`);
  if (!answersOn(user.tenantId) || !cardById(id)) notFound();
  if (!can(user, "answers")) redirect("/");
  const r = await runCard(user, id).catch((e: { status?: number }) => (e.status === 404 ? null : Promise.reject(e)));
  if (!r) notFound();
  const plant = await kit.branding(user.tenantId);
  const totals = fieldsOf(r.card, "total");
  const cols = fieldsOf(r.card, "row");
  const copy = copyFor(user, r);
  const wa = (row: Row) => (typeof row.phone === "string" && row.phone.length === 10 && !user.isSupport ? `https://wa.me/91${row.phone}` : null);

  return (
    <div className="space-y-4 pb-8">
      <Header user={user} plant={plant} />
      <BackLink href="/reports/answers">← Plant answers</BackLink>
      <h1 className="text-2xl font-bold">{r.card.title}</h1>

      <p className="rounded-2xl bg-(--brand-soft) p-4 text-lg font-semibold">{r.sentence}</p>
      {r.missing.map((m) => (
        <p key={m} className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">{m}</p>
      ))}

      {totals.length > 0 && (
        <div className="grid grid-cols-3 gap-2">
          {totals.map((f) => (
            <div key={f.key} className="rounded-xl border border-slate-200 bg-white p-3">
              <span className="block text-xs font-bold text-slate-600">{f.label}</span>
              <span className="block text-xl font-bold tabular-nums">{formatValue(f.kind, r.facts.totals[f.key] ?? null)}</span>
            </div>
          ))}
        </div>
      )}

      {r.facts.rows.length > 0 && (
        <>
          <ul className="space-y-2 sm:hidden">
            {r.facts.rows.map((row, i) => (
              <li key={String(row.key ?? i)} className="space-y-1 rounded-xl border border-slate-200 bg-white p-3 text-sm">
                {cols.filter((f) => f.kind !== "phone").map((f) => (
                  <div key={f.key} className="flex justify-between gap-3">
                    <span className="text-slate-600">{f.label}</span>
                    <span className="text-right"><Cell f={f} r={row} plain={user.isSupport} /></span>
                  </div>
                ))}
                {cols.some((f) => f.kind === "phone") && row.phone && (
                  <div className="flex items-center justify-between gap-3">
                    <PhoneLink phone={String(row.phone)} plain={user.isSupport} />
                    {wa(row) && <a href={wa(row)!} target="_blank" rel="noreferrer" className="flex min-h-11 items-center font-semibold text-(--brand)">WhatsApp</a>}
                  </div>
                )}
              </li>
            ))}
          </ul>
          <div className={`${box} hidden overflow-x-auto p-0 sm:block`}>
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs text-slate-600">
                <tr>
                  <th className="px-3 py-2">#</th>
                  {cols.map((f) => (
                    <th key={f.key} className={`px-3 py-2 ${f.kind === "money" || f.kind === "days" ? "text-right" : ""}`}>{f.label}</th>
                  ))}
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {r.facts.rows.map((row, i) => (
                  <tr key={String(row.key ?? i)}>
                    <td className="px-3 py-2 text-slate-500">{i + 1}</td>
                    {cols.map((f) => (
                      <td key={f.key} className={`px-3 py-2 ${f.kind === "money" || f.kind === "days" ? "whitespace-nowrap text-right tabular-nums" : f.kind === "phone" ? "whitespace-nowrap" : ""}`}>
                        <Cell f={f} r={row} plain={user.isSupport} />
                      </td>
                    ))}
                    <td className="px-3 py-2">{wa(row) && <a href={wa(row)!} target="_blank" rel="noreferrer" className="font-semibold text-(--brand)">WhatsApp</a>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <p className="text-sm text-slate-600">
        As of {at(r.at)} · from{" "}
        {r.card.source ? <a href={r.card.source.href} className="font-semibold text-(--brand)">{r.card.source.label}</a> : "Sales"}
        {" · "}worked out by PlantOps rules (v{r.preparedBy.rules}.{r.preparedBy.wording})
      </p>

      {copy && (
        <div className="space-y-1">
          <CopyWhatsapp text={copy} />
          <p className="text-xs text-slate-600">Names, bills and days only: the message has no amounts and no phone numbers.</p>
        </div>
      )}
      {!copy && user.isSupport && <p className="text-xs text-slate-500">PlantOps support view: read-only, no Copy.</p>}
    </div>
  );
}
