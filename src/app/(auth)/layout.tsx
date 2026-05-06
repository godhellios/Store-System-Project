import { cookies } from "next/headers";
import { I18nProvider } from "@/modules/i18n/provider";
import type { Locale } from "@/modules/i18n/_shared";

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies();
  const locale = (cookieStore.get("locale")?.value ?? "en") as Locale;
  return <I18nProvider locale={locale}>{children}</I18nProvider>;
}
