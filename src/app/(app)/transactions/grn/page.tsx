import { prisma } from "@/lib/prisma";
import { TransactionForm } from "@/components/transaction-form";

export default async function GrnPage() {
  const locations = await prisma.location.findMany({ where: { isActive: true }, orderBy: { name: "asc" } });
  return (
    <div>
      <h1 className="text-base font-semibold text-slate-800 mb-5">Goods Received (GRN)</h1>
      <TransactionForm type="GRN" locations={locations} />
    </div>
  );
}
