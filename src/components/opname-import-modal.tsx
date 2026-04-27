"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";

type Location = { id: string; name: string };

type ValidationError = { rowNum: number; message: string };
type PreviewRow = {
  rowNum: number;
  productId: string;
  productName: string;
  sku: string;
  unit: string;
  currentStock: number;
  physicalQty: number;
  difference: number;
  notes: string;
};
type ValidationResult = {
  errors: ValidationError[];
  rows: PreviewRow[];
  locationName: string;
  skippedRows: number;
};

type Stage = "upload" | "preview" | "applying";

export function OpnameImportModal({
  locations,
  onClose,
}: {
  locations: Location[];
  onClose: () => void;
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [stage, setStage] = useState<Stage>("upload");
  const [locationId, setLocationId] = useState(locations[0]?.id ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ValidationResult | null>(null);
  const [showErrors, setShowErrors] = useState(false);

  async function handleValidate() {
    if (!file) { toast.error("Please select a file"); return; }
    setLoading(true);
    const form = new FormData();
    form.append("file", file);
    form.append("locationId", locationId);
    const res = await fetch("/api/opname/import", { method: "POST", body: form });
    setLoading(false);
    if (!res.ok) {
      const data = await res.json();
      toast.error(data.error ?? "Failed to validate file");
      return;
    }
    const data: ValidationResult = await res.json();
    setResult(data);
    setStage("preview");
  }

  async function handleApply() {
    if (!result || result.rows.length === 0) return;
    setStage("applying");
    const res = await fetch("/api/opname/import/apply", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        locationId,
        rows: result.rows.map((r) => ({
          productId: r.productId,
          physicalQty: r.physicalQty,
          notes: r.notes,
        })),
      }),
    });
    if (!res.ok) {
      const data = await res.json();
      toast.error(data.error ?? "Import failed");
      setStage("preview");
      return;
    }
    const data = await res.json();
    toast.success(`Session ${data.sessionNumber} created — ready for approval`);
    onClose();
    router.push(`/opname/${data.sessionId}`);
    router.refresh();
  }

  const hasErrors = (result?.errors.length ?? 0) > 0;
  const hasRows = (result?.rows.length ?? 0) > 0;
  const discrepancies = result?.rows.filter((r) => r.difference !== 0).length ?? 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden">

        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
          <div>
            <h2 className="text-base font-bold text-slate-800">Import Stock Opname</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              {stage === "upload" && "Upload the completed opname Excel file"}
              {stage === "preview" && `Preview — ${result?.locationName}`}
              {stage === "applying" && "Creating opname session…"}
            </p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl leading-none px-1">×</button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5">

          {/* Stage: upload */}
          {stage === "upload" && (
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Location</label>
                <select
                  value={locationId}
                  onChange={(e) => setLocationId(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {locations.map((l) => (
                    <option key={l.id} value={l.id}>{l.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Excel File (.xlsx)</label>
                <div
                  onClick={() => fileRef.current?.click()}
                  className="border-2 border-dashed border-slate-300 rounded-xl p-8 text-center cursor-pointer hover:border-blue-400 hover:bg-blue-50 transition-colors"
                >
                  {file ? (
                    <div>
                      <div className="text-2xl mb-1">📊</div>
                      <div className="text-sm font-medium text-slate-700">{file.name}</div>
                      <div className="text-xs text-slate-400">{(file.size / 1024).toFixed(1)} KB · click to change</div>
                    </div>
                  ) : (
                    <div>
                      <div className="text-2xl mb-1">📁</div>
                      <div className="text-sm text-slate-600">Click to select file</div>
                      <div className="text-xs text-slate-400 mt-1">Accepts .xlsx files exported from this system</div>
                    </div>
                  )}
                </div>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  className="hidden"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                />
              </div>

              <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-xs text-amber-800">
                <strong>Important:</strong> Only rows with a Physical Count Qty filled in will be imported. Empty rows are skipped.
                Rows with errors will not be applied.
              </div>
            </div>
          )}

          {/* Stage: preview */}
          {stage === "preview" && result && (
            <div className="space-y-4">
              {/* Summary chips */}
              <div className="flex flex-wrap gap-2">
                <span className="px-2.5 py-1 bg-green-100 text-green-700 rounded-full text-xs font-medium">
                  {result.rows.length} items valid
                </span>
                {discrepancies > 0 && (
                  <span className="px-2.5 py-1 bg-orange-100 text-orange-700 rounded-full text-xs font-medium">
                    {discrepancies} discrepanc{discrepancies !== 1 ? "ies" : "y"}
                  </span>
                )}
                {result.skippedRows > 0 && (
                  <span className="px-2.5 py-1 bg-slate-100 text-slate-600 rounded-full text-xs font-medium">
                    {result.skippedRows} skipped (no count)
                  </span>
                )}
                {hasErrors && (
                  <button
                    onClick={() => setShowErrors((v) => !v)}
                    className="px-2.5 py-1 bg-red-100 text-red-700 rounded-full text-xs font-medium hover:bg-red-200"
                  >
                    {result.errors.length} error{result.errors.length !== 1 ? "s" : ""} {showErrors ? "▲" : "▼"}
                  </button>
                )}
              </div>

              {/* Errors panel */}
              {hasErrors && showErrors && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-3 space-y-1 max-h-32 overflow-y-auto">
                  {result.errors.map((e, i) => (
                    <div key={i} className="text-xs text-red-700">{e.message}</div>
                  ))}
                </div>
              )}

              {/* Preview table */}
              {hasRows ? (
                <div className="border border-slate-200 rounded-xl overflow-hidden">
                  <table className="w-full text-xs border-collapse">
                    <thead>
                      <tr className="bg-slate-50 text-slate-500 uppercase tracking-wide border-b border-slate-200">
                        <th className="px-3 py-2 text-left font-medium">Product</th>
                        <th className="px-3 py-2 text-right font-medium">System Stock</th>
                        <th className="px-3 py-2 text-right font-medium">Physical Count</th>
                        <th className="px-3 py-2 text-right font-medium">Difference</th>
                        <th className="px-3 py-2 text-left font-medium">Notes</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.rows.map((row) => {
                        const diff = row.difference;
                        return (
                          <tr key={row.productId} className={`border-t border-slate-100 ${diff !== 0 ? "bg-orange-50" : ""}`}>
                            <td className="px-3 py-2">
                              <div className="font-medium text-slate-800">{row.productName}</div>
                              <div className="text-slate-400 font-mono">{row.sku} · {row.unit}</div>
                            </td>
                            <td className="px-3 py-2 text-right text-slate-600">{row.currentStock}</td>
                            <td className="px-3 py-2 text-right font-semibold text-slate-800">{row.physicalQty}</td>
                            <td className={`px-3 py-2 text-right font-bold ${diff === 0 ? "text-green-600" : diff > 0 ? "text-blue-600" : "text-red-600"}`}>
                              {diff === 0 ? "✓" : diff > 0 ? `+${diff}` : diff}
                            </td>
                            <td className="px-3 py-2 text-slate-400">{row.notes || "—"}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="py-10 text-center text-slate-400 text-xs border border-slate-200 rounded-xl">
                  No valid rows found in the file.
                </div>
              )}

              {hasRows && (
                <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-3 text-xs text-blue-800">
                  Confirming will create an opname session in <strong>Reviewing</strong> status.
                  An admin can approve it to apply stock adjustments for the {discrepancies} discrepanc{discrepancies !== 1 ? "ies" : "y"}.
                </div>
              )}
            </div>
          )}

          {/* Stage: applying */}
          {stage === "applying" && (
            <div className="py-16 text-center text-slate-500 text-sm animate-pulse">
              Creating opname session…
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-slate-100 flex gap-3 justify-between">
          <button
            onClick={stage === "upload" ? onClose : () => { setStage("upload"); setResult(null); }}
            disabled={stage === "applying"}
            className="px-4 py-2 text-sm border border-slate-300 rounded-lg text-slate-600 hover:bg-slate-50 disabled:opacity-50"
          >
            {stage === "upload" ? "Cancel" : "← Back"}
          </button>

          <div className="flex gap-3">
            {stage === "upload" && (
              <button
                onClick={handleValidate}
                disabled={!file || loading}
                className="px-5 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-semibold rounded-lg transition-colors"
              >
                {loading ? "Validating…" : "Validate File →"}
              </button>
            )}
            {stage === "preview" && (
              <button
                onClick={handleApply}
                disabled={!hasRows}
                className="px-5 py-2 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white text-sm font-semibold rounded-lg transition-colors"
              >
                Confirm & Create Session
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
