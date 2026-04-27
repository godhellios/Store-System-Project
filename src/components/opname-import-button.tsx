"use client";

import { useState } from "react";
import { OpnameImportModal } from "./opname-import-modal";

type Location = { id: string; name: string };

export function OpnameImportButton({ locations }: { locations: Location[] }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 px-3 py-2 text-sm border border-slate-300 rounded-lg text-slate-600 hover:bg-slate-50 transition-colors"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
        </svg>
        Import Excel
      </button>
      {open && <OpnameImportModal locations={locations} onClose={() => setOpen(false)} />}
    </>
  );
}
