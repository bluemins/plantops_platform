import { notFound, redirect } from "next/navigation";
import { cardById, type FieldDef } from "@/lib/answers/cards";
import { fieldsOf, formatValue, noteOf, type Row } from "@/lib/answers/facts";
import { can } from "@/server/access";
import { answersOn, copyFor, runCard, type CardAnswer } from "@/server/answers";
import { kit } from "@/server/kit";
import { env } from "@/server/env";
import { requirePageUser } from "@/server/session";
import { Header } from "../../../header";
import { BackLink, PhoneLink } from "../../../parts";
import { CopyWhatsapp } from "../../../cash/van/van-parts";

type Props = { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };
const box = "rounded-2xl border border-slate-200 bg-white p-4";
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const at = (iso: string) =>
  new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));
const right = (f: FieldDef) => f.kind === "money" || f.kind === "days" || f.kind === "count" || f.kind === "percent";
const tone = (f: FieldDef, v: unknown) =>
  f.kind === "percent" && typeof v === "number" ? (v > 0 ? "text-emerald-700" : v < 0 ? "text-red-700" : "") : f.key === "marks" && v ? "text-amber-800 font-semibold" : "";

/** One value on screen: an order or customer links to its page, a phone can be tapped. */
function Cell({ f, r, plain }: { f: FieldDef; r: Row; plain: boolean }) {
  const v = r[f.key] ?? null;
  if (f.kind === "phone") return v ? <PhoneLink phone={String(v)} plain={plain} /> : <span className="text-slate-400">—</span>;
  const href = f.key === "ref" ? r.href : f.key === "customer" ? (r.customer_href ?? (r.ref ? null : r.href)) : null;
  if (typeof href === "string") return <a href={href} className="font-semibold text-(--brand)">{formatValue(f.kind, v)}</a>;
  return <span className={tone(f, v)}>{formatValue(f.kind, v)}</span>;
}

/** What each column means (owner 2026-11-28: a note beside every number). */
function Legend({ fields }: { fields: FieldDef[] }) {
  const shown = fields.filter((f) => f.kind !== "phone");
  return (
    <details className="text-xs text-slate-600">
      <summary className="cursor-pointer py-1 font-semibold">What the columns mean</summary>
      <dl className="mt-1 space-y-1">
        {shown.map((f) => (
          <div key={f.key}>
            <dt className="inline font-semibold text-slate-700">{f.label}: </dt>
            <dd className="inline">{f.note}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}

/** A table on a PC, cards on a phone. */
function Table({ fields, rows, plain, isSupport }: { fields: FieldDef[]; rows: Row[]; plain: boolean; isSupport: boolean }) {
  const wa = (row: Row) => (typeof row.phone === "string" && row.phone.length === 10 && !isSupport ? `https://wa.me/91${row.phone}` : null);
  const cols = fields;
  return (
    <>
      <ul className="space-y-2 sm:hidden">
        {rows.map((row, i) => (
          <li key={String(row.key ?? i)} className={`space-y-1 rounded-xl border border-slate-200 bg-white p-3 text-sm ${row.cancelled ? "bg-red-50" : ""}`}>
            {cols.filter((f) => f.kind !== "phone").map((f) => (
              <div key={f.key} className="flex justify-between gap-3">
                <span className="text-slate-600">{f.label}</span>
                <span className="text-right"><Cell f={f} r={row} plain={plain} /></span>
              </div>
            ))}
            {cols.some((f) => f.kind === "phone") && row.phone && (
              <div className="flex items-center justify-between gap-3">
                <PhoneLink phone={String(row.phone)} plain={plain} />
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
                <th key={f.key} className={`px-3 py-2 ${right(f) ? "text-right" : ""}`}>{f.label}</th>
              ))}
              {cols.some((f) => f.kind === "phone") && <th className="px-3 py-2" />}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((row, i) => (
              <tr key={String(row.key ?? i)} className={row.cancelled ? "bg-red-50" : ""}>
                <td className="px-3 py-2 text-slate-500">{i + 1}</td>
                {cols.map((f) => (
                  <td key={f.key} className={`px-3 py-2 ${right(f) ? "whitespace-nowrap text-right tabular-nums" : f.kind === "phone" ? "whitespace-nowrap" : ""}`}>
                    <Cell f={f} r={row} plain={plain} />
                  </td>
                ))}
                {cols.some((f) => f.kind === "phone") && <td className="px-3 py-2">{wa(row) && <a href={wa(row)!} target="_blank" rel="noreferrer" className="font-semibold text-(--brand)">WhatsApp</a>}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

/** O3's product, O4's period, O5's customer search: a plain form, so it works on any phone. */
function Pickers({ r, q }: { r: CardAnswer; q: string }) {
  const c = r.choices;
  if (!c) return null;
  const sel = "min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-base";
  return (
    <form method="get" className={`${box} space-y-2`}>
      {c.products && (
        <label className="block space-y-1">
          <span className="text-sm font-semibold">Product</span>
          <select name="product" defaultValue={c.picked} className={sel}>
            {c.products.map((p) => (
              <option key={p.key} value={p.key}>{`${p.name} (${p.n} stopped)`}</option>
            ))}
          </select>
          {!c.products.length && <span className="block text-sm text-slate-600">Nobody has stopped buying any product.</span>}
        </label>
      )}
      {c.periods && (
        <label className="block space-y-1">
          <span className="text-sm font-semibold">Period</span>
          <select name="period" defaultValue={c.picked} className={sel}>
            {c.periods.map((p) => (
              <option key={p.key} value={p.key}>{p.label}</option>
            ))}
          </select>
        </label>
      )}
      {c.customers && (
        <label className="block space-y-1">
          <span className="text-sm font-semibold">Customer (name, place or last digits of the mobile)</span>
          <input name="q" defaultValue={q} maxLength={60} className={sel} />
        </label>
      )}
      <button className="min-h-11 rounded-xl bg-(--brand) px-4 font-semibold text-(--brand-contrast)">{c.customers ? "Search" : "Show"}</button>
      {c.customers && q && (
        <ul className="divide-y divide-slate-100">
          {c.customers.map((x) => (
            <li key={x.key}>
              <a href={`?${new URLSearchParams({ q, customer: x.key })}`} className={`flex min-h-11 items-center justify-between gap-3 ${x.key === c.picked ? "font-bold" : ""}`}>
                <span className="text-(--brand)">{x.name}</span>
                <span className="text-sm text-slate-500">{x.place}</span>
              </a>
            </li>
          ))}
          {!c.customers.length && <li className="py-2 text-sm text-slate-600">No customer found.</li>}
        </ul>
      )}
    </form>
  );
}

/** One answer card: the sentence, every number with a note beside it, the tables, as-of and source, Copy for the owner. */
export default async function AnswerPage({ params, searchParams }: Props) {
  const { id: raw } = await params;
  const sp = await searchParams;
  const id = raw.toUpperCase();
  const user = await requirePageUser(`/reports/answers/${id}`);
  if (!answersOn(user.tenantId) || !cardById(id)) notFound();
  if (!can(user, "answers")) redirect("/");
  const q = one(sp.q).slice(0, 60);
  const input = { product: one(sp.product), period: one(sp.period), customer: one(sp.customer), q };
  const r = await runCard(user, id, undefined, input).catch((e: { status?: number }) => (e.status === 404 ? null : Promise.reject(e)));
  if (!r) notFound();
  const plant = await kit.branding(user.tenantId);
  const totals = fieldsOf(r.card, "total").filter((f) => r.facts.totals[f.key] !== undefined && r.facts.totals[f.key] !== null);
  const cols = fieldsOf(r.card, "row");
  const copy = copyFor(user, r);
  const lists = (r.card.lists ?? []).filter((l) => r.facts.lists?.[l.key]?.length);

  return (
    <div className="space-y-4 pb-8">
      <Header user={user} plant={plant} />
      <BackLink href="/reports/answers">← Plant answers</BackLink>
      <h1 className="text-2xl font-bold">{r.card.title}</h1>
      <Pickers r={r} q={q} />

      <p className="rounded-2xl bg-(--brand-soft) p-4 text-lg font-semibold">{r.sentence}</p>
      {r.missing.map((m) => (
        <p key={m} className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">{m}</p>
      ))}

      {r.ready && totals.length > 0 && (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {totals.map((f) => (
            <div key={f.key} className="rounded-xl border border-slate-200 bg-white p-3">
              <span className={`block text-xl font-bold tabular-nums ${tone(f, r.facts.totals[f.key])}`}>{formatValue(f.kind, r.facts.totals[f.key] ?? null)}</span>
              <span className="block text-sm font-semibold">{f.label}</span>
              <span className="block text-xs leading-relaxed text-slate-600">{noteOf(f, r.facts)}</span>
            </div>
          ))}
        </div>
      )}

      {r.facts.rows.length > 0 && (
        <section className="space-y-2">
          {r.card.rowsTitle && <h2 className="text-lg font-bold">{r.card.rowsTitle}</h2>}
          {r.card.rowsNote && <p className="text-sm text-slate-600">{r.card.rowsNote}</p>}
          <Table fields={cols} rows={r.facts.rows} plain={user.isSupport} isSupport={user.isSupport} />
          <Legend fields={cols} />
        </section>
      )}

      {lists.map((l) => (
        <section key={l.key} className="space-y-2">
          <h2 className="text-lg font-bold">{l.title}</h2>
          <p className="text-sm text-slate-600">{l.note}</p>
          <Table fields={l.fields} rows={r.facts.lists![l.key]!} plain={user.isSupport} isSupport={user.isSupport} />
          <Legend fields={l.fields} />
        </section>
      ))}

      <p className="text-sm text-slate-600">
        As of {at(r.at)} · from{" "}
        {r.card.source ? (
          r.card.source.module && user.isSupport ? (
            r.card.source.label
          ) : (
            <a href={r.card.source.module ? `${env.platformUrl}/sso/start?module=${r.card.source.module}&next=${encodeURIComponent(r.card.source.href)}` : r.card.source.href} className="font-semibold text-(--brand)">
              {r.card.source.label}
            </a>
          )
        ) : (
          "Sales"
        )}
        {" · "}worked out by PlantOps rules (v{r.preparedBy.rules}.{r.preparedBy.wording})
      </p>

      {copy && (
        <div className="space-y-1">
          <CopyWhatsapp text={copy} />
          <p className="text-xs text-slate-600">The message has no amounts and no phone numbers.</p>
        </div>
      )}
      {r.card.noCopy && !user.isSupport && <p className="rounded-xl bg-slate-50 p-3 text-sm text-slate-600">No Copy button: cash stays on your screen.</p>}
      {!copy && user.isSupport && <p className="text-xs text-slate-500">PlantOps support view: read-only, no Copy.</p>}
    </div>
  );
}
