// Pure logic for saving opname physical counts.
//
// A session can now hold a line for every active product (1000+), so a save
// must (a) only write lines that actually changed — updating all of them per
// save times out — and (b) treat a blank box as "not counted" (physicalQty
// null, difference null), NOT a physical zero. Recording an uncounted product
// as 0 would show a large negative difference and wipe its stock on approval.

export type ExistingLine = {
  id: string;
  physicalQty: number | null;
  staffConfirmed: boolean;
  bookQty: number;
};

export type IncomingCount = {
  id: string;
  physicalQty: number | null;
  staffConfirmed?: boolean;
};

export type CountUpdate = {
  id: string;
  physicalQty: number | null;
  difference: number | null;
  staffConfirmed: boolean;
};

/**
 * The minimal set of line updates for a count save: only lines whose count or
 * confirmed-flag changed. `physicalQty === null` (blank / uncounted) yields
 * `difference === null`, which the approval step ignores.
 */
export function diffCountUpdates(existing: ExistingLine[], incoming: IncomingCount[]): CountUpdate[] {
  const byId = new Map(existing.map((e) => [e.id, e]));
  const out: CountUpdate[] = [];
  for (const inc of incoming) {
    const ex = byId.get(inc.id);
    if (!ex) continue; // ignore ids not on this session
    const phys = inc.physicalQty ?? null;
    const sc = inc.staffConfirmed ?? false;
    if (ex.physicalQty === phys && ex.staffConfirmed === sc) continue; // unchanged → skip
    out.push({
      id: inc.id,
      physicalQty: phys,
      difference: phys === null ? null : phys - ex.bookQty,
      staffConfirmed: sc,
    });
  }
  return out;
}
