"use client";

import { useState, useEffect } from "react";
import { Sidebar } from "@/components/sidebar";
import { ThemeToggle } from "@/components/theme-toggle";

export function AppShell({
  children,
  userName,
}: {
  children: React.ReactNode;
  userName: string;
}) {
  const [open, setOpen] = useState(false);

  // Lock body scroll when mobile sidebar is open
  useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => { document.body.style.overflow = ""; };
  }, [open]);

  // Close on resize to desktop
  useEffect(() => {
    const close = () => { if (window.innerWidth >= 768) setOpen(false); };
    window.addEventListener("resize", close);
    return () => window.removeEventListener("resize", close);
  }, []);

  return (
    <div className="flex min-h-screen">
      {/* Mobile overlay — blocks interaction with content behind sidebar */}
      {open && (
        <div
          className="fixed inset-0 z-20 bg-black/50 md:hidden"
          onClick={() => setOpen(false)}
        />
      )}

      {/* Sidebar shell
          Mobile : fixed, 100dvh (dynamic viewport — accounts for browser chrome)
          Desktop: relative flex-shrink-0, auto height via flex stretch            */}
      <div
        className={[
          "fixed top-0 left-0 z-30 w-[230px]",
          "md:relative md:top-auto md:left-auto md:flex-shrink-0 md:h-auto md:min-h-screen",
          "transition-transform duration-200 ease-in-out",
          open ? "translate-x-0" : "-translate-x-full md:translate-x-0",
        ].join(" ")}
        // 100dvh = dynamic viewport height: shrinks when browser chrome (address bar) is visible
        // On desktop the md: Tailwind classes above override this via the media-query cascade
        style={{ height: "100dvh" }}
      >
        <Sidebar onClose={() => setOpen(false)} />
      </div>

      {/* Main content */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        <header className="bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700 px-4 sm:px-6 py-3.5 flex items-center gap-3 flex-shrink-0">
          <button
            onClick={() => setOpen(true)}
            className="md:hidden p-1.5 -ml-1 rounded-lg text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 flex-shrink-0"
            aria-label="Open navigation"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <div className="flex items-center justify-between flex-1 min-w-0 gap-3">
            <span className="text-sm font-semibold text-slate-800 dark:text-slate-100 truncate">
              MRIs — Mitra Ramah Inventory System
            </span>
            <div className="flex items-center gap-3 flex-shrink-0">
              <span className="text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap hidden sm:block">
                {userName}
              </span>
              <ThemeToggle />
            </div>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto p-4 sm:p-6 bg-slate-50 dark:bg-slate-950">
          {children}
        </main>

        <footer className="text-center text-xs text-slate-400 dark:text-slate-500 py-3 bg-white dark:bg-slate-900 border-t border-slate-100 dark:border-slate-800">
          © 2026 Mitra Ramah — All rights reserved | MRIs v1.0
        </footer>
      </div>
    </div>
  );
}
