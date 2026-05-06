import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { AppShell } from "@/components/app-shell";
import { I18nProvider } from "@/modules/i18n/provider";
import type { Locale } from "@/modules/i18n/_shared";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login");

  // For non-admins, verify the session ID in the JWT still matches the DB.
  // If another browser/device has logged in since, activeSessionId will differ → kick out.
  if (session.user?.role !== "ADMIN" && session.user?.sessionId) {
    const dbUser = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { activeSessionId: true },
    });
    if (dbUser?.activeSessionId !== session.user.sessionId) {
      redirect("/login?reason=displaced");
    }
  }

  const cookieStore = await cookies();
  const locale = (cookieStore.get("locale")?.value ?? "en") as Locale;

  return (
    <I18nProvider locale={locale}>
      <AppShell userName={session.user?.name ?? ""} userRole={session.user?.role ?? "STAFF"} loginAt={session.user?.loginAt}>
        {children}
      </AppShell>
    </I18nProvider>
  );
}
