"use client";

// ─────────────────────────────────────────────────────────────────────────────
// Photo Opname Scan — settings toggle (admin).
//
// Self-contained on/off switch for the whole feature. Reads/writes the
// `opname_scan_enabled` SystemSetting through the existing /api/settings
// endpoint (no API changes). When off, the scan panel, the print link, and the
// scan route all disappear. Mounted with a single line in the Settings page.
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useState } from "react";
import toast from "react-hot-toast";

const KEY = "opname_scan_enabled";

export function OpnameScanSettings() {
  const [enabled, setEnabled] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((d) => setEnabled(d[KEY] === "1"))
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  async function toggle(next: boolean) {
    setSaving(true);
    setEnabled(next); // optimistic
    const res = await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: KEY, value: next ? "1" : "0" }),
    });
    setSaving(false);
    if (res.ok) toast.success(next ? "Photo scanning enabled" : "Photo scanning disabled");
    else {
      setEnabled(!next); // revert
      toast.error("Failed to save");
    }
  }

  return (
    <div className="max-w-lg mt-6">
      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-base">📷</span>
              <span className="text-sm font-semibold text-slate-800">Photo count-sheet scanning</span>
            </div>
            <p className="text-xs text-slate-500">
              Let admins photograph a filled-in paper count sheet and have the system read the
              handwritten quantities into the opname draft. Uses the Claude vision API (small
              per-page cost). When off, the feature is completely hidden.
            </p>
          </div>
          <button
            role="switch"
            aria-checked={enabled}
            disabled={!loaded || saving}
            onClick={() => toggle(!enabled)}
            className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${enabled ? "bg-blue-600" : "bg-slate-300"}`}
          >
            <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${enabled ? "translate-x-6" : "translate-x-1"}`} />
          </button>
        </div>
      </div>
    </div>
  );
}
