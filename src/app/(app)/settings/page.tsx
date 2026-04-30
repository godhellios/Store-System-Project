"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
// ── push-notify module ──────────────────────────────────────────────────────
import { PushSubscribeButton } from "@/modules/push-notify";
// ────────────────────────────────────────────────────────────────────────────

type Row = { id: string; name: string; type?: string; isActive: boolean; _count?: { products?: number; stock?: number } };
type LocationRow = { id: string; name: string; type: string; isActive: boolean; _count: { stock: number } };
type StockItem = {
  id: string; quantity: number;
  product: { id: string; name: string; sku: string; colorVariant: string | null; isActive: boolean; category: { name: string }; unit: { name: string } };
};
type UnitRow = {
  id: string; name: string; isActive: boolean;
  parentUnitId: string | null; conversionFactor: number | null;
  parent: { id: string; name: string } | null;
  _count: { products: number };
};

const TABS = ["Categories", "Units", "Locations", "Notifications"];

// Generic manager for categories and locations
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
      <form onSubmit={handleAdd} className="flex flex-col sm:flex-row gap-2 mb-4">
        <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder={`New ${label.toLowerCase()} name…`}
          className="flex-1 px-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        {hasType && (
          <input value={newType} onChange={(e) => setNewType(e.target.value)} placeholder="Type (e.g. Warehouse)"
            className="sm:w-36 px-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        )}
        <button type="submit" disabled={loading || !newName.trim()}
          className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-semibold px-4 py-2.5 rounded-lg">
          Add
        </button>
      </form>
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden divide-y divide-slate-100">
        {rows.length === 0 && <p className="px-4 py-6 text-center text-xs text-slate-400">No {label.toLowerCase()}s yet</p>}
        {rows.map((row) => (
          <div key={row.id} className={`px-4 py-3 ${!row.isActive ? "opacity-50" : ""}`}>
            {editing?.id === row.id ? (
              <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2">
                <input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                  className="flex-1 w-full px-3 py-2 border border-blue-400 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" autoFocus />
                {hasType && (
                  <input value={editing.type} onChange={(e) => setEditing({ ...editing, type: e.target.value })}
                    className="sm:w-28 w-full px-3 py-2 border border-blue-400 rounded-lg text-sm focus:outline-none" />
                )}
                <div className="flex gap-2">
                  <button onClick={handleSave} className="px-3 py-2 text-xs text-white bg-blue-600 hover:bg-blue-700 font-semibold rounded-lg">Save</button>
                  <button onClick={() => setEditing(null)} className="px-3 py-2 text-xs text-slate-600 border border-slate-300 hover:bg-slate-50 rounded-lg">Cancel</button>
                </div>
              </div>
            ) : (
              <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                <div className="flex-1 min-w-0">
                  <span className="text-sm text-slate-800">{row.name}</span>
                  {hasType && row.type && <span className="ml-2 text-xs text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded">{row.type}</span>}
                  {row._count?.products !== undefined && (
                    <span className="ml-2 text-xs text-slate-400">{row._count.products} product{row._count.products !== 1 ? "s" : ""}</span>
                  )}
                  {row._count?.stock !== undefined && (
                    <span className="ml-2 text-xs text-slate-400">{row._count.stock} stock record{row._count.stock !== 1 ? "s" : ""}</span>
                  )}
                </div>
                <div className="flex gap-1.5">
                  <button onClick={() => setEditing({ id: row.id, name: row.name, type: row.type ?? "" })}
                    className="flex-1 sm:flex-none px-3 py-1.5 text-xs text-slate-600 border border-slate-300 hover:bg-slate-50 rounded-lg transition-colors">Edit</button>
                  <button onClick={() => toggleActive(row)}
                    className={`flex-1 sm:flex-none px-3 py-1.5 text-xs rounded-lg transition-colors border ${row.isActive ? "text-orange-600 border-orange-200 hover:bg-orange-50" : "text-green-600 border-green-200 hover:bg-green-50"}`}>
                    {row.isActive ? "Deactivate" : "Activate"}
                  </button>
                  <button onClick={() => handleDelete(row)}
                    className="flex-1 sm:flex-none px-3 py-1.5 text-xs text-red-500 border border-red-200 hover:bg-red-50 rounded-lg transition-colors">Delete</button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// Dedicated unit manager with parent/conversion support
function UnitManager() {
  const [units, setUnits] = useState<UnitRow[]>([]);
  const [newName, setNewName] = useState("");
  const [newParentId, setNewParentId] = useState("");
  const [newFactor, setNewFactor] = useState("");
  const [editing, setEditing] = useState<{ id: string; name: string; parentUnitId: string; conversionFactor: string } | null>(null);
  const [loading, setLoading] = useState(false);

  async function load() {
    const res = await fetch("/api/units");
    if (res.ok) setUnits(await res.json());
  }
  useEffect(() => { load(); }, []);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    setLoading(true);
    const res = await fetch("/api/units", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: newName.trim(),
        parentUnitId: newParentId || null,
        conversionFactor: newFactor ? parseFloat(newFactor) : null,
      }),
    });
    const data = await res.json();
    setLoading(false);
    if (!res.ok) { toast.error(data.error); return; }
    toast.success("Unit added");
    setNewName(""); setNewParentId(""); setNewFactor("");
    load();
  }

  async function handleSave() {
    if (!editing) return;
    setLoading(true);
    const res = await fetch(`/api/units/${editing.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: editing.name,
        parentUnitId: editing.parentUnitId || null,
        conversionFactor: editing.conversionFactor ? parseFloat(editing.conversionFactor) : null,
      }),
    });
    const data = await res.json();
    setLoading(false);
    if (!res.ok) { toast.error(data.error); return; }
    toast.success("Saved");
    setEditing(null);
    load();
  }

  async function toggleActive(unit: UnitRow) {
    const res = await fetch(`/api/units/${unit.id}`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: !unit.isActive }),
    });
    if (!res.ok) { toast.error("Failed"); return; }
    toast.success(unit.isActive ? "Deactivated" : "Activated");
    load();
  }

  async function handleDelete(unit: UnitRow) {
    if (!confirm(`Delete "${unit.name}"?`)) return;
    const res = await fetch(`/api/units/${unit.id}`, { method: "DELETE" });
    if (res.status === 204) { toast.success("Deleted"); load(); return; }
    const data = await res.json();
    toast.error(data.error);
  }

  const activeUnits = units.filter((u) => u.isActive);

  return (
    <div className="max-w-xl">
      <p className="text-xs text-slate-500 mb-3">
        Define higher units by selecting a parent. Example: <span className="font-medium">Box</span> → parent = <span className="font-medium">Dozen</span>, factor = <span className="font-medium">12</span> means 1 Box = 12 Dozen.
      </p>
      <form onSubmit={handleAdd} className="flex flex-wrap gap-2 mb-4 items-end">
        <div className="flex-1 min-w-[140px]">
          <label className="block text-xs text-slate-500 mb-0.5">Unit name *</label>
          <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. Box"
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
        <div className="min-w-[130px]">
          <label className="block text-xs text-slate-500 mb-0.5">1 of this = … of</label>
          <select value={newParentId} onChange={(e) => setNewParentId(e.target.value)}
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
            <option value="">(base unit)</option>
            {activeUnits.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </div>
        {newParentId && (
          <div className="w-24">
            <label className="block text-xs text-slate-500 mb-0.5">Factor *</label>
            <input type="number" min="1" step="any" value={newFactor} onChange={(e) => setNewFactor(e.target.value)}
              placeholder="e.g. 12"
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
        )}
        <button type="submit" disabled={loading || !newName.trim() || (!!newParentId && !newFactor)}
          className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-semibold px-4 py-2 rounded-lg">
          Add
        </button>
      </form>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden divide-y divide-slate-100">
        {units.length === 0 && <p className="px-4 py-6 text-center text-xs text-slate-400">No units yet</p>}
        {units.map((unit) => (
          <div key={unit.id} className={`px-4 py-2.5 ${!unit.isActive ? "opacity-50" : ""}`}>
            {editing?.id === unit.id ? (
              <div className="flex flex-wrap gap-2 items-end">
                <div className="flex-1 min-w-[120px]">
                  <label className="block text-xs text-slate-400 mb-0.5">Name</label>
                  <input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                    className="w-full px-2 py-1 border border-blue-400 rounded text-sm focus:outline-none" autoFocus />
                </div>
                <div className="min-w-[120px]">
                  <label className="block text-xs text-slate-400 mb-0.5">1 of this = … of</label>
                  <select value={editing.parentUnitId}
                    onChange={(e) => setEditing({ ...editing, parentUnitId: e.target.value, conversionFactor: "" })}
                    className="w-full px-2 py-1 border border-blue-400 rounded text-sm focus:outline-none">
                    <option value="">(base unit)</option>
                    {activeUnits.filter((u) => u.id !== unit.id).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                  </select>
                </div>
                {editing.parentUnitId && (
                  <div className="w-20">
                    <label className="block text-xs text-slate-400 mb-0.5">Factor</label>
                    <input type="number" min="1" step="any" value={editing.conversionFactor}
                      onChange={(e) => setEditing({ ...editing, conversionFactor: e.target.value })}
                      className="w-full px-2 py-1 border border-blue-400 rounded text-sm focus:outline-none" />
                  </div>
                )}
                <div className="flex gap-2 items-center">
                  <button onClick={handleSave} className="text-xs text-blue-600 font-medium hover:underline">Save</button>
                  <button onClick={() => setEditing(null)} className="text-xs text-slate-400 hover:underline">Cancel</button>
                </div>
              </div>
            ) : (
              <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                <div className="flex-1 min-w-0">
                  <span className="text-sm text-slate-800">{unit.name}</span>
                  {unit.parent && (
                    <span className="ml-2 text-xs text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded">
                      1 {unit.name} = {unit.conversionFactor} {unit.parent.name}
                    </span>
                  )}
                  <span className="ml-2 text-xs text-slate-400">{unit._count.products} product{unit._count.products !== 1 ? "s" : ""}</span>
                </div>
                <div className="flex gap-1.5">
                  <button onClick={() => setEditing({ id: unit.id, name: unit.name, parentUnitId: unit.parentUnitId ?? "", conversionFactor: unit.conversionFactor?.toString() ?? "" })}
                    className="flex-1 sm:flex-none px-3 py-1.5 text-xs text-slate-600 border border-slate-300 hover:bg-slate-50 rounded-lg transition-colors">Edit</button>
                  <button onClick={() => toggleActive(unit)}
                    className={`flex-1 sm:flex-none px-3 py-1.5 text-xs rounded-lg transition-colors border ${unit.isActive ? "text-orange-600 border-orange-200 hover:bg-orange-50" : "text-green-600 border-green-200 hover:bg-green-50"}`}>
                    {unit.isActive ? "Deactivate" : "Activate"}
                  </button>
                  <button onClick={() => handleDelete(unit)}
                    className="flex-1 sm:flex-none px-3 py-1.5 text-xs text-red-500 border border-red-200 hover:bg-red-50 rounded-lg transition-colors">Delete</button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function LocationManager() {
  const [rows, setRows] = useState<LocationRow[]>([]);
  const [newName, setNewName] = useState("");
  const [newType, setNewType] = useState("Warehouse");
  const [editing, setEditing] = useState<{ id: string; name: string; type: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [stockItems, setStockItems] = useState<StockItem[]>([]);
  const [stockLoading, setStockLoading] = useState(false);

  async function load() {
    const res = await fetch("/api/locations");
    if (res.ok) setRows(await res.json());
  }
  useEffect(() => { load(); }, []);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    setLoading(true);
    const res = await fetch("/api/locations", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newName.trim(), type: newType.trim() || "Warehouse" }),
    });
    const data = await res.json();
    setLoading(false);
    if (!res.ok) { toast.error(data.error); return; }
    toast.success("Location added");
    setNewName(""); setNewType("Warehouse");
    load();
  }

  async function handleSave() {
    if (!editing) return;
    setLoading(true);
    const res = await fetch(`/api/locations/${editing.id}`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: editing.name, type: editing.type }),
    });
    const data = await res.json();
    setLoading(false);
    if (!res.ok) { toast.error(data.error); return; }
    toast.success("Saved");
    setEditing(null);
    load();
  }

  async function toggleActive(row: LocationRow) {
    const res = await fetch(`/api/locations/${row.id}`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: !row.isActive }),
    });
    if (!res.ok) { toast.error("Failed"); return; }
    toast.success(row.isActive ? "Deactivated" : "Activated");
    load();
  }

  async function handleDelete(row: LocationRow) {
    if (!confirm(`Delete "${row.name}"?`)) return;
    const res = await fetch(`/api/locations/${row.id}`, { method: "DELETE" });
    if (res.status === 204) { toast.success("Deleted"); load(); return; }
    const data = await res.json();
    toast.error(data.error);
  }

  async function toggleExpand(id: string) {
    if (expandedId === id) { setExpandedId(null); setStockItems([]); return; }
    setExpandedId(id);
    setStockLoading(true);
    const res = await fetch(`/api/stock?locationId=${id}&includeInactive=true`);
    if (res.ok) setStockItems(await res.json());
    setStockLoading(false);
  }

  async function deleteStockItem(stockId: string, qty: number) {
    const msg = qty > 0
      ? `This item still has ${qty} units in stock. Remove it anyway?`
      : `Remove this stock record?`;
    if (!confirm(msg)) return;
    const res = await fetch(`/api/stock/${stockId}`, { method: "DELETE" });
    if (res.status !== 204) { const d = await res.json(); toast.error(d.error); return; }
    toast.success("Removed");
    if (expandedId) {
      const r = await fetch(`/api/stock?locationId=${expandedId}&includeInactive=true`);
      if (r.ok) setStockItems(await r.json());
    }
    load();
  }

  return (
    <div className="max-w-2xl">
      <form onSubmit={handleAdd} className="flex flex-col sm:flex-row gap-2 mb-4">
        <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="New location name…"
          className="flex-1 px-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        <input value={newType} onChange={(e) => setNewType(e.target.value)} placeholder="Type (e.g. Warehouse)"
          className="sm:w-36 px-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        <button type="submit" disabled={loading || !newName.trim()}
          className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-semibold px-4 py-2.5 rounded-lg">
          Add
        </button>
      </form>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden divide-y divide-slate-100">
        {rows.length === 0 && <p className="px-4 py-6 text-center text-xs text-slate-400">No locations yet</p>}
        {rows.map((row) => (
          <div key={row.id}>
            {/* Row header */}
            <div className={`px-4 py-3 ${!row.isActive ? "opacity-50" : ""}`}>
              {editing?.id === row.id ? (
                <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2">
                  <input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                    className="flex-1 w-full px-3 py-2 border border-blue-400 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" autoFocus />
                  <input value={editing.type} onChange={(e) => setEditing({ ...editing, type: e.target.value })}
                    className="sm:w-28 w-full px-3 py-2 border border-blue-400 rounded-lg text-sm focus:outline-none" />
                  <div className="flex gap-2">
                    <button onClick={handleSave} className="px-3 py-2 text-xs text-white bg-blue-600 hover:bg-blue-700 font-semibold rounded-lg">Save</button>
                    <button onClick={() => setEditing(null)} className="px-3 py-2 text-xs text-slate-600 border border-slate-300 hover:bg-slate-50 rounded-lg">Cancel</button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                  <div className="flex-1 min-w-0">
                    <span className="text-sm text-slate-800">{row.name}</span>
                    {row.type && <span className="ml-2 text-xs text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded">{row.type}</span>}
                    <button
                      onClick={() => toggleExpand(row.id)}
                      className="ml-2 text-xs text-blue-600 hover:underline"
                    >
                      {row._count.stock} item{row._count.stock !== 1 ? "s" : ""}
                      {row._count.stock > 0 && <span className="ml-1">{expandedId === row.id ? "▲" : "▼"}</span>}
                    </button>
                  </div>
                  <div className="flex gap-1.5">
                    <button onClick={() => setEditing({ id: row.id, name: row.name, type: row.type })}
                      className="flex-1 sm:flex-none px-3 py-1.5 text-xs text-slate-600 border border-slate-300 hover:bg-slate-50 rounded-lg transition-colors">Edit</button>
                    <button onClick={() => toggleActive(row)}
                      className={`flex-1 sm:flex-none px-3 py-1.5 text-xs rounded-lg transition-colors border ${row.isActive ? "text-orange-600 border-orange-200 hover:bg-orange-50" : "text-green-600 border-green-200 hover:bg-green-50"}`}>
                      {row.isActive ? "Deactivate" : "Activate"}
                    </button>
                    <button onClick={() => handleDelete(row)}
                      className="flex-1 sm:flex-none px-3 py-1.5 text-xs text-red-500 border border-red-200 hover:bg-red-50 rounded-lg transition-colors">Delete</button>
                  </div>
                </div>
              )}
            </div>

            {/* Expanded stock items */}
            {expandedId === row.id && (
              <div className="bg-slate-50 border-t border-slate-100 px-4 py-3">
                {stockLoading ? (
                  <p className="text-xs text-slate-400">Loading…</p>
                ) : stockItems.length === 0 ? (
                  <p className="text-xs text-slate-400">No stock records for this location.</p>
                ) : (
                  <div className="divide-y divide-slate-200 rounded-lg border border-slate-200 overflow-hidden bg-white">
                    <div className="grid grid-cols-[1fr_auto_auto_auto] gap-x-4 px-3 py-1.5 bg-slate-100 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                      <span>Product</span>
                      <span>Category</span>
                      <span className="text-right">Qty</span>
                      <span />
                    </div>
                    {stockItems.map((s) => (
                      <div key={s.id} className="grid grid-cols-[1fr_auto_auto_auto] gap-x-4 px-3 py-2 items-center">
                        <div className="min-w-0">
                          <div className={`text-sm truncate flex items-center gap-1.5 ${!s.product.isActive ? "text-slate-400" : "text-slate-800"}`}>
                            {s.product.name}{s.product.colorVariant ? <span className="text-slate-400"> — {s.product.colorVariant}</span> : null}
                            {!s.product.isActive && <span className="text-[9px] font-semibold bg-slate-200 text-slate-400 px-1.5 py-0.5 rounded-full uppercase tracking-wide flex-shrink-0">Inactive</span>}
                          </div>
                          <div className="text-xs font-mono text-slate-400">{s.product.sku}</div>
                        </div>
                        <span className="text-xs text-slate-500 whitespace-nowrap">{s.product.category.name}</span>
                        <span className={`text-sm font-semibold text-right whitespace-nowrap ${s.quantity === 0 ? "text-slate-300" : "text-slate-800"}`}>
                          {s.quantity} {s.product.unit.name.toLowerCase()}
                        </span>
                        <button onClick={() => deleteStockItem(s.id, s.quantity)}
                          className="text-xs text-red-400 hover:text-red-600 hover:underline whitespace-nowrap">
                          Remove
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function NotificationsManager() {
  const [waNumber, setWaNumber] = useState("");
  const [waLoading, setWaLoading] = useState(false);

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((d) => { if (d.whatsapp_number) setWaNumber(d.whatsapp_number); })
      .catch(() => {});
  }, []);

  async function saveWaNumber() {
    if (!waNumber.trim()) return;
    setWaLoading(true);
    const res = await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: "whatsapp_number", value: waNumber.trim().replace(/\D/g, "") }),
    });
    setWaLoading(false);
    if (res.ok) toast.success("WhatsApp number saved");
    else toast.error("Failed to save");
  }

  return (
    <div className="max-w-lg space-y-6">
      {/* WhatsApp DO number */}
      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <div className="flex items-center gap-2 mb-1">
          <svg className="w-4 h-4 text-green-600" viewBox="0 0 24 24" fill="currentColor">
            <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
          </svg>
          <span className="text-sm font-semibold text-slate-800">WhatsApp DO Number</span>
        </div>
        <p className="text-xs text-slate-500 mb-3">
          Delivery Orders from Goods Out will be sent to this number. Enter digits only, with country code (e.g. 6281283118487).
        </p>
        <div className="flex gap-2">
          <input
            value={waNumber}
            onChange={(e) => setWaNumber(e.target.value)}
            placeholder="6281283118487"
            className="flex-1 px-3 py-2 border border-slate-300 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-green-500"
          />
          <button
            onClick={saveWaNumber}
            disabled={waLoading || !waNumber.trim()}
            className="bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors"
          >
            {waLoading ? "Saving…" : "Save"}
          </button>
        </div>
      </div>

      {/* Push notifications */}
      <div>
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 mb-4 flex gap-3">
          <span className="text-xl">🔔</span>
          <div>
            <div className="text-sm font-semibold text-blue-800 mb-0.5">Phone Push Notifications</div>
            <p className="text-xs text-blue-700">
              Get an instant notification on this device whenever a Goods Out order is confirmed. Free — no service required. Enable on each device you want to receive alerts.
            </p>
          </div>
        </div>
        {/* ── push-notify module ─────────────────────────────────────────── */}
        <PushSubscribeButton
          vapidPublicKey={process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? ""}
        />
        {/* ─────────────────────────────────────────────────────────────────── */}
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

      <div className="flex gap-1 mb-6 border-b border-slate-200 overflow-x-auto -mx-4 sm:mx-0 px-4 sm:px-0 pb-px">
        {TABS.map((t, i) => (
          <button key={t} onClick={() => setTab(i)}
            className={`whitespace-nowrap flex-shrink-0 px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px ${i === tab ? "border-blue-600 text-blue-600" : "border-transparent text-slate-500 hover:text-slate-800"}`}>
            {t}
          </button>
        ))}
      </div>

      {tab === 0 && <EntityManager endpoint="categories" label="Category" />}
      {tab === 1 && <UnitManager />}
      {tab === 2 && <LocationManager />}
      {tab === 3 && <NotificationsManager />}
    </div>
  );
}
