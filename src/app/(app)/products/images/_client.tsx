"use client";

import { useRef, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { upload } from "@vercel/blob/client";
import toast from "react-hot-toast";
import { matchBySku } from "@/modules/bulk-image-upload/uploader";
import type { FileRow, ProductSku, BulkSaveResult } from "@/modules/bulk-image-upload/types";

const CONCURRENCY = 5;
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];
const ALLOWED_EXT = ["jpg", "jpeg", "png", "webp"];

type SearchResult = { id: string; sku: string; name: string };

export function BulkImageUploadClient({ products }: { products: ProductSku[] }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<FileRow[]>([]);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [result, setResult] = useState<BulkSaveResult | null>(null);
  const [searchState, setSearchState] = useState<Record<number, { query: string; results: SearchResult[]; open: boolean }>>({});

  const matchedCount = rows.filter((r) => r.status === "matched").length;

  function addFiles(files: File[]) {
    const valid = files.filter((f) => {
      const ext = f.name.split(".").pop()?.toLowerCase() ?? "";
      return ALLOWED_TYPES.includes(f.type) || ALLOWED_EXT.includes(ext);
    });
    if (valid.length < files.length)
      toast(`${files.length - valid.length} file(s) skipped — only JPG, PNG, WEBP allowed`);

    const newRows = matchBySku(valid, products);

    setRows((prev) => {
      const existing = new Map(prev.map((r, i) => [r.filename, i]));
      const merged = [...prev];
      for (const row of newRows) {
        const idx = existing.get(row.filename);
        if (idx !== undefined) {
          merged[idx] = row; // replace duplicate filename
        } else {
          merged.push(row);
        }
      }
      return merged;
    });
    setResult(null);
  }

  function onInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    if (e.target.files) addFiles(Array.from(e.target.files));
    e.target.value = "";
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    if (e.dataTransfer.files) addFiles(Array.from(e.dataTransfer.files));
  }

  function dismissRow(idx: number) {
    setRows((prev) => prev.map((r, i) => i === idx ? { ...r, status: "dismissed", productId: null, productName: null, productSku: null } : r));
  }

  function assignRow(idx: number, product: SearchResult) {
    const existing = rows.find((r, i) => i !== idx && r.productId === product.id && r.status === "matched");
    if (existing) { toast.error(`${product.sku} is already assigned to ${existing.filename}`); return; }
    const hasExisting = products.find((p) => p.id === product.id)?.imageUrl ?? null;
    setRows((prev) => prev.map((r, i) => i === idx
      ? { ...r, status: "matched", productId: product.id, productName: product.name, productSku: product.sku, hasExistingImage: !!hasExisting }
      : r
    ));
    setSearchState((s) => ({ ...s, [idx]: { query: "", results: [], open: false } }));
  }

  const searchProducts = useCallback(async (idx: number, q: string) => {
    // Always include results:[] so render never sees results as undefined
    setSearchState((s) => ({ ...s, [idx]: { ...s[idx], query: q, open: true, results: s[idx]?.results ?? [] } }));
    if (q.trim().length < 1) { setSearchState((s) => ({ ...s, [idx]: { ...s[idx], results: [], open: false } })); return; }
    try {
      const res = await fetch(`/api/products/search?q=${encodeURIComponent(q)}`);
      if (!res.ok) return;
      const data = await res.json();
      if (Array.isArray(data)) {
        setSearchState((s) => ({ ...s, [idx]: { ...s[idx], results: data.slice(0, 8), open: true } }));
      }
    } catch {
      // ignore fetch errors — search silently fails
    }
  }, []);

  async function handleUpload() {
    const toUpload = rows.filter((r) => r.status === "matched");
    if (!toUpload.length) return;
    setUploading(true);
    setProgress({ done: 0, total: toUpload.length });
    setResult(null);

    const saves: { productId: string; url: string }[] = [];
    let done = 0;

    for (let i = 0; i < toUpload.length; i += CONCURRENCY) {
      const batch = toUpload.slice(i, i + CONCURRENCY);
      const batchResults = await Promise.allSettled(
        batch.map(async (row) => {
          const ext = row.filename.split(".").pop()?.toLowerCase() ?? "jpg";
          const pathname = `products/${row.productId}-${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
          const blob = await upload(pathname, row.file, {
            access: "public",
            handleUploadUrl: "/api/products/images/token",
          });
          return { productId: row.productId!, url: blob.url };
        })
      );
      for (const r of batchResults) {
        if (r.status === "fulfilled") saves.push(r.value);
      }
      done += batch.length;
      setProgress({ done, total: toUpload.length });
    }

    const res = await fetch("/api/products/images/bulk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ saves }),
    });
    const data: BulkSaveResult = await res.json();
    setResult(data);
    setUploading(false);

    if (data.failed === 0) toast.success(`${data.saved} image${data.saved !== 1 ? "s" : ""} uploaded`);
    else toast(`${data.saved} uploaded, ${data.failed} failed`, { icon: "⚠️" });
  }

  const matched = rows.filter((r) => r.status === "matched");
  const unmatched = rows.filter((r) => r.status === "unmatched");
  const dismissed = rows.filter((r) => r.status === "dismissed");

  return (
    <div className="max-w-3xl space-y-5">

      {/* Drop zone */}
      <div
        onDrop={onDrop}
        onDragOver={(e) => e.preventDefault()}
        onClick={() => inputRef.current?.click()}
        className="border-2 border-dashed border-slate-300 dark:border-slate-600 rounded-xl p-8 text-center cursor-pointer hover:border-blue-400 hover:bg-blue-50 dark:hover:bg-slate-800 transition-colors"
      >
        <input ref={inputRef} type="file" multiple accept="image/jpeg,image/png,image/webp" className="hidden" onChange={onInputChange} />
        <div className="text-2xl mb-2">🖼</div>
        <p className="text-sm font-medium text-slate-700 dark:text-slate-200">Drop images here or click to browse</p>
        <p className="text-xs text-slate-400 mt-1">Rename files to match SKU — e.g. <span className="font-mono">BTN-12-BLK.jpg</span> · JPG, PNG, WEBP · max 5 MB</p>
        {rows.length > 0 && (
          <p className="text-xs text-blue-600 mt-2 font-medium">
            {rows.length} file{rows.length !== 1 ? "s" : ""} loaded — drop more to add
          </p>
        )}
      </div>

      {/* Match table */}
      {rows.length > 0 && (
        <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700">

          {/* Matched */}
          {matched.length > 0 && (
            <>
              <div className="px-4 py-2 bg-slate-50 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-500 uppercase tracking-wide">
                Matched ({matched.length})
              </div>
              {rows.map((row, idx) => row.status !== "matched" ? null : (
                <div key={idx} className="flex items-center gap-3 px-4 py-2.5 border-b border-slate-100 dark:border-slate-800 last:border-0 text-sm">
                  <span className="text-green-500 flex-shrink-0">✓</span>
                  <span className="font-mono text-xs text-slate-500 w-52 truncate flex-shrink-0">{row.filename}</span>
                  <span className="text-slate-400 flex-shrink-0">→</span>
                  <span className="flex-1 text-slate-800 dark:text-slate-200 truncate">
                    {row.productName}
                    <span className="ml-1.5 font-mono text-xs text-slate-400">{row.productSku}</span>
                  </span>
                  {row.hasExistingImage && (
                    <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 flex-shrink-0">will overwrite</span>
                  )}
                </div>
              ))}
            </>
          )}

          {/* Unmatched */}
          {unmatched.length > 0 && (
            <>
              <div className="px-4 py-2 bg-slate-50 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-500 uppercase tracking-wide">
                Unmatched ({unmatched.length}) — assign or dismiss
              </div>
              {rows.map((row, idx) => row.status !== "unmatched" ? null : (
                <div key={idx} className="flex items-center gap-3 px-4 py-2.5 border-b border-slate-100 dark:border-slate-800 last:border-0 text-sm">
                  <span className="text-slate-300 flex-shrink-0">?</span>
                  <span className="font-mono text-xs text-slate-500 w-52 truncate flex-shrink-0">{row.filename}</span>
                  <div className="flex-1 relative">
                    <input
                      type="text"
                      placeholder="Search product…"
                      value={searchState[idx]?.query ?? ""}
                      onChange={(e) => searchProducts(idx, e.target.value)}
                      onBlur={() => setTimeout(() => setSearchState((s) => ({ ...s, [idx]: { ...s[idx], open: false } })), 150)}
                      className="w-full px-2.5 py-1.5 text-xs border border-slate-300 dark:border-slate-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-slate-800 dark:text-slate-200"
                    />
                    {searchState[idx]?.open && (searchState[idx]?.results?.length ?? 0) > 0 && (
                      <div className="absolute z-10 top-full left-0 right-0 mt-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600 rounded-lg shadow-lg overflow-hidden">
                        {searchState[idx].results.map((p) => (
                          <button
                            key={p.id}
                            type="button"
                            onMouseDown={() => assignRow(idx, p)}
                            className="w-full text-left px-3 py-2 text-xs hover:bg-blue-50 dark:hover:bg-slate-700 flex items-center gap-2"
                          >
                            <span className="font-mono text-slate-400">{p.sku}</span>
                            <span className="text-slate-700 dark:text-slate-200">{p.name}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <button type="button" onClick={() => dismissRow(idx)} className="text-slate-300 hover:text-red-400 flex-shrink-0 text-base leading-none">✕</button>
                </div>
              ))}
            </>
          )}

          {/* Dismissed */}
          {dismissed.length > 0 && (
            <>
              <div className="px-4 py-2 bg-slate-50 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-400 uppercase tracking-wide">
                Dismissed ({dismissed.length})
              </div>
              {rows.map((row, idx) => row.status !== "dismissed" ? null : (
                <div key={idx} className="flex items-center gap-3 px-4 py-2 border-b border-slate-100 dark:border-slate-800 last:border-0 text-sm opacity-40">
                  <span className="flex-shrink-0">—</span>
                  <span className="font-mono text-xs text-slate-500 truncate">{row.filename}</span>
                </div>
              ))}
            </>
          )}
        </div>
      )}

      {/* Upload button + progress */}
      {rows.length > 0 && !result && (
        <div className="flex items-center gap-4">
          <button
            onClick={handleUpload}
            disabled={uploading || matchedCount === 0}
            className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-semibold px-5 py-2 rounded-lg transition-colors"
          >
            {uploading
              ? `Uploading ${progress.done} / ${progress.total}…`
              : `Upload ${matchedCount} image${matchedCount !== 1 ? "s" : ""}`}
          </button>
          {!uploading && (
            <button onClick={() => { setRows([]); setResult(null); }} className="text-xs text-slate-400 hover:text-slate-600">
              Clear all
            </button>
          )}
        </div>
      )}

      {/* Result summary */}
      {result && (
        <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700 p-5 space-y-4">
          <div className="grid grid-cols-2 gap-3 max-w-xs">
            <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-3">
              <div className="text-2xl font-bold text-green-700">{result.saved}</div>
              <div className="text-[11px] font-medium text-green-600 mt-0.5">Uploaded</div>
            </div>
            <div className={`${result.failed > 0 ? "bg-red-50 border-red-200" : "bg-slate-50 border-slate-200"} border rounded-xl px-4 py-3`}>
              <div className={`text-2xl font-bold ${result.failed > 0 ? "text-red-600" : "text-slate-400"}`}>{result.failed}</div>
              <div className={`text-[11px] font-medium mt-0.5 ${result.failed > 0 ? "text-red-500" : "text-slate-400"}`}>Failed</div>
            </div>
          </div>
          <div className="flex gap-3">
            <button onClick={() => router.push("/products")} className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold px-5 py-2 rounded-lg">
              View Products
            </button>
            <button onClick={() => { setRows([]); setResult(null); }} className="px-4 py-2 text-sm border border-slate-300 rounded-lg text-slate-600 hover:bg-slate-50">
              Upload More
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
