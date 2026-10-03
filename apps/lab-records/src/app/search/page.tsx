import { Card } from "@plantops/ui";
import { branding } from "@/server/platform";
import { search, SearchInput } from "@/server/search";
import { requirePageUser } from "@/server/session";
import { fmtDate } from "@/lib/format";
import { FORMS } from "@/lib/forms";
import { SectionTitle, StatusChip } from "@/lib/ui";
import { EntryCard } from "../entry-card";
import { Header } from "../header";

type Props = { searchParams: Promise<Record<string, string | undefined>> };

const select = "min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3 text-base";
const input = "min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3 text-base";

/** Search batches or records. A plain form (GET), so results can be bookmarked and shared inside the plant. */
export default async function SearchPage({ searchParams }: Props) {
  const raw = await searchParams;
  const user = await requirePageUser(`/search?${new URLSearchParams(raw as Record<string, string>).toString()}`);
  const q = SearchInput.parse({ ...raw, batch_no: raw.batch_no || undefined });
  const [plant, result] = await Promise.all([branding(user.tenantId), search(user, q)]);
  const count = result.kind === "batches" ? result.batches.length : result.records.length;

  return (
    <div className="space-y-5">
      <Header user={user} plant={plant} />
      <a href="/" className="text-sm font-semibold text-(--brand)">
        ← Home
      </a>
      <h1 className="text-2xl font-bold">Search</h1>

      <Card>
        <form method="get" className="grid grid-cols-2 gap-3">
          <label className="col-span-2">
            <span className="mb-1 block text-sm font-medium text-slate-700">Look for</span>
            <select name="kind" defaultValue={q.kind} className={select}>
              <option value="records">Tests &amp; form records</option>
              <option value="batches">Batches</option>
            </select>
          </label>
          <label>
            <span className="mb-1 block text-sm font-medium text-slate-700">From</span>
            <input type="date" name="from" defaultValue={q.from} className={input} />
          </label>
          <label>
            <span className="mb-1 block text-sm font-medium text-slate-700">To</span>
            <input type="date" name="to" defaultValue={q.to} className={input} />
          </label>
          <label>
            <span className="mb-1 block text-sm font-medium text-slate-700">Batch no.</span>
            <input name="batch_no" defaultValue={q.batch_no} placeholder="any" className={input} />
          </label>
          <label>
            <span className="mb-1 block text-sm font-medium text-slate-700">Batch status</span>
            <select name="status" defaultValue={q.status ?? ""} className={select}>
              <option value="">Any</option>
              <option value="pending">Awaiting approval</option>
              <option value="on_hold">On hold</option>
              <option value="approved">Approved</option>
              <option value="rejected">Rejected</option>
            </select>
          </label>
          <label>
            <span className="mb-1 block text-sm font-medium text-slate-700">Form</span>
            <select name="form" defaultValue={q.form ?? ""} className={select}>
              <option value="">Any</option>
              {Object.values(FORMS).map((f) => (
                <option key={f.id} value={f.id}>
                  {f.short}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="mb-1 block text-sm font-medium text-slate-700">Result</span>
            <select name="verdict" defaultValue={q.verdict ?? ""} className={select}>
              <option value="">Any</option>
              <option value="fail">Fail</option>
              <option value="pass">Pass</option>
              <option value="none">No verdict</option>
            </select>
          </label>
          <button className="col-span-2 min-h-12 rounded-xl bg-(--brand) font-semibold text-(--brand-contrast)">Search</button>
        </form>
      </Card>

      {result.cutoff && (
        <p className="rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-700">
          Your plan shows records from {fmtDate(result.cutoff)} onwards. Older records are kept safely; ask PlantOps to extend the plan to see them.
        </p>
      )}

      <SectionTitle>
        {count}
        {result.capped ? "+" : ""} found{result.capped ? " (showing the newest 200 – narrow the search)" : ""}
      </SectionTitle>
      {result.kind === "batches" ? (
        <div className="space-y-2">
          {result.batches.map((b) => (
            <a key={b.id} href={`/batches/${b.id}`} className="block rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="text-lg font-semibold">{b.batch_no}</span>
                <StatusChip status={b.status} />
              </div>
              <p className="text-sm text-slate-500">
                {fmtDate(b.production_date)}
                {b.product_name && ` · ${b.product_name}`} · {b.tests} record{b.tests === 1 ? "" : "s"}
              </p>
            </a>
          ))}
        </div>
      ) : (
        <div className="space-y-2">
          {result.records.map((e) => (
            <EntryCard key={e.id} entry={e} />
          ))}
        </div>
      )}

      {user.isOwner && (
        <Card>
          <p className="font-semibold">Export everything</p>
          <p className="text-sm text-slate-600">All records and batches as spreadsheet files (CSV, opens in Excel), including anything older than your plan shows.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <a href="/api/export/records" className="inline-flex min-h-12 items-center rounded-xl border border-slate-300 bg-white px-5 font-semibold">
              ⬇ All records
            </a>
            <a href="/api/export/batches" className="inline-flex min-h-12 items-center rounded-xl border border-slate-300 bg-white px-5 font-semibold">
              ⬇ All batches
            </a>
          </div>
        </Card>
      )}
    </div>
  );
}
