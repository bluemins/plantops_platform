import { notFound } from "next/navigation";
import { Card } from "@plantops/ui";
import { fmtDateTime } from "@plantops/module-kit/format";
import { getComplaint, type EventView, type FileView } from "@/server/inbox";
import { kit } from "@/server/kit";
import { orNotFound } from "@/server/pages";
import { requirePageUser } from "@/server/session";
import { Header } from "../../header";
import { AgeText, BackLink, PhoneLink, StatusBadge } from "../../parts";
import { ComplaintActions } from "./actions";

type Params = Promise<{ id: string }>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const EVENT_TEXT: Record<EventView["kind"], string> = {
  in_progress: "set it In progress",
  resolved: "resolved it",
  reopened: "reopened it",
  note: "added a note",
};

/** One complaint: details, photos / video, history, and the buttons this person may use. */
export default async function ComplaintPage({ params }: { params: Params }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const user = await requirePageUser(`/c/${id}`);
  const [plant, c] = await Promise.all([kit.branding(user.tenantId), orNotFound(getComplaint(user, id))]);

  return (
    <div className="space-y-5">
      <Header user={user} plant={plant} />
      <BackLink />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold">{c.ref}</h1>
        <div className="flex items-center gap-2">
          <AgeText status={c.status} days={c.days_open} amber={c.amber} changedAt={c.status_changed_at} />
          <StatusBadge status={c.status} />
        </div>
      </div>

      <Card className="space-y-3">
        <Row label="Customer">{c.customer_name}</Row>
        <Row label="Mobile">
          <PhoneLink phone={c.phone} plain={user.isSupport} />
        </Row>
        <Row label="Place">{c.place}</Row>
        <Row label="Item">{c.item_name}</Row>
        {c.batch_text && <Row label="Batch / date on the bottle">{c.batch_text}</Row>}
        <Row label="What went wrong">
          <span className="whitespace-pre-line">{c.description}</span>
        </Row>
        <p className="text-sm text-slate-500">
          Logged by {c.reported_by_name}, {fmtDateTime(c.created_at)}
        </p>
        {(c.photos.length > 0 || c.video) && <Media photos={c.photos} video={c.video} />}
      </Card>

      <ComplaintActions complaint={{ id: c.id, ref: c.ref, status: c.status }} can={c.can} />

      <section className="space-y-3">
        <h2 className="text-lg font-bold">History</h2>
        <Card>
          <ol className="space-y-4">
            <li>
              <p>
                <span className="font-semibold">{c.reported_by_name}</span> logged the complaint
              </p>
              <p className="text-sm text-slate-500">{fmtDateTime(c.created_at)}</p>
            </li>
            {c.history.map((e) => (
              <li key={e.id} className="border-t border-slate-100 pt-3">
                <p>
                  <span className="font-semibold">{e.by}</span> {EVENT_TEXT[e.kind]}
                  {e.text && (e.kind === "note" ? ":" : `: ${e.text}`)}
                </p>
                {e.kind === "note" && e.text && <p className="mt-1 whitespace-pre-line rounded-lg bg-slate-50 px-3 py-2">{e.text}</p>}
                {e.photos.length > 0 && <Media photos={e.photos} video={null} />}
                <p className="text-sm text-slate-500">{fmtDateTime(e.at)}</p>
              </li>
            ))}
          </ol>
        </Card>
      </section>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-sm text-slate-500">{label}</p>
      <div className="font-medium">{children}</div>
    </div>
  );
}

/** Photos (tap for full size) and the video. Both are served by /files/<id>, only to this plant. */
function Media({ photos, video }: { photos: FileView[]; video: FileView | null }) {
  return (
    <div className="mt-2 space-y-2">
      {photos.length > 0 && (
        <ul className="grid grid-cols-3 gap-2">
          {photos.map((p) => (
            <li key={p.id}>
              <a href={`/files/${p.id}`} target="_blank" rel="noreferrer">
                {/* eslint-disable-next-line @next/next/no-img-element -- private file, served by this module */}
                <img src={`/files/${p.id}`} alt="Complaint photo" loading="lazy" className="aspect-square w-full rounded-lg object-cover" />
              </a>
            </li>
          ))}
        </ul>
      )}
      {video && <video src={`/files/${video.id}`} controls playsInline preload="metadata" className="w-full rounded-lg bg-black" />}
    </div>
  );
}
