"use client";

import { createContext, useContext, useState } from "react";
import { useRouter } from "next/navigation";
import { getTranslations, lookup, type Locale, type TFunction } from "./_shared";
import { I18N_ENABLED } from "./feature-flag";

const I18nContext = createContext<{
  locale: Locale;
  t: TFunction;
  setLocale: (l: Locale) => void;
}>({
  locale: "id",
  t: (_key: string, fallback: string) => fallback,
  setLocale: () => {},
});

export function I18nProvider({
  locale: initialLocale,
  children,
}: {
  locale: Locale;
  children: React.ReactNode;
}) {
  const [locale, setLocaleState] = useState<Locale>(initialLocale);
  const router = useRouter();
  const translations = getTranslations(locale);

  const t: TFunction = I18N_ENABLED
    ? (key, fallback) => lookup(translations, key, fallback)
    : (_key, fallback) => fallback;

  function setLocale(l: Locale) {
    document.cookie = `locale=${l}; path=/; max-age=31536000; SameSite=Lax`;
    setLocaleState(l);
    router.refresh();
  }

  return (
    <I18nContext.Provider value={{ locale, t, setLocale }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useT(): TFunction {
  return useContext(I18nContext).t;
}

export function useLocale() {
  const { locale, setLocale } = useContext(I18nContext);
  return { locale, setLocale };
}
