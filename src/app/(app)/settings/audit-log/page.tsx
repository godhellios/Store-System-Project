"use client";

import { useEffect, useState, useCallback } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";

type AuditLog = {
  id: string;
  userId: string | null;
  userName: string;
  userRole: string;
  action: string;
  description: string;
  entityId: string | null;
  entityType: string | null;
  createdAt: string;
};

const ACTION_COLORS: Record<string, string> = {
  CREATE_GRN: "bg-green-100 text-green-800",
  CREATE_GOODS_OUT: "bg-orange-100 text-orange-800",
  CREATE_TRANSFER: "bg-blue-100 text-blue-800",
  CREATE_ADJUSTMENT: "bg-purple-100 text-purple-800",
  APPROVE_ADJUSTMENT: "bg-emerald-100 text-emerald-800",
  REJECT_ADJUSTMENT: "bg-red-100 text-red-800",
  DELETE_ORDER: "bg-red-200 text-red-900",
  EDIT_PRODUCT: "bg-sky-100 text-sky-800",
  DELETE_PRODUCT: "bg-red-200 text-red-900",
  APPROVE_OPNAME: "bg-teal-100 text-teal-800",
};

const ROLE_BADGE: Record<string, string> = {
  ADMIN: "bg-red-100 text-red-700",
  STAFF: "bg-blue-100 text-blue-700",
  VIEWER: "bg-slate-100 text-slate-600",
  OPERATOR: "bg-amber-100 text-amber-700",
};

const ENTITY_LINK: Record<string, (id: string) => string> = {
  ORDER: (id) => `/orders/${id}`,
  PRODUCT: (id) => `/products/${id}`,
  OPNAME: (id) => `/opname/${id}`,
};

const ALL_ACTIONS = [
  "CREATE_GRN", "CREATE_GOODS_OUT", "CREATE_TRANSFER", "CREATE_ADJUSTMENT",
  "APPROVE_ADJUSTMENT", "REJECT_ADJUSTMENT", "DELETE_ORDER",
  "EDIT_PRODUCT", "DELETE_PRODUCT", "APPROVE_OPNAME",
];

const ALL_ENTITY_TYPES = ["ORDER", "PRODUCT", "OPNAME"];

export default function AuditLogPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);

  const [filterAction, setFilterAction] = useState("");
  const [filterEntityType, setFilterEntityType] = useState("");
  const [filterUser, setFilterUser] = useState("");
  const [userInput, setUserInput] = useState("");

  const fetchLogs = useCallback(async (p: number) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(p) });
      if (filterAction) params.set("action", filterAction);
      if (filterEntityType) params.set("entityType", filterEntityType);
      if (filterUser) params.set("userName", filterUser);
      const res = await fetch(`/api/audit-log?${params}`);
      if (!res.ok) throw new Error("Failed");
      const data = await res.json();
      setLogs(data.logs);
      setTotal(data.total);
      setPages(data.pages);
      setPage(p);
    } catch {
      toast.error("Failed to load audit log");
    } finally {
      setLoading(false);
    }
  }, [filterAction, filterEntityType, filterUser]);

  useEffect(() => {
    if (status === "loading") return;
    if (!session || session.user.role !== "ADMIN") {
      router.replace("/settings");
      return;
    }
    fetchLogs(1);
  }, [status, session, router, fetchLogs]);

  function handleFilterSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFilterUser(userInput);
  }

  if (status === "loading" || !session) return null;

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 space-y-6">
      <div>
        <h1 className="text-xl font-bold text-slate-900 dark:text-white">Audit Log</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
          Record of all significant write actions in the system — {total.toLocaleString()} entries
        </p>
      </div>

      {/* Filters */}
      <form onSubmit={handleFilterSubmit} className="flex flex-wrap gap-3 items-end">
        <div>
          <label className="block text-xs text-slate-500 mb-1">Action</label>
          <select
            value={filterAction}
            onChange={(e) => setFilterAction(e.target.value)}
            className="text-sm border border-slate-200 rounded-lg px-3 py-2 dark:bg-slate-800 dark:border-slate-700 dark:text-white"
          >
            <option value="">All actions</option>
            {ALL_ACTIONS.map((a) => (
              <option key={a} value={a}>{a.replace(/_/g, " ")}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs text-slate-500 mb-1">Entity type</label>
          <select
            value={filterEntityType}
            onChange={(e) => setFilterEntityType(e.target.value)}
            className="text-sm border border-slate-200 rounded-lg px-3 py-2 dark:bg-slate-800 dark:border-slate-700 dark:text-white"
          >
            <option value="">All types</option>
            {ALL_ENTITY_TYPES.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs text-slate-500 mb-1">User</label>
          <input
            type="text"
            value={userInput}
            onChange={(e) => setUserInput(e.target.value)}
            placeholder="Search by name…"
            className="text-sm border border-slate-200 rounded-lg px-3 py-2 dark:bg-slate-800 dark:border-slate-700 dark:text-white w-44"
          />
        </div>
        <button
          type="submit"
          className="text-sm bg-sky-600 text-white rounded-lg px-4 py-2 hover:bg-sky-700"
        >
          Filter
        </button>
        {(filterAction || filterEntityType || filterUser) && (
          <button
            type="button"
            onClick={() => { setFilterAction(""); setFilterEntityType(""); setFilterUser(""); setUserInput(""); }}
            className="text-sm text-slate-500 hover:text-slate-700 py-2"
          >
            Clear
          </button>
        )}
      </form>

      {/* Log entries */}
      <div className="space-y-2">
        {loading && (
          <div className="text-sm text-slate-500 py-8 text-center">Loading…</div>
        )}
        {!loading && logs.length === 0 && (
          <div className="text-sm text-slate-500 py-8 text-center">No entries found</div>
        )}
        {!loading && logs.map((log) => {
          const entityLink = log.entityId && log.entityType ? ENTITY_LINK[log.entityType]?.(log.entityId) : null;
          const actionColor = ACTION_COLORS[log.action] ?? "bg-slate-100 text-slate-700";
          const roleColor = ROLE_BADGE[log.userRole] ?? "bg-slate-100 text-slate-600";
          const date = new Date(log.createdAt);
          return (
            <div key={log.id} className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-3 flex gap-4 items-start">
              <div className="flex-shrink-0 w-28 text-right">
                <div className="text-xs text-slate-500 dark:text-slate-400 leading-tight">
                  {date.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}
                </div>
                <div className="text-xs text-slate-400 dark:text-slate-500">
                  {date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                </div>
              </div>
              <div className="flex-1 min-w-0 space-y-1">
                <div className="flex flex-wrap gap-2 items-center">
                  <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${actionColor}`}>
                    {log.action.replace(/_/g, " ")}
                  </span>
                  {log.entityType && (
                    <span className="text-[11px] text-slate-400 dark:text-slate-500">
                      {log.entityType}
                      {entityLink && (
                        <a href={entityLink} className="ml-1 text-sky-500 hover:underline">→</a>
                      )}
                    </span>
                  )}
                </div>
                <p className="text-sm text-slate-800 dark:text-slate-200 truncate">{log.description}</p>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-600 dark:text-slate-300 font-medium">{log.userName}</span>
                  <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${roleColor}`}>{log.userRole}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Pagination */}
      {pages > 1 && (
        <div className="flex justify-center gap-2">
          <button
            onClick={() => fetchLogs(page - 1)}
            disabled={page <= 1 || loading}
            className="text-sm px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 disabled:opacity-40 hover:bg-slate-50 dark:hover:bg-slate-700"
          >
            ← Prev
          </button>
          <span className="text-sm text-slate-500 py-1.5 px-2">
            Page {page} of {pages}
          </span>
          <button
            onClick={() => fetchLogs(page + 1)}
            disabled={page >= pages || loading}
            className="text-sm px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 disabled:opacity-40 hover:bg-slate-50 dark:hover:bg-slate-700"
          >
            Next →
          </button>
        </div>
      )}
    </div>
  );
}
