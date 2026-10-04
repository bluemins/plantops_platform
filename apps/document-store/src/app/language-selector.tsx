"use client";

import { useState } from "react";
import { useTranslation } from "./language-provider";

export function LanguageSelector() {
  const { locale, t } = useTranslation();
  const [error, setError] = useState("");

  async function changeLanguage(next: string) {
    setError("");
    try {
      const response = await fetch("/language", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ locale: next }),
      });
      if (!response.ok) {
        setError(t("chooseLanguageError"));
        return;
      }
      window.location.reload();
    } catch {
      setError(t("chooseLanguageError"));
    }
  }

  return (
    <label className="flex items-center gap-2 text-sm text-slate-600">
      <span>{t("language")}</span>
      <select
        aria-label={t("language")}
        value={locale}
        onChange={(event) => void changeLanguage(event.target.value)}
        className="min-h-10 rounded-lg border border-slate-300 bg-white px-2"
      >
        <option value="en">{t("english")}</option>
        <option value="hi">{t("hindi")}</option>
        <option value="or">{t("odia")}</option>
      </select>
      {error && <span role="alert" className="text-red-700">{error}</span>}
    </label>
  );
}
