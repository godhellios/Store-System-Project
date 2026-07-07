"use client";

// ─────────────────────────────────────────────────────────────────────────────
// Photo Opname Scan — admin upload panel.
//
// Renders inside the opname count sheet (admin, IN_PROGRESS only). Lets the
// admin pick one or more page photos; each is uploaded to /api/opname/[id]/scan
// one at a time (per-page progress + isolation). Confident reads are handed to
// the count sheet via onApply(); unclear/blank rows are reported so the admin
// knows which cells to type by hand. Never writes to the DB.
// ─────────────────────────────────────────────────────────────────────────────
import { useRef, useState } from "react";
import toast from "react-hot-toast";

export type ScanApplyRow = { lineId: string; sku: string; name: string; qty: number };
type ScanUnclearRow = { lineId: string; sku: string; name: string; reason: "unclear" | "blank" };

type PageResult = {
  fileName: string;
  status: "reading" | "done" | "error";
  page?: number | null;
  filledCount?: number;
  unclearCount?: number;
  photoUrl?: string | null;
  unclear?: ScanUnclearRow[];
  error?: string;
};

export function OpnameScanPanel({
  sessionId,
  onApply,
}: {
  sessionId: string;
  onApply: (rows: ScanApplyRow[]) => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<PageResult[]>([]);

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setBusy(true);
    setResults([]);

    const list = Array.from(files);
    for (const file of list) {
      setResults((prev) => [...prev, { fileName: file.name, status: "reading" }]);
      try {
        const form = new FormData();
        form.append("file", file);
        const res = await fetch(`/api/opname/${sessionId}/scan`, { method: "POST", body: form });
        const data = await res.json();
        if (!res.ok) {
          setResults((prev) => updateLast(prev, { status: "error", error: data.error || "Failed to read page" }));
          continue;
        }
        const apply: ScanApplyRow[] = data.apply ?? [];
        if (apply.length > 0) onApply(apply);
        setResults((prev) => updateLast(prev, {
          status: "done",
          page: data.page,
          filledCount: data.filledCount,
          unclearCount: data.unclearCount,
          photoUrl: data.photoUrl,
          unclear: data.unclear ?? [],
        }));
      } catch {
        setResults((prev) => updateLast(prev, { status: "error", error: "Network error — retry this page" }));
      }
    }

    setBusy(false);
    if (inputRef.current) inputRef.current.value = "";
    toast.success("Photo reading complete — review the filled counts below.");
  }

  return (
    <div className="mb-4 bg-white rounded-xl border border-slate-200 overflow-hidden">
      <div className="px-5 py-3 border-b border-slate-200 bg-slate-50 flex items-center gap-2">
        <span className="text-lg">📷</span>
        <div>
          <div className="text-sm font-semibold text-slate-800">Scan paper count sheet</div>
          <div className="text-xs text-slate-500">Photograph each printed page. The system fills the counts — you review and approve.</div>
        </div>
      </div>

      <div className="px-5 py-4 space-y-3">
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          multiple
          disabled={busy}
          onChange={(e) => handleFiles(e.target.files)}
          className="hidden"
        />
        <button
          onClick={() => inputRef.current?.click()}
          disabled={busy}
          className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-semibold px-4 py-2 rounded-lg"
        >
          {busy ? "Reading…" : "Upload page photos"}
        </button>

        {results.length > 0 && (
          <div className="space-y-2 pt-1">
            {results.map((r, i) => (
              <div key={i} className="text-xs rounded-lg border border-slate-200 px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-slate-700 truncate">
                    {r.page != null ? `Page ${r.page}` : r.fileName}
                  </span>
                  {r.status === "reading" && <span className="text-slate-400">Reading…</span>}
                  {r.status === "done" && (
                    <span className="text-green-600 font-medium">
                      ✓ {r.filledCount} filled{r.unclearCount ? `, ${r.unclearCount} unclear` : ""}
                    </span>
                  )}
                  {r.status === "error" && <span className="text-red-500 font-medium">Failed</span>}
                </div>
                {r.status === "error" && r.error && (
                  <div className="text-red-500 mt-1">{r.error}</div>
                )}
                {r.status === "done" && r.unclear && r.unclear.length > 0 && (
                  <div className="text-amber-600 mt-1">
                    Type these by hand: {r.unclear.map((u) => u.sku).join(", ")}
                  </div>
                )}
                {r.status === "done" && r.photoUrl && (
                  <a href={r.photoUrl} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline mt-1 inline-block">
                    View photo
                  </a>
                )}
              </div>
            ))}
          </div>
        )}

        <p className="text-xs text-slate-400">
          Reads are a draft only — nothing is saved until you Save Draft or Submit. Always check unclear rows against the paper.
        </p>
      </div>
    </div>
  );
}

function updateLast(prev: PageResult[], patch: Partial<PageResult>): PageResult[] {
  if (prev.length === 0) return prev;
  const next = [...prev];
  next[next.length - 1] = { ...next[next.length - 1], ...patch };
  return next;
}
