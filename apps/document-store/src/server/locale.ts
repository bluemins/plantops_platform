import { cookies } from "next/headers";
import { LOCALES, type Locale } from "@/lib/i18n";

export async function getLocale(): Promise<Locale> {
  const saved = (await cookies()).get("document-store-language")?.value;
  return LOCALES.includes(saved as Locale) ? (saved as Locale) : "en";
}
