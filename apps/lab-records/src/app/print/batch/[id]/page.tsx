import { Card } from "@plantops/ui";
import { FORMS, fieldText } from "@/lib/forms";
import { limitText } from "@/lib/verdict";
import { getBatch } from "@/server/batches";
import { uuidParam } from "@/server/http";
import { orHidden } from "@/server/pages";
import { branding } from "@/server/platform";
import { requirePageUser } from "@/server/session";
import { PrintButton } from "../../print-button";
import { paperDate, paperTime, Sheet, SignCell } from "../../sheet";

type Props = { params: Promise<{ id: string }> };

const STATUS: Record<string, string> = { pending: "Awaiting approval", on_hold: "ON HOLD", approved: "Approved for production", rejected: "Rejected" };
const EVENT: Record<string, string> = { created: "Created", held: "Put on hold", released: "Hold released", approved: "Approved", rejected: "Rejected" };

/** Everything about one batch on paper: status, every test and record (current version), corrective actions, history. */
export default async function BatchReportPage({ params }: Props) {
  const { id } = await params;
  const user = await requirePageUser(`/print/batch/${id}`);
  const [plant, batch] = await Promise.all([branding(user.tenantId), orHidden(getBatch(user, uuidParam(id)))]);
  if ("hidden" in batch) return <Card>{batch.hidden}</Card>;
  const printed = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date());
  const tests = [...batch.entries].filter((e) => e.current.results.length).sort((a, b) => a.current.tested_at.localeCompare(b.current.tested_at));
  const records = [...batch.entries].filter((e) => !e.current.results.length).sort((a, b) => a.current.tested_at.localeCompare(b.current.tested_at));
  const decided = [...batch.events].reverse().find((e) => e.event === "approved" || e.event === "rejected");

  return (
    <>
      <div className="no-print mx-auto flex max-w-3xl flex-wrap items-center gap-3 px-4 py-4">
        <a href={`/batches/${batch.id}`} className="text-sm font-semibold text-(--brand)">
          ← Back to batch
        </a>
        <PrintButton />
      </div>
      <Sheet plant={plant?.name ?? "Plant Name"} code="" title={`Batch report – ${batch.batch_no}`} orientation="portrait" footer={`Printed from PlantOps Lab Records on ${printed} by ${user.name}`}>
        <table style={{ marginTop: "6px" }}>
          <tbody>
            <tr>
              <th style={{ width: "25%", textAlign: "left" }}>Batch No.</th>
              <td>{batch.batch_no}</td>
              <th style={{ width: "25%", textAlign: "left" }}>Date of Prodn.</th>
              <td>{paperDate(batch.production_date)}</td>
            </tr>
            <tr>
              <th style={{ textAlign: "left" }}>Product</th>
              <td>{batch.product_name ?? "—"}</td>
              <th style={{ textAlign: "left" }}>Status</th>
              <td style={{ fontWeight: 700 }}>
                {STATUS[batch.status]}
                {decided && (
                  <span className="muted">
                    {" "}
                    – {decided.by_name}, {paperDate(decided.at)}
                    {decided.note ? `: ${decided.note}` : ""}
                  </span>
                )}
              </td>
            </tr>
          </tbody>
        </table>

        <h3 style={{ font: "700 9pt system-ui", margin: "10px 0 4px" }}>Tests</h3>
        <table>
          <thead>
            <tr>
              {["Sr.", "Record", "Date / time", "Parameter", "Value", "Limit", "Result", "Sign", "Verified By"].map((h) => (
                <th key={h}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {tests.length === 0 && (
              <tr>
                <td colSpan={9}>No tests.</td>
              </tr>
            )}
            {tests.map((e, i) =>
              e.current.results.map((r, j) => (
                <tr key={`${e.id}-${r.parameter_id}`}>
                  {j === 0 && (
                    <>
                      <td rowSpan={e.current.results.length} className="num">
                        {i + 1}
                      </td>
                      <td rowSpan={e.current.results.length}>
                        {FORMS[e.form].short}
                        {e.current.version > 1 && <div className="muted">Corrected (v{e.current.version}): {e.current.reason}</div>}
                      </td>
                      <td rowSpan={e.current.results.length}>
                        {paperDate(e.current.tested_at)}
                        {e.form === "daily" ? ` ${paperTime(e.current.tested_at)}` : ""}
                      </td>
                    </>
                  )}
                  <td>{r.name}</td>
                  <td className={`num ${r.verdict === "fail" ? "fail" : ""}`}>
                    {r.value} {r.unit ?? ""}
                  </td>
                  <td className="num">{limitText(r.limit_min, r.limit_max)}</td>
                  <td className="num">{r.verdict === "fail" ? "FAIL" : r.verdict === "pass" ? "Pass" : ""}</td>
                  {j === 0 && (
                    <>
                      <td rowSpan={e.current.results.length} className="sign">
                        {e.current.entered_by_name}
                        <br />
                        <span className="muted">{paperDate(e.current.entered_at)}</span>
                      </td>
                      <td rowSpan={e.current.results.length} className="sign">
                        {e.current.verified ? (
                          <>
                            {e.current.verified.by}
                            <br />
                            <span className="muted">{paperDate(e.current.verified.at)}</span>
                          </>
                        ) : null}
                      </td>
                    </>
                  )}
                </tr>
              )),
            )}
          </tbody>
        </table>

        {records.length > 0 && (
          <>
            <h3 style={{ font: "700 9pt system-ui", margin: "10px 0 4px" }}>Other records</h3>
            <table>
              <thead>
                <tr>
                  {["Sr.", "Record", "Details", "Sign", "Verified By"].map((h) => (
                    <th key={h}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {records.map((e, i) => (
                  <tr key={e.id}>
                    <td className="num">{i + 1}</td>
                    <td>{FORMS[e.form].short}</td>
                    <td>
                      {FORMS[e.form].fields
                        .map((f) => [f.label, fieldText(f, e.current.data[f.key])] as const)
                        .filter(([, v]) => v)
                        .map(([l, v]) => `${l}: ${v}`)
                        .join(" · ")}
                    </td>
                    <SignCell name={e.current.entered_by_name} at={e.current.entered_at} />
                    <SignCell name={e.current.verified?.by} at={e.current.verified?.at} />
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}

        {batch.corrective.length > 0 && (
          <>
            <h3 style={{ font: "700 9pt system-ui", margin: "10px 0 4px" }}>Corrective actions</h3>
            <table>
              <tbody>
                {[...batch.corrective].reverse().map((c) => (
                  <tr key={c.id}>
                    <td style={{ width: "22%" }}>
                      {paperDate(c.at)} {paperTime(c.at)}
                    </td>
                    <td>{c.note}</td>
                    <td style={{ width: "20%" }}>{c.by_name}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}

        <h3 style={{ font: "700 9pt system-ui", margin: "10px 0 4px" }}>History</h3>
        <table>
          <tbody>
            {batch.events.map((e, i) => (
              <tr key={i}>
                <td style={{ width: "22%" }}>
                  {paperDate(e.at)} {paperTime(e.at)}
                </td>
                <td style={{ width: "18%" }}>{EVENT[e.event] ?? e.event}</td>
                <td style={{ width: "20%" }}>{e.by_name}</td>
                <td>{e.note}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <table style={{ marginTop: "18px" }}>
          <tbody>
            <tr>
              <td style={{ height: "18mm", width: "50%", verticalAlign: "bottom" }}>Lab in-charge (sign &amp; date)</td>
              <td style={{ verticalAlign: "bottom" }}>Approved by (sign &amp; date)</td>
            </tr>
          </tbody>
        </table>
      </Sheet>
    </>
  );
}
