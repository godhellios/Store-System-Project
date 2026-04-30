"use client";

import { useTheme } from "@/components/theme-provider";

export function ThemeToggle() {
  const { theme, toggle } = useTheme();
  const isDark = theme === "dark";

  return (
    <button
      onClick={toggle}
      title={isDark ? "Switch to light mode" : "Switch to dark mode"}
      className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors duration-300 focus-visible:outline-none ${
        isDark ? "bg-slate-600" : "bg-slate-300"
      }`}
    >
      <span
        className={`inline-flex h-5 w-5 items-center justify-center rounded-full bg-white shadow-sm transition-transform duration-300 ${
          isDark ? "translate-x-[22px]" : "translate-x-0.5"
        }`}
      >
        {isDark ? (
          /* Moon */
          <svg className="h-3 w-3 text-slate-600" fill="currentColor" viewBox="0 0 24 24">
            <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
          </svg>
        ) : (
          /* Sun */
          <svg className="h-3 w-3 text-amber-500" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" viewBox="0 0 24 24">
            <circle cx="12" cy="12" r="4" fill="currentColor" stroke="none" />
            <line x1="12" y1="2" x2="12" y2="4" />
            <line x1="12" y1="20" x2="12" y2="22" />
            <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
            <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
            <line x1="2" y1="12" x2="4" y2="12" />
            <line x1="20" y1="12" x2="22" y2="12" />
            <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
            <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
          </svg>
        )}
      </span>
    </button>
  );
}
