import { requireAdmin } from "@/lib/role-guard";

export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  await requireAdmin();
  return <>{children}</>;
}
