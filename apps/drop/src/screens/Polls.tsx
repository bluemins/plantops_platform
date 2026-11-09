import { useState } from "react";
import { Check, Star } from "lucide-react";
import { call, type Polls } from "../api";
import { CheerArt, PollBubble, WavingDrop } from "../art";
import { dayOfTime } from "../format";
import { useLoad } from "../load";
import { BrandHeader, solid } from "../ui";
import { t } from "../text/en";
import { Status } from "./Status";

const OTHER = -1;

/** Polls: each open poll as a tap list (+ Other box) → Send → the thank-you with the points it earned. */
export function PollsScreen({ token, onEnded }: { token: string; onEnded: () => void }) {
  const { s, reload } = useLoad(() => call<Polls>("/api/app/v1/polls", { token }), onEnded);
  const [thanks, setThanks] = useState<string>();
  if (s.state !== "ready") return <Status s={s} retry={reload} />;
  return (
    <PollsView
      data={s.data}
      thanks={thanks}
      send={async (id, choice, other) => {
        const r = await call<{ message: string }>(`/api/app/v1/polls/${id}/answer`, { token, body: { choice, ...(choice === OTHER ? { other } : {}) } });
        if (!r.ok && r.status === 401) return onEnded();
        setThanks(r.ok ? r.data.message : r.message || t.common.error);
        await reload();
      }}
    />
  );
}

export function PollsView({ data, thanks, send }: { data: Polls; thanks?: string; send: (id: string, choice: number, other?: string) => Promise<void> }) {
  return (
    <>
      <BrandHeader
        className="h-[250px]"
        art={
          <>
            <PollBubble className="absolute top-4 right-4 h-[90px] w-[142px]" />
            <WavingDrop className="absolute top-[104px] right-5 h-[92px] w-[82px] -scale-x-100" />
          </>
        }
      >
        <div className="flex max-w-[210px] flex-col gap-2.5 px-5 pt-5">
          <h1 className="font-display text-4xl leading-none font-extrabold">{t.polls.title}</h1>
          <p className="text-[15px] leading-snug opacity-90">{t.polls.tagline}</p>
          {data.points_each > 0 && (
            <span className="inline-flex items-center gap-1.5 self-start whitespace-nowrap rounded-full bg-amber-300 px-3 py-1.5 text-[13px] font-bold text-[#3b2a03]">
              <Star className="h-3.5 w-3.5 fill-current" aria-hidden />
              {data.this_week.counted ? t.polls.weekDone : t.polls.weekPoints(data.points_each)}
            </span>
          )}
        </div>
      </BrandHeader>

      <div className="relative -mt-9 flex flex-col gap-4 px-4">
        {thanks && (
          <div className="card card-lift flex flex-col items-center gap-2 p-5 text-center">
            <CheerArt />
            <p className="font-display text-xl font-bold">{thanks}</p>
          </div>
        )}
        {data.polls.length === 0 ? (
          <div className="card card-lift p-5 text-center text-muted">{t.polls.none}</div>
        ) : (
          data.polls.map((p, i) => <OnePoll key={p.id} poll={p} n={i + 1} of={data.polls.length} send={send} />)
        )}
        {data.answered.count > 0 && (
          <div className="card flex items-center gap-3 px-4 py-3.5">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-good-soft">
              <Check className="h-[22px] w-[22px] text-good" strokeWidth={2.5} aria-hidden />
            </span>
            <span className="text-[15px]">{t.polls.answered(data.answered.count, data.answered.points)}</span>
          </div>
        )}
      </div>
      <div className="h-6" />
    </>
  );
}

function OnePoll({ poll, n, of, send }: { poll: Polls["polls"][number]; n: number; of: number; send: (id: string, choice: number, other?: string) => Promise<void> }) {
  const [choice, setChoice] = useState<number | null>(null);
  const [other, setOther] = useState("");
  const [busy, setBusy] = useState(false);
  const ready = choice !== null && (choice !== OTHER || other.trim().length > 0);
  const options = [...poll.choices.map((c, i) => ({ label: c, value: i })), ...(poll.other_allowed ? [{ label: t.polls.other, value: OTHER }] : [])];
  return (
    <div className="card card-lift flex flex-col gap-3 px-[18px] py-5">
      <span className="text-xs font-bold tracking-wider text-muted uppercase">{t.polls.ofN(n, of)}</span>
      <h2 className="font-display text-[22px] leading-tight font-bold">{poll.question}</h2>
      <fieldset className="flex flex-col gap-2.5">
        <legend className="sr-only">{t.polls.choose}</legend>
        {options.map((o) => {
          const on = choice === o.value;
          return (
            <label key={o.value} className={`relative flex min-h-14 cursor-pointer items-center gap-3.5 rounded-2xl border-2 px-4 ${on ? "border-brand bg-faint" : "border-line bg-white"}`}>
              <input type="radio" name={`poll-${poll.id}`} checked={on} onChange={() => setChoice(o.value)} className="sr-only" />
              <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 ${on ? "border-brand" : "border-[#9aa6bc]"}`}>
                {on && <span className="h-3 w-3 rounded-full bg-brand" />}
              </span>
              <span className="text-base font-semibold">{o.label}</span>
            </label>
          );
        })}
        {choice === OTHER && (
          <>
            <label htmlFor={`other-${poll.id}`} className="text-[13px] font-semibold text-muted">
              {t.polls.yourAnswer}
            </label>
            <input
              id={`other-${poll.id}`}
              type="text"
              maxLength={100}
              placeholder={t.polls.otherPlaceholder}
              value={other}
              onChange={(e) => setOther(e.target.value)}
              className="h-[52px] rounded-[14px] border-2 border-brand px-3.5 text-base outline-none"
            />
          </>
        )}
      </fieldset>
      <button
        type="button"
        className={solid}
        disabled={!ready || busy}
        onClick={async () => {
          setBusy(true);
          await send(poll.id, choice!, other.trim());
          setBusy(false);
        }}
      >
        {t.polls.send}
      </button>
      <p className="text-center text-[13px] text-muted">{t.polls.closes(dayOfTime(new Date(Date.parse(poll.closes_at) - 60_000).toISOString()))}</p>
    </div>
  );
}
