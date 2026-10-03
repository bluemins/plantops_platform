import { Card } from "@plantops/ui";
import { listBatches, todaysTests } from "@/server/batches";
import { branding } from "@/server/platform";
import { form1DueFor } from "@/server/reminders";
import { requirePageUser } from "@/server/session";
import { fmtAge, fmtDate, fmtDateTime } from "@/lib/format";
import { LinkButton, SectionTitle, StatusChip, VerdictBadge } from "@/lib/ui";
import { Header } from "./header";

function greeting() {
  const h = Number(new Intl.DateTimeFormat("en-IN", { hour: "numeric", hourCycle: "h23", timeZone: "Asia/Kolkata" }).format(new Date()));
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

/** Lab Records home: what needs attention, quick actions for this user's role, recent batches and today's tests. */
export default async function HomePage() {
  const user = await requirePageUser("/");
  const [plant, batches, tests, held, waiting, form1Due] = await Promise.all([
    branding(user.tenantId),
    listBatches(user, { limit: 20 }),
    todaysTests(user),
    listBatches(user, { statuses: ["on_hold"], limit: 50 }),
    user.canApprove ? listBatches(user, { statuses: ["pending"], limit: 50 }) : Promise.resolve([]),
    form1DueFor(user.tenantId),
  ]);
  const onHold = held;

  return (
    <div className="space-y-5">
      <Header user={user} plant={plant} />
      <div>
        <h1 className="text-2xl font-bold">
          {greeting()}, {user.name.split(" ")[0]}
        </h1>
        <p className="text-slate-500">{user.isSupport ? "Read-only support view." : user.canEnter ? "Enter today's tests, or open a batch." : "View this plant's batches and tests."}</p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:flex sm:flex-wrap">
        {user.canEnter && <LinkButton href="/tests/new">+ Daily test</LinkButton>}
        {user.canEnter && <LinkButton href="/batches/new" variant="secondary">+ New batch</LinkButton>}
        <LinkButton href="/forms" variant="secondary">FSSAI forms</LinkButton>
        <LinkButton href="/search" variant="secondary">Search</LinkButton>
        {user.canApprove && <LinkButton href="/settings" variant="secondary">Tests &amp; limits</LinkButton>}
        {user.isOwner && <LinkButton href="/support-access" variant="secondary">Support access</LinkButton>}
      </div>

      {form1Due && (
        <a href={user.canEnter ? "/forms/form1/new" : "/forms"} className="block rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 font-semibold text-amber-900">
          Form 1 (monthly testing) is due this month →
        </a>
      )}

      {waiting.length > 0 && (
        <Card className="border-amber-200 bg-amber-50">
          <p className="font-semibold text-amber-900">
            {waiting.length} batch{waiting.length === 1 ? "" : "es"} awaiting your approval
          </p>
          <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
            {waiting.map((b) => (
              <li key={b.id}>
                <a href={`/batches/${b.id}`} className="font-semibold text-amber-900 underline">
                  {b.batch_no}
                </a>
                <span className="text-sm text-amber-800"> ({b.tests} test{b.tests === 1 ? "" : "s"})</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {onHold.length > 0 && (
        <Card className="border-red-200 bg-red-50">
          <p className="font-semibold text-red-800">
            {onHold.length} batch{onHold.length === 1 ? "" : "es"} on hold
          </p>
          <ul className="mt-1 space-y-1">
            {onHold.map((b) => (
              <li key={b.id}>
                <a href={`/batches/${b.id}`} className="font-semibold text-red-800 underline">
                  {b.batch_no}
                </a>
                {b.held_since && <span className="text-red-700"> · on hold {fmtAge(b.held_since)}</span>}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <SectionTitle>Today&apos;s tests</SectionTitle>
      {tests.length === 0 ? (
        <p className="text-slate-500">No tests entered today yet.</p>
      ) : (
        <div className="space-y-2">
          {tests.map((e) => (
            <a key={e.id} href={`/entries/${e.id}`} className="block rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold">{e.batch_no ? `Batch ${e.batch_no}` : "General check"}</span>
                <VerdictBadge verdict={e.current.verdict} />
              </div>
              <p className="text-sm text-slate-500">
                {fmtDateTime(e.current.tested_at)} · {e.current.entered_by_name}
                {e.current.version > 1 && ` · corrected (v${e.current.version})`}
              </p>
              <p className="mt-1 text-sm text-slate-700">
                {e.current.results.map((r) => `${r.name} ${r.value}`).join(" · ")}
              </p>
            </a>
          ))}
        </div>
      )}

      <SectionTitle>Batches</SectionTitle>
      {batches.length === 0 ? (
        <p className="text-slate-500">No batches yet.{user.canEnter ? " Tap “New batch” to add the first one." : ""}</p>
      ) : (
        <div className="space-y-2">
          {batches.map((b) => (
            <a key={b.id} href={`/batches/${b.id}`} className="block rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="text-lg font-semibold">{b.batch_no}</span>
                <StatusChip status={b.status} />
              </div>
              <p className="text-sm text-slate-500">
                {fmtDate(b.production_date)}
                {b.product_name && ` · ${b.product_name}`} · {b.tests} test{b.tests === 1 ? "" : "s"}
              </p>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
