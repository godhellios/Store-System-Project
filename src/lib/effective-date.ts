// Pure helper for the "effective date" (a.k.a. business date — when a transaction
// actually happened, as opposed to `createdAt` = when it was typed in).
//
// `effectiveDate` is nullable: it is populated on records created from the date
// feature onward, while older rows stay null. Any consumer (reports, cost replay)
// must treat a null effective date as "same as createdAt" — that fallback rule
// lives here so every caller agrees on it.

/** Return the effective date if set, otherwise fall back to createdAt. */
export function resolveEffectiveDate(
  effectiveDate: Date | null | undefined,
  createdAt: Date,
): Date {
  return effectiveDate ?? createdAt;
}
