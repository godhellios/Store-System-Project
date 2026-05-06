import en from "./translations/en.json";
import id from "./translations/id.json";

export type Locale = "en" | "id";
export type TFunction = (key: string, fallback: string) => string;

export function getTranslations(locale: Locale): Record<string, unknown> {
  return (locale === "id" ? id : en) as Record<string, unknown>;
}

export function lookup(obj: Record<string, unknown>, key: string, fallback: string): string {
  const parts = key.split(".");
  let current: unknown = obj;
  for (const part of parts) {
    if (current == null || typeof current !== "object") return fallback;
    current = (current as Record<string, unknown>)[part];
  }
  return typeof current === "string" ? current : fallback;
}
