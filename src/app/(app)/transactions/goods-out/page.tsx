import { prisma } from "@/lib/prisma";
import { TransactionForm } from "@/components/transaction-form";
import { getT } from "@/modules/i18n";

export default async function GoodsOutPage() {
  const [locations, waSetting, t] = await Promise.all([
    prisma.location.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
    prisma.systemSetting.findUnique({ where: { key: "whatsapp_number" } }),
    getT(),
  ]);
  return (
    <div>
      <h1 className="text-base font-semibold text-slate-800 mb-5">{t("transactions.goodsOut", "Goods Out")}</h1>
      <TransactionForm
        type="GOODS_OUT"
        locations={locations.map((l) => ({ id: l.id, name: l.name, type: l.type }))}
        whatsappNumber={waSetting?.value ?? "6281283118487"}
      />
    </div>
  );
}
