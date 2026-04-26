"use client";

import { useState } from "react";

export function ProductImageHover({ src }: { src: string }) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);

  function handleMouseEnter(e: React.MouseEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    setPos({ x: rect.right + 10, y: rect.top });
  }

  function handleMouseMove(e: React.MouseEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    setPos({ x: rect.right + 10, y: rect.top });
  }

  return (
    <div
      className="w-9 h-9 rounded border border-slate-200 overflow-hidden flex-shrink-0 cursor-zoom-in"
      onMouseEnter={handleMouseEnter}
      onMouseMove={handleMouseMove}
      onMouseLeave={() => setPos(null)}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt="" className="w-full h-full object-cover" />
      {pos && (
        <div
          className="pointer-events-none fixed z-50"
          style={{ left: pos.x, top: pos.y }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={src}
            alt=""
            className="w-52 h-52 object-cover rounded-lg shadow-2xl border border-slate-200"
          />
        </div>
      )}
    </div>
  );
}
