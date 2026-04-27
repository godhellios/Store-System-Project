import { prisma } from "@/lib/prisma";
import { notFound, redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import Link from "next/link";
import { OrderEditForm } from "@/components/order-edit-form";

const TYPE_LABEL: Record<string, string> = {
  GRN: "GRN", GOODS_OUT: "Goods Out", TRANSFER: "Transfer", ADJUSTMENT: "Adjustment",
};
const TYPE_BADGE: Record<string, string> = {
  GRN: "bg-green-100 text-green-700", GOODS_OUT: "bg-orange-100 text-orange-700",
  TRANSFER: "bg-blue-100 text-blue-700", ADJUSTMENT: "bg-gray-100 text-gray-600",
};

export default async function OrderEditPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login");
  if (!["ADMIN", "STAFF"].includes(session.user.role)) redirect("/orders");

  const { id } = await params;
  const order = await prisma.order.findUnique({
    where: { id },
    include: {
      fromLocation: true,
      toLocation: true,
      lines: {
        include: {
          product: { include: { unit: true, unitConversions: true } },
        },
        orderBy: { id: "asc" },
      },
    },
  });
  if (!order) notFound();

  return (
    <div className="max-w-3xl">
      <div className="flex items-center gap-2 text-sm text-slate-500 mb-5">
        <Link href="/orders" className="hover:text-slate-800">Orders</Link>
        <span>/</span>
        <Link href={`/orders/${id}`} className="hover:text-slate-800 font-mono">{order.orderNumber}</Link>
        <span>/</span>
        <span className="text-slate-800 font-medium">Edit</span>
      </div>

      <div className="flex items-center gap-3 mb-5">
        <h1 className="text-base font-semibold text-slate-800 font-mono">{order.orderNumber}</h1>
        <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${TYPE_BADGE[order.type]}`}>
          {TYPE_LABEL[order.type]}
        </span>
        {order.fromLocation && (
          <span className="text-xs text-slate-500">from <span className="font-medium text-slate-700">{order.fromLocation.name}</span></span>
        )}
        {order.toLocation && (
          <span className="text-xs text-slate-500">to <span className="font-medium text-slate-700">{order.toLocation.name}</span></span>
        )}
      </div>

      <OrderEditForm order={order} />
    </div>
  );
}
