"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession, signOut } from "next-auth/react";
import { useT } from "@/modules/i18n/provider";

type NavLink = {
  href: string;
  label: string;
  labelKey: string;
  icon: string;
  indent?: boolean;
  small?: boolean;
  adminOnly?: boolean;
};

type NavSection = {
  section: string;
  sectionKey: string;
  roles: string[];
  links: NavLink[];
};

const NAV: NavSection[] = [
  {
    section: "Main",
    sectionKey: "nav.sections.main",
    roles: ["ADMIN", "STAFF", "VIEWER"],
    links: [
      { href: "/dashboard", label: "Dashboard", labelKey: "nav.links.dashboard", icon: "▦" },
      { href: "/products", label: "Products", labelKey: "nav.links.products", icon: "⊞" },
      { href: "/products/add", label: "Add Product", labelKey: "nav.links.addProduct", icon: "↳", indent: true, small: true },
      { href: "/products/import", label: "Bulk Import", labelKey: "nav.links.bulkImport", icon: "↳", indent: true, small: true },
      { href: "/products/images", label: "Bulk Images", labelKey: "nav.links.bulkImages", icon: "↳", indent: true, small: true }, // BULK_IMAGE_UPLOAD
      { href: "/warehouse", label: "Warehouse", labelKey: "nav.links.warehouse", icon: "⊟" },
    ],
  },
  {
    section: "Transactions",
    sectionKey: "nav.sections.transactions",
    roles: ["ADMIN", "STAFF", "VIEWER", "OPERATOR"],
    links: [
      { href: "/transactions/grn", label: "Goods Received (GRN)", labelKey: "nav.links.grn", icon: "↓" },
      { href: "/transactions/goods-out", label: "Goods Out Order", labelKey: "nav.links.goodsOut", icon: "↑" },
      { href: "/transactions/transfer", label: "Transfer", labelKey: "nav.links.transfer", icon: "⇄" },
      { href: "/transactions/adjustment", label: "Stock Adjustment", labelKey: "nav.links.adjustment", icon: "±" },
    ],
  },
  {
    section: "Barcodes",
    sectionKey: "nav.sections.barcodes",
    roles: ["ADMIN", "STAFF", "VIEWER"],
    links: [{ href: "/barcodes", label: "Barcode Labels", labelKey: "nav.links.barcodeLabels", icon: "▣" }],
  },
  {
    section: "History",
    sectionKey: "nav.sections.history",
    roles: ["ADMIN", "STAFF", "VIEWER"],
    links: [
      { href: "/orders", label: "Order History", labelKey: "nav.links.orderHistory", icon: "📋" },
      { href: "/approvals", label: "Pending Approval", labelKey: "nav.links.pendingApproval", icon: "⏳", indent: true, small: true, adminOnly: true },
      { href: "/movements", label: "Movement Log", labelKey: "nav.links.movementLog", icon: "≡", adminOnly: true },
      { href: "/reports", label: "Reports", labelKey: "nav.links.reports", icon: "⊙" },
    ],
  },
  {
    section: "Operations",
    sectionKey: "nav.sections.operations",
    roles: ["ADMIN", "STAFF"],
    links: [{ href: "/opname", label: "Stock Opname", labelKey: "nav.links.stockOpname", icon: "⊘" }],
  },
  {
    section: "Settings",
    sectionKey: "nav.sections.settings",
    roles: ["ADMIN"],
    links: [
      { href: "/settings", label: "Settings", labelKey: "nav.links.settings", icon: "⚙" },
      { href: "/settings/users", label: "User Management", labelKey: "nav.links.userManagement", icon: "↳", indent: true, small: true },
      { href: "/settings/audit-log", label: "Audit Log", labelKey: "nav.links.auditLog", icon: "↳", indent: true, small: true },
    ],
  },
];

export function Sidebar({ onClose }: { onClose?: () => void }) {
  const t = useT();
  const pathname = usePathname();
  const { data: session } = useSession();
  const role = session?.user.role ?? "";

  return (
    /*
     * h-full fills the shell (which is 100dvh on mobile, flex-stretch on desktop).
     * overflow-hidden clips anything that escapes before the nav scroll kicks in.
     */
    <div className="h-full flex flex-col bg-slate-800 dark:bg-slate-950 text-slate-400 overflow-hidden">

      {/* ── Logo / header ─ pinned at the top, never scrolls ── */}
      <div className="flex-shrink-0 px-4 py-5 border-b border-slate-700 dark:border-slate-800 flex items-center justify-between">
        <div>
          <div className="text-base font-extrabold text-white tracking-tight">
            MR<span className="text-sky-400">Is</span>
          </div>
          {role === "OPERATOR" && (
            <div className="mt-1 text-[10px] uppercase tracking-widest text-amber-400 font-semibold">
              Operator
            </div>
          )}
        </div>
        {onClose && (
          <button
            onClick={onClose}
            className="md:hidden p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-700"
            aria-label={t("app.closeMenu", "Close menu")}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

      {/* ── Nav ─ flex-1 so it fills the gap; min-h-0 lets it shrink so overflow triggers ── */}
      <nav
        className="flex-1 min-h-0 overflow-y-auto overscroll-contain"
        style={{ WebkitOverflowScrolling: "touch" }}
      >
        {NAV
          .filter((s) => s.roles.includes(role))
          .map(({ section, sectionKey, links }) => (
            <div key={section}>
              <div className="px-4 pt-3.5 pb-1 text-[10px] uppercase tracking-widest text-slate-500 dark:text-slate-300 font-semibold">
                {t(sectionKey, section)}
              </div>
              {links.filter(({ adminOnly }) => !adminOnly || role === "ADMIN").map(({ href, label, labelKey, icon, indent, small }) => {
                const active =
                  pathname === href ||
                  (href !== "/dashboard" && pathname.startsWith(href));
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
                    {t(labelKey, label)}
                  </Link>
                );
              })}
            </div>
          ))}

        {/* Extra bottom padding so last item clears the mobile browser bar */}
        <div className="h-4" />
      </nav>

      {/* ── Sign out ─ pinned at the bottom, never scrolls ── */}
      <div className="flex-shrink-0 border-t border-slate-700 dark:border-slate-800 p-4">
        <button
          onClick={() => {
            ["GOODS_OUT", "GRN", "TRANSFER", "ADJUSTMENT"].forEach((t) =>
              localStorage.removeItem(`mris_draft_${t}`)
            );
            signOut({ callbackUrl: "/login" });
          }}
          className="w-full text-xs text-slate-500 hover:text-slate-300 text-left py-2 px-3 rounded-lg hover:bg-slate-700 dark:hover:bg-slate-800 transition-colors"
        >
          ⎋ &nbsp;{t("common.signOut", "Sign out")}
        </button>
      </div>
    </div>
  );
}
