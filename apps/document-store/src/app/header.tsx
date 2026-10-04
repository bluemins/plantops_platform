import Link from "next/link";
import type { TenantBranding } from "@plantops/types";
import { kit } from "@/server/kit";
import type { DocUser } from "@/server/session";
import type { Locale } from "@/lib/i18n";
import { translate } from "@/lib/i18n";
import { LanguageSelector } from "./language-selector";

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");

/** Top bar on every screen: plant logo + name, who is logged in, the way back to PlantOps (or out of support). */
export function Header({ user, plant, locale }: { user: DocUser; plant: TenantBranding | null; locale: Locale }) {
  const t = (key: Parameters<typeof translate>[1], values?: Record<string, string | number>) => translate(locale, key, values);
  const role = user.isSupport ? t("readOnly") : user.isOwner ? t("owner") : t("documentKeeper");
  return (
    <>
      {user.isSupport && (
        <div className="-mx-4 -mt-6 mb-4 flex items-center justify-between gap-2 bg-amber-300 px-4 py-2 text-sm font-semibold text-amber-950">
          <span>{t("supportBanner", { plant: plant?.name ?? "this plant" })}</span>
          <a href="/sso/support-exit" className="underline">
            {t("exit")}
          </a>
        </div>
      )}
      <header className="flex items-center justify-between gap-3">
        <Link href="/" className="flex min-w-0 items-center gap-2">
          {plant?.logo_url ? (
            // eslint-disable-next-line @next/next/no-img-element -- served by this module from the platform
            <img src="/plant-logo" alt="" className="h-10 w-10 rounded-full border border-slate-200 bg-white object-contain" />
          ) : null}
          <span className="min-w-0">
            <span className="block truncate text-lg font-bold">
              Document <span className="text-(--brand)">Store</span>
            </span>
            <span className="block truncate text-sm text-slate-500">{plant?.name ?? ""}</span>
          </span>
        </Link>
        <div className="flex flex-wrap items-center justify-end gap-3">
          <LanguageSelector />
          <a href={user.isSupport ? "/sso/support-exit" : kit.accountUrl()} className="flex items-center gap-2 text-right" title={user.isSupport ? t("exitSupportTitle") : t("accountTitle")}>
            <span className="hidden sm:block">
              <span className="block font-semibold">{user.name}</span>
              <span className="block text-sm text-slate-500">{role}</span>
            </span>
            <span className="grid h-11 w-11 place-items-center rounded-full bg-(--brand-soft) font-bold text-(--brand)">{initials(user.name)}</span>
          </a>
        </div>
      </header>
    </>
  );
}
