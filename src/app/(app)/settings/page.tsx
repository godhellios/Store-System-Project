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
                  {row._count?.products !== undefined && (
                    <span className="ml-2 text-xs text-slate-400">{row._count.products} product{row._count.products !== 1 ? "s" : ""}</span>
                  )}
                  {row._count?.stock !== undefined && (
                    <span className="ml-2 text-xs text-slate-400">{row._count.stock} stock record{row._count.stock !== 1 ? "s" : ""}</span>
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
              <div className="flex items-center gap-3">
                <div className="flex-1">
                  <span className="text-sm text-slate-800">{unit.name}</span>
                  {unit.parent && (
                    <span className="ml-2 text-xs text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded">
                      1 {unit.name} = {unit.conversionFactor} {unit.parent.name}
                    </span>
                  )}
                  <span className="ml-2 text-xs text-slate-400">{unit._count.products} product{unit._count.products !== 1 ? "s" : ""}</span>
                </div>
                <button onClick={() => setEditing({ id: unit.id, name: unit.name, parentUnitId: unit.parentUnitId ?? "", conversionFactor: unit.conversionFactor?.toString() ?? "" })}
                  className="text-xs text-slate-500 hover:underline">Edit</button>
                <button onClick={() => toggleActive(unit)}
                  className={`text-xs hover:underline ${unit.isActive ? "text-orange-500" : "text-green-600"}`}>
                  {unit.isActive ? "Deactivate" : "Activate"}
                </button>
                <button onClick={() => handleDelete(unit)} className="text-xs text-red-400 hover:underline">Delete</button>
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
      <form onSubmit={handleAdd} className="flex gap-2 mb-4">
        <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="New location name…"
          className="flex-1 px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        <input value={newType} onChange={(e) => setNewType(e.target.value)} placeholder="Type (e.g. Warehouse)"
          className="w-36 px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        <button type="submit" disabled={loading || !newName.trim()}
          className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-semibold px-4 py-2 rounded-lg">
          Add
        </button>
      </form>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden divide-y divide-slate-100">
        {rows.length === 0 && <p className="px-4 py-6 text-center text-xs text-slate-400">No locations yet</p>}
        {rows.map((row) => (
          <div key={row.id}>
            {/* Row header */}
            <div className={`flex items-center gap-3 px-4 py-2.5 ${!row.isActive ? "opacity-50" : ""}`}>
              {editing?.id === row.id ? (
                <>
                  <input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                    className="flex-1 px-2 py-1 border border-blue-400 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" autoFocus />
                  <input value={editing.type} onChange={(e) => setEditing({ ...editing, type: e.target.value })}
                    className="w-28 px-2 py-1 border border-blue-400 rounded text-sm focus:outline-none" />
                  <button onClick={handleSave} className="text-xs text-blue-600 font-medium hover:underline">Save</button>
                  <button onClick={() => setEditing(null)} className="text-xs text-slate-400 hover:underline">Cancel</button>
                </>
              ) : (
                <>
                  <div className="flex-1">
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
                  <button onClick={() => setEditing({ id: row.id, name: row.name, type: row.type })}
                    className="text-xs text-slate-500 hover:underline">Edit</button>
                  <button onClick={() => toggleActive(row)}
                    className={`text-xs hover:underline ${row.isActive ? "text-orange-500" : "text-green-600"}`}>
                    {row.isActive ? "Deactivate" : "Activate"}
                  </button>
                  <button onClick={() => handleDelete(row)} className="text-xs text-red-400 hover:underline">Delete</button>
                </>
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

// ── whatsapp-do module ──────────────────────────────────────────────────────
function NotificationsManager() {
  const [phone, setPhone] = useState("");
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((data) => {
        setPhone(data.wa_do_phone ?? "6281283118487");
        setLoaded(true);
      });
  }, []);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    const res = await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: "wa_do_phone", value: phone.trim() }),
    });
    setSaving(false);
    if (res.ok) toast.success("WhatsApp number saved");
    else toast.error("Failed to save");
  }

  if (!loaded) return <p className="text-sm text-slate-400 py-4">Loading…</p>;

  return (
    <div className="max-w-lg">
      <div className="bg-green-50 border border-green-200 rounded-xl p-4 mb-5 flex gap-3">
        <span className="text-xl">📱</span>
        <div>
          <div className="text-sm font-semibold text-green-800 mb-0.5">WhatsApp Delivery Order Notification</div>
          <p className="text-xs text-green-700">
            When a Delivery Order (Goods Out) is printed, the DO summary is automatically opened in WhatsApp addressed to this number. No API or subscription required.
          </p>
        </div>
      </div>

      <form onSubmit={handleSave} className="space-y-3">
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">
            Recipient Phone Number
          </label>
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value.replace(/\D/g, ""))}
            placeholder="6281283118487"
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <p className="text-[11px] text-slate-400 mt-1">
            Include country code, no + or spaces. Indonesia example: 628123456789 (62 + number without leading 0)
          </p>
        </div>
        <button
          type="submit"
          disabled={saving || !phone.trim()}
          className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-semibold px-5 py-2 rounded-lg transition-colors"
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </form>

      {/* ── push-notify module ─────────────────────────────────────────── */}
      <div className="mt-6 pt-6 border-t border-slate-200">
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 mb-4 flex gap-3">
          <span className="text-xl">🔔</span>
          <div>
            <div className="text-sm font-semibold text-blue-800 mb-0.5">Phone Push Notifications</div>
            <p className="text-xs text-blue-700">
              Get an instant notification on this device whenever a Goods Out order is confirmed. Free — no service required. Enable on each device you want to receive alerts.
            </p>
          </div>
        </div>
        <PushSubscribeButton
          vapidPublicKey={process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? ""}
        />
      </div>
      {/* ─────────────────────────────────────────────────────────────────── */}
    </div>
  );
}
// ────────────────────────────────────────────────────────────────────────────

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
      {tab === 1 && <UnitManager />}
      {tab === 2 && <LocationManager />}
      {tab === 3 && <NotificationsManager />}
    </div>
  );
}
