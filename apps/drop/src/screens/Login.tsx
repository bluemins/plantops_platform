import { useEffect, useState } from "react";
import { MessageCircle, Phone } from "lucide-react";
import { call, type Look } from "../api";
import { LoginArt, Waves } from "../art";
import { mobile, telLink } from "../format";
import { solid } from "../ui";
import { t } from "../text/en";

/** Phone → WhatsApp code → logged in (docs/CUSTOMER_APP_PHASE_PLAN.md "Login"). The same answer for every number. */
export function Login({ look, onIn }: { look: Look | null; onIn: (token: string) => void }) {
  const [stage, setStage] = useState<"phone" | "code">("phone");
  const [typed, setTyped] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [wait, setWait] = useState(0);
  const phone = mobile(typed);

  useEffect(() => {
    if (wait <= 0) return;
    const id = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(id);
  }, [wait]);

  async function send() {
    if (!phone) return setError(t.login.phoneBad);
    setBusy(true);
    setError(undefined);
    const r = await call<{ ok: true; resend_after: number }>("/api/app/v1/login/start", { body: { phone } });
    setBusy(false);
    if (!r.ok) return setError(r.code === "offline" ? t.common.offlineText : r.message || t.common.error);
    setStage("code");
    setWait(r.data.resend_after ?? 60);
  }

  async function verify() {
    const c = code.replace(/\D/g, "");
    if (c.length !== 6) return setError(t.login.wrong);
    setBusy(true);
    setError(undefined);
    const r = await call<{ token: string }>("/api/app/v1/login/verify", { body: { phone, code: c } });
    setBusy(false);
    if (!r.ok) return setError(r.code === "offline" ? t.common.offlineText : r.code === "wrong_code" ? t.login.wrong : r.message || t.common.error);
    onIn(r.data.token);
  }

  const field = "flex h-14 items-center gap-2.5 rounded-2xl border-2 bg-white px-4";
  return (
    <div className="flex min-h-full flex-col bg-page pb-[env(safe-area-inset-bottom)]">
      <div className="relative h-[480px] shrink-0 overflow-hidden bg-brand text-on-brand">
        <LoginArt />
        <div className="absolute inset-x-0 top-[284px] flex flex-col items-center gap-1.5 px-8 text-center">
          <p className="font-display text-[56px] leading-none font-extrabold">{t.app}</p>
          <p className="text-[15px] leading-snug opacity-90">{t.login.tagline}</p>
          {look && <span className="mt-2 rounded-full bg-white/20 px-3.5 py-1.5 text-[13px] font-semibold">{look.name}</span>}
        </div>
        <Waves />
      </div>

      <div className="card card-lift relative mx-5 -mt-10 flex flex-col gap-3.5 p-6">
        <h1 className="font-display text-[26px] leading-tight font-bold">{t.login.title}</h1>
        {stage === "phone" ? (
          <>
            <label htmlFor="phone" className="text-sm font-semibold text-muted">
              {t.login.phoneLabel}
            </label>
            <div className={`${field} ${error ? "border-red-600" : "border-brand"}`}>
              <span className="border-r border-line pr-2.5 text-[17px] font-bold">+91</span>
              <input
                id="phone"
                type="tel"
                inputMode="tel"
                autoComplete="tel-national"
                placeholder={t.login.phonePlaceholder}
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                className="min-w-0 flex-1 bg-transparent text-lg tracking-wide outline-none"
              />
            </div>
            {error && <p className="text-sm font-semibold text-red-700">{error}</p>}
            <button type="button" className={solid} onClick={send} disabled={busy}>
              <MessageCircle className="h-[22px] w-[22px]" aria-hidden /> {t.login.send}
            </button>
            <p className="text-center text-[13px] text-muted">{t.login.willSend}</p>
          </>
        ) : (
          <>
            <p className="text-sm">{t.login.sent}</p>
            <label htmlFor="code" className="text-sm font-semibold text-muted">
              {t.login.codeLabel}
            </label>
            <div className={`${field} ${error ? "border-red-600" : "border-brand"}`}>
              <input
                id="code"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                className="min-w-0 flex-1 bg-transparent text-center font-display text-2xl font-bold tracking-[0.4em] outline-none"
              />
            </div>
            <p className="text-[13px] text-muted">{t.login.codeHint}</p>
            {error && <p className="text-sm font-semibold text-red-700">{error}</p>}
            <button type="button" className={solid} onClick={verify} disabled={busy}>
              {t.login.verify}
            </button>
            <button type="button" className="min-h-11 font-semibold text-link disabled:text-muted" onClick={send} disabled={busy || wait > 0}>
              {wait > 0 ? t.login.resendIn(wait) : t.login.resend}
            </button>
            <button type="button" className="min-h-11 font-semibold text-link" onClick={() => (setStage("phone"), setCode(""), setError(undefined))}>
              {t.login.otherNumber}
            </button>
          </>
        )}
      </div>

      {look?.support && (
        <div className="mt-auto flex flex-col items-center gap-1.5 px-8 pt-5 pb-7 text-center">
          <p className="text-sm text-muted">{t.login.noCode}</p>
          <a href={telLink(look.support.phone)} className="inline-flex min-h-11 items-center gap-2 text-[15px] font-bold text-link">
            <Phone className="h-[18px] w-[18px]" aria-hidden /> {t.login.call} {look.support.phone}
          </a>
        </div>
      )}
    </div>
  );
}
