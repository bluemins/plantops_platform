import { listEntries } from "@/server/entries";
import { branding } from "@/server/platform";
import { requirePageUser } from "@/server/session";
import { fmtDateTime } from "@/lib/format";
import { FORMS, fieldText, type FormId } from "@/lib/forms";
import { LinkButton, SectionTitle, VerdictBadge } from "@/lib/ui";
import { Header } from "../header";

const LISTED: FormId[] = ["form1", "form2", "form3", "form4"];

/** A one-line summary of a record for lists ("Borewell 2 · SGS"). */
function headline(form: FormId, data: Record<string, unknown>, batchNo: string | null) {
  const pick = (k: string) => fieldText(FORMS[form].fields.find((f) => f.key === k)!, data[k]);
  if (form === "form3") return `${pick("source_of_water")} · ${pick("lab_name")}`;
  if (form === "form4") return `${pick("packaging_type")} · ${pick("supplier")}`;
  if (form === "form2") return `Batch ${batchNo} · ${pick("lab_name")}`;
  return `Batch ${batchNo} · ${pick("source")}`;
}

/** The four FSSAI forms: recent records of each, and "+ New" for lab staff. */
export default async function FormsPage() {
  const user = await requirePageUser("/forms");
  const [plant, ...lists] = await Promise.all([branding(user.tenantId), ...LISTED.map((f) => listEntries(user, f, 5))]);
  return (
    <div className="space-y-5">
      <Header user={user} plant={plant} />
      <a href="/" className="text-sm font-semibold text-(--brand)">
        ← Home
      </a>
      <h1 className="text-2xl font-bold">FSSAI forms</h1>
      <p className="text-slate-600">
        Print any form for a date range in the government layout. The daily in-house register prints too:{" "}
        <a href="/print/daily" className="font-semibold text-(--brand) underline">
          print daily tests
        </a>
        .
      </p>
      {LISTED.map((id, i) => {
        const def = FORMS[id];
        const list = lists[i]!;
        return (
          <section key={id} className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <SectionTitle>
                {def.code} · {def.title.length > 40 ? def.short.split(" · ")[1] : def.title}
              </SectionTitle>
              <a href={`/search?kind=records&form=${id}`} className="text-sm font-semibold text-(--brand)">
                All →
              </a>
            </div>
            {list.length === 0 && <p className="text-sm text-slate-500">No records yet.</p>}
            {list.map((e) => (
              <a key={e.id} href={`/entries/${e.id}`} className="flex items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3">
                <span className="min-w-0">
                  <span className="block truncate font-medium">{headline(id, e.current.data, e.batch_no)}</span>
                  <span className="block text-sm text-slate-500">
                    {fmtDateTime(e.current.tested_at).split(",")[0]} · {e.current.entered_by_name}
                    {e.current.verified ? " · ✓ verified" : ""}
                  </span>
                </span>
                <VerdictBadge verdict={e.current.verdict} />
              </a>
            ))}
            <div className="flex flex-wrap gap-2">
              {user.canEnter && (
                <LinkButton href={`/forms/${id}/new`} variant="secondary">
                  + New {def.code} record
                </LinkButton>
              )}
              <LinkButton href={`/print/${id}`} variant="secondary">
                🖨 Print {def.code}
              </LinkButton>
            </div>
          </section>
        );
      })}
    </div>
  );
}
