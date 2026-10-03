import type { ReactNode } from "react";

/** dd-mm-yyyy, as written on paper registers. */
export function paperDate(value: string | null | undefined) {
  if (!value) return "";
  const ymd = value.length > 10 ? new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date(value)) : value;
  const [y, m, d] = ymd.split("-");
  return `${d}-${m}-${y}`;
}

export const paperTime = (iso: string) =>
  new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso));

/**
 * The sheet's look: black ruled table, header rows "Plant Name" / "FORM n" / title across the full width
 * (merged A1:V1 etc. in the Excel), then the column headings. Printed on A4 (landscape for the registers).
 */
export function Sheet({
  plant,
  code,
  title,
  period,
  orientation,
  footer,
  children,
}: {
  plant: string;
  code: string;
  title: string;
  period?: string;
  orientation: "landscape" | "portrait";
  footer: string;
  children: ReactNode;
}) {
  return (
    <div className="print-sheet bg-white text-black">
      <style>{`
        @page { size: A4 ${orientation}; margin: 9mm 8mm 12mm;
          @bottom-left { content: "${footer.replace(/"/g, "'")}"; font: 7pt system-ui, sans-serif; color: #444; }
          @bottom-right { content: "Page " counter(page) " of " counter(pages); font: 7pt system-ui, sans-serif; color: #444; } }
        .sheet table { border-collapse: collapse; width: 100%; font: 8pt/1.25 system-ui, sans-serif; }
        .sheet th, .sheet td { border: 1px solid #000; padding: 3px 4px; vertical-align: top; }
        .sheet th { font-weight: 700; text-align: center; vertical-align: middle; background: #f2f2f2; }
        .sheet thead { display: table-header-group; }
        .sheet tr { break-inside: avoid; }
        .sheet .vert { writing-mode: vertical-rl; transform: rotate(180deg); white-space: nowrap; padding: 4px 2px; }
        .sheet .sign { min-width: 22mm; height: 11mm; }
        .sheet .num { text-align: center; }
        .sheet .fail { font-weight: 700; text-decoration: underline; }
        .sheet .muted { color: #555; font-size: 7pt; }
        @media print { .sheet { padding: 0 } }
      `}</style>
      <div className="sheet mx-auto p-4">
        <table>
          <tbody>
            <tr>
              <td className="text-center" style={{ fontSize: "11pt", fontWeight: 700, padding: "5px" }}>{plant}</td>
            </tr>
            {code && (
              <tr>
                <td className="text-center" style={{ fontWeight: 700 }}>{code}</td>
              </tr>
            )}
            <tr>
              <td className="text-center" style={{ fontWeight: 700 }}>
                {title}
                {period && <span style={{ fontWeight: 400 }}> · {period}</span>}
              </td>
            </tr>
          </tbody>
        </table>
        <div style={{ height: 0 }} />
        {children}
      </div>
    </div>
  );
}

/** "Sign" / "Verified By" cell: the name and date from the app, with room to sign by hand. */
export function SignCell({ name, at }: { name?: string | null; at?: string | null }) {
  return (
    <td className="sign">
      {name && (
        <>
          {name}
          <br />
          <span className="muted">{paperDate(at)}</span>
        </>
      )}
    </td>
  );
}
