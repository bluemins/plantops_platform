// Small pieces of the owner / HR desk screens (server components).
import { phoneDisplay } from "@plantops/module-kit/phone";
import { statusOf } from "@/lib/status";

export function StatusChip({ status }: { status: string }) {
  const s = statusOf(status);
  return <span className={`rounded-full px-2 py-0.5 text-xs font-bold whitespace-nowrap ${s.chip}`}>{s.label}</span>;
}

const PhoneIcon = ({ size = 20 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.5c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z" />
  </svg>
);

/** The round call button on a list card (support: none, they don't call applicants). */
export function CallButton({ name, phone, plain }: { name: string; phone: string; plain: boolean }) {
  if (plain) return null;
  return (
    <a href={phoneDisplay(phone).href!} aria-label={`Call ${name}`} className="grid h-[46px] w-[46px] shrink-0 place-items-center rounded-full bg-(--brand-soft) text-slate-900">
      <PhoneIcon />
    </a>
  );
}

/** Call + WhatsApp (screen 6). */
export function ContactButtons({ phone }: { phone: string }) {
  return (
    <div className="grid grid-cols-2 gap-2.5">
      <a href={phoneDisplay(phone).href!} className="flex items-center justify-center gap-2 rounded-[14px] bg-(--brand) p-[13px] text-base font-bold text-(--brand-contrast)">
        <PhoneIcon size={18} />
        Call
      </a>
      <a href={`https://wa.me/91${phone}`} target="_blank" rel="noopener noreferrer" className="flex items-center justify-center gap-2 rounded-[14px] border-2 border-green-700 p-[11px] text-base font-bold text-green-900">
        WhatsApp
      </a>
    </div>
  );
}

const IST = "Asia/Kolkata";
/** "10 min ago", "2 h ago", "Yesterday", "14 Oct" (screen 5). */
export function whenText(iso: string, now = Date.now()) {
  const t = new Date(iso).getTime();
  const min = Math.max(0, Math.floor((now - t) / 60_000));
  if (min < 60) return `${min} min ago`;
  if (min < 24 * 60) return `${Math.floor(min / 60)} h ago`;
  const day = (ms: number) => new Intl.DateTimeFormat("en-CA", { timeZone: IST }).format(new Date(ms));
  if (day(t) === day(now - 86_400_000)) return "Yesterday";
  return new Intl.DateTimeFormat("en-IN", { timeZone: IST, day: "numeric", month: "short", ...(new Date(t).getFullYear() !== new Date(now).getFullYear() ? { year: "numeric" } : {}) }).format(new Date(t));
}
