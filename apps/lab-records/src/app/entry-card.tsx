import { fmtDateTime } from "@/lib/format";
import { VerdictBadge, verdictText } from "@/lib/ui";
import { limitText } from "@/lib/verdict";
import type { EntryView, VersionView } from "@/server/entries";

/** One version's values as a small table: value, allowed range (as it was at test time), pass/fail. */
export function ResultsTable({ version }: { version: VersionView }) {
  return (
    <table className="mt-2 w-full text-sm">
      <tbody>
        {version.results.map((r) => (
          <tr key={r.parameter_id} className="border-t border-slate-100">
            <td className="py-1.5 pr-2 text-slate-600">{r.name}</td>
            <td className={`py-1.5 pr-2 text-right ${verdictText(r.verdict)}`}>
              {r.value}
              {r.unit ? <span className="ml-1 font-normal text-slate-400">{r.unit}</span> : null}
            </td>
            <td className="py-1.5 text-right text-slate-400">{limitText(r.limit_min, r.limit_max)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const FORM_NAMES: Record<string, string> = { daily: "Daily test", form1: "Form 1", form2: "Form 2", form3: "Form 3", form4: "Form 4" };

/** A test as it stands now (latest version), linking to its full history. */
export function EntryCard({ entry }: { entry: EntryView }) {
  const v = entry.current;
  return (
    <a href={`/entries/${entry.id}`} className="block rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <span className="font-semibold">
          {FORM_NAMES[entry.form]} · {fmtDateTime(v.tested_at)}
        </span>
        <VerdictBadge verdict={v.verdict} />
      </div>
      <p className="text-sm text-slate-500">
        {v.entered_by_name}
        {v.version > 1 && <span className="ml-1 rounded bg-amber-100 px-1.5 text-amber-800">corrected · v{v.version}</span>}
      </p>
      <ResultsTable version={v} />
      {v.remark && <p className="mt-2 text-sm text-slate-600">Remark: {v.remark}</p>}
    </a>
  );
}
