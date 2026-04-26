import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { Sidebar } from "@/components/sidebar";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login");

  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        <header className="bg-white border-b border-slate-200 px-6 py-3.5 flex items-center justify-between flex-shrink-0">
          <span className="text-sm font-semibold text-slate-800">
            MRIs — Mitra Ramah Inventory System
          </span>
          <span className="text-xs text-slate-500">
            {session.user?.name} · MRIs v1.0
          </span>
        </header>
        <main className="flex-1 overflow-y-auto p-6 bg-slate-50">{children}</main>
        <footer className="text-center text-xs text-slate-400 py-3 bg-white border-t border-slate-100">
          © 2026 Mitra Ramah — All rights reserved | MRIs Inventory System v1.0
        </footer>
      </div>
    </div>
  );
}
