import { CircleCheck, ChevronRight, MessageCircle, Phone } from "lucide-react";
import { call, type Home } from "../api";
import { EmptyJarArt, GiftDrop, ProductIcon, TruckArt, WavingDrop, kindOf } from "../art";
import { day, num, rupees, telLink, waLink } from "../format";
import { useLoad } from "../load";
import { BrandHeader, SectionTitle, outline, solid } from "../ui";
import { t } from "../text/en";
import { Status } from "./Status";

const BRAND_DOTS = ["bg-brand", "bg-amber-500", "bg-pink-400", "bg-teal-600"];

/** Home: the current order, due per brand, boxes bought, points, Call / WhatsApp. No rates, no bill amounts. */
export function HomeScreen({ token, onEnded, goPoints }: { token: string; onEnded: () => void; goPoints: () => void }) {
  const { s, reload } = useLoad(() => call<Home>("/api/app/v1/home", { token }), onEnded);
  if (s.state !== "ready") return <Status s={s} retry={reload} />;
  return <HomeView home={s.data} goPoints={goPoints} />;
}

export function HomeView({ home, goPoints, hour = new Date().getHours() }: { home: Home; goPoints: () => void; hour?: number }) {
  const boxes = home.boxes ? Object.entries(home.boxes)[0] : null;
  const allZero = home.dues.every((d) => d.paise <= 0);
  return (
    <>
      <BrandHeader className="h-[210px]" art={<WavingDrop className="absolute top-3 right-3 h-[112px] w-[100px]" />}>
        <div className="max-w-[250px] px-5 pt-3">
          <p className="text-[15px] opacity-90">{t.home.greet(hour)}</p>
          <p className="mt-0.5 font-display text-[30px] leading-[1.1] font-bold">{t.home.hello(home.shop.name)}</p>
        </div>
      </BrandHeader>

      <div className="relative -mt-12 flex flex-col gap-4 px-4">
        {home.orders.length === 0 ? (
          <div className="card card-lift flex flex-col items-center gap-2 p-5 text-center">
            <EmptyJarArt />
            <p className="font-display text-xl font-bold">{t.home.order}</p>
            <p className="text-sm text-muted">{t.home.noOrder}</p>
          </div>
        ) : (
          home.orders.map((o, i) => (
            <div key={i} className="card card-lift flex flex-col gap-3 p-[18px]">
              <div className="flex items-center justify-between">
                <h2 className="font-display text-xl font-bold">{t.home.order}</h2>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-soft px-3 py-1 text-[13px] font-bold text-link">
                  <span className="h-2 w-2 rounded-full bg-brand" />
                  {o.status === "delivered" ? t.home.pillDelivered : t.home.pillReceived}
                </span>
              </div>
              <TruckArt />
              <ul>
                {o.lines.map((l) => (
                  <li key={l.product} className="flex items-center gap-3 border-b border-well py-2.5 last:border-0">
                    <ProductIcon kind={kindOf(l.size, l.unit)} />
                    <span className="flex-1 text-[15px] font-semibold">{l.product}</span>
                    <span className="flex flex-col items-end gap-0.5">
                      <span className="font-display text-lg leading-tight font-bold">
                        {num(l.qty)} {l.unit}
                      </span>
                      {l.free > 0 && <span className="rounded-full bg-good-soft px-2 text-xs font-bold text-good">{t.home.free(l.free)}</span>}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="text-[13px] text-muted">{o.status === "delivered" ? t.home.delivered(o.time ?? "") : t.home.received(day(o.date))}</p>
            </div>
          ))
        )}
      </div>

      <SectionTitle>{t.home.due}</SectionTitle>
      {allZero ? (
        <div className="card mx-4 flex items-center gap-2 p-4 font-display text-lg font-bold text-good">
          <CircleCheck className="h-5 w-5" aria-hidden /> {t.home.nothingDue}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 px-4">
          {home.dues.map((d, i) => (
            <div key={d.brand} className="card flex flex-col gap-1.5 p-4">
              <span className="flex items-center gap-2 text-sm font-semibold text-muted">
                <span className={`h-2.5 w-2.5 rounded-full ${BRAND_DOTS[i % BRAND_DOTS.length]}`} />
                {d.brand}
              </span>
              {d.paise > 0 ? (
                <span className="font-display text-[28px] leading-tight font-extrabold">{rupees(d.paise)}</span>
              ) : (
                <span className="flex items-center gap-1.5 font-display text-lg leading-normal font-bold text-good">
                  <CircleCheck className="h-5 w-5" aria-hidden /> {t.home.nothingDue}
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      {boxes && <Boxes b={boxes[1]} />}

      {home.points && (
        <button type="button" onClick={goPoints} className="mx-4 mt-4 flex w-[calc(100%-2rem)] items-center gap-3.5 rounded-3xl bg-soft px-4 py-3.5 text-left">
          <GiftDrop />
          <span className="flex flex-1 flex-col gap-0.5">
            <span className="text-[13px] font-semibold text-muted">{t.home.points}</span>
            <span className="font-display text-[28px] leading-none font-extrabold">{num(home.points.balance)}</span>
            {home.points.next && (
              <span className="text-sm">{home.points.next.missing > 0 ? t.home.toNext(num(home.points.next.missing), home.points.next.label) : t.home.canUse(home.points.next.label)}</span>
            )}
          </span>
          <ChevronRight className="h-[22px] w-[22px]" aria-hidden />
        </button>
      )}

      {home.support && (
        <div className="px-4 pt-5">
          <div className="grid grid-cols-2 gap-3">
            <a href={telLink(home.support.phone)} className={outline}>
              <Phone className="h-5 w-5" aria-hidden /> {t.home.call}
            </a>
            <a href={waLink(home.support.phone)} className={solid}>
              <MessageCircle className="h-5 w-5" aria-hidden /> {t.home.whatsapp}
            </a>
          </div>
          {home.support.hours && <p className="mt-2.5 text-center text-[13px] text-muted">{t.home.hours(home.support.hours)}</p>}
        </div>
      )}
      <div className="h-6" />
    </>
  );
}

function Boxes({ b }: { b: NonNullable<Home["boxes"]>[string] }) {
  const most = Math.max(b.this_month.total, b.last_month.total, 1);
  const bar = (n: number, fill: string, label: string, bold = false) => (
    <div className="flex items-center gap-2.5">
      <span className="w-[86px] text-[13px] text-muted">{label}</span>
      <span className="h-3 flex-1 overflow-hidden rounded-full bg-well">
        <span className={`block h-3 rounded-full ${fill}`} style={{ width: `${(n / most) * 100}%` }} />
      </span>
      <span className={`w-10 text-right text-sm ${bold ? "font-bold" : "font-semibold"}`}>{num(n)}</span>
    </div>
  );
  return (
    <div className="card mx-4 mt-4 flex flex-col gap-3 p-[18px]">
      <h2 className="font-display text-xl font-bold">{t.home.boxes}</h2>
      <div className="flex items-baseline gap-2">
        <span className="font-display text-[44px] leading-none font-extrabold text-link">{num(b.this_month.total)}</span>
        <span className="text-[15px] text-muted">{t.home.thisMonth.toLowerCase()}</span>
      </div>
      {b.this_month.sizes.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {b.this_month.sizes.map((x) => (
            <span key={x.size} className="rounded-full bg-well px-2.5 py-1 text-[13px] font-semibold">
              {x.size} · {num(x.boxes)}
            </span>
          ))}
        </div>
      )}
      <div className="flex flex-col gap-2">
        {bar(b.this_month.total, "bg-brand", t.home.thisMonth, true)}
        {bar(b.last_month.total, "bg-mid", t.home.lastMonth)}
      </div>
      <p className="border-t border-well pt-2.5 text-sm text-muted">
        {t.home.thisYear} <strong className="text-ink">{num(b.this_year.total)}</strong> · {t.home.lastYear(num(b.this_year.last_year_same_days))}
      </p>
    </div>
  );
}
