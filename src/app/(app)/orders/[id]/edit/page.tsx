import { prisma } from "@/lib/prisma";
import { notFound, redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import Link from "next/link";
import { OrderEditForm } from "@/components/order-edit-form";

const TYPE_LABEL: Record<string, string> = {
  GRN: "GRN", GOODS_OUT: "Goods Out", TRANSFER: "Transfer", ADJUSTMENT: "Adjustment",
};

export default async function OrderEditPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login");
  if (!["ADMIN", "STAFF"].includes(session.user.role)) redirect("/orders");

  const { id } = await params;
  const order = await prisma.order.findUnique({
    where: { id },
    include: { lines: { include: { product: true } } },
  });
  if (!order) notFound();

  return (
    <div className="max-w-2xl">
      <div className="flex items-center gap-2 text-sm text-slate-500 mb-5">
        <Link href="/orders" className="hover:text-slate-800">Orders</Link>
        <span>/</span>
        <Link href={`/orders/${id}`} className="hover:text-slate-800 font-mono">{order.orderNumber}</Link>
        <span>/</span>
        <span className="text-slate-800 font-medium">Edit</span>
      </div>

      <div className="flex items-center gap-3 mb-4">
        <h1 className="text-base font-semibold text-slate-800 font-mono">{order.orderNumber}</h1>
        <span className="text-xs text-slate-500">{TYPE_LABEL[order.type]}</span>
      </div>

      <p className="text-xs text-slate-400 mb-4">
        Only reference, notes, and line notes can be edited. To correct quantities, delete and re-create the order.
      </p>

      <OrderEditForm order={order} />
    </div>
  );
}
