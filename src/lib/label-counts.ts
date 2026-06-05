// Pure helper for "re-label by quantity" barcode printing.
//
// Each physical box carries TWO stickers: a box barcode and a pcs barcode. A
// loose remainder that doesn't fill a box still gets its own pcs sticker. So
// for a quantity in base units and a box size (conversion factor):
//   boxLabels = number of FULL boxes              (floor)
//   pcsLabels = one per box, plus one for leftover (ceil)
//
// Examples (box size 12): 24 → {2,2}, 25 → {2,3}, 11 → {0,1}, 12 → {1,1}.
// The labels carry no quantity — staff scan and enter the qty in the system.
export function labelCounts(
  baseQty: number,
  boxFactor: number,
): { boxLabels: number; pcsLabels: number } {
  if (!Number.isFinite(baseQty) || baseQty <= 0) return { boxLabels: 0, pcsLabels: 0 };

  // No real packaging unit → every item is a loose piece, no box labels.
  if (!Number.isFinite(boxFactor) || boxFactor <= 1) {
    return { boxLabels: 0, pcsLabels: Math.floor(baseQty) };
  }

  return {
    boxLabels: Math.floor(baseQty / boxFactor),
    pcsLabels: Math.ceil(baseQty / boxFactor),
  };
}
