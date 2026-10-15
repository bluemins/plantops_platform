import { Card } from "@plantops/ui";
import { can } from "@/server/access";
import { kit } from "@/server/kit";
import { scanState } from "@/server/marks";
import { requirePageUser } from "@/server/session";
import { Header } from "../header";
import { ScanButton } from "./scan-button";

type Search = Promise<Record<string, string | string[] | undefined>>;

const today = () => new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", weekday: "long", day: "numeric", month: "short" }).format(new Date());

/**
 * The page the QR on the wall opens (mock-up "Worker · Scan the QR"): the person's state and one big button. Nothing is
 * saved until the tap. The key in the link is checked here and again when the mark is saved.
 */
export default async function ScanPage({ searchParams }: { searchParams: Search }) {
  const user = await requirePageUser("/scan"); // logged without the key
  const sp = await searchParams;
  const k = typeof sp.k === "string" ? sp.k : null;
  const plant = await kit.branding(user.tenantId);

  const message = (title: string, text: string, tone: "red" | "slate" = "red") => (
    <div className="space-y-5">
      <Header user={user} plant={plant} />
      <section className={`space-y-2 rounded-2xl border p-5 ${tone === "red" ? "border-red-200 bg-red-50 text-red-900" : "border-slate-200 bg-white"}`}>
        <h1 className="text-xl font-bold">{title}</h1>
        <p>{text}</p>
      </section>
      <a href="/" className="flex min-h-11 items-center justify-center font-semibold text-(--brand)">
        My attendance
      </a>
    </div>
  );

  if (user.isSupport) return message("Read-only", "PlantOps support can't mark attendance.", "slate");
  if (!can(user, "mark")) {
    return message(
      user.isOwner ? "Owners don't mark attendance" : "No access",
      user.isOwner ? "Add Plant staff to yourself on Manage users to mark." : "You don't have access to Attendance. Ask the plant owner.",
      "slate",
    );
  }

  const s = await scanState(user, k);
  if (s.key !== "ok") return message(s.key === "bad" ? "This QR is old" : "Can't mark here", s.key_message!);
  if (!s.location_set) return message("Not ready yet", "The owner hasn't set the plant location yet.", "slate");

  return (
    <div className="space-y-5">
      <Header user={user} plant={plant} />
      <ScanButton k={k!} name={user.name} date={today()} next={s.next} state={s.state} />
    </div>
  );
}
