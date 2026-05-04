"use client";

import { useState, useEffect } from "react";
import { signOut } from "next-auth/react";
import { Sidebar } from "@/components/sidebar";
import { ThemeToggle } from "@/components/theme-toggle";

export function AppShell({
  children,
  userName,
  userRole,
  loginAt,
}: {
  children: React.ReactNode;
  userName: string;
  userRole: string;
  loginAt?: number;
}) {
  const [open, setOpen] = useState(false);
  const [geoBlocked, setGeoBlocked] = useState(false);

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

  // Auto-logout non-admin users when tab or browser is closed and reopened
  useEffect(() => {
    if (userRole === "ADMIN") return;
    if (!sessionStorage.getItem("session_alive")) {
      signOut({ callbackUrl: "/login" });
      return;
    }
    // Catch Chrome/Edge session restore: loginAt comes from the JWT (server-side),
    // so it can't be spoofed by the browser restoring sessionStorage.
    // 10 hours covers any overnight gap between shifts.
    if (loginAt && Date.now() - loginAt > 10 * 60 * 60 * 1000) {
      sessionStorage.removeItem("session_alive");
      signOut({ callbackUrl: "/login" });
    }
  }, [userRole, loginAt]);

  // Poll every 15 seconds — kicks out immediately if another device logs in
  useEffect(() => {
    if (userRole === "ADMIN") return;
    const interval = setInterval(async () => {
      try {
        const res = await fetch("/api/session-check");
        const data = await res.json();
        if (!data.valid) {
          sessionStorage.removeItem("session_alive");
          signOut({ callbackUrl: "/login?reason=displaced" });
        }
      } catch {
        // ignore network errors — don't kick out on flaky connection
      }
    }, 15000);
    return () => clearInterval(interval);
  }, [userRole]);

  // Require location — block app if denied
  useEffect(() => {
    if (!navigator.geolocation) return;
    const isFreshLogin = sessionStorage.getItem("captureLoginGeo") === "1";

    function request() {
      navigator.geolocation.getCurrentPosition(
        ({ coords }) => {
          setGeoBlocked(false);
          if (isFreshLogin) {
            sessionStorage.removeItem("captureLoginGeo");
            fetch("/api/login-logs/geo", {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ lat: coords.latitude, lng: coords.longitude }),
            }).catch(() => {});
          }
        },
        () => {
          sessionStorage.removeItem("captureLoginGeo");
          setGeoBlocked(true);
        },
        { timeout: 15000, enableHighAccuracy: false }
      );
    }

    if (navigator.permissions) {
      navigator.permissions.query({ name: "geolocation" as PermissionName }).then((result) => {
        if (result.state === "denied") {
          sessionStorage.removeItem("captureLoginGeo");
          setGeoBlocked(true);
        } else {
          request();
        }
        result.onchange = () => {
          if (result.state === "denied") setGeoBlocked(true);
          else { setGeoBlocked(false); request(); }
        };
      }).catch(() => request());
    } else {
      request();
    }
  }, []);

  function retryGeo() {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        setGeoBlocked(false);
        fetch("/api/login-logs/geo", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ lat: coords.latitude, lng: coords.longitude }),
        }).catch(() => {});
      },
      () => setGeoBlocked(true),
      { timeout: 15000, enableHighAccuracy: false }
    );
  }

  return (
    <div className="flex min-h-screen">

      {/* ── Location required overlay ─────────────────────── */}
      {geoBlocked && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/80 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-2xl p-8 max-w-sm w-full text-center">
            <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-red-500" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/>
              </svg>
            </div>
            <h2 className="text-lg font-bold text-slate-800 mb-2">Akses Lokasi Diperlukan</h2>
            <p className="text-sm text-slate-500 mb-5">
              Aplikasi ini memerlukan akses lokasi untuk keamanan dan audit login. Izinkan akses lokasi di browser Anda untuk melanjutkan.
            </p>
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 text-left mb-5 space-y-1.5">
              <p className="text-xs font-semibold text-slate-700 mb-2">Cara mengaktifkan:</p>
              <p className="text-xs text-slate-600">• <span className="font-medium">Chrome / Edge:</span> klik ikon kunci di address bar → Lokasi → Izinkan</p>
              <p className="text-xs text-slate-600">• <span className="font-medium">Firefox:</span> klik ikon kunci → Izinkan Lokasi</p>
              <p className="text-xs text-slate-600">• <span className="font-medium">Safari:</span> Pengaturan → Safari → Lokasi → Izinkan</p>
              <p className="text-xs text-slate-600">• <span className="font-medium">HP Android:</span> Pengaturan → Aplikasi → Browser → Izin → Lokasi</p>
            </div>
            <button
              onClick={retryGeo}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2.5 rounded-xl text-sm transition-colors"
            >
              Coba Lagi
            </button>
          </div>
        </div>
      )}

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
          © 2026 Mitra Ramah — All rights reserved | MRIs v1.3.2
        </footer>
      </div>
    </div>
  );
}
