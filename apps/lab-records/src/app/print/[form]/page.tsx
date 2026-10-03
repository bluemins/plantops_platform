import { notFound } from "next/navigation";
import { z } from "zod";
import { FORMS, OUTCOMES, SOURCES, type FormId } from "@/lib/forms";
import { FORM1_PARAMETERS } from "@/server/parameters";
import { branding } from "@/server/platform";
import { defaultRange, printRows, type PrintRow } from "@/server/print";
import { requirePageUser } from "@/server/session";
import { PrintButton } from "../print-button";
import { paperDate, paperTime, Sheet, SignCell } from "../sheet";

type Props = { params: Promise<{ form: string }>; searchParams: Promise<{ from?: string; to?: string }> };

const Ymd = z.iso.date();
const str = (v: unknown) => (v === undefined || v === null ? "" : String(v));

/** The Remark cell: the remark, plus anything the paper reader must know (corrections, where Form 1 was tested). */
function Remark({ row }: { row: PrintRow }) {
  const v = row.current;
  const d = v.data;
  const notes: string[] = [];
  if (row.form === "form1") {
    notes.push(d.source === "outside" ? `${SOURCES.outside}: ${str(d.lab_name)}, report ${str(d.report_no)}${d.report_date ? ` dt. ${paperDate(str(d.report_date))}` : ""}` : SOURCES.in_house);
  }
  if ((row.form === "form3" || row.form === "form4") && d.outcome) notes.push(`Outcome: ${OUTCOMES[d.outcome as keyof typeof OUTCOMES]}`);
  return (
    <td>
      {v.remark}
      {notes.map((n) => (
        <div key={n} className="muted">
          {n}
        </div>
      ))}
      {v.version > 1 && <div className="muted">Corrected (v{v.version}): {v.reason}</div>}
    </td>
  );
}

const Sign = ({ row }: { row: PrintRow }) => (
  <>
    <SignCell name={row.current.entered_by_name} at={row.current.entered_at} />
    <SignCell name={row.current.verified?.by} at={row.current.verified?.at} />
  </>
);

function Form1Table({ rows }: { rows: PrintRow[] }) {
  return (
    <table>
      <thead>
        <tr>
          <th>Sr. No.</th>
          <th>Date of Prodn.</th>
          <th>Batch No.</th>
          {FORM1_PARAMETERS.map((p) => (
            <th key={p.code}>
              <span className="vert">{p.name}</span>
            </th>
          ))}
          <th>Remark</th>
          <th>Sign</th>
          <th>Verified By</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={r.id}>
            <td className="num">{i + 1}</td>
            <td>{paperDate(r.production_date)}</td>
            <td>{r.batch_no}</td>
            {FORM1_PARAMETERS.map((p) => {
              const res = r.current.results.find((x) => x.name === p.name);
              return (
                <td key={p.code} className={`num ${res?.verdict === "fail" ? "fail" : ""}`}>
                  {res?.value ?? ""}
                </td>
              );
            })}
            <Remark row={r} />
            <Sign row={r} />
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Form2Table({ rows }: { rows: PrintRow[] }) {
  return (
    <table>
      <thead>
        <tr>
          {["Sr. No.", "Batch No", "Date of Manufacturing", "Type of Packing", "Date on which sample sent", "Lab to which sample sent", "Test report No", "Test report date", "Remark", "Sign", "Verified By"].map((h) => (
            <th key={h}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => {
          const d = r.current.data;
          return (
            <tr key={r.id}>
              <td className="num">{i + 1}</td>
              <td>{r.batch_no}</td>
              <td>{paperDate(str(d.manufacturing_date))}</td>
              <td>{str(d.packing_type)}</td>
              <td>{paperDate(str(d.sample_sent_on))}</td>
              <td>{str(d.lab_name)}</td>
              <td>{str(d.report_no)}</td>
              <td>{paperDate(str(d.report_date))}</td>
              <Remark row={r} />
              <Sign row={r} />
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function Form3Table({ rows }: { rows: PrintRow[] }) {
  return (
    <table>
      <thead>
        <tr>
          <th rowSpan={2}>Sr. No.</th>
          <th rowSpan={2}>Source of Water</th>
          <th colSpan={3}>Testing</th>
          <th rowSpan={2}>Record of Test Report</th>
          <th rowSpan={2}>Results</th>
          <th rowSpan={2}>Remark</th>
          <th rowSpan={2}>Sign</th>
          <th rowSpan={2}>Verified By</th>
        </tr>
        <tr>
          <th>Name of Lab</th>
          <th>Sample Sent on</th>
          <th>Test Report No. and Date</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => {
          const d = r.current.data;
          return (
            <tr key={r.id}>
              <td className="num">{i + 1}</td>
              <td>{str(d.source_of_water)}</td>
              <td>{str(d.lab_name)}</td>
              <td>{paperDate(str(d.sample_sent_on))}</td>
              <td>
                {str(d.report_no)}
                {d.report_date ? ` dt. ${paperDate(str(d.report_date))}` : ""}
              </td>
              <td />
              <td style={{ whiteSpace: "pre-wrap" }}>{str(d.results)}</td>
              <Remark row={r} />
              <Sign row={r} />
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function Form4Table({ rows }: { rows: PrintRow[] }) {
  return (
    <table>
      <thead>
        <tr>
          <th rowSpan={2}>Sr. No.</th>
          <th rowSpan={2}>Type of Packaging Water</th>
          <th rowSpan={2}>Name of Supplier</th>
          <th rowSpan={2}>Quantity Received</th>
          <th colSpan={2}>Details of testing</th>
          <th colSpan={2}>Results</th>
          <th rowSpan={2}>Remark</th>
          <th rowSpan={2}>Sign</th>
          <th rowSpan={2}>Verified By</th>
        </tr>
        <tr>
          <th>Name of lab</th>
          <th>Date of sending samples</th>
          <th>Overall migration</th>
          <th>Remaining Parameters as per FSS PKG Regulation 2018</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => {
          const d = r.current.data;
          return (
            <tr key={r.id}>
              <td className="num">{i + 1}</td>
              <td>{str(d.packaging_type)}</td>
              <td>{str(d.supplier)}</td>
              <td>{str(d.quantity_received)}</td>
              <td>{str(d.lab_name)}</td>
              <td>{paperDate(str(d.samples_sent_on))}</td>
              <td>{str(d.overall_migration)}</td>
              <td style={{ whiteSpace: "pre-wrap" }}>{str(d.remaining_parameters)}</td>
              <Remark row={r} />
              <Sign row={r} />
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/** Daily in-house register (not a government form, same look): one column per check that appears in the period. */
function DailyTable({ rows }: { rows: PrintRow[] }) {
  const names: string[] = [];
  for (const r of rows) for (const x of r.current.results) if (!names.includes(x.name)) names.push(x.name);
  return (
    <table>
      <thead>
        <tr>
          <th>Sr. No.</th>
          <th>Date</th>
          <th>Time</th>
          <th>Batch No.</th>
          {names.map((n) => (
            <th key={n}>{n}</th>
          ))}
          <th>Result</th>
          <th>Remark</th>
          <th>Sign</th>
          <th>Verified By</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={r.id}>
            <td className="num">{i + 1}</td>
            <td>{paperDate(r.current.tested_at)}</td>
            <td>{paperTime(r.current.tested_at)}</td>
            <td>{r.batch_no ?? "—"}</td>
            {names.map((n) => {
              const res = r.current.results.find((x) => x.name === n);
              return (
                <td key={n} className={`num ${res?.verdict === "fail" ? "fail" : ""}`}>
                  {res?.value ?? ""}
                </td>
              );
            })}
            <td className="num">{r.current.verdict === "fail" ? "FAIL" : r.current.verdict === "pass" ? "Pass" : ""}</td>
            <Remark row={r} />
            <Sign row={r} />
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const TABLES: Record<FormId, (p: { rows: PrintRow[] }) => React.ReactNode> = {
  daily: DailyTable,
  form1: Form1Table,
  form2: Form2Table,
  form3: Form3Table,
  form4: Form4Table,
};

/** One FSSAI register for a date range, in the same layout as the Excel sheet, ready for Print / Save as PDF. */
export default async function PrintFormPage({ params, searchParams }: Props) {
  const { form } = await params;
  if (!(form in FORMS)) notFound();
  const def = FORMS[form as FormId];
  const q = await searchParams;
  const range = { ...defaultRange(), ...(Ymd.safeParse(q.from).success ? { from: q.from! } : {}), ...(Ymd.safeParse(q.to).success ? { to: q.to! } : {}) };
  const user = await requirePageUser(`/print/${form}?from=${range.from}&to=${range.to}`);
  const [plant, data] = await Promise.all([branding(user.tenantId), printRows(user, def.id, range)]);
  const Table = TABLES[def.id];
  const printed = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date());

  return (
    <>
      <div className="no-print mx-auto max-w-3xl space-y-3 px-4 py-4">
        <a href="/forms" className="text-sm font-semibold text-(--brand)">
          ← Back
        </a>
        <form method="get" className="flex flex-wrap items-end gap-3">
          <label>
            <span className="block text-sm font-medium text-slate-700">From</span>
            <input type="date" name="from" defaultValue={data.from} className="min-h-12 rounded-xl border border-slate-300 bg-white px-3" />
          </label>
          <label>
            <span className="block text-sm font-medium text-slate-700">To</span>
            <input type="date" name="to" defaultValue={data.to} className="min-h-12 rounded-xl border border-slate-300 bg-white px-3" />
          </label>
          <button className="min-h-12 rounded-xl border border-slate-300 bg-white px-5 font-semibold">Show</button>
          <PrintButton />
        </form>
        <p className="text-sm text-slate-600">
          {data.rows.length} record{data.rows.length === 1 ? "" : "s"}. Tip: in the print window choose <b>Landscape</b> and turn off <b>Headers and footers</b>.
          {data.cutoff && data.from === data.cutoff && " Older records are outside your plan's history window."}
        </p>
      </div>
      <Sheet
        plant={plant?.name ?? "Plant Name"}
        code={def.code}
        title={def.title}
        period={`${paperDate(data.from)} to ${paperDate(data.to)}`}
        orientation="landscape"
        footer={`Printed from PlantOps Lab Records on ${printed} by ${user.name}`}
      >
        <Table rows={data.rows} />
        {data.rows.length === 0 && <p style={{ padding: "8px", font: "9pt system-ui" }}>No records in this period.</p>}
      </Sheet>
    </>
  );
}
