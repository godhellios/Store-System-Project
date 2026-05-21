import { prisma } from "@/lib/prisma";
import { TransactionForm } from "@/components/transaction-form";
import { blockViewer } from "@/lib/role-guard";
import { getT } from "@/modules/i18n";

export default async function TransferPage() {
  await blockViewer();
  const [locations, t] = await Promise.all([
    prisma.location.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
    getT(),
  ]);
  return (
    <div>
      <h1 className="text-base font-semibold text-slate-800 mb-5">{t("transactions.transfer", "Stock Transfer")}</h1>
      <TransactionForm type="TRANSFER" locations={locations.map((l) => ({ id: l.id, name: l.name, type: l.type }))} />
    </div>
  );
}
