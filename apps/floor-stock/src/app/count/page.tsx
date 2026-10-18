import { redirect } from "next/navigation";
import { Card } from "@plantops/ui";
import { fmtDate } from "@plantops/module-kit/format";
import { istTime } from "@/lib/days";
import { allowedDates, countDates, countForm } from "@/server/counts";
import { kit } from "@/server/kit";
import { requirePageUser } from "@/server/session";
import { LinkButton } from "@/lib/ui";
import { Header } from "../header";
import { CountEntry } from "./entry";

type Props = { searchParams: Promise<{ date?: string; correct?: string }> };

/** Enter today's (or yesterday's) count, or correct one. Owner or store keeper. */
export default async function CountPage({ searchParams }: Props) {
  const q = await searchParams;
  const [today, yesterday] = allowedDates();
  // until 5 am the count opens on last night's date (B-05), also from the 8 pm reminder's plain /count link
  const day = countDates();
  const date = q.date ?? day.main;
  const user = await requirePageUser(`/count?date=${encodeURIComponent(date)}${q.correct ? "&correct=1" : ""}`);
  if (!user.canCount || user.isSupport) redirect(`/day/${date}`);
  const plant = await kit.branding(user.tenantId);

  if (date !== today && date !== yesterday) {
    return (
      <div className="space-y-5">
        <Header user={user} plant={plant} />
        <Card className="space-y-3">
          <p className="text-lg font-semibold">A count can only be entered for today or yesterday</p>
          <LinkButton href="/">Back to Floor Stock</LinkButton>
        </Card>
      </div>
    );
  }

  const form = await countForm(user, date);
  if (form.current && !q.correct) redirect(`/day/${date}`);
  if (!form.current && q.correct) redirect(`/count?date=${date}`);
  const itemCount = form.sections.reduce((n, s) => n + s.items.length, 0);

  return (
    <div className="space-y-5 pb-28">
      <Header user={user} plant={plant} />
      <a href="/" className="text-sm font-semibold text-(--brand)">
        ← Floor Stock
      </a>
      {day.afterMidnight && date === day.calendarToday && !form.current && (
        <Card className="space-y-3 border-amber-200 bg-amber-50 text-amber-900">
          <p>
            ⚠ It&apos;s {istTime(new Date())}. This count is for <strong>{fmtDate(date)} (today)</strong>. Last night&apos;s count is for{" "}
            {fmtDate(day.main)}.
          </p>
          <LinkButton href={`/count?date=${day.main}`} variant="secondary">
            Count for {fmtDate(day.main)} instead
          </LinkButton>
        </Card>
      )}
      <h1 className="text-2xl font-bold">
        {form.current
          ? `Correct the count · ${fmtDate(date)}`
          : day.afterMidnight && date === day.main
            ? `Counting for ${fmtDate(date)} (last night)`
            : `${date === today ? "Today's count" : "Yesterday's count"} · ${fmtDate(date)}`}
      </h1>
      {itemCount === 0 ? (
        <Card className="space-y-3">
          <p>There is nothing to count yet: no sections or items are set up.</p>
          <LinkButton href="/setup">⚙ Sections &amp; items</LinkButton>
        </Card>
      ) : (
        <CountEntry form={form} />
      )}
    </div>
  );
}
