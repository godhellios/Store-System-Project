"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";

type Row = { id: string; name: string; type?: string; isActive: boolean; _count?: { products: number } };

const TABS = ["Categories", "Units", "Locations"];

function EntityManager({ endpoint, label, hasType }: { endpoint: string; label: string; hasType?: boolean }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [newName, setNewName] = useState("");
  const [newType, setNewType] = useState("");
  const [editing, setEditing] = useState<{ id: string; name: string; type: string } | null>(null);
  const [loading, setLoading] = useState(false);

  async function load() {
    const res = await fetch(`/api/${endpoint}`);
    if (res.ok) setRows(await res.json());
  }

  useEffect(() => { load(); }, []);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    setLoading(true);
    const body: Record<string, string> = { name: newName.trim() };
    if (hasType) body.type = newType.trim() || "Warehouse";
    const res = await fetch(`/api/${endpoint}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    const data = await res.json();
    setLoading(false);
    if (!res.ok) { toast.error(data.error); return; }
    toast.success(`${label} added`);
    setNewName(""); setNewType("");
    load();
  }

  async function handleSave() {
    if (!editing) return;
    setLoading(true);
    const body: Record<string, string> = { name: editing.name };
    if (hasType) body.type = editing.type;
    const res = await fetch(`/api/${endpoint}/${editing.id}`, {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    const data = await res.json();
    setLoading(false);
    if (!res.ok) { toast.error(data.error); return; }
    toast.success("Saved");
    setEditing(null);
    load();
  }

  async function toggleActive(row: Row) {
    const res = await fetch(`/api/${endpoint}/${row.id}`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: !row.isActive }),
    });
    if (!res.ok) { toast.error("Failed"); return; }
    toast.success(row.isActive ? "Deactivated" : "Activated");
    load();
  }

  async function handleDelete(row: Row) {
    if (!confirm(`Delete "${row.name}"?`)) return;
    const res = await fetch(`/api/${endpoint}/${row.id}`, { method: "DELETE" });
    if (res.status === 204) { toast.success("Deleted"); load(); return; }
    const data = await res.json();
    toast.error(data.error);
  }

  return (
    <div className="max-w-xl">
      {/* Add form */}
      <form onSubmit={handleAdd} className="flex gap-2 mb-4">
        <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder={`New ${label.toLowerCase()} name…`}
          className="flex-1 px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        {hasType && (
          <input value={newType} onChange={(e) => setNewType(e.target.value)} placeholder="Type (e.g. Warehouse)"
            className="w-36 px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        )}
        <button type="submit" disabled={loading || !newName.trim()}
          className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-semibold px-4 py-2 rounded-lg">
          Add
        </button>
      </form>

      {/* List */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden divide-y divide-slate-100">
        {rows.length === 0 && <p className="px-4 py-6 text-center text-xs text-slate-400">No {label.toLowerCase()}s yet</p>}
        {rows.map((row) => (
          <div key={row.id} className={`flex items-center gap-3 px-4 py-2.5 ${!row.isActive ? "opacity-50" : ""}`}>
            {editing?.id === row.id ? (
              <>
                <input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                  className="flex-1 px-2 py-1 border border-blue-400 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" autoFocus />
                {hasType && (
                  <input value={editing.type} onChange={(e) => setEditing({ ...editing, type: e.target.value })}
                    className="w-28 px-2 py-1 border border-blue-400 rounded text-sm focus:outline-none" />
                )}
                <button onClick={handleSave} className="text-xs text-blue-600 font-medium hover:underline">Save</button>
                <button onClick={() => setEditing(null)} className="text-xs text-slate-400 hover:underline">Cancel</button>
              </>
            ) : (
              <>
                <div className="flex-1">
                  <span className="text-sm text-slate-800">{row.name}</span>
                  {hasType && row.type && <span className="ml-2 text-xs text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded">{row.type}</span>}
                  {row._count !== undefined && (
                    <span className="ml-2 text-xs text-slate-400">{row._count.products} product{row._count.products !== 1 ? "s" : ""}</span>
                  )}
                </div>
                <button onClick={() => setEditing({ id: row.id, name: row.name, type: row.type ?? "" })}
                  className="text-xs text-slate-500 hover:underline">Edit</button>
                <button onClick={() => toggleActive(row)}
                  className={`text-xs hover:underline ${row.isActive ? "text-orange-500" : "text-green-600"}`}>
                  {row.isActive ? "Deactivate" : "Activate"}
                </button>
                <button onClick={() => handleDelete(row)} className="text-xs text-red-400 hover:underline">Delete</button>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function SettingsPage() {
  const { data: session } = useSession();
  const router = useRouter();
  useEffect(() => {
    if (session?.user.role === "OPERATOR") router.replace("/transactions/grn");
  }, [session, router]);

  const [tab, setTab] = useState(0);

  return (
    <div>
      <h1 className="text-base font-semibold text-slate-800 mb-5">Settings</h1>

      <div className="flex gap-1 mb-6 border-b border-slate-200">
        {TABS.map((t, i) => (
          <button key={t} onClick={() => setTab(i)}
            className={`px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px ${i === tab ? "border-blue-600 text-blue-600" : "border-transparent text-slate-500 hover:text-slate-800"}`}>
            {t}
          </button>
        ))}
      </div>

      {tab === 0 && <EntityManager endpoint="categories" label="Category" />}
      {tab === 1 && <EntityManager endpoint="units" label="Unit" />}
      {tab === 2 && <EntityManager endpoint="locations" label="Location" hasType />}
    </div>
  );
}
