import { redirect } from "next/navigation";
import { Card } from "@plantops/ui";
import { fmtDate } from "@plantops/module-kit/format";
import { allowedDates, countForm } from "@/server/counts";
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
  const date = q.date ?? today!;
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
      <h1 className="text-2xl font-bold">
        {form.current ? "Correct the count" : date === today ? "Today's count" : "Yesterday's count"} · {fmtDate(date)}
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
