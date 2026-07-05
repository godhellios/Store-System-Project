// Pure logic for category-scoped opname (physical count). An open count freezes
// only the categories it covers; an empty category set means a whole-warehouse
// count (today's behaviour) which freezes everything at that location.
//
// The route handlers (POST /api/opname, orders/route.ts) pre-filter open sessions
// to the relevant location(s) and pass their category sets here — this module is
// side-effect free so it is unit-testable in isolation.

export type OpenSession = {
  id: string;
  sessionNumber: string;
  locationId: string;
  categoryIds: string[]; // empty = whole-warehouse count
};

/**
 * Given the open counts at the affected location(s) and the categories of the
 * products in an incoming transaction, return the count that blocks it (with the
 * offending category, or null for a whole-warehouse count) — or null if allowed.
 */
export function transactionBlockedBy(
  openSessions: OpenSession[],
  txProductCategoryIds: string[]
): { session: OpenSession; categoryId: string | null } | null {
  for (const s of openSessions) {
    if (s.categoryIds.length === 0) return { session: s, categoryId: null }; // whole-warehouse blocks all
    const hit = txProductCategoryIds.find((c) => s.categoryIds.includes(c));
    if (hit) return { session: s, categoryId: hit };
  }
  return null;
}

/**
 * Whether a new count (newCategoryIds; empty = whole-warehouse) would overlap any
 * already-open count at the same location — returns the conflicting session or null.
 * Either side being whole-warehouse counts as overlap.
 */
export function overlapsExistingCount(
  openSessionsAtLocation: OpenSession[],
  newCategoryIds: string[]
): OpenSession | null {
  for (const s of openSessionsAtLocation) {
    if (newCategoryIds.length === 0) return s; // new whole-warehouse overlaps anything open
    if (s.categoryIds.length === 0) return s; // existing whole-warehouse overlaps anything
    if (s.categoryIds.some((c) => newCategoryIds.includes(c))) return s; // shared category
  }
  return null;
}
