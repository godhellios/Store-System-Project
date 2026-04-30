"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession, signOut } from "next-auth/react";

const nav = [
  {
    section: "Main",
    roles: ["ADMIN", "STAFF", "VIEWER"],
    links: [
      { href: "/dashboard", label: "Dashboard", icon: "▦" },
      { href: "/products", label: "Products", icon: "⊞" },
      { href: "/products/add", label: "Add Product", icon: "↳", indent: true, small: true },
      { href: "/products/import", label: "Bulk Import", icon: "↳", indent: true, small: true },
      { href: "/warehouse", label: "Warehouse", icon: "⊟" },
    ],
  },
  {
    section: "Transactions",
    roles: ["ADMIN", "STAFF", "VIEWER", "OPERATOR"],
    links: [
      { href: "/transactions/grn", label: "Goods Received (GRN)", icon: "↓" },
      { href: "/transactions/goods-out", label: "Goods Out Order", icon: "↑" },
      { href: "/transactions/transfer", label: "Transfer", icon: "⇄" },
    ],
  },
  {
    section: "Barcodes",
    roles: ["ADMIN", "STAFF", "VIEWER"],
    links: [{ href: "/barcodes", label: "Barcode Labels", icon: "▣" }],
  },
  {
    section: "History",
    roles: ["ADMIN", "STAFF", "VIEWER"],
    links: [
      { href: "/orders", label: "Order History", icon: "📋" },
      { href: "/movements", label: "Movement Log", icon: "≡" },
      { href: "/reports", label: "Reports", icon: "⊙" },
    ],
  },
  {
    section: "Operations",
    roles: ["ADMIN", "STAFF", "VIEWER"],
    links: [{ href: "/opname", label: "Stock Opname", icon: "⊘" }],
  },
  {
    section: "Settings",
    roles: ["ADMIN", "STAFF"],
    links: [
      { href: "/settings", label: "Settings", icon: "⚙" },
      { href: "/settings/users", label: "User Management", icon: "↳", indent: true, small: true },
    ],
  },
];

export function Sidebar({ onClose }: { onClose?: () => void }) {
  const pathname = usePathname();
  const { data: session } = useSession();
  const role = session?.user.role ?? "";

  return (
    <div className="absolute inset-0 bg-slate-800 dark:bg-slate-950 text-slate-400 flex flex-col overflow-hidden">
      {/* Header — always visible at top */}
      <div className="flex-shrink-0 px-4 py-5 border-b border-slate-700 dark:border-slate-800 flex items-center justify-between">
        <div>
          <div className="text-base font-extrabold text-white tracking-tight">
            MR<span className="text-sky-400">Is</span>
          </div>
          {role === "OPERATOR" && (
            <div className="mt-1 text-[10px] uppercase tracking-widest text-amber-400 font-semibold">Operator</div>
          )}
        </div>
        {onClose && (
          <button
            onClick={onClose}
            className="md:hidden p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-700"
            aria-label="Close menu"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

      {/* Nav — scrollable, fills all remaining space */}
      <nav className="flex-1 overflow-y-auto overscroll-contain" style={{ WebkitOverflowScrolling: "touch" }}>
        {nav
          .filter((s) => s.roles.includes(role))
          .map(({ section, links }) => (
            <div key={section}>
              <div className="px-4 pt-3.5 pb-1 text-[10px] uppercase tracking-widest text-slate-500 dark:text-slate-300 font-semibold">
                {section}
              </div>
              {links.map(({ href, label, icon, indent, small }) => {
                const active = pathname === href || (href !== "/dashboard" && pathname.startsWith(href));
                return (
                  <Link
                    key={href}
                    href={href}
                    onClick={onClose}
                    className={[
                      "flex items-center gap-2.5 py-2.5 border-l-[3px] transition-colors",
                      indent ? "pl-7" : "pl-4",
                      small ? "text-xs" : "text-[13px]",
                      active
                        ? "bg-slate-900 dark:bg-slate-800 text-sky-400 border-sky-400"
                        : "border-transparent hover:bg-slate-900 dark:hover:bg-slate-800 hover:text-slate-200",
                    ].join(" ")}
                  >
                    <span>{icon}</span>
                    {label}
                  </Link>
                );
              })}
            </div>
          ))}
      </nav>

      {/* Sign out — always visible at bottom */}
      <div className="flex-shrink-0 border-t border-slate-700 dark:border-slate-800 p-4">
        <button
          onClick={() => signOut({ callbackUrl: "/login" })}
          className="w-full text-xs text-slate-500 hover:text-slate-300 text-left py-2 px-3 rounded-lg hover:bg-slate-700 dark:hover:bg-slate-800 transition-colors"
        >
          ⎋ &nbsp;Sign out
        </button>
      </div>
    </div>
  );
}
