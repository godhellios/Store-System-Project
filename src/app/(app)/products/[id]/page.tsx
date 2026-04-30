import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import { blockOperator } from "@/lib/role-guard";
import Link from "next/link";

const TYPE_COLOR: Record<string, string> = {
  GRN:        "bg-green-100 text-green-700",
  GOODS_OUT:  "bg-orange-100 text-orange-700",
  TRANSFER:   "bg-blue-100 text-blue-700",
  ADJUSTMENT: "bg-slate-100 text-slate-600",
};
const TYPE_LABEL: Record<string, string> = {
  GRN: "GRN", GOODS_OUT: "Goods Out", TRANSFER: "Transfer", ADJUSTMENT: "Adjustment",
};
const MOVEMENT_SIGN: Record<string, string> = {
  IN: "+", OUT: "−", TRANSFER: "⇄", ADJUSTMENT: "±",
};
const MOVEMENT_COLOR: Record<string, string> = {
  IN: "text-green-600", OUT: "text-red-500", TRANSFER: "text-blue-600", ADJUSTMENT: "text-slate-500",
};

export default async function ProductDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  await blockOperator();
  const { id } = await params;
  const { page: pageParam } = await searchParams;
  const page = Math.max(1, parseInt(pageParam ?? "1"));
  const perPage = 30;

  const [product, movements, total] = await Promise.all([
    prisma.product.findUnique({
      where: { id },
      include: {
        category: true,
        unit: true,
        stock: { include: { location: true }, orderBy: { location: { name: "asc" } } },
      },
    }),
    prisma.movement.findMany({
      where: { productId: id },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * perPage,
      take: perPage,
      include: {
        order: true,
        fromLocation: true,
        toLocation: true,
      },
    }),
    prisma.movement.count({ where: { productId: id } }),
  ]);

  if (!product) notFound();

  const pages = Math.ceil(total / perPage);
  const totalStock = product.stock.reduce((s, st) => s + st.quantity, 0);

  return (
    <div className="max-w-4xl">
      {/* Back + actions */}
      <div className="flex flex-wrap items-center justify-between gap-2 mb-5">
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <Link href="/products" className="hover:text-slate-800">Products</Link>
          <span>/</span>
          <span className="text-slate-800 font-medium truncate">{product.name}</span>
        </div>
        <div className="flex gap-2">
          <Link
            href={`/products/${id}/edit`}
            className="text-xs px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg transition-colors"
          >
            Edit
          </Link>
        </div>
      </div>

      {/* Product info card */}
      <div className="bg-white rounded-xl border border-slate-200 p-5 mb-5">
        <div className="flex flex-col sm:flex-row gap-5">
          {/* Image */}
          <div className="flex-shrink-0">
            {product.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={product.imageUrl}
                alt={product.name}
                className="w-24 h-24 rounded-lg object-cover border border-slate-200"
              />
            ) : (
              <div className="w-24 h-24 rounded-lg border-2 border-dashed border-slate-200 bg-slate-50 flex items-center justify-center text-slate-300 text-xs text-center">
                No image
              </div>
            )}
          </div>

          {/* Info */}
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-start gap-2 mb-1">
              <h1 className="text-lg font-bold text-slate-800">{product.name}</h1>
              {!product.isActive && (
                <span className="text-[10px] font-semibold bg-slate-200 text-slate-500 px-2 py-0.5 rounded-full uppercase tracking-wide">
                  Inactive
                </span>
              )}
            </div>
            {product.colorVariant && (
              <p className="text-sm text-slate-500 mb-2">{product.colorVariant}</p>
            )}

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-2 text-sm mt-3">
              <div>
                <span className="text-xs text-slate-400 block">SKU</span>
                <span className="font-mono font-medium text-blue-600">{product.sku}</span>
              </div>
              <div>
                <span className="text-xs text-slate-400 block">Barcode</span>
                <span className="font-mono text-slate-700 bg-slate-100 px-1.5 py-0.5 rounded text-xs">{product.barcode}</span>
              </div>
              <div>
                <span className="text-xs text-slate-400 block">Category</span>
                <span className="text-slate-700">{product.category.name}</span>
              </div>
              <div>
                <span className="text-xs text-slate-400 block">Unit</span>
                <span className="text-slate-700">{product.unit.name}</span>
              </div>
              <div>
                <span className="text-xs text-slate-400 block">Reorder Point</span>
                <span className="text-slate-700">{product.reorderPoint}</span>
              </div>
              {product.description && (
                <div className="col-span-2 sm:col-span-3">
                  <span className="text-xs text-slate-400 block">Description</span>
                  <span className="text-slate-700">{product.description}</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Stock by location */}
      <h2 className="text-sm font-semibold text-slate-700 mb-2">Current Stock</h2>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
        {product.stock.length === 0 ? (
          <p className="col-span-3 text-xs text-slate-400">No stock records yet.</p>
        ) : product.stock.map((s) => {
          const isLow = product.isActive && product.reorderPoint > 0 && s.quantity <= product.reorderPoint;
          return (
            <div
              key={s.id}
              className={`bg-white dark:bg-slate-800 rounded-xl border p-4 flex items-center justify-between ${isLow ? "border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/40" : "border-slate-200 dark:border-slate-700"}`}
            >
              <div>
                <div className="text-xs text-slate-500">{s.location.name}</div>
                <div className="text-xs text-slate-400">{s.location.type}</div>
              </div>
              <div className="text-right">
                <div className={`text-xl font-bold ${isLow ? "text-red-600 dark:text-red-400" : "text-slate-800 dark:text-slate-100"}`}>
                  {s.quantity}
                </div>
                <div className="text-xs text-slate-400">{product.unit.name.toLowerCase()}</div>
                {isLow && <div className="text-[10px] text-red-400 font-medium">⚠ Low stock</div>}
              </div>
            </div>
          );
        })}
        <div className="bg-slate-800 rounded-xl p-4 flex items-center justify-between">
          <div className="text-xs text-slate-300">Total (all locations)</div>
          <div className="text-right">
            <div className="text-xl font-bold text-white">{totalStock}</div>
            <div className="text-xs text-slate-400">{product.unit.name.toLowerCase()}</div>
          </div>
        </div>
      </div>

      {/* Movement history */}
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-sm font-semibold text-slate-700">Movement History</h2>
        <span className="text-xs text-slate-400">{total} record{total !== 1 ? "s" : ""}</span>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden mb-4">
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500 border-b border-slate-200">
                <th className="px-4 py-2.5 text-left font-medium">Date</th>
                <th className="px-4 py-2.5 text-left font-medium">Order</th>
                <th className="px-4 py-2.5 text-left font-medium">Type</th>
                <th className="px-4 py-2.5 text-left font-medium">Location</th>
                <th className="px-4 py-2.5 text-right font-medium">Qty</th>
              </tr>
            </thead>
            <tbody>
              {movements.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center text-slate-400 text-xs">
                    No movements recorded yet.
                  </td>
                </tr>
              ) : movements.map((m) => {
                const locationLabel = m.type === "TRANSFER"
                  ? `${m.fromLocation?.name ?? "?"} → ${m.toLocation?.name ?? "?"}`
                  : m.type === "IN" || m.order.type === "GRN"
                  ? m.toLocation?.name ?? "—"
                  : m.fromLocation?.name ?? "—";

                return (
                  <tr key={m.id} className="border-t border-slate-100 hover:bg-slate-50">
                    <td className="px-4 py-2.5 text-xs text-slate-500 whitespace-nowrap">
                      {new Date(m.createdAt).toLocaleString("id-ID", {
                        day: "numeric", month: "short", year: "numeric",
                        hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jakarta",
                      })}
                    </td>
                    <td className="px-4 py-2.5">
                      <Link
                        href={`/orders/${m.orderId}`}
                        className="font-mono text-xs font-semibold text-blue-600 hover:underline"
                      >
                        {m.order.orderNumber}
                      </Link>
                    </td>
                    <td className="px-4 py-2.5">
                      <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${TYPE_COLOR[m.order.type]}`}>
                        {TYPE_LABEL[m.order.type]}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-xs text-slate-600">{locationLabel}</td>
                    <td className="px-4 py-2.5 text-right">
                      <span className={`font-semibold text-sm ${MOVEMENT_COLOR[m.type]}`}>
                        {MOVEMENT_SIGN[m.type]}{m.quantity}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pagination */}
      {pages > 1 && (
        <div className="flex gap-2 justify-center">
          {Array.from({ length: pages }, (_, i) => i + 1).map((p) => (
            <Link
              key={p}
              href={`/products/${id}?page=${p}`}
              className={`px-3 py-1 rounded text-xs ${p === page ? "bg-blue-600 text-white" : "border border-slate-300 text-slate-600 hover:bg-slate-50"}`}
            >
              {p}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
