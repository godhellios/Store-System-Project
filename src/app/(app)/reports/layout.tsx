import { requireReportAccess } from "@/lib/role-guard";

export default async function ReportsLayout({ children }: { children: React.ReactNode }) {
  await requireReportAccess();
  return <>{children}</>;
}
