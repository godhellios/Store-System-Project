"use client";

import { useLocale } from "./provider";
import { I18N_ENABLED } from "./feature-flag";

export function LanguageSwitcher() {
  if (!I18N_ENABLED) return null;
  const { locale, setLocale } = useLocale();
  return (
    <div className="flex items-center gap-0.5 flex-shrink-0">
      <button
        onClick={() => setLocale("en")}
        className={`text-[11px] px-1.5 py-0.5 rounded font-semibold transition-colors ${
          locale === "en"
            ? "bg-blue-600 text-white"
            : "text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300"
        }`}
      >
        EN
      </button>
      <button
        onClick={() => setLocale("id")}
        className={`text-[11px] px-1.5 py-0.5 rounded font-semibold transition-colors ${
          locale === "id"
            ? "bg-blue-600 text-white"
            : "text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300"
        }`}
      >
        ID
      </button>
    </div>
  );
}
