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
  searchParams: Promise<{ q?: string; categoryId?: string; locationId?: string; page?: string; showInactive?: string; lowStock?: string }>;
}) {
  await blockOperator();
  const params = await searchParams;
  const q = params.q ?? "";
  const categoryId = params.categoryId ?? "";
  const locationId = params.locationId ?? "";
  const page = Math.max(1, parseInt(params.page ?? "1"));
  const showInactive = params.showInactive === "1";
  const lowStock = params.lowStock === "1";
  const perPage = 20;

  // Find product IDs where at least one location is at or below reorder point
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
    ...(locationId ? { stock: { some: { locationId, quantity: { gt: 0 } } } } : {}),
  };

  const [products, total, categories, locations] = await Promise.all([
    prisma.product.findMany({
      where,
      orderBy: [{ isActive: "desc" }, { name: "asc" }],
      skip: (page - 1) * perPage,
      take: perPage,
      include: { category: true, unit: true, stock: { include: { location: true } } },
    }),
    prisma.product.count({ where }),
    prisma.category.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
    prisma.location.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
  ]);

  const pages = Math.ceil(total / perPage);
  const baseQs = `q=${q}&categoryId=${categoryId}&locationId=${locationId}&showInactive=${showInactive ? "1" : "0"}&lowStock=${lowStock ? "1" : "0"}`;

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

      <form method="GET" className="flex gap-2 mb-4 flex-wrap items-center">
        <input name="q" defaultValue={q} placeholder="Search name, SKU or barcode…"
          className="px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 w-full sm:w-64" />
        <select name="categoryId" defaultValue={categoryId}
          className="px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
          <option value="">All Categories</option>
          {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select name="locationId" defaultValue={locationId}
          className="px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
          <option value="">All Locations</option>
          {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
        <label className="flex items-center gap-1.5 text-sm text-slate-600 cursor-pointer select-none">
          <input type="checkbox" name="showInactive" value="1" defaultChecked={showInactive}
            className="w-4 h-4 accent-blue-600" />
          Show inactive
        </label>
        <label className="flex items-center gap-1.5 text-sm text-slate-600 cursor-pointer select-none">
          <input type="checkbox" name="lowStock" value="1" defaultChecked={lowStock}
            className="w-4 h-4 accent-red-500" />
          <span className={lowStock ? "text-red-600 font-medium" : ""}>⚠ Low stock only</span>
        </label>
        <button type="submit" className="bg-blue-600 text-white text-sm px-4 py-2 rounded-lg hover:bg-blue-700">Search</button>
        {(q || categoryId || locationId || showInactive || lowStock) && (
          <Link href="/products" className="text-sm px-4 py-2 rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-50">Clear</Link>
        )}
      </form>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500 border-b border-slate-200">
              <th className="px-4 py-2.5 text-left font-medium">Product</th>
              <th className="px-4 py-2.5 text-left font-medium">SKU / Barcode</th>
              <th className="px-4 py-2.5 text-left font-medium">Category</th>
              <th className="px-4 py-2.5 text-left font-medium">Unit</th>
              <th className="px-4 py-2.5 text-right font-medium">Total Stock</th>
              <th className="px-4 py-2.5 text-left font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {products.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-10 text-center text-slate-400 text-xs">
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
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-3">
                      {p.imageUrl ? (
                        <ProductImageHover src={p.imageUrl} />
                      ) : (
                        <div className="w-9 h-9 rounded border border-dashed border-slate-200 bg-slate-50 flex-shrink-0" />
                      )}
                    <div className="min-w-0">
                    <div className={`font-medium flex items-center gap-2 ${!p.isActive ? "text-slate-400 line-through" : "text-slate-800"}`}>
                      {p.name}
                      {!p.isActive && (
                        <span className="no-underline not-italic line-through-none text-[10px] font-semibold bg-slate-200 text-slate-500 px-1.5 py-0.5 rounded-full uppercase tracking-wide" style={{ textDecoration: "none" }}>
                          Inactive
                        </span>
                      )}
                    </div>
                      {p.colorVariant && <div className={`text-xs ${!p.isActive ? "text-slate-300" : "text-slate-400"}`}>{p.colorVariant}</div>}
                    </div>
                    </div>
                  </td>
                  <td className="px-4 py-2.5">
                    <div className={`font-mono text-xs ${!p.isActive ? "text-slate-400" : "text-blue-600"}`}>{p.sku}</div>
                    <div className="font-mono text-xs text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded mt-0.5 inline-block">{p.barcode}</div>
                  </td>
                  <td className="px-4 py-2.5">
                    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${!p.isActive ? "bg-slate-100 text-slate-400" : hashColor(p.category.name)}`}>
                      {p.category.name}
                    </span>
                  </td>
                  <td className={`px-4 py-2.5 text-xs ${!p.isActive ? "text-slate-400" : "text-slate-600"}`}>{p.unit.name}</td>
                  <td className="px-4 py-2.5 text-right">
                    <div className={`font-semibold ${!p.isActive ? "text-slate-400" : isLow ? "text-red-600" : "text-slate-800"}`}>
                      {totalQty}{isLow ? " ⚠" : ""}
                      {isLow && <span className="block text-xs font-normal text-red-400">reorder: {p.reorderPoint}</span>}
                    </div>
                    {visibleStock.filter((s) => s.quantity > 0).map((s) => {
                      const locLow = p.isActive && p.reorderPoint > 0 && s.quantity <= p.reorderPoint;
                      return (
                        <div key={s.id} className={`text-xs mt-0.5 ${locLow ? "text-red-500" : "text-slate-400"}`}>
                          {!locationId && <span>{s.location.name}: </span>}
                          <span className="font-medium">{s.quantity}</span>
                          {locLow && <span className="ml-1">⚠</span>}
                        </div>
                      );
                    })}
                    {p.stock.every((s) => s.quantity === 0) && totalQty === 0 && (
                      <div className="text-xs text-slate-300 mt-0.5">no stock</div>
                    )}
                  </td>
                  <td className="px-4 py-2.5 flex gap-3 items-center">
                    {p.isActive && (
                      <Link href={`/barcodes?productId=${p.id}`} className="text-xs text-slate-500 hover:underline">Label</Link>
                    )}
                    <Link href={`/products/${p.id}/edit`} className="text-xs text-blue-600 hover:underline">Edit</Link>
                    <ProductDeactivateButton productId={p.id} isActive={p.isActive} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        </div>
      </div>

      {pages > 1 && (
        <div className="flex gap-2 justify-center mt-4">
          {Array.from({ length: pages }, (_, i) => i + 1).map((p) => (
            <Link key={p} href={`/products?${baseQs}&page=${p}`}
              className={`px-3 py-1 rounded text-xs ${p === page ? "bg-blue-600 text-white" : "border border-slate-300 text-slate-600 hover:bg-slate-50"}`}>
              {p}
            </Link>
          ))}
        </div>
      )}
      <p className="text-xs text-slate-400 mt-3 text-right">{total} product{total !== 1 ? "s" : ""} total</p>
    </div>
  );
}
