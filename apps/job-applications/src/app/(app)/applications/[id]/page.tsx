import { orNotFound } from "@plantops/module-kit/pages";
import { fmtDateTime } from "@plantops/module-kit/format";
import { phoneDisplay } from "@plantops/module-kit/phone";
import { redirect } from "next/navigation";
import { can } from "@/server/access";
import { getApplication } from "@/server/applications";
import { kit } from "@/server/kit";
import { requirePageUser } from "@/server/session";
import { Header } from "../../header";
import { ContactButtons, StatusChip } from "../../parts";
import { NoteBox, RemoveNow, StatusButtons } from "./actions";

type Params = Promise<{ id: string }>;
const dateOnly = (iso: string) => new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric" }).format(new Date(iso));

/** Mock-up 6: one application. Opening it the first time (owner / HR desk) records "Opened by …". */
export default async function ApplicationPage({ params }: { params: Params }) {
  const { id } = await params;
  const user = await requirePageUser(`/applications/${id}`);
  if (!can(user, "read")) redirect("/applications");
  const [plant, a] = await Promise.all([kit.branding(user.tenantId), orNotFound(getApplication(user, id))]);
  const photos = a.files.filter((f) => f.type !== "application/pdf");
  const pdf = a.files.find((f) => f.type === "application/pdf");
  const rows: [string, React.ReactNode][] = [
    ["Position", a.position],
    ["Mobile", `+91 ${phoneDisplay(a.phone).text}`],
    ["Lives in", a.place],
    [
      "Applied before",
      a.appliedBefore.length ? (
        <span className="flex flex-col items-end gap-0.5">
          {a.appliedBefore.map((b) => (
            <a key={b.id} href={`/applications/${b.id}`} className="text-(--brand) underline-offset-2 hover:underline">
              {b.ref} · {b.position} · {dateOnly(b.at)}
            </a>
          ))}
        </span>
      ) : (
        "No"
      ),
    ],
  ];

  return (
    <div className="space-y-3.5">
      <Header user={user} plant={plant} />
      <a href="/applications" className="inline-flex min-h-11 items-center gap-1.5 text-[15px] font-semibold text-(--brand)">
        ‹ Applications
      </a>
      <div className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-bold">{a.name}</h1>
          <StatusChip status={a.status} />
        </div>
        <p className="text-sm text-slate-600">
          {a.ref} · sent {fmtDateTime(a.createdAt)} · from the public page
        </p>
      </div>
      {!user.isSupport && <ContactButtons phone={a.phone} />}

      <section className="rounded-2xl border border-slate-200 bg-white px-4 py-1">
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-3 border-b border-slate-100 py-3 text-[15px]">
            <span className="text-slate-600">{k}</span>
            <span className="text-right font-semibold">{v}</span>
          </div>
        ))}
        <p className="py-3 text-[13px] text-slate-600">Agreed to be kept for 12 months · removed on {dateOnly(a.removalOn)}</p>
      </section>

      <section className="space-y-2.5 rounded-2xl border border-slate-200 bg-white p-4">
        <h2 className="text-base font-bold">Resume · {pdf ? "PDF" : `${photos.length} photo${photos.length === 1 ? "" : "s"}`}</h2>
        {pdf ? (
          <a href={`/api/app/files/${pdf.id}`} target="_blank" rel="noopener" className="inline-flex min-h-12 items-center rounded-xl border border-slate-300 px-4 font-semibold">
            Open PDF ({Math.max(1, Math.round(pdf.size / 1024))} KB)
          </a>
        ) : (
          <div className="grid grid-cols-2 gap-2.5">
            {photos.map((f) => (
              <a key={f.id} href={`/api/app/files/${f.id}`} target="_blank" rel="noopener" className="relative block h-[200px] overflow-hidden rounded-[10px] border border-slate-300 bg-slate-100">
                {/* eslint-disable-next-line @next/next/no-img-element -- a resume page served by this app */}
                <img src={`/api/app/files/${f.id}`} alt={`Resume page ${f.pageNo}`} className="h-full w-full object-cover object-top" />
                <span className="absolute bottom-1.5 left-1.5 rounded bg-white/90 px-1.5 text-xs text-slate-700">Page {f.pageNo}</span>
              </a>
            ))}
          </div>
        )}
        <p className="text-[13px] text-slate-600">Tap a page to open it full screen. A PDF opens in the phone&apos;s viewer.</p>
      </section>

      <StatusButtons id={a.id} status={a.status} canEdit={can(user, "update")} />
      {can(user, "update") && <NoteBox id={a.id} />}

      <section className="space-y-2.5 rounded-2xl border border-slate-200 bg-white p-4">
        <h2 className="text-base font-bold">History</h2>
        <ul className="space-y-2">
          {a.history.map((h, i) => (
            <li key={i} className="flex gap-3 text-sm">
              <span className="w-24 shrink-0 whitespace-nowrap text-slate-600">{fmtDateTime(h.at)}</span>
              <span className="min-w-0 break-words">{h.text}</span>
            </li>
          ))}
        </ul>
      </section>

      {can(user, "remove") && (
        <div className="flex flex-col">
          <RemoveNow id={a.id} refText={a.ref} />
        </div>
      )}
    </div>
  );
}
