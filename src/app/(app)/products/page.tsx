import { prisma } from "@/lib/prisma";
import Link from "next/link";
import { blockOperator } from "@/lib/role-guard";
import { ProductsBulkPanel } from "@/components/products-bulk-panel";

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

      <ProductsBulkPanel products={products} userRole={userRole} locationId={locationId} />

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
