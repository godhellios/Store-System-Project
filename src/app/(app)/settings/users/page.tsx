"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";

const ROLES = ["ADMIN", "STAFF", "VIEWER", "OPERATOR"] as const;
type Role = (typeof ROLES)[number];

const ROLE_BADGE: Record<Role, string> = {
  ADMIN: "bg-red-100 text-red-700",
  STAFF: "bg-blue-100 text-blue-700",
  VIEWER: "bg-slate-100 text-slate-600",
  OPERATOR: "bg-amber-100 text-amber-700",
};

type User = {
  id: string;
  name: string;
  email: string;
  role: Role;
  isActive: boolean;
  createdAt: string;
};

type FormState = {
  name: string;
  email: string;
  role: Role;
  password: string;
  confirmPassword: string;
};

const EMPTY_FORM: FormState = { name: "", email: "", role: "STAFF", password: "", confirmPassword: "" };

export default function UsersPage() {
  const { data: session } = useSession();
  const router = useRouter();
  useEffect(() => {
    if (session?.user.role === "OPERATOR") router.replace("/transactions/grn");
  }, [session, router]);

  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState<"add" | "edit" | null>(null);
  const [editing, setEditing] = useState<User | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  async function load() {
    const res = await fetch("/api/users");
    if (res.ok) setUsers(await res.json());
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  function openAdd() {
    setForm(EMPTY_FORM);
    setEditing(null);
    setModal("add");
  }

  function openEdit(u: User) {
    setForm({ name: u.name, email: u.email, role: u.role, password: "", confirmPassword: "" });
    setEditing(u);
    setModal("edit");
  }

  function setField(k: keyof FormState, v: string) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (modal === "add" && form.password !== form.confirmPassword) {
      toast.error("Passwords do not match");
      return;
    }
    if (modal === "edit" && form.password && form.password !== form.confirmPassword) {
      toast.error("Passwords do not match");
      return;
    }
    setSaving(true);

    const url = modal === "add" ? "/api/users" : `/api/users/${editing!.id}`;
    const method = modal === "add" ? "POST" : "PUT";
    const body: Record<string, string> = { name: form.name, email: form.email, role: form.role };
    if (modal === "add") body.password = form.password;
    if (modal === "edit" && form.password) body.password = form.password;

    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    setSaving(false);
    if (!res.ok) { toast.error(data.error ?? "Failed to save"); return; }
    toast.success(modal === "add" ? "User created" : "User updated");
    setModal(null);
    load();
  }

  async function toggleActive(u: User) {
    if (u.id === session?.user.id && u.isActive) {
      toast.error("You cannot deactivate your own account");
      return;
    }
    const res = await fetch(`/api/users/${u.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: !u.isActive }),
    });
    if (res.ok) {
      toast.success(u.isActive ? "User deactivated" : "User activated");
      load();
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <h1 className="text-base font-semibold text-slate-800">User Management</h1>
        <button onClick={openAdd}
          className="bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold px-3 py-2 rounded-lg transition-colors">
          + Add User
        </button>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500 border-b border-slate-200">
              <th className="px-4 py-2.5 text-left font-medium">Name</th>
              <th className="px-4 py-2.5 text-left font-medium">Email</th>
              <th className="px-4 py-2.5 text-left font-medium">Role</th>
              <th className="px-4 py-2.5 text-left font-medium">Status</th>
              <th className="px-4 py-2.5 text-left font-medium">Created</th>
              <th className="px-4 py-2.5 text-left font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="px-4 py-10 text-center text-slate-400 text-xs">Loading…</td></tr>
            ) : users.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-10 text-center text-slate-400 text-xs">No users found</td></tr>
            ) : users.map((u) => (
              <tr key={u.id} className={`border-t border-slate-100 ${!u.isActive ? "opacity-60 bg-slate-50" : "hover:bg-slate-50"}`}>
                <td className="px-4 py-2.5">
                  <div className="font-medium text-slate-800">{u.name}</div>
                  {u.id === session?.user.id && (
                    <span className="text-[10px] text-blue-500 font-medium">You</span>
                  )}
                </td>
                <td className="px-4 py-2.5 text-slate-600 text-xs font-mono">{u.email}</td>
                <td className="px-4 py-2.5">
                  <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${ROLE_BADGE[u.role]}`}>
                    {u.role}
                  </span>
                </td>
                <td className="px-4 py-2.5">
                  <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${u.isActive ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-500"}`}>
                    {u.isActive ? "Active" : "Inactive"}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-xs text-slate-500">
                  {new Date(u.createdAt).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" })}
                </td>
                <td className="px-4 py-2.5 flex gap-3 items-center">
                  <button onClick={() => openEdit(u)} className="text-xs text-blue-600 hover:underline">Edit</button>
                  <button onClick={() => toggleActive(u)}
                    className={`text-xs hover:underline ${u.isActive ? "text-red-500" : "text-green-600"}`}>
                    {u.isActive ? "Deactivate" : "Activate"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {modal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
              <h2 className="text-sm font-semibold text-slate-800">
                {modal === "add" ? "Add User" : `Edit — ${editing?.name}`}
              </h2>
              <button onClick={() => setModal(null)} className="text-slate-400 hover:text-slate-600 text-lg leading-none">×</button>
            </div>
            <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Full Name *</label>
                <input value={form.name} onChange={(e) => setField("name", e.target.value)} required
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="e.g. John Doe" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Email *</label>
                <input type="email" value={form.email} onChange={(e) => setField("email", e.target.value)} required
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="user@example.com" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Role *</label>
                <select value={form.role} onChange={(e) => setField("role", e.target.value as Role)} required
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                  {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  {modal === "add" ? "Password *" : "New Password"}{modal === "edit" && <span className="text-slate-400 font-normal"> (leave blank to keep current)</span>}
                </label>
                <input type="password" value={form.password} onChange={(e) => setField("password", e.target.value)}
                  required={modal === "add"} minLength={modal === "add" ? 6 : undefined}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Min. 6 characters" />
              </div>
              {(modal === "add" || form.password) && (
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Confirm Password *</label>
                  <input type="password" value={form.confirmPassword} onChange={(e) => setField("confirmPassword", e.target.value)}
                    required className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="Re-enter password" />
                </div>
              )}
              <div className="flex gap-3 pt-2">
                <button type="submit" disabled={saving}
                  className="bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-sm font-semibold px-5 py-2 rounded-lg">
                  {saving ? "Saving…" : modal === "add" ? "Create User" : "Save Changes"}
                </button>
                <button type="button" onClick={() => setModal(null)}
                  className="px-5 py-2 text-sm border border-slate-300 rounded-lg text-slate-600 hover:bg-slate-50">
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
