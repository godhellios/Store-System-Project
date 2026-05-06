import { cookies } from "next/headers";
import { getTranslations, lookup, type Locale, type TFunction } from "./_shared";
import { I18N_ENABLED } from "./feature-flag";

export async function getT(): Promise<TFunction> {
  if (!I18N_ENABLED) return (_key: string, fallback: string) => fallback;
  const cookieStore = await cookies();
  const locale = (cookieStore.get("locale")?.value ?? "id") as Locale;
  const translations = getTranslations(locale);
  return (key: string, fallback: string) => lookup(translations, key, fallback);
}
