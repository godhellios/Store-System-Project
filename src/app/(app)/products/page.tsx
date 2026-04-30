import { prisma } from "@/lib/prisma";
import Link from "next/link";
import ProductDeactivateButton from "@/components/product-deactivate-button";
import { ProductImageHover } from "@/components/product-image-hover";
import { blockOperator } from "@/lib/role-guard";

function hashColor(name: string) {
  const palette = [
    "bg-blue-100 text-blue-700", "bg-purple-100 text-purple-700",
    "bg-green-100 text-green-700", "bg-orange-100 text-orange-700",
    "bg-pink-100 text-pink-700", "bg-cyan-100 text-cyan-700",
    "bg-yellow-100 text-yellow-700", "bg-rose-100 text-rose-700",
  ];
  let h = 0;
  for (let i = 0; i < name.length; i++) h = name.charCodeAt(i) + ((h << 5) - h);
  return palette[Math.abs(h) % palette.length];
}

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; categoryId?: string; unitId?: string; locationId?: string; page?: string; showInactive?: string; lowStock?: string }>;
}) {
  const session = await blockOperator();
  const userRole = session.user.role;
  const params = await searchParams;
  const q = params.q ?? "";
  const categoryId = params.categoryId ?? "";
  const unitId = params.unitId ?? "";
  const locationId = params.locationId ?? "";
  const page = Math.max(1, parseInt(params.page ?? "1"));
  const showInactive = params.showInactive === "1";
  const lowStock = params.lowStock === "1";
  const perPage = 20;

  let lowStockIds: string[] | null = null;
  if (lowStock) {
    const allStock = await prisma.stock.findMany({
      where: { product: { isActive: true, reorderPoint: { gt: 0 } } },
      select: { productId: true, quantity: true, product: { select: { reorderPoint: true } } },
    });
    lowStockIds = [
      ...new Set(
        allStock
          .filter((s) => s.quantity <= s.product.reorderPoint)
          .map((s) => s.productId)
      ),
    ];
  }

  const where = {
    ...(showInactive ? {} : { isActive: true }),
    ...(lowStockIds !== null ? { id: { in: lowStockIds } } : {}),
    ...(q ? {
      OR: [
        { name: { contains: q, mode: "insensitive" as const } },
        { sku: { contains: q, mode: "insensitive" as const } },
        { barcode: { contains: q, mode: "insensitive" as const } },
      ],
    } : {}),
    ...(categoryId ? { categoryId } : {}),
    ...(unitId ? { unitId } : {}),
    ...(locationId ? { stock: { some: { locationId, quantity: { gt: 0 } } } } : {}),
  };

  const [products, total, categories, units, locations] = await Promise.all([
    prisma.product.findMany({
      where,
      orderBy: showInactive ? [{ isActive: "asc" }, { name: "asc" }] : [{ name: "asc" }],
      skip: (page - 1) * perPage,
      take: perPage,
      include: { category: true, unit: true, stock: { include: { location: true } } },
    }),
    prisma.product.count({ where }),
    prisma.category.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
    prisma.unit.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
    prisma.location.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
  ]);

  const pages = Math.ceil(total / perPage);
  const baseQs = `q=${q}&categoryId=${categoryId}&unitId=${unitId}&locationId=${locationId}&showInactive=${showInactive ? "1" : "0"}&lowStock=${lowStock ? "1" : "0"}`;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-5">
        <h1 className="text-base font-semibold text-slate-800">Products</h1>
        <div className="flex gap-2">
          <Link href="/products/import" className="text-xs px-3 py-2 border border-slate-300 rounded-lg text-slate-600 hover:bg-slate-50">
            ↑ Bulk Import
          </Link>
          <Link href="/products/add" className="bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold px-3 py-2 rounded-lg transition-colors">
            + Add Product
          </Link>
        </div>
      </div>

      <form method="GET" className="mb-4">
        <div className="grid grid-cols-2 sm:flex sm:flex-wrap gap-2 items-center">
          <select name="categoryId" defaultValue={categoryId}
            className="px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
            <option value="">All Categories</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <select name="unitId" defaultValue={unitId}
            className="px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
            <option value="">All Units</option>
            {units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
          <select name="locationId" defaultValue={locationId}
            className="px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
            <option value="">All Locations</option>
            {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
          <input name="q" defaultValue={q} placeholder="Search name, code, barcode…"
            className="col-span-2 sm:col-auto px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 sm:w-64" />
        </div>
        <div className="flex flex-wrap items-center gap-3 mt-2">
          <label className="flex items-center gap-1.5 text-sm text-slate-600 cursor-pointer select-none">
            <input key={`si-${showInactive}`} type="checkbox" name="showInactive" value="1" defaultChecked={showInactive}
              className="w-4 h-4 accent-blue-600" />
            Show inactive
          </label>
          <label className="flex items-center gap-1.5 text-sm text-slate-600 cursor-pointer select-none">
            <input key={`ls-${lowStock}`} type="checkbox" name="lowStock" value="1" defaultChecked={lowStock}
              className="w-4 h-4 accent-red-500" />
            <span className={lowStock ? "text-red-600 font-medium" : ""}>⚠ Low stock only</span>
          </label>
          <button type="submit" className="bg-blue-600 text-white text-sm px-4 py-2 rounded-lg hover:bg-blue-700">Search</button>
          {(q || categoryId || unitId || locationId || showInactive || lowStock) && (
            <Link href="/products" className="text-sm px-4 py-2 rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-50">Clear</Link>
          )}
        </div>
      </form>

      {/* Mobile card list */}
      <div className="md:hidden space-y-2">
        {products.length === 0 ? (
          <p className="text-center text-slate-400 text-xs py-10">
            No products found. <Link href="/products/add" className="text-blue-600 hover:underline">Add one?</Link>
          </p>
        ) : products.map((p) => {
          const visibleStock = locationId
            ? p.stock.filter((s) => s.locationId === locationId)
            : p.stock;
          const totalQty = visibleStock.reduce((s, st) => s + st.quantity, 0);
          const isLow = p.isActive && p.reorderPoint > 0 &&
            visibleStock.some((s) => s.quantity <= p.reorderPoint);
          return (
            <div key={p.id} className={`bg-white rounded-xl border px-4 py-3 ${!p.isActive ? "opacity-60 border-slate-200" : isLow ? "border-red-200 bg-red-50" : "border-slate-200"}`}>
              {/* Row 1: name + status */}
              <div className="flex items-start justify-between gap-2 mb-1">
                <div className="flex items-center gap-2 min-w-0">
                  {p.imageUrl && <ProductImageHover src={p.imageUrl} />}
                  <Link href={`/products/${p.id}`} className={`font-semibold text-sm leading-tight hover:underline ${!p.isActive ? "text-slate-400 line-through" : "text-slate-800"}`}>
                    {p.name}
                  </Link>
                </div>
                {!p.isActive ? (
                  <span className="flex-shrink-0 text-[10px] font-semibold bg-slate-100 text-slate-400 px-1.5 py-0.5 rounded-full uppercase tracking-wide">Inactive</span>
                ) : isLow ? (
                  <span className="flex-shrink-0 text-[10px] font-semibold bg-red-100 text-red-600 px-1.5 py-0.5 rounded-full uppercase tracking-wide">Low</span>
                ) : (
                  <span className="flex-shrink-0 text-[10px] font-semibold bg-green-100 text-green-700 px-1.5 py-0.5 rounded-full uppercase tracking-wide">OK</span>
                )}
              </div>
              {/* Row 2: SKU + category */}
              <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                <span className="font-mono text-xs text-blue-600">{p.sku}</span>
                {p.barcode && p.barcode !== p.sku && (
                  <span className="font-mono text-xs text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded">{p.barcode}</span>
                )}
                <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${!p.isActive ? "bg-slate-100 text-slate-400" : hashColor(p.category.name)}`}>
                  {p.category.name}
                </span>
              </div>
              {/* Row 3: stock */}
              <div className="flex items-baseline gap-1.5 mb-2">
                <span className={`font-semibold text-sm ${!p.isActive ? "text-slate-400" : isLow ? "text-red-600" : "text-slate-800"}`}>
                  {totalQty}
                </span>
                <span className="text-xs text-slate-500">{p.unit.name.toLowerCase()}</span>
                {visibleStock.filter((s) => s.quantity > 0).map((s) => {
                  const locLow = p.isActive && p.reorderPoint > 0 && s.quantity <= p.reorderPoint;
                  return (
                    <span key={s.id} className={`text-xs ${locLow ? "text-red-400" : "text-slate-400"}`}>
                      · {!locationId && `${s.location.name}: `}<span className="font-medium">{s.quantity}</span>
                    </span>
                  );
                })}
              </div>
              {/* Row 4: actions */}
              <div className="flex items-center gap-3 pt-2 border-t border-slate-100">
                <Link href={`/barcodes?productId=${p.id}`} className="text-xs text-violet-600 font-medium hover:underline">▣ Label</Link>
                <Link href={`/products/${p.id}/edit`} className="text-xs text-blue-600 font-medium hover:underline">Edit</Link>
                <ProductDeactivateButton productId={p.id} isActive={p.isActive} userRole={userRole} />
              </div>
            </div>
          );
        })}
      </div>

      {/* Desktop table */}
      <div className="hidden md:block bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500 border-b border-slate-200">
                <th className="px-4 py-2.5 text-left font-medium">Barcode</th>
                <th className="px-4 py-2.5 text-left font-medium">Code</th>
                <th className="px-4 py-2.5 text-left font-medium">Product Name</th>
                <th className="px-4 py-2.5 text-left font-medium">Category</th>
                <th className="px-4 py-2.5 text-left font-medium">Unit</th>
                <th className="px-4 py-2.5 text-left font-medium">Reorder Pt</th>
                <th className="px-4 py-2.5 text-right font-medium">Total Stock</th>
                <th className="px-4 py-2.5 text-left font-medium">Status</th>
                <th className="px-4 py-2.5 text-left font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {products.length === 0 ? (
                <tr><td colSpan={9} className="px-4 py-10 text-center text-slate-400 text-xs">
                  No products found. <Link href="/products/add" className="text-blue-600 hover:underline">Add one?</Link>
                </td></tr>
              ) : products.map((p) => {
                const visibleStock = locationId
                  ? p.stock.filter((s) => s.locationId === locationId)
                  : p.stock;
                const totalQty = visibleStock.reduce((s, st) => s + st.quantity, 0);
                const isLow = p.isActive && p.reorderPoint > 0 &&
                  visibleStock.some((s) => s.quantity <= p.reorderPoint);
                const rowBg = !p.isActive
                  ? "bg-slate-50 opacity-60"
                  : isLow
                  ? "bg-red-50 hover:bg-red-50"
                  : "hover:bg-slate-50";
                return (
                  <tr key={p.id} className={`border-t border-slate-100 ${rowBg}`}>
                    {/* Barcode */}
                    <td className="px-4 py-2.5">
                      <span className="font-mono text-xs text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded">{p.barcode}</span>
                    </td>
                    {/* Code / SKU */}
                    <td className="px-4 py-2.5">
                      <span className={`font-mono text-xs font-medium ${!p.isActive ? "text-slate-400" : "text-blue-600"}`}>{p.sku}</span>
                    </td>
                    {/* Product Name */}
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-3">
                        {p.imageUrl ? (
                          <ProductImageHover src={p.imageUrl} />
                        ) : (
                          <div className="w-8 h-8 rounded border border-dashed border-slate-200 bg-slate-50 flex-shrink-0" />
                        )}
                        <div className="min-w-0">
                          <div className={`font-medium flex items-center gap-2 ${!p.isActive ? "text-slate-400 line-through" : "text-slate-800"}`}>
                            <Link href={`/products/${p.id}`} className="hover:text-blue-600 hover:underline">{p.name}</Link>
                            {!p.isActive && (
                              <span className="no-underline text-[10px] font-semibold bg-slate-200 text-slate-500 px-1.5 py-0.5 rounded-full uppercase tracking-wide" style={{ textDecoration: "none" }}>
                                Inactive
                              </span>
                            )}
                          </div>
                          {p.colorVariant && <div className={`text-xs ${!p.isActive ? "text-slate-300" : "text-slate-400"}`}>{p.colorVariant}</div>}
                        </div>
                      </div>
                    </td>
                    {/* Category */}
                    <td className="px-4 py-2.5">
                      <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${!p.isActive ? "bg-slate-100 text-slate-400" : hashColor(p.category.name)}`}>
                        {p.category.name}
                      </span>
                    </td>
                    {/* Unit */}
                    <td className={`px-4 py-2.5 text-xs ${!p.isActive ? "text-slate-400" : "text-slate-600"}`}>{p.unit.name}</td>
                    {/* Reorder Pt */}
                    <td className={`px-4 py-2.5 text-xs ${!p.isActive ? "text-slate-400" : "text-slate-600"}`}>
                      {p.reorderPoint > 0 ? `${p.reorderPoint} ${p.unit.name.toLowerCase()}` : "—"}
                    </td>
                    {/* Total Stock */}
                    <td className="px-4 py-2.5 text-right">
                      <div className={`font-semibold text-sm ${!p.isActive ? "text-slate-400" : isLow ? "text-red-600" : "text-slate-800"}`}>
                        {totalQty} {p.unit.name.toLowerCase()}
                      </div>
                      {visibleStock.filter((s) => s.quantity > 0).map((s) => {
                        const locLow = p.isActive && p.reorderPoint > 0 && s.quantity <= p.reorderPoint;
                        return (
                          <div key={s.id} className={`text-xs mt-0.5 ${locLow ? "text-red-400" : "text-slate-400"}`}>
                            {!locationId && <span>{s.location.name}: </span>}
                            <span className="font-medium">{s.quantity}</span>
                          </div>
                        );
                      })}
                      {p.stock.every((s) => s.quantity === 0) && totalQty === 0 && (
                        <div className="text-xs text-slate-300 mt-0.5">no stock</div>
                      )}
                    </td>
                    {/* Status */}
                    <td className="px-4 py-2.5">
                      {!p.isActive ? (
                        <span className="inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-100 text-slate-400 uppercase tracking-wide">
                          Inactive
                        </span>
                      ) : isLow ? (
                        <span className="inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold bg-red-100 text-red-600 uppercase tracking-wide">
                          Low
                        </span>
                      ) : (
                        <span className="inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold bg-green-100 text-green-700 uppercase tracking-wide">
                          OK
                        </span>
                      )}
                    </td>
                    {/* Actions */}
                    <td className="px-4 py-2.5">
                      <div className="flex gap-3 items-center">
                        <Link href={`/barcodes?productId=${p.id}`} className="text-xs text-violet-600 hover:underline">▣ Label</Link>
                        <Link href={`/products/${p.id}/edit`} className="text-xs text-blue-600 hover:underline">Edit</Link>
                        <ProductDeactivateButton productId={p.id} isActive={p.isActive} userRole={userRole} />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {pages > 1 && (() => {
        const slots: (number | "…")[] = [];
        const near = new Set<number>([1, pages]);
        for (let i = Math.max(2, page - 2); i <= Math.min(pages - 1, page + 2); i++) near.add(i);
        let prev = 0;
        for (const n of [...near].sort((a, b) => a - b)) {
          if (n - prev > 1) slots.push("…");
          slots.push(n);
          prev = n;
        }
        return (
          <div className="flex items-center gap-1 justify-center mt-5">
            <Link href={`/products?${baseQs}&page=${page - 1}`}
              className={`px-3 py-1.5 rounded-lg text-xs border transition-colors ${page === 1 ? "pointer-events-none opacity-30 border-slate-200 text-slate-400" : "border-slate-300 text-slate-600 hover:bg-slate-50"}`}>
              ← Prev
            </Link>
            {slots.map((s, i) =>
              s === "…" ? (
                <span key={`e${i}`} className="px-2 text-xs text-slate-400">…</span>
              ) : (
                <Link key={s} href={`/products?${baseQs}&page=${s}`}
                  className={`min-w-[32px] text-center px-2 py-1.5 rounded-lg text-xs border transition-colors ${s === page ? "bg-blue-600 text-white border-blue-600" : "border-slate-300 text-slate-600 hover:bg-slate-50"}`}>
                  {s}
                </Link>
              )
            )}
            <Link href={`/products?${baseQs}&page=${page + 1}`}
              className={`px-3 py-1.5 rounded-lg text-xs border transition-colors ${page === pages ? "pointer-events-none opacity-30 border-slate-200 text-slate-400" : "border-slate-300 text-slate-600 hover:bg-slate-50"}`}>
              Next →
            </Link>
          </div>
        );
      })()}
      <p className="text-xs text-slate-400 mt-3 text-right">
        {(page - 1) * perPage + 1}–{Math.min(page * perPage, total)} of {total} product{total !== 1 ? "s" : ""}
      </p>
    </div>
  );
}
