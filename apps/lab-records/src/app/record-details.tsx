import { FORMS, fieldText } from "@/lib/forms";
import type { EntryView, VersionView } from "@/server/entries";
import { ResultsTable } from "./entry-card";

/** A record's own columns (from the sheet) as label / value pairs, then its results if any. */
export function RecordDetails({ entry, version }: { entry: EntryView; version: VersionView }) {
  const def = FORMS[entry.form];
  const rows = def.fields.map((f) => [f.label, fieldText(f, version.data[f.key])] as const).filter(([, v]) => v);
  return (
    <>
      {(entry.batch_no || rows.length > 0) && (
        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          {entry.batch_no && (
            <>
              <dt className="text-slate-500">Batch no.</dt>
              <dd className="font-medium">
                <a href={`/batches/${entry.batch_id}`} className="text-(--brand) underline">
                  {entry.batch_no}
                </a>
              </dd>
            </>
          )}
          {rows.map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-slate-500">{label}</dt>
              <dd className="font-medium whitespace-pre-wrap">{value}</dd>
            </div>
          ))}
        </dl>
      )}
      {version.results.length > 0 && <ResultsTable version={version} />}
    </>
  );
}
