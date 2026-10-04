"use client";

import { createContext, useContext, type ReactNode } from "react";
import { translate, type Locale, type MessageKey } from "@/lib/i18n";

const LocaleContext = createContext<Locale>("en");

export function LanguageProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  return <LocaleContext.Provider value={locale}>{children}</LocaleContext.Provider>;
}

export function useTranslation() {
  const locale = useContext(LocaleContext);
  return {
    locale,
    t: (key: MessageKey, values?: Record<string, string | number>) => translate(locale, key, values),
  };
}
