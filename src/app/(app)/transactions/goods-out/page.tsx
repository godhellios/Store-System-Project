import { prisma } from "@/lib/prisma";
import { TransactionForm } from "@/components/transaction-form";

export default async function GoodsOutPage() {
  const [locations, waSetting] = await Promise.all([
    prisma.location.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
    prisma.systemSetting.findUnique({ where: { key: "whatsapp_number" } }),
  ]);
  return (
    <div>
      <h1 className="text-base font-semibold text-slate-800 mb-5">Goods Out</h1>
      <TransactionForm
        type="GOODS_OUT"
        locations={locations}
        whatsappNumber={waSetting?.value ?? "6281283118487"}
      />
    </div>
  );
}
