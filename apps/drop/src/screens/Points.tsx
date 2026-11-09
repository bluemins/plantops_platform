import { useState } from "react";
import { Info, Truck } from "lucide-react";
import { call, type Points } from "../api";
import { DropGauge, RewardArt, kindOf } from "../art";
import { day, longDay, month, num } from "../format";
import { useLoad } from "../load";
import { SectionTitle, smallGrey, smallSolid } from "../ui";
import { t } from "../text/en";
import { Status } from "./Status";

const newKey = () => `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
type Reward = Points["rewards"][number];

/** Points: balance, progress, free boxes (Use → confirm), the monthly record. Points only, never bills. */
export function PointsScreen({ token, onEnded }: { token: string; onEnded: () => void }) {
  const { s, reload, set } = useLoad(() => call<Points>("/api/app/v1/points", { token }), onEnded);
  const [ask, setAsk] = useState<Reward | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string>();
  if (s.state !== "ready") return <Status s={s} retry={reload} />;

  async function use() {
    if (!ask) return;
    setBusy(true);
    const r = await call<Points & { asked: { label: string } }>("/api/app/v1/points/redeem", { token, body: { reward: ask.id, request_key: newKey() } });
    setBusy(false);
    setAsk(null);
    if (r.ok) {
      set(r.data);
      setNote(t.points.asked(r.data.asked.label));
    } else if (r.status === 401) onEnded();
    else setNote(r.message || t.common.error);
  }

  return <PointsView p={s.data} note={note} onUse={setAsk} confirm={ask} busy={busy} onConfirm={use} onCancel={() => setAsk(null)} />;
}

/** The next free box still to reach (cheapest above the balance); none = every box is within reach. */
function target(p: Points) {
  const up = [...p.rewards].sort((a, b) => a.points - b.points);
  const next = up.find((r) => r.points > p.balance);
  if (next) return { progress: p.balance / next.points, text: t.home.toNext(num(next.points - p.balance), next.label) };
  const top = up[up.length - 1];
  return { progress: 1, text: top ? t.home.canUse(top.label) : null };
}

export function PointsView(props: { p: Points; note?: string; onUse: (r: Reward) => void; confirm: Reward | null; busy: boolean; onConfirm: () => void; onCancel: () => void }) {
  const { p } = props;
  if (!p.on)
    return (
      <div className="card mx-4 mt-4 flex flex-col items-center gap-2 p-6 text-center">
        <RewardArt kind="bottle" className="h-[74px] w-20" />
        <p className="font-display text-xl font-bold">{t.points.title}</p>
        <p className="text-muted">{t.points.off}</p>
      </div>
    );
  const goal = target(p);
  return (
    <>
      <div className="flex flex-col items-center gap-1 bg-soft px-5 pt-[18px] pb-6">
        <h1 className="self-start font-display text-[26px] font-bold">{t.points.title}</h1>
        <div className="relative mt-2 h-[260px] w-[220px]">
          <DropGauge progress={goal.progress} label={t.points.gauge(Math.round(goal.progress * 100))} />
          <div className="absolute top-[148px] left-1/2 flex -translate-x-1/2 flex-col items-center rounded-[20px] bg-white px-[18px] py-2 shadow-[0_8px_22px_rgb(15_27_51/0.14)]">
            <span className="font-display text-[38px] leading-none font-extrabold">{num(p.balance)}</span>
            <span className="text-xs font-semibold text-muted">{t.points.word}</span>
          </div>
        </div>
        {goal.text && <p className="mt-2.5 text-center font-display text-xl font-bold">{goal.text}</p>}
        {p.ends_on && <p className="text-sm text-muted">{t.points.endsOn(longDay(p.ends_on))}</p>}
        <p className="mt-3 flex items-start gap-2.5 rounded-2xl bg-white px-3.5 py-3 text-[13px] leading-snug">
          <Info className="h-5 w-5 shrink-0 text-link" aria-hidden />
          {t.points.howTo}
        </p>
      </div>

      {props.note && <div className="card mx-4 mt-4 bg-good-soft p-4 font-semibold text-good">{props.note}</div>}
      {p.open_request && (
        <div className="card mx-4 mt-4 flex items-center gap-3 px-4 py-3.5">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[14px] bg-amber-100">
            <Truck className="h-6 w-6 text-amber-800" aria-hidden />
          </span>
          <span className="text-[15px] font-bold">{t.points.open(p.open_request.label, t.points.states[p.open_request.state] ?? p.open_request.state)}</span>
        </div>
      )}

      <SectionTitle>{t.points.freeBoxes}</SectionTitle>
      {!p.redeem_open && p.opens_on && <p className="mx-5 mb-2.5 text-sm text-muted">{t.points.freeFrom(longDay(p.opens_on))}</p>}
      <div className="flex flex-col gap-2.5 px-4">
        {p.rewards.map((r) => {
          const short = r.points - p.balance;
          return (
            <div key={r.id} className="card flex items-center gap-3 px-3.5 py-3">
              <RewardArt kind={kindOf(r.size)} />
              <span className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="text-base font-bold">{r.label}</span>
                <span className="text-[13px] text-muted">
                  {t.points.pointsN(num(r.points))}
                  {short > 0 && ` · ${t.points.more(num(short))}`}
                </span>
                {short > 0 && (
                  <span className="h-1.5 overflow-hidden rounded-full bg-well">
                    <span className="block h-1.5 rounded-full bg-brand" style={{ width: `${(p.balance / r.points) * 100}%` }} />
                  </span>
                )}
                {!r.can_use && r.why_not && <span className="text-[13px] text-muted">{r.why_not}</span>}
              </span>
              <button type="button" className={smallSolid} disabled={!r.can_use} onClick={() => props.onUse(r)}>
                {t.points.use}
              </button>
            </div>
          );
        })}
      </div>

      <SectionTitle>{t.points.record}</SectionTitle>
      {p.record.length === 0 ? (
        <p className="mx-5 text-sm text-muted">{t.points.nothingYet}</p>
      ) : (
        <div className="card mx-4 flex flex-col gap-3.5 p-4">
          {p.record.map((m, i) => (
            <div key={m.month} className="flex gap-3">
              <span className="flex flex-col items-center pt-1">
                <span className={`h-3 w-3 rounded-full ${i === 0 ? "bg-brand" : "bg-mid"}`} />
                {i < p.record.length - 1 && <span className="mt-1 w-0.5 flex-1 bg-line" />}
              </span>
              <span className="flex flex-1 flex-col gap-1 pb-1">
                <span className="text-[15px] font-bold">{month(m.month)}</span>
                {m.purchases > 0 && <Row label={t.points.billsLine} value={`+${num(m.purchases)}`} />}
                {m.polls > 0 && <Row label={t.points.pollsLine} value={`+${num(m.polls)}`} />}
                {m.boxes.map((b) => (
                  <Row key={b.label + b.date} label={`${t.points.box(b.label)} · ${day(b.date)}`} value={t.points.states[b.state] ?? b.state} plain />
                ))}
              </span>
            </div>
          ))}
        </div>
      )}
      <div className="h-6" />

      {props.confirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/45 p-5" onClick={props.onCancel}>
          <div role="dialog" aria-modal="true" aria-labelledby="use-title" className="flex w-full max-w-sm flex-col items-center gap-2 rounded-3xl bg-white px-5 pt-[22px] pb-4 text-center" onClick={(e) => e.stopPropagation()}>
            <RewardArt kind={kindOf(props.confirm.size)} className="h-[74px] w-20" />
            <p id="use-title" className="font-display text-[22px] font-bold">
              {t.points.confirmTitle}
            </p>
            <p className="text-[15px] leading-snug text-muted">{t.points.confirmText(num(props.confirm.points), props.confirm.label)}</p>
            <div className="mt-2.5 grid w-full grid-cols-2 gap-2.5">
              <button type="button" className={smallGrey} onClick={props.onCancel}>
                {t.points.no}
              </button>
              <button type="button" className={`${smallSolid} h-12 px-2`} onClick={props.onConfirm} disabled={props.busy}>
                {t.points.yes}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function Row({ label, value, plain }: { label: string; value: string; plain?: boolean }) {
  return (
    <span className="flex justify-between gap-3 text-sm">
      <span className="text-muted">{label}</span>
      <span className={plain ? "font-semibold text-muted" : "font-bold text-good"}>{value}</span>
    </span>
  );
}
