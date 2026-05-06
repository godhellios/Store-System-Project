import { prisma } from "@/lib/prisma";
import { TransactionForm } from "@/components/transaction-form";
import { getT } from "@/modules/i18n";

export default async function GrnPage() {
  const [locations, t] = await Promise.all([
    prisma.location.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
    getT(),
  ]);
  return (
    <div>
      <h1 className="text-base font-semibold text-slate-800 mb-5">{t("transactions.grn", "Goods Received (GRN)")}</h1>
      <TransactionForm type="GRN" locations={locations} />
    </div>
  );
}
