import { OfflineArt } from "../art";
import { smallSolid } from "../ui";
import { t } from "../text/en";
import type { Loaded } from "../load";

/** Loading / no internet / error, for any screen; null when the data is ready. */
export function Status<T>({ s, retry }: { s: Loaded<T>; retry: () => void }) {
  if (s.state === "ready") return null;
  if (s.state === "loading")
    return (
      <div className="flex flex-col items-center gap-3 py-20" role="status" aria-label={t.common.loading}>
        <svg viewBox="0 0 24 24" className="h-10 w-10 animate-bounce" aria-hidden>
          <path d="M12 2 C12 2 5 10 5 14.5 a7 7 0 0 0 14 0 C19 10 12 2 12 2 Z" className="fill-brand" />
        </svg>
        <span className="h-1.5 w-8 rounded-full bg-soft" />
      </div>
    );
  return (
    <div className="card mx-4 mt-6 flex flex-col items-center gap-2 px-5 py-6 text-center">
      <OfflineArt />
      <p className="font-display text-xl font-bold">{s.state === "offline" ? t.common.offline : t.common.error}</p>
      <p className="text-sm text-muted">{s.state === "offline" ? t.common.offlineText : s.message || t.common.error}</p>
      <button type="button" className={`${smallSolid} mt-1.5 h-12 px-7`} onClick={retry}>
        {t.common.retry}
      </button>
    </div>
  );
}
