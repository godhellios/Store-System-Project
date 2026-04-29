import { prisma } from "@/lib/prisma";
import Link from "next/link";
import { blockOperator } from "@/lib/role-guard";
import { LocationStockTable } from "@/components/location-stock-table";

export default async function WarehousePage({
  searchParams,
}: {
  searchParams: Promise<{ locationId?: string }>;
}) {
  await blockOperator();
  const { locationId } = await searchParams;

  const [locations, categories] = await Promise.all([
    prisma.location.findMany({
      orderBy: { name: "asc" },
      include: {
        _count: { select: { stock: true } },
        stock: { select: { quantity: true } },
      },
    }),
    prisma.category.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
  ]);

  const stock = locationId
    ? await prisma.stock.findMany({
        where: { locationId },
        include: { product: { include: { category: true, unit: true } } },
        orderBy: { product: { name: "asc" } },
      })
    : [];

  const selectedLocation = locations.find((l) => l.id === locationId) ?? null;

  return (
    <div>
      <h1 className="text-base font-semibold text-slate-800 mb-5">Warehouse Locations</h1>

      {/* Location cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mb-6">
        {locations.map((loc) => {
          const totalQty = loc.stock.reduce((s, r) => s + r.quantity, 0);
          const isSelected = loc.id === locationId;
          return (
            <Link
              key={loc.id}
              href={`/warehouse?locationId=${loc.id}`}
              className={[
                "rounded-xl border p-4 transition-all",
                !loc.isActive ? "opacity-50" : "",
                isSelected
                  ? "border-blue-500 bg-blue-50 shadow-sm"
                  : "border-slate-200 bg-white hover:border-blue-300 hover:shadow-sm",
              ].join(" ")}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className={`font-semibold text-sm truncate ${isSelected ? "text-blue-700" : "text-slate-800"}`}>
                    {loc.name}
                  </div>
                  <div className="text-xs text-slate-400 mt-0.5">{loc.type}</div>
                </div>
                {!loc.isActive && (
                  <span className="flex-shrink-0 text-[9px] font-semibold bg-slate-200 text-slate-400 px-1.5 py-0.5 rounded-full uppercase tracking-wide">
                    Inactive
                  </span>
                )}
              </div>
              <div className="mt-3 flex items-end gap-4">
                <div>
                  <div className={`text-2xl font-bold ${isSelected ? "text-blue-600" : "text-slate-700"}`}>
                    {loc._count.stock}
                  </div>
                  <div className="text-[10px] text-slate-400 uppercase tracking-wide">products</div>
                </div>
                <div>
                  <div className={`text-2xl font-bold ${isSelected ? "text-blue-600" : "text-slate-700"}`}>
                    {totalQty}
                  </div>
                  <div className="text-[10px] text-slate-400 uppercase tracking-wide">units total</div>
                </div>
              </div>
            </Link>
          );
        })}
      </div>

      {/* Stock table for selected location */}
      {selectedLocation ? (
        <div>
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-sm font-semibold text-slate-800">{selectedLocation.name}</h2>
              <p className="text-xs text-slate-400 mt-0.5">{selectedLocation.type}</p>
            </div>
            <Link href="/warehouse" className="text-xs text-slate-400 hover:text-slate-600 hover:underline">
              ✕ Deselect
            </Link>
          </div>
          <LocationStockTable stock={stock} categories={categories} />
        </div>
      ) : (
        <p className="text-sm text-slate-400 text-center py-10">
          Select a location above to view its inventory.
        </p>
      )}
    </div>
  );
}
