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

export type DateAllowedResult =
  | { ok: true }
  | { ok: false; reason: "future" | "before_opname" };

/**
 * Hard rules for setting a transaction's effective (business) date:
 * - it cannot be in the future, and
 * - it cannot be earlier than `floor` — the most recent APPROVED opname for the
 *   transaction's location(s). `floor === null` means no approved count exists,
 *   so any past date is allowed.
 */
export function isDateAllowed(proposed: Date, floor: Date | null, now: Date): DateAllowedResult {
  if (proposed.getTime() > now.getTime()) return { ok: false, reason: "future" };
  if (floor !== null && proposed.getTime() < floor.getTime()) return { ok: false, reason: "before_opname" };
  return { ok: true };
}

/**
 * Soft guard (UI confirmation only, not a hard block): true when `proposed` is
 * more than `capDays` whole days before `now`. Exactly `capDays` does not warn.
 */
export function exceedsSoftCap(proposed: Date, now: Date, capDays = 90): boolean {
  const diffDays = Math.floor((now.getTime() - proposed.getTime()) / 86_400_000);
  return diffDays > capDays;
}
