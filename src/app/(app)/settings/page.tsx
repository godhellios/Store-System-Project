"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
// ── push-notify module ──────────────────────────────────────────────────────
import { PushSubscribeButton } from "@/modules/push-notify";
// ────────────────────────────────────────────────────────────────────────────
import { useT } from "@/modules/i18n/provider";

type Row = { id: string; name: string; type?: string; isActive: boolean; _count?: { products?: number; stock?: number } };
type CategoryRow = { id: string; name: string; code: string | null; isActive: boolean; _count: { products: number } };
type LocationRow = { id: string; name: string; type: string; isActive: boolean; _count: { stock: number } };
type StockItem = {
  id: string; quantity: number;
  product: { id: string; name: string; sku: string; colorVariant: string | null; isActive: boolean; category: { name: string }; unit: { name: string } };
};
type UnitRow = {
  id: string; name: string; suffix: string | null; isActive: boolean;
  parentUnitId: string | null; conversionFactor: number | null;
  parent: { id: string; name: string } | null;
  _count: { products: number };
};

const TABS = [
  { key: "settings.tabs.categories", label: "Categories" },
  { key: "settings.tabs.units", label: "Units" },
  { key: "settings.tabs.locations", label: "Locations" },
  { key: "settings.tabs.suppliers", label: "Suppliers" },
  { key: "settings.tabs.notifications", label: "Notifications" },
  { key: "settings.tabs.loginHistory", label: "Login History" },
];

// Dedicated category manager with SKU Code support
function CategoryManager() {
  const t = useT();
  const [rows, setRows] = useState<CategoryRow[]>([]);
  const [newName, setNewName] = useState("");
  const [newCode, setNewCode] = useState("");
  const [editing, setEditing] = useState<{ id: string; name: string; code: string } | null>(null);
  const [codeError, setCodeError] = useState("");
  const [loading, setLoading] = useState(false);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  async function load() {
    const res = await fetch("/api/categories");
    if (res.ok) setRows(await res.json());
  }
  useEffect(() => { load(); }, []);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    setLoading(true);
    setCodeError("");
    const res = await fetch("/api/categories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newName.trim(), code: newCode.trim() || null }),
    });
    const data = await res.json();
    setLoading(false);
    if (!res.ok) {
      if (data.error?.includes("Code")) setCodeError(data.error);
      else toast.error(data.error);
      return;
    }
    toast.success("Category added");
    setNewName(""); setNewCode(""); setCodeError("");
    load();
  }

  async function handleSave() {
    if (!editing) return;
    setLoading(true);
    setCodeError("");
    const res = await fetch(`/api/categories/${editing.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: editing.name, code: editing.code.trim() || null }),
    });
    const data = await res.json();
    setLoading(false);
    if (!res.ok) {
      if (data.error?.includes("Code")) setCodeError(data.error);
      else toast.error(data.error);
      return;
    }
    if (data.warning) toast(data.warning, { icon: "⚠️" });
    toast.success(t("common.save", "Save") + "d");
    setEditing(null); setCodeError("");
    load();
  }

  async function toggleActive(row: CategoryRow) {
    const res = await fetch(`/api/categories/${row.id}`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: !row.isActive }),
    });
    if (!res.ok) { toast.error("Failed"); return; }
    toast.success(row.isActive ? t("common.deactivate", "Deactivate") + "d" : t("common.activate", "Activate") + "d");
    load();
  }

  async function handleDelete(row: CategoryRow) {
    const res = await fetch(`/api/categories/${row.id}`, { method: "DELETE" });
    if (res.status === 204) { toast.success(t("common.delete", "Delete") + "d"); setConfirmingId(null); load(); return; }
    const data = await res.json();
    toast.error(data.error);
    setConfirmingId(null);
  }

  return (
    <div className="max-w-xl">
      <form onSubmit={handleAdd} className="flex flex-col gap-2 mb-4">
        <div className="flex flex-col sm:flex-row gap-2">
          <input value={newName} onChange={(e) => setNewName(e.target.value)}
            placeholder={t("settings.categories.placeholder", "New category name…")}
            className="flex-1 px-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          <div className="sm:w-36 flex flex-col gap-1">
            <input
              value={newCode}
              onChange={(e) => { setNewCode(e.target.value.toUpperCase()); setCodeError(""); }}
              maxLength={4}
              placeholder="e.g. BTN"
              className={`w-full px-3 py-2.5 border rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 ${codeError ? "border-red-400" : "border-slate-300"}`}
            />
            <label className="text-xs text-slate-400">SKU Code</label>
          </div>
          <button type="submit" disabled={loading || !newName.trim()}
            className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-semibold px-4 py-2.5 rounded-lg">
            {t("common.add", "Add")}
          </button>
        </div>
        {codeError && <p className="text-xs text-red-500">{codeError}</p>}
      </form>
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden divide-y divide-slate-100">
        {rows.length === 0 && <p className="px-4 py-6 text-center text-xs text-slate-400">No categories yet</p>}
        {rows.map((row) => (
          <div key={row.id} className={`px-4 py-3 ${!row.isActive ? "opacity-50" : ""}`}>
            {editing?.id === row.id ? (
              <div className="flex flex-col gap-2">
                <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2">
                  <input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                    className="flex-1 w-full px-3 py-2 border border-blue-400 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" autoFocus />
                  <div className="sm:w-36 flex flex-col gap-1">
                    <input
                      value={editing.code}
                      onChange={(e) => { setEditing({ ...editing, code: e.target.value.toUpperCase() }); setCodeError(""); }}
                      maxLength={4}
                      placeholder="e.g. BTN"
                      className={`w-full px-3 py-2 border rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 ${codeError ? "border-red-400" : "border-blue-400"}`}
                    />
                    <label className="text-xs text-slate-400">SKU Code</label>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={handleSave} className="px-3 py-2 text-xs text-white bg-blue-600 hover:bg-blue-700 font-semibold rounded-lg">{t("common.save", "Save")}</button>
                    <button onClick={() => { setEditing(null); setCodeError(""); }} className="px-3 py-2 text-xs text-slate-600 border border-slate-300 hover:bg-slate-50 rounded-lg">{t("common.cancel", "Cancel")}</button>
                  </div>
                </div>
                {codeError && <p className="text-xs text-red-500">{codeError}</p>}
              </div>
            ) : (
              <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                <div className="flex-1 min-w-0">
                  <span className="text-sm text-slate-800">{row.name}</span>
                  {row.code && (
                    <span className="ml-2 text-xs font-mono bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded">{row.code}</span>
                  )}
                  <span className="ml-2 text-xs text-slate-400">{row._count.products} product{row._count.products !== 1 ? "s" : ""}</span>
                </div>
                <div className="flex gap-1.5">
                  <button onClick={() => { setCodeError(""); setEditing({ id: row.id, name: row.name, code: row.code ?? "" }); }}
                    className="flex-1 sm:flex-none px-3 py-1.5 text-xs text-slate-600 border border-slate-300 hover:bg-slate-50 rounded-lg transition-colors">{t("common.edit", "Edit")}</button>
                  <button onClick={() => toggleActive(row)}
                    className={`flex-1 sm:flex-none px-3 py-1.5 text-xs rounded-lg transition-colors border ${row.isActive ? "text-orange-600 border-orange-200 hover:bg-orange-50" : "text-green-600 border-green-200 hover:bg-green-50"}`}>
                    {row.isActive ? t("common.deactivate", "Deactivate") : t("common.activate", "Activate")}
                  </button>
                  {confirmingId === row.id ? (
                    <>
                      <button onClick={() => setConfirmingId(null)} className="flex-1 sm:flex-none px-3 py-1.5 text-xs text-slate-600 border border-slate-300 hover:bg-slate-50 rounded-lg">{t("common.no", "No")}</button>
                      <button onClick={() => handleDelete(row)} className="flex-1 sm:flex-none px-3 py-1.5 text-xs text-white bg-red-600 hover:bg-red-700 font-semibold rounded-lg">{t("common.yes", "Yes")}</button>
                    </>
                  ) : (
                    <button onClick={() => setConfirmingId(row.id)}
                      className="flex-1 sm:flex-none px-3 py-1.5 text-xs text-red-500 border border-red-200 hover:bg-red-50 rounded-lg transition-colors">{t("common.delete", "Delete")}</button>
                  )}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// Generic manager for categories and locations
function EntityManager({ endpoint, label, hasType, placeholder }: { endpoint: string; label: string; hasType?: boolean; placeholder?: string }) {
  const t = useT();
  const [rows, setRows] = useState<Row[]>([]);
  const [newName, setNewName] = useState("");
  const [newType, setNewType] = useState("");
  const [editing, setEditing] = useState<{ id: string; name: string; type: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

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
    toast.success(t("common.save", "Save") + "d");
    setEditing(null);
    load();
  }

  async function toggleActive(row: Row) {
    const res = await fetch(`/api/${endpoint}/${row.id}`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: !row.isActive }),
    });
    if (!res.ok) { toast.error("Failed"); return; }
    toast.success(row.isActive ? t("common.deactivate", "Deactivate") + "d" : t("common.activate", "Activate") + "d");
    load();
  }

  async function handleDelete(row: Row) {
    const res = await fetch(`/api/${endpoint}/${row.id}`, { method: "DELETE" });
    if (res.status === 204) { toast.success(t("common.delete", "Delete") + "d"); setConfirmingId(null); load(); return; }
    const data = await res.json();
    toast.error(data.error);
    setConfirmingId(null);
  }

  return (
    <div className="max-w-xl">
      <form onSubmit={handleAdd} className="flex flex-col sm:flex-row gap-2 mb-4">
        <input value={newName} onChange={(e) => setNewName(e.target.value)}
          placeholder={placeholder ?? `New ${label.toLowerCase()} name…`}
          className="flex-1 px-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        {hasType && (
          <input value={newType} onChange={(e) => setNewType(e.target.value)} placeholder="Type (e.g. Warehouse)"
            className="sm:w-36 px-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        )}
        <button type="submit" disabled={loading || !newName.trim()}
          className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-semibold px-4 py-2.5 rounded-lg">
          {t("common.add", "Add")}
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
                  <button onClick={handleSave} className="px-3 py-2 text-xs text-white bg-blue-600 hover:bg-blue-700 font-semibold rounded-lg">{t("common.save", "Save")}</button>
                  <button onClick={() => setEditing(null)} className="px-3 py-2 text-xs text-slate-600 border border-slate-300 hover:bg-slate-50 rounded-lg">{t("common.cancel", "Cancel")}</button>
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
                    className="flex-1 sm:flex-none px-3 py-1.5 text-xs text-slate-600 border border-slate-300 hover:bg-slate-50 rounded-lg transition-colors">{t("common.edit", "Edit")}</button>
                  <button onClick={() => toggleActive(row)}
                    className={`flex-1 sm:flex-none px-3 py-1.5 text-xs rounded-lg transition-colors border ${row.isActive ? "text-orange-600 border-orange-200 hover:bg-orange-50" : "text-green-600 border-green-200 hover:bg-green-50"}`}>
                    {row.isActive ? t("common.deactivate", "Deactivate") : t("common.activate", "Activate")}
                  </button>
                  {confirmingId === row.id ? (
                    <>
                      <button onClick={() => setConfirmingId(null)} className="flex-1 sm:flex-none px-3 py-1.5 text-xs text-slate-600 border border-slate-300 hover:bg-slate-50 rounded-lg">{t("common.no", "No")}</button>
                      <button onClick={() => handleDelete(row)} className="flex-1 sm:flex-none px-3 py-1.5 text-xs text-white bg-red-600 hover:bg-red-700 font-semibold rounded-lg">{t("common.yes", "Yes")}</button>
                    </>
                  ) : (
                    <button onClick={() => setConfirmingId(row.id)}
                      className="flex-1 sm:flex-none px-3 py-1.5 text-xs text-red-500 border border-red-200 hover:bg-red-50 rounded-lg transition-colors">{t("common.delete", "Delete")}</button>
                  )}
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
  const t = useT();
  const [units, setUnits] = useState<UnitRow[]>([]);
  const [newName, setNewName] = useState("");
  const [newParentId, setNewParentId] = useState("");
  const [newFactor, setNewFactor] = useState("");
  const [newSuffix, setNewSuffix] = useState("");
  const [editing, setEditing] = useState<{ id: string; name: string; parentUnitId: string; conversionFactor: string; suffix: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

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
        suffix: newSuffix.trim() || null,
      }),
    });
    const data = await res.json();
    setLoading(false);
    if (!res.ok) { toast.error(data.error); return; }
    toast.success("Unit added");
    setNewName(""); setNewParentId(""); setNewFactor(""); setNewSuffix("");
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
        suffix: editing.suffix.trim() || null,
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
    const res = await fetch(`/api/units/${unit.id}`, { method: "DELETE" });
    if (res.status === 204) { toast.success("Deleted"); setConfirmingId(null); load(); return; }
    const data = await res.json();
    toast.error(data.error);
    setConfirmingId(null);
  }

  const activeUnits = units.filter((u) => u.isActive);

  return (
    <div className="max-w-xl">
      <p className="text-xs text-slate-500 mb-3">
        {t("settings.units.help", "Define higher units by selecting a parent. Example:")} <span className="font-medium">{t("settings.units.helpBold", "Box")}</span> → {t("settings.units.helpParent", "parent =")} <span className="font-medium">{t("settings.units.helpDummy", "Dozen")}</span>, {t("settings.units.helpFactor", "factor =")} <span className="font-medium">12</span> {t("settings.units.helpMeans", "means 1 Box = 12 Dozen.")}
      </p>
      <form onSubmit={handleAdd} className="flex flex-wrap gap-2 mb-4 items-end">
        <div className="flex-1 min-w-[140px]">
          <label className="block text-xs text-slate-500 mb-0.5">{t("settings.units.nameLabel", "Unit name *")}</label>
          <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. Box"
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
        <div className="min-w-[130px]">
          <label className="block text-xs text-slate-500 mb-0.5">{t("settings.units.parentLabel", "1 of this = … of")}</label>
          <select value={newParentId} onChange={(e) => setNewParentId(e.target.value)}
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
            <option value="">{t("settings.units.baseUnit", "(base unit)")}</option>
            {activeUnits.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </div>
        {newParentId && (
          <div className="w-24">
            <label className="block text-xs text-slate-500 mb-0.5">{t("settings.units.factorLabel", "Factor *")}</label>
            <input type="number" inputMode="decimal" min="1" step="any" value={newFactor} onChange={(e) => setNewFactor(e.target.value)}
              placeholder="e.g. 12"
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
        )}
        <div className="w-28">
          <label className="block text-xs text-slate-500 mb-0.5">Barcode Suffix</label>
          <input value={newSuffix} onChange={(e) => setNewSuffix(e.target.value.toUpperCase())} maxLength={5} placeholder="e.g. BOX"
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500" />
          <p className="text-[10px] text-slate-400 mt-0.5 leading-tight">Used for unit barcodes (e.g. BOX → SKU-BOX). Leave blank if not needed.</p>
        </div>
        <button type="submit" disabled={loading || !newName.trim() || (!!newParentId && !newFactor)}
          className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-semibold px-4 py-2 rounded-lg">
          {t("common.add", "Add")}
        </button>
      </form>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden divide-y divide-slate-100">
        {units.length === 0 && <p className="px-4 py-6 text-center text-xs text-slate-400">No units yet</p>}
        {units.map((unit) => (
          <div key={unit.id} className={`px-4 py-2.5 ${!unit.isActive ? "opacity-50" : ""}`}>
            {editing?.id === unit.id ? (
              <div className="flex flex-wrap gap-2 items-end">
                <div className="flex-1 min-w-[120px]">
                  <label className="block text-xs text-slate-400 mb-0.5">{t("settings.units.nameEditLabel", "Name")}</label>
                  <input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                    className="w-full px-2 py-1 border border-blue-400 rounded text-sm focus:outline-none" autoFocus />
                </div>
                <div className="min-w-[120px]">
                  <label className="block text-xs text-slate-400 mb-0.5">{t("settings.units.parentLabel", "1 of this = … of")}</label>
                  <select value={editing.parentUnitId}
                    onChange={(e) => setEditing({ ...editing, parentUnitId: e.target.value, conversionFactor: "" })}
                    className="w-full px-2 py-1 border border-blue-400 rounded text-sm focus:outline-none">
                    <option value="">{t("settings.units.baseUnit", "(base unit)")}</option>
                    {activeUnits.filter((u) => u.id !== unit.id).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                  </select>
                </div>
                {editing.parentUnitId && (
                  <div className="w-20">
                    <label className="block text-xs text-slate-400 mb-0.5">{t("settings.units.factorEditLabel", "Factor")}</label>
                    <input type="number" inputMode="decimal" min="1" step="any" value={editing.conversionFactor}
                      onChange={(e) => setEditing({ ...editing, conversionFactor: e.target.value })}
                      className="w-full px-2 py-1 border border-blue-400 rounded text-sm focus:outline-none" />
                  </div>
                )}
                <div className="w-24">
                  <label className="block text-xs text-slate-400 mb-0.5">Barcode Suffix</label>
                  <input value={editing.suffix} onChange={(e) => setEditing({ ...editing, suffix: e.target.value.toUpperCase() })}
                    maxLength={5} placeholder="e.g. BOX"
                    className="w-full px-2 py-1 border border-blue-400 rounded text-sm font-mono focus:outline-none" />
                </div>
                <div className="flex gap-2 items-center">
                  <button onClick={handleSave} className="text-xs text-blue-600 font-medium hover:underline">{t("common.save", "Save")}</button>
                  <button onClick={() => setEditing(null)} className="text-xs text-slate-400 hover:underline">{t("common.cancel", "Cancel")}</button>
                </div>
              </div>
            ) : (
              <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                <div className="flex-1 min-w-0">
                  <span className="text-sm text-slate-800">{unit.name}</span>
                  {unit.suffix && (
                    <span className="ml-2 text-xs font-mono bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded">{unit.suffix}</span>
                  )}
                  {unit.parent && (
                    <span className="ml-2 text-xs text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded">
                      1 {unit.name} = {unit.conversionFactor} {unit.parent.name}
                    </span>
                  )}
                  <span className="ml-2 text-xs text-slate-400">{unit._count.products} product{unit._count.products !== 1 ? "s" : ""}</span>
                </div>
                <div className="flex gap-1.5">
                  <button onClick={() => setEditing({ id: unit.id, name: unit.name, parentUnitId: unit.parentUnitId ?? "", conversionFactor: unit.conversionFactor?.toString() ?? "", suffix: unit.suffix ?? "" })}
                    className="flex-1 sm:flex-none px-3 py-1.5 text-xs text-slate-600 border border-slate-300 hover:bg-slate-50 rounded-lg transition-colors">{t("common.edit", "Edit")}</button>
                  <button onClick={() => toggleActive(unit)}
                    className={`flex-1 sm:flex-none px-3 py-1.5 text-xs rounded-lg transition-colors border ${unit.isActive ? "text-orange-600 border-orange-200 hover:bg-orange-50" : "text-green-600 border-green-200 hover:bg-green-50"}`}>
                    {unit.isActive ? t("common.deactivate", "Deactivate") : t("common.activate", "Activate")}
                  </button>
                  {confirmingId === unit.id ? (
                    <>
                      <button onClick={() => setConfirmingId(null)} className="flex-1 sm:flex-none px-3 py-1.5 text-xs text-slate-600 border border-slate-300 hover:bg-slate-50 rounded-lg">{t("common.no", "No")}</button>
                      <button onClick={() => handleDelete(unit)} className="flex-1 sm:flex-none px-3 py-1.5 text-xs text-white bg-red-600 hover:bg-red-700 font-semibold rounded-lg">{t("common.yes", "Yes")}</button>
                    </>
                  ) : (
                    <button onClick={() => setConfirmingId(unit.id)}
                      className="flex-1 sm:flex-none px-3 py-1.5 text-xs text-red-500 border border-red-200 hover:bg-red-50 rounded-lg transition-colors">{t("common.delete", "Delete")}</button>
                  )}
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
  const t = useT();
  const [rows, setRows] = useState<LocationRow[]>([]);
  const [newName, setNewName] = useState("");
  const [newType, setNewType] = useState("Warehouse");
  const [editing, setEditing] = useState<{ id: string; name: string; type: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [stockItems, setStockItems] = useState<StockItem[]>([]);
  const [stockLoading, setStockLoading] = useState(false);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [confirmingStockId, setConfirmingStockId] = useState<string | null>(null);

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
    const res = await fetch(`/api/locations/${row.id}`, { method: "DELETE" });
    if (res.status === 204) { toast.success("Deleted"); setConfirmingId(null); load(); return; }
    const data = await res.json();
    toast.error(data.error);
    setConfirmingId(null);
  }

  async function toggleExpand(id: string) {
    if (expandedId === id) { setExpandedId(null); setStockItems([]); return; }
    setExpandedId(id);
    setStockLoading(true);
    const res = await fetch(`/api/stock?locationId=${id}&includeInactive=true`);
    if (res.ok) setStockItems(await res.json());
    setStockLoading(false);
  }

  async function deleteStockItem(stockId: string) {
    const res = await fetch(`/api/stock/${stockId}`, { method: "DELETE" });
    if (res.status !== 204) { const d = await res.json(); toast.error(d.error); setConfirmingStockId(null); return; }
    toast.success("Removed");
    setConfirmingStockId(null);
    if (expandedId) {
      const r = await fetch(`/api/stock?locationId=${expandedId}&includeInactive=true`);
      if (r.ok) setStockItems(await r.json());
    }
    load();
  }

  return (
    <div className="max-w-2xl">
      <form onSubmit={handleAdd} className="flex flex-col sm:flex-row gap-2 mb-4">
        <input value={newName} onChange={(e) => setNewName(e.target.value)}
          placeholder={t("settings.locations.placeholder", "New location name…")}
          className="flex-1 px-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        <input value={newType} onChange={(e) => setNewType(e.target.value)}
          placeholder={t("settings.locations.typePlaceholder", "Type (e.g. Warehouse)")}
          className="sm:w-36 px-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        <button type="submit" disabled={loading || !newName.trim()}
          className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-semibold px-4 py-2.5 rounded-lg">
          {t("common.add", "Add")}
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
                    <button onClick={handleSave} className="px-3 py-2 text-xs text-white bg-blue-600 hover:bg-blue-700 font-semibold rounded-lg">{t("common.save", "Save")}</button>
                    <button onClick={() => setEditing(null)} className="px-3 py-2 text-xs text-slate-600 border border-slate-300 hover:bg-slate-50 rounded-lg">{t("common.cancel", "Cancel")}</button>
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
                      className="flex-1 sm:flex-none px-3 py-1.5 text-xs text-slate-600 border border-slate-300 hover:bg-slate-50 rounded-lg transition-colors">{t("common.edit", "Edit")}</button>
                    <button onClick={() => toggleActive(row)}
                      className={`flex-1 sm:flex-none px-3 py-1.5 text-xs rounded-lg transition-colors border ${row.isActive ? "text-orange-600 border-orange-200 hover:bg-orange-50" : "text-green-600 border-green-200 hover:bg-green-50"}`}>
                      {row.isActive ? t("common.deactivate", "Deactivate") : t("common.activate", "Activate")}
                    </button>
                    {confirmingId === row.id ? (
                      <>
                        <button onClick={() => setConfirmingId(null)} className="flex-1 sm:flex-none px-3 py-1.5 text-xs text-slate-600 border border-slate-300 hover:bg-slate-50 rounded-lg">{t("common.no", "No")}</button>
                        <button onClick={() => handleDelete(row)} className="flex-1 sm:flex-none px-3 py-1.5 text-xs text-white bg-red-600 hover:bg-red-700 font-semibold rounded-lg">{t("common.yes", "Yes")}</button>
                      </>
                    ) : (
                      <button onClick={() => setConfirmingId(row.id)}
                        className="flex-1 sm:flex-none px-3 py-1.5 text-xs text-red-500 border border-red-200 hover:bg-red-50 rounded-lg transition-colors">{t("common.delete", "Delete")}</button>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Expanded stock items */}
            {expandedId === row.id && (
              <div className="bg-slate-50 border-t border-slate-100 px-4 py-3">
                {stockLoading ? (
                  <p className="text-xs text-slate-400">{t("common.loading", "Loading…")}</p>
                ) : stockItems.length === 0 ? (
                  <p className="text-xs text-slate-400">{t("settings.locations.noStock", "No stock records for this location.")}</p>
                ) : (
                  <div className="divide-y divide-slate-200 rounded-lg border border-slate-200 overflow-hidden bg-white">
                    <div className="grid grid-cols-[1fr_auto_auto_auto] gap-x-4 px-3 py-1.5 bg-slate-100 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                      <span>{t("settings.locations.colProduct", "Product")}</span>
                      <span>{t("settings.locations.colCategory", "Category")}</span>
                      <span className="text-right">{t("settings.locations.colQty", "Qty")}</span>
                      <span />
                    </div>
                    {stockItems.map((s) => (
                      <div key={s.id} className="grid grid-cols-[1fr_auto_auto_auto] gap-x-4 px-3 py-2 items-center">
                        <div className="min-w-0">
                          <div className={`text-sm truncate flex items-center gap-1.5 ${!s.product.isActive ? "text-slate-400" : "text-slate-800"}`}>
                            {s.product.name}{s.product.colorVariant ? <span className="text-slate-400"> — {s.product.colorVariant}</span> : null}
                            {!s.product.isActive && <span className="text-[9px] font-semibold bg-slate-200 text-slate-400 px-1.5 py-0.5 rounded-full uppercase tracking-wide flex-shrink-0">{t("common.inactive", "Inactive")}</span>}
                          </div>
                          <div className="text-xs font-mono text-slate-400">{s.product.sku}</div>
                        </div>
                        <span className="text-xs text-slate-500 whitespace-nowrap">{s.product.category.name}</span>
                        <span className={`text-sm font-semibold text-right whitespace-nowrap ${s.quantity === 0 ? "text-slate-300" : "text-slate-800"}`}>
                          {s.quantity} {s.product.unit.name.toLowerCase()}
                        </span>
                        {confirmingStockId === s.id ? (
                          <span className="flex items-center gap-1.5 whitespace-nowrap">
                            {s.quantity > 0 && <span className="text-[10px] text-orange-600">{s.quantity} in stock</span>}
                            <button onClick={() => setConfirmingStockId(null)} className="text-xs text-slate-500 hover:underline">{t("common.no", "No")}</button>
                            <button onClick={() => deleteStockItem(s.id)} className="text-xs text-red-600 font-semibold hover:underline">{t("common.yes", "Yes")}</button>
                          </span>
                        ) : (
                          <button onClick={() => setConfirmingStockId(s.id)}
                            className="text-xs text-red-400 hover:text-red-600 hover:underline whitespace-nowrap">
                            {t("common.remove", "Remove")}
                          </button>
                        )}
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
  const t = useT();
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
          <span className="text-sm font-semibold text-slate-800">{t("settings.notifications.waTitle", "WhatsApp DO Number")}</span>
        </div>
        <p className="text-xs text-slate-500 mb-3">
          {t("settings.notifications.waDesc", "Delivery Orders from Goods Out will be sent to this number. Enter digits only, with country code (e.g. 6281283118487).")}
        </p>
        <div className="flex gap-2">
          <input
            type="tel"
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
            {waLoading ? t("common.saving", "Saving…") : t("common.save", "Save")}
          </button>
        </div>
      </div>

      {/* Push notifications */}
      <div>
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 mb-4 flex gap-3">
          <span className="text-xl">🔔</span>
          <div>
            <div className="text-sm font-semibold text-blue-800 mb-0.5">{t("settings.notifications.pushTitle", "Phone Push Notifications")}</div>
            <p className="text-xs text-blue-700">
              {t("settings.notifications.pushDesc", "Get an instant notification on this device whenever a Goods Out order is confirmed. Free — no service required. Enable on each device you want to receive alerts.")}
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

type LoginLogRow = {
  id: string;
  userName: string;
  email: string;
  ip: string | null;
  userAgent: string | null;
  lat: number | null;
  lng: number | null;
  createdAt: string;
};

function LoginHistoryTab() {
  const t = useT();
  const [logs, setLogs] = useState<LoginLogRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [loading, setLoading] = useState(true);

  async function load(p: number) {
    setLoading(true);
    const res = await fetch(`/api/login-logs?page=${p}`);
    if (res.ok) {
      const data = await res.json();
      setLogs(data.logs);
      setTotal(data.total);
      setPage(data.page);
      setPages(data.pages);
    }
    setLoading(false);
  }

  useEffect(() => { load(1); }, []);

  function formatUA(ua: string | null) {
    if (!ua) return "—";
    if (/Mobile|Android|iPhone|iPad/i.test(ua)) {
      const match = ua.match(/(Android|iPhone|iPad)[^;)]*/) ?? ua.match(/Mobile[^;)]*/);
      return match ? match[0] : "Mobile";
    }
    if (/Chrome\/(\d+)/i.test(ua)) return `Chrome ${ua.match(/Chrome\/(\d+)/i)?.[1]}`;
    if (/Firefox\/(\d+)/i.test(ua)) return `Firefox ${ua.match(/Firefox\/(\d+)/i)?.[1]}`;
    if (/Safari\/(\d+)/i.test(ua) && !/Chrome/i.test(ua)) return `Safari`;
    if (/Edg\/(\d+)/i.test(ua)) return `Edge ${ua.match(/Edg\/(\d+)/i)?.[1]}`;
    return ua.slice(0, 40);
  }

  function formatTime(iso: string) {
    const d = new Date(iso);
    return d.toLocaleString("id-ID", { timeZone: "Asia/Jakarta", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) + " WIB";
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs text-slate-500">
          {total} {total !== 1 ? t("settings.loginHistory.eventsRecorded", "login events recorded") : t("settings.loginHistory.eventRecorded", "login event recorded")}
        </p>
        <button onClick={() => load(page)} className="text-xs text-blue-600 hover:underline">{t("common.refresh", "Refresh")}</button>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500 border-b border-slate-200">
                <th className="px-4 py-2.5 text-left font-medium">{t("settings.loginHistory.timeHeader", "Time (WIB)")}</th>
                <th className="px-4 py-2.5 text-left font-medium">{t("settings.loginHistory.user", "User")}</th>
                <th className="px-4 py-2.5 text-left font-medium">{t("settings.loginHistory.ip", "IP Address")}</th>
                <th className="px-4 py-2.5 text-left font-medium">{t("settings.loginHistory.device", "Device / Browser")}</th>
                <th className="px-4 py-2.5 text-left font-medium">{t("settings.loginHistory.location", "Location")}</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={5} className="px-4 py-10 text-center text-xs text-slate-400">{t("common.loading", "Loading…")}</td></tr>
              ) : logs.length === 0 ? (
                <tr><td colSpan={5} className="px-4 py-10 text-center text-xs text-slate-400">{t("settings.loginHistory.noHistory", "No login history yet")}</td></tr>
              ) : logs.map((log) => (
                <tr key={log.id} className="border-t border-slate-100 hover:bg-slate-50">
                  <td className="px-4 py-2.5 text-xs text-slate-500 whitespace-nowrap">{formatTime(log.createdAt)}</td>
                  <td className="px-4 py-2.5">
                    <div className="font-medium text-slate-800 text-sm">{log.userName}</div>
                    <div className="text-xs text-slate-400">{log.email}</div>
                  </td>
                  <td className="px-4 py-2.5 font-mono text-xs text-slate-600">{log.ip ?? "—"}</td>
                  <td className="px-4 py-2.5 text-xs text-slate-500">{formatUA(log.userAgent)}</td>
                  <td className="px-4 py-2.5 text-xs">
                    {log.lat != null && log.lng != null ? (
                      <a
                        href={`https://www.google.com/maps?q=${log.lat},${log.lng}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-blue-600 hover:underline"
                      >
                        <svg className="w-3 h-3" viewBox="0 0 24 24" fill="currentColor">
                          <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/>
                        </svg>
                        Maps
                      </a>
                    ) : (
                      <span className="text-slate-300">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {pages > 1 && (
        <div className="flex items-center justify-center gap-2 mt-4">
          <button onClick={() => load(page - 1)} disabled={page <= 1}
            className="px-3 py-1.5 text-xs border border-slate-300 rounded-lg text-slate-600 hover:bg-slate-50 disabled:opacity-40">
            {t("common.previous", "Previous")}
          </button>
          <span className="text-xs text-slate-500">Page {page} {t("settings.loginHistory.of", "of")} {pages}</span>
          <button onClick={() => load(page + 1)} disabled={page >= pages}
            className="px-3 py-1.5 text-xs border border-slate-300 rounded-lg text-slate-600 hover:bg-slate-50 disabled:opacity-40">
            {t("common.next", "Next")}
          </button>
        </div>
      )}
    </div>
  );
}

type SupplierRow = { id: string; name: string; phone: string | null; address: string | null; notes: string | null; isActive: boolean; _count: { orders: number } };

function SupplierManager() {
  const [rows, setRows] = useState<SupplierRow[]>([]);
  const [form, setForm] = useState({ name: "", phone: "", address: "", notes: "" });
  const [editing, setEditing] = useState<SupplierRow | null>(null);
  const [loading, setLoading] = useState(false);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  async function load() {
    const res = await fetch("/api/suppliers");
    if (res.ok) setRows(await res.json());
  }
  useEffect(() => { load(); }, []);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) return;
    setLoading(true);
    const res = await fetch("/api/suppliers", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    const data = await res.json();
    setLoading(false);
    if (!res.ok) { toast.error(data.error); return; }
    toast.success("Supplier added");
    setForm({ name: "", phone: "", address: "", notes: "" });
    load();
  }

  async function handleSave() {
    if (!editing) return;
    setLoading(true);
    const res = await fetch(`/api/suppliers/${editing.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: editing.name, phone: editing.phone, address: editing.address, notes: editing.notes }),
    });
    const data = await res.json();
    setLoading(false);
    if (!res.ok) { toast.error(data.error); return; }
    toast.success("Saved");
    setEditing(null);
    load();
  }

  async function handleDelete(row: SupplierRow) {
    const res = await fetch(`/api/suppliers/${row.id}`, { method: "DELETE" });
    const data = await res.json();
    if (!res.ok) { toast.error(data.error); return; }
    toast.success(data.deactivated ? "Supplier deactivated (has orders)" : "Supplier deleted");
    setConfirmingId(null);
    load();
  }

  return (
    <div className="space-y-6">
      <form onSubmit={handleAdd} className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
        <p className="text-sm font-semibold text-slate-700">Add Supplier</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="Name *" required
            className="px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })}
            placeholder="Phone"
            className="px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          <input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })}
            placeholder="Address"
            className="px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 sm:col-span-2" />
          <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })}
            placeholder="Notes" rows={2}
            className="px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 sm:col-span-2 resize-none" />
        </div>
        <button type="submit" disabled={loading || !form.name.trim()}
          className="bg-blue-600 text-white text-sm px-4 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50">
          {loading ? "Adding…" : "Add Supplier"}
        </button>
      </form>

      <div className="space-y-2">
        {rows.map((row) => (
          <div key={row.id} className={`bg-white border rounded-xl p-4 ${!row.isActive ? "opacity-50" : "border-slate-200"}`}>
            {editing?.id === row.id ? (
              <div className="space-y-2">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                    className="px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  <input value={editing.phone ?? ""} onChange={(e) => setEditing({ ...editing, phone: e.target.value })}
                    placeholder="Phone"
                    className="px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  <input value={editing.address ?? ""} onChange={(e) => setEditing({ ...editing, address: e.target.value })}
                    placeholder="Address"
                    className="px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 sm:col-span-2" />
                  <textarea value={editing.notes ?? ""} onChange={(e) => setEditing({ ...editing, notes: e.target.value })}
                    placeholder="Notes" rows={2}
                    className="px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 sm:col-span-2 resize-none" />
                </div>
                <div className="flex gap-2">
                  <button onClick={handleSave} disabled={loading}
                    className="text-xs px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">Save</button>
                  <button onClick={() => setEditing(null)}
                    className="text-xs px-3 py-1.5 border border-slate-300 rounded-lg text-slate-600 hover:bg-slate-50">Cancel</button>
                </div>
              </div>
            ) : (
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-800">{row.name}
                    {!row.isActive && <span className="ml-2 text-xs text-slate-400">(inactive)</span>}
                  </p>
                  {row.phone && <p className="text-xs text-slate-500 mt-0.5">{row.phone}</p>}
                  {row.address && <p className="text-xs text-slate-500">{row.address}</p>}
                  {row.notes && <p className="text-xs text-slate-400 italic mt-0.5">{row.notes}</p>}
                  <p className="text-xs text-slate-400 mt-1">{row._count.orders} order{row._count.orders !== 1 ? "s" : ""}</p>
                </div>
                <div className="flex gap-2 flex-shrink-0">
                  <button onClick={() => setEditing(row)}
                    className="text-xs px-3 py-1.5 border border-slate-300 rounded-lg text-slate-600 hover:bg-slate-50">Edit</button>
                  {confirmingId === row.id ? (
                    <div className="flex gap-1 items-center">
                      <span className="text-xs text-slate-500">Sure?</span>
                      <button onClick={() => handleDelete(row)}
                        className="text-xs px-2 py-1 bg-red-600 text-white rounded-lg hover:bg-red-700">Yes</button>
                      <button onClick={() => setConfirmingId(null)}
                        className="text-xs px-2 py-1 border border-slate-300 rounded-lg text-slate-600">No</button>
                    </div>
                  ) : (
                    <button onClick={() => setConfirmingId(row.id)}
                      className="text-xs px-3 py-1.5 border border-red-200 text-red-500 rounded-lg hover:bg-red-50">
                      {row._count.orders > 0 ? "Deactivate" : "Delete"}
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        ))}
        {rows.length === 0 && <p className="text-sm text-slate-400 text-center py-8">No suppliers yet. Add one above.</p>}
      </div>
    </div>
  );
}

export default function SettingsPage() {
  const t = useT();
  const { data: session } = useSession();
  const router = useRouter();
  useEffect(() => {
    if (session?.user.role !== "ADMIN") router.replace("/dashboard");
  }, [session, router]);

  const [tab, setTab] = useState(0);

  return (
    <div>
      <h1 className="text-base font-semibold text-slate-800 mb-5">{t("settings.title", "Settings")}</h1>

      <div className="flex gap-1 mb-6 border-b border-slate-200 overflow-x-auto -mx-4 sm:mx-0 px-4 sm:px-0 pb-px">
        {TABS.map((tabItem, i) => (
          <button key={tabItem.label} onClick={() => setTab(i)}
            className={`whitespace-nowrap flex-shrink-0 px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px ${i === tab ? "border-blue-600 text-blue-600" : "border-transparent text-slate-500 hover:text-slate-800"}`}>
            {t(tabItem.key, tabItem.label)}
          </button>
        ))}
      </div>

      {tab === 0 && <CategoryManager />}
      {tab === 1 && <UnitManager />}
      {tab === 2 && <LocationManager />}
      {tab === 3 && <SupplierManager />}
      {tab === 4 && <NotificationsManager />}
      {tab === 5 && (
        session?.user.role === "ADMIN"
          ? <LoginHistoryTab />
          : <p className="text-sm text-slate-400">{t("settings.adminOnly", "Admin access required.")}</p>
      )}
    </div>
  );
}
