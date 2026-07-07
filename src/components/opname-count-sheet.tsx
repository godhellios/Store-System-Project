"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { useT } from "@/modules/i18n/provider";
import { OpnameScanPanel, type ScanApplyRow } from "@/components/opname-scan-panel";

type Line = {
  id: string;
  bookQty: number;
  physicalQty: number | null;
  difference: number | null;
  notes: string | null;
  staffConfirmed: boolean;
  product: { name: string; sku: string; category: { name: string }; unit: { name: string } };
};
type Session = {
  id: string;
  sessionNumber: string;
  status: string;
  notes: string | null;
  cancelNote: string | null;
  createdByName?: string | null;
  approvedByName?: string | null;
  lines: Line[];
};
type LineStatus = "empty" | "match" | "mismatch" | "confirmed";

export function OpnameCountSheet({ session, isAdmin, scanEnabled = false }: { session: Session; isAdmin: boolean; scanEnabled?: boolean }) {
  const t = useT();
  const router = useRouter();
  const isEditable = session.status === "IN_PROGRESS";
  const isReviewing = session.status === "REVIEWING";
  const isCancelled = session.status === "CANCELLED";

  const [counts, setCounts] = useState<Record<string, string>>(
    Object.fromEntries(session.lines.map((l) => [l.id, l.physicalQty?.toString() ?? ""]))
  );
  const [confirmedLines, setConfirmedLines] = useState<Set<string>>(
    new Set(session.lines.filter((l) => l.staffConfirmed).map((l) => l.id))
  );
  const [saving, setSaving] = useState(false);
  const [confirmingApprove, setConfirmingApprove] = useState(false);
  const [showCancelForm, setShowCancelForm] = useState(false);
  const [cancelNoteInput, setCancelNoteInput] = useState("");
  const [cancelling, setCancelling] = useState(false);
  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  function setCount(id: string, v: string) {
    setCounts((c) => ({ ...c, [id]: v }));
    if (confirmedLines.has(id)) {
      setConfirmedLines((prev) => { const n = new Set(prev); n.delete(id); return n; });
    }
  }

  // Photo-scan module: merge confidently-read counts into the draft (module-guarded).
  function applyScan(rows: ScanApplyRow[]) {
    setCounts((c) => {
      const next = { ...c };
      for (const r of rows) next[r.lineId] = String(r.qty);
      return next;
    });
  }

  function confirmLine(id: string) {
    setConfirmedLines((prev) => new Set([...prev, id]));
  }

  function recheckLine(id: string) {
    setCount(id, "");
    setTimeout(() => inputRefs.current[id]?.focus(), 0);
  }

  function unconfirmLine(id: string) {
    setConfirmedLines((prev) => { const n = new Set(prev); n.delete(id); return n; });
    setCount(id, "");
  }

  function getLineStatus(line: Line): LineStatus {
    if (confirmedLines.has(line.id)) return "confirmed";
    const val = counts[line.id];
    if (val === "") return "empty";
    const phys = parseInt(val);
    if (isNaN(phys)) return "empty";
    return phys === line.bookQty ? "match" : "mismatch";
  }

  // Admin view: discrepant lines first (largest abs diff), then matches alphabetically
  const sortedAdminLines = [...session.lines].sort((a, b) => {
    const aDiff = a.difference !== null && a.difference !== 0;
    const bDiff = b.difference !== null && b.difference !== 0;
    if (aDiff && !bDiff) return -1;
    if (!aDiff && bDiff) return 1;
    if (aDiff && bDiff) return Math.abs(b.difference!) - Math.abs(a.difference!);
    return a.product.name.localeCompare(b.product.name);
  });

  const filledCount = session.lines.filter((l) => counts[l.id] !== "").length;
  const discrepancies = session.lines.filter((l) => l.difference !== null && l.difference !== 0).length;

  async function saveCounts() {
    setSaving(true);
    const lines = session.lines.map((l) => ({
      id: l.id,
      physicalQty: parseInt(counts[l.id]) || 0,
      staffConfirmed: confirmedLines.has(l.id),
    }));
    const res = await fetch(`/api/opname/${session.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "update-counts", lines }),
    });
    setSaving(false);
    if (!res.ok) { toast.error("Failed to save counts"); return false; }
    toast.success("Counts saved");
    router.refresh();
    return true;
  }

  async function submitForReview() {
    const ok = await saveCounts();
    if (!ok) return;
    const res = await fetch(`/api/opname/${session.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "submit" }),
    });
    if (!res.ok) { toast.error("Failed to submit"); return; }
    toast.success("Submitted for review");
    router.refresh();
  }

  async function approve() {
    const res = await fetch(`/api/opname/${session.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "approve" }),
    });
    if (!res.ok) { toast.error("Failed to approve"); return; }
    const data = await res.json();
    setConfirmingApprove(false);
    if (data.pendingOrderId) {
      toast.success("Opname disetujui. Adjustment menunggu konfirmasi stok.");
      router.push(`/orders/${data.pendingOrderId}`);
    } else {
      toast.success("Opname disetujui — tidak ada selisih.");
      router.push("/opname");
    }
    router.refresh();
  }

  async function cancelSession() {
    setCancelling(true);
    const res = await fetch(`/api/opname/${session.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "cancel", cancelNote: cancelNoteInput }),
    });
    setCancelling(false);
    if (!res.ok) { toast.error("Failed to cancel session"); return; }
    toast.success("Session dibatalkan");
    router.push("/opname");
    router.refresh();
  }

  // ── Staff blind-count view (IN_PROGRESS, non-admin) ──────────────────────

  if (isEditable && !isAdmin) {
    return (
      <div>
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden mb-4">
          <div className="px-5 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between text-xs text-slate-500">
            <span>{filledCount}/{session.lines.length} terhitung</span>
            <span className="font-medium text-yellow-600">IN PROGRESS</span>
          </div>

          {/* Mobile */}
          <div className="md:hidden divide-y divide-slate-100">
            {session.lines.map((line) => {
              const status = getLineStatus(line);
              return (
                <div key={line.id} className={`px-4 py-3 ${status === "mismatch" ? "bg-amber-50" : status === "confirmed" ? "bg-blue-50" : ""}`}>
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="min-w-0">
                      <div className="font-medium text-slate-800 text-sm leading-tight">{line.product.name}</div>
                      <div className="text-xs font-mono text-slate-400 mt-0.5">{line.product.sku} · {line.product.category?.name}</div>
                    </div>
                    {status === "match" && <span className="text-green-600 font-bold flex-shrink-0">✓</span>}
                    {status === "confirmed" && <span className="text-blue-600 text-xs font-semibold flex-shrink-0">🔒 Dikonfirmasi</span>}
                  </div>
                  <div className="flex items-center gap-3 flex-wrap">
                    <input
                      ref={(el) => { inputRefs.current[line.id] = el; }}
                      type="number" inputMode="numeric" min="0"
                      value={counts[line.id]}
                      onFocus={(e) => e.target.select()} onChange={(e) => setCount(line.id, e.target.value)}
                      disabled={status === "confirmed"}
                      className="w-28 text-center px-3 py-3 border-2 border-slate-300 rounded-xl text-base font-semibold focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:opacity-50 disabled:bg-slate-50"
                      placeholder="Count"
                    />
                    <span className="text-xs text-slate-400">{line.product.unit?.name}</span>
                    {status === "confirmed" && (
                      <button onClick={() => unconfirmLine(line.id)} className="text-xs text-blue-500 hover:underline">Edit</button>
                    )}
                  </div>
                  {status === "mismatch" && (
                    <div className="flex items-center gap-2 mt-2 flex-wrap">
                      <span className="text-xs text-amber-700 font-medium">⚠ Qty tidak sesuai sistem</span>
                      <button onClick={() => recheckLine(line.id)} className="text-xs px-2 py-1 border border-slate-300 rounded text-slate-600 hover:bg-slate-100">Hitung Ulang</button>
                      <button onClick={() => confirmLine(line.id)} className="text-xs px-2 py-1 bg-amber-500 hover:bg-amber-600 text-white rounded font-medium">Konfirmasi</button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Desktop */}
          <table className="hidden md:table w-full text-sm border-collapse">
            <thead>
              <tr className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500 border-b border-slate-200">
                <th className="px-4 py-2.5 text-left font-medium">Product</th>
                <th className="px-4 py-2.5 text-left font-medium">Category</th>
                <th className="px-4 py-2.5 text-center font-medium">{t("opname.countSheet.colPhysical", "Physical Qty")}</th>
                <th className="px-4 py-2.5 text-left font-medium">Unit</th>
                <th className="px-4 py-2.5 text-left font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {session.lines.map((line) => {
                const status = getLineStatus(line);
                return (
                  <tr key={line.id} className={`border-t border-slate-100 ${status === "mismatch" ? "bg-amber-50" : status === "confirmed" ? "bg-blue-50" : ""}`}>
                    <td className="px-4 py-2.5">
                      <div className="font-medium text-slate-800">{line.product.name}</div>
                      <div className="text-xs font-mono text-slate-400">{line.product.sku}</div>
                    </td>
                    <td className="px-4 py-2.5 text-xs text-slate-500">{line.product.category?.name}</td>
                    <td className="px-4 py-2.5 text-center">
                      <input
                        ref={(el) => { inputRefs.current[line.id] = el; }}
                        type="number" inputMode="numeric" min="0"
                        value={counts[line.id]}
                        onFocus={(e) => e.target.select()} onChange={(e) => setCount(line.id, e.target.value)}
                        disabled={status === "confirmed"}
                        className="w-24 text-center px-2 py-1 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:bg-slate-50"
                        placeholder="—"
                      />
                    </td>
                    <td className="px-4 py-2.5 text-xs text-slate-500">{line.product.unit?.name}</td>
                    <td className="px-4 py-2.5">
                      {status === "match" && <span className="text-green-600 font-bold">✓</span>}
                      {status === "confirmed" && (
                        <span className="inline-flex items-center gap-2">
                          <span className="text-blue-600 text-xs font-semibold">🔒 Dikonfirmasi</span>
                          <button onClick={() => unconfirmLine(line.id)} className="text-xs text-slate-400 hover:text-slate-600 underline">Edit</button>
                        </span>
                      )}
                      {status === "mismatch" && (
                        <span className="inline-flex items-center gap-2">
                          <span className="text-amber-600 text-xs font-medium">⚠ Tidak sesuai</span>
                          <button onClick={() => recheckLine(line.id)} className="text-xs px-2 py-1 border border-slate-300 rounded text-slate-600 hover:bg-slate-100">Hitung Ulang</button>
                          <button onClick={() => confirmLine(line.id)} className="text-xs px-2 py-1 bg-amber-500 hover:bg-amber-600 text-white rounded font-medium">Konfirmasi</button>
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="flex gap-3 flex-wrap items-center">
          <button onClick={saveCounts} disabled={saving}
            className="px-5 py-2 text-sm border border-slate-300 rounded-lg text-slate-600 hover:bg-slate-50 disabled:opacity-50">
            {saving ? t("opname.countSheet.saving", "Saving…") : t("opname.countSheet.saveDraft", "Save Draft")}
          </button>
          <button onClick={submitForReview} disabled={saving || filledCount === 0}
            className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-semibold px-5 py-2 rounded-lg">
            {t("opname.countSheet.submitForReview", "Submit for Review")}
          </button>
        </div>
      </div>
    );
  }

  // ── Admin / review / approved / cancelled view ────────────────────────────

  return (
    <div>
      {scanEnabled && isAdmin && isEditable && (
        <OpnameScanPanel sessionId={session.id} onApply={applyScan} />
      )}
      {isCancelled && (
        <div className="mb-4 bg-red-50 border border-red-200 rounded-xl px-5 py-3">
          <div className="text-xs font-semibold text-red-500 uppercase tracking-wide mb-1">Session Dibatalkan</div>
          <div className="text-sm text-red-800">{session.cancelNote || "Dibatalkan oleh admin."}</div>
        </div>
      )}

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden mb-4">
        <div className="px-5 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between text-xs text-slate-500">
          <span>
            {session.lines.length} items
            {(isReviewing || session.status === "APPROVED") && ` · ${discrepancies} selisih`}
          </span>
          <div className="flex items-center gap-2">
            {session.status === "APPROVED" && session.approvedByName && (
              <span className="text-slate-400">Disetujui oleh <span className="font-medium text-slate-600">{session.approvedByName}</span></span>
            )}
            {session.status !== "APPROVED" && session.createdByName && (
              <span className="text-slate-400">Oleh <span className="font-medium text-slate-600">{session.createdByName}</span></span>
            )}
            <span className={`font-medium ${session.status === "APPROVED" ? "text-green-600" : session.status === "REVIEWING" ? "text-blue-600" : session.status === "CANCELLED" ? "text-red-500" : "text-yellow-600"}`}>
              {session.status.replace("_", " ")}
            </span>
          </div>
        </div>

        {isReviewing && session.createdByName && (
          <div className="px-5 py-2 bg-slate-50 border-b border-slate-200 flex items-center gap-2 text-xs text-slate-500">
            <svg className="w-3.5 h-3.5 flex-shrink-0 text-slate-400" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v2.4h19.2v-2.4c0-3.2-6.4-4.8-9.6-4.8z"/>
            </svg>
            <span>Dilakukan oleh: <span className="font-semibold text-slate-700">{session.createdByName}</span></span>
          </div>
        )}

        {/* Mobile */}
        <div className="md:hidden divide-y divide-slate-100">
          {sortedAdminLines.map((line) => {
            const diff = line.difference;
            const hasDisc = diff !== null && diff !== 0;
            return (
              <div key={line.id} className={`px-4 py-3 ${hasDisc ? "bg-red-50" : ""}`}>
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="min-w-0">
                    <div className="font-medium text-slate-800 text-sm leading-tight">{line.product.name}</div>
                    <div className="text-xs font-mono text-slate-400 mt-0.5">{line.product.sku} · {line.product.category?.name}</div>
                  </div>
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    {line.staffConfirmed && (
                      <span className="text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded font-medium">Dikonfirmasi staff</span>
                    )}
                    <span className={`text-sm font-bold ${diff === null ? "text-slate-300" : diff === 0 ? "text-green-600" : diff > 0 ? "text-blue-600" : "text-red-600"}`}>
                      {diff === null ? "—" : diff === 0 ? "✓" : diff > 0 ? `+${diff}` : diff}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="text-xs text-slate-500">
                    Sistem: <span className="font-semibold text-slate-700">{line.bookQty}</span> {line.product.unit?.name}
                  </div>
                  <div className="flex-1" />
                  {isEditable ? (
                    <input
                      type="number" inputMode="numeric" min="0" value={counts[line.id]}
                      onFocus={(e) => e.target.select()} onChange={(e) => setCount(line.id, e.target.value)}
                      className="w-28 text-center px-3 py-3 border-2 border-slate-300 rounded-xl text-base font-semibold focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="Count"
                    />
                  ) : (
                    <span className="text-base font-semibold text-slate-800">
                      {line.physicalQty ?? "—"} <span className="text-xs font-normal text-slate-500">{line.product.unit?.name}</span>
                    </span>
                  )}
                </div>
                {line.notes && <div className="text-xs text-slate-400 mt-1.5">{line.notes}</div>}
              </div>
            );
          })}
        </div>

        {/* Desktop */}
        <table className="hidden md:table w-full text-sm border-collapse">
          <thead>
            <tr className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500 border-b border-slate-200">
              <th className="px-4 py-2.5 text-left font-medium">Product</th>
              <th className="px-4 py-2.5 text-left font-medium">Category</th>
              <th className="px-4 py-2.5 text-right font-medium">{t("opname.countSheet.colBook", "Book Qty")}</th>
              <th className="px-4 py-2.5 text-center font-medium">{t("opname.countSheet.colPhysical", "Physical Qty")}</th>
              <th className="px-4 py-2.5 text-right font-medium">{t("opname.countSheet.colDifference", "Difference")}</th>
              <th className="px-4 py-2.5 text-left font-medium">Unit</th>
              <th className="px-4 py-2.5 text-left font-medium">Notes</th>
            </tr>
          </thead>
          <tbody>
            {sortedAdminLines.map((line) => {
              const diff = line.difference;
              const hasDisc = diff !== null && diff !== 0;
              return (
                <tr key={line.id} className={`border-t border-slate-100 ${hasDisc ? "bg-red-50" : ""}`}>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      <div>
                        <div className="font-medium text-slate-800">{line.product.name}</div>
                        <div className="text-xs font-mono text-slate-400">{line.product.sku}</div>
                      </div>
                      {line.staffConfirmed && (
                        <span className="text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded font-medium whitespace-nowrap">Dikonfirmasi staff</span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-xs text-slate-500">{line.product.category?.name}</td>
                  <td className="px-4 py-2.5 text-right text-slate-600">{line.bookQty}</td>
                  <td className="px-4 py-2.5 text-center">
                    {isEditable ? (
                      <input
                        type="number" inputMode="numeric" min="0" value={counts[line.id]}
                        onFocus={(e) => e.target.select()} onChange={(e) => setCount(line.id, e.target.value)}
                        className="w-24 text-center px-2 py-1 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        placeholder="—"
                      />
                    ) : (
                      <span className="text-slate-800">{line.physicalQty ?? "—"}</span>
                    )}
                  </td>
                  <td className={`px-4 py-2.5 text-right font-semibold ${diff === null ? "text-slate-300" : diff === 0 ? "text-green-600" : diff! > 0 ? "text-blue-600" : "text-red-600"}`}>
                    {diff === null ? "—" : diff === 0 ? "✓" : diff! > 0 ? `+${diff}` : diff}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-slate-500">{line.product.unit?.name}</td>
                  <td className="px-4 py-2.5 text-xs text-slate-400">{line.notes ?? "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Admin IN_PROGRESS footer */}
      {isEditable && isAdmin && (
        <div className="flex gap-3">
          <button onClick={saveCounts} disabled={saving}
            className="px-5 py-2 text-sm border border-slate-300 rounded-lg text-slate-600 hover:bg-slate-50 disabled:opacity-50">
            {saving ? t("opname.countSheet.saving", "Saving…") : t("opname.countSheet.saveDraft", "Save Draft")}
          </button>
          <button onClick={submitForReview} disabled={saving || filledCount === 0}
            className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-semibold px-5 py-2 rounded-lg">
            {t("opname.countSheet.submitForReview", "Submit for Review")}
          </button>
        </div>
      )}

      {/* Admin REVIEWING footer */}
      {isReviewing && isAdmin && (
        <div className="space-y-3">
          {!showCancelForm && (
            <div className="flex gap-3 items-center flex-wrap">
              <span className="text-xs text-slate-500">{discrepancies} selisih akan membuat adjustment order (status pending, stok belum berubah).</span>
              {confirmingApprove ? (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-600 font-medium">Setujui dan buat adjustment pending?</span>
                  <button onClick={() => setConfirmingApprove(false)} className="text-xs px-3 py-1.5 border border-slate-300 rounded-lg text-slate-600 hover:bg-slate-50">Batal</button>
                  <button onClick={approve} className="text-xs bg-green-600 hover:bg-green-700 text-white font-semibold px-3 py-1.5 rounded-lg">Ya, setujui</button>
                </div>
              ) : (
                <div className="flex gap-2">
                  <button onClick={() => setConfirmingApprove(true)}
                    className="bg-green-600 hover:bg-green-700 text-white text-sm font-semibold px-5 py-2 rounded-lg">
                    Setujui Opname
                  </button>
                  <button onClick={() => setShowCancelForm(true)}
                    className="px-5 py-2 text-sm border border-red-200 text-red-600 rounded-lg hover:bg-red-50">
                    Batalkan Session
                  </button>
                </div>
              )}
            </div>
          )}

          {showCancelForm && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-4 space-y-3">
              <div className="text-sm font-semibold text-red-700">Batalkan session ini?</div>
              <div className="text-xs text-red-600">Tulis item mana yang perlu dihitung ulang. Staff akan melihat catatan ini.</div>
              <textarea
                value={cancelNoteInput}
                onChange={(e) => setCancelNoteInput(e.target.value)}
                placeholder="Contoh: Harap hitung ulang Beras 5kg (rak B-3) dan Minyak Goreng 2L (rak A-1)…"
                rows={3}
                className="w-full px-3 py-2 text-sm border border-red-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-400 bg-white"
              />
              <div className="flex gap-2">
                <button onClick={() => setShowCancelForm(false)}
                  className="px-4 py-2 text-sm border border-slate-300 rounded-lg text-slate-600 hover:bg-slate-50">
                  Kembali
                </button>
                <button onClick={cancelSession} disabled={cancelling}
                  className="px-4 py-2 text-sm bg-red-600 hover:bg-red-700 text-white font-semibold rounded-lg disabled:opacity-50">
                  {cancelling ? "Membatalkan…" : "Batalkan Session"}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
