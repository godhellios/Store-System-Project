import Link from "next/link";
import { PendingOrdersList } from "@/components/pending-orders-list";

export default function OrdersPendingPage() {
  return (
    <div>
      <div className="flex items-center gap-2 mb-5">
        <Link href="/orders" className="text-xs text-slate-500 hover:underline">← Orders</Link>
        <h1 className="text-base font-semibold text-slate-800">Pending Approval</h1>
      </div>
      <PendingOrdersList />
    </div>
  );
}
