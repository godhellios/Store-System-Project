"use client";

import { useState, useEffect } from "react";
import { Sidebar } from "@/components/sidebar";

export function AppShell({
  children,
  userName,
}: {
  children: React.ReactNode;
  userName: string;
}) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const close = () => { if (window.innerWidth >= 768) setOpen(false); };
    window.addEventListener("resize", close);
    return () => window.removeEventListener("resize", close);
  }, []);

  return (
    <div className="flex min-h-screen">
      {/* Mobile overlay */}
      {open && (
        <div
          className="fixed inset-0 z-20 bg-black/50 md:hidden"
          onClick={() => setOpen(false)}
        />
      )}

      {/* Sidebar — drawer on mobile, static on md+ */}
      <div
        className={[
          "fixed inset-y-0 left-0 z-30 transition-transform duration-200 ease-in-out",
          "md:relative md:translate-x-0 md:flex-shrink-0",
          open ? "translate-x-0" : "-translate-x-full",
        ].join(" ")}
      >
        <Sidebar onClose={() => setOpen(false)} />
      </div>

      {/* Main area */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        <header className="bg-white border-b border-slate-200 px-4 sm:px-6 py-3.5 flex items-center gap-3 flex-shrink-0">
          {/* Hamburger — mobile only */}
          <button
            onClick={() => setOpen(true)}
            className="md:hidden p-1.5 -ml-1 rounded-lg text-slate-500 hover:bg-slate-100 flex-shrink-0"
            aria-label="Open navigation"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <div className="flex items-center justify-between flex-1 min-w-0">
            <span className="text-sm font-semibold text-slate-800 truncate">
              MRIs — Mitra Ramah Inventory System
            </span>
            <span className="text-xs text-slate-500 whitespace-nowrap ml-3 hidden sm:block">
              {userName} · MRIs v1.0
            </span>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto p-4 sm:p-6 bg-slate-50">
          {children}
        </main>

        <footer className="text-center text-xs text-slate-400 py-3 bg-white border-t border-slate-100">
          © 2026 Mitra Ramah — All rights reserved | MRIs v1.0
        </footer>
      </div>
    </div>
  );
}
