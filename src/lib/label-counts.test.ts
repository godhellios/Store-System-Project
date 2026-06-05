import { describe, it, expect } from "vitest";
import { labelCounts } from "./label-counts";

describe("labelCounts", () => {
  it("splits a whole number of boxes into equal box and pcs labels", () => {
    expect(labelCounts(24, 12)).toEqual({ boxLabels: 2, pcsLabels: 2 });
    expect(labelCounts(36, 12)).toEqual({ boxLabels: 3, pcsLabels: 3 });
    expect(labelCounts(12, 12)).toEqual({ boxLabels: 1, pcsLabels: 1 });
  });

  it("adds one extra pcs label for a leftover that isn't a full box", () => {
    // 25 = 2 full boxes + 1 loose piece → 2 box labels, 3 pcs labels
    expect(labelCounts(25, 12)).toEqual({ boxLabels: 2, pcsLabels: 3 });
    expect(labelCounts(13, 12)).toEqual({ boxLabels: 1, pcsLabels: 2 });
  });

  it("gives no box label when there isn't a full box, but still a pcs label", () => {
    expect(labelCounts(11, 12)).toEqual({ boxLabels: 0, pcsLabels: 1 });
    expect(labelCounts(1, 12)).toEqual({ boxLabels: 0, pcsLabels: 1 });
  });

  it("returns nothing for zero stock", () => {
    expect(labelCounts(0, 12)).toEqual({ boxLabels: 0, pcsLabels: 0 });
  });

  it("treats a factor of 1 or less as no packaging — only pcs labels", () => {
    expect(labelCounts(5, 1)).toEqual({ boxLabels: 0, pcsLabels: 5 });
    expect(labelCounts(5, 0)).toEqual({ boxLabels: 0, pcsLabels: 5 });
  });

  it("guards against negative or invalid quantities", () => {
    expect(labelCounts(-3, 12)).toEqual({ boxLabels: 0, pcsLabels: 0 });
    expect(labelCounts(NaN, 12)).toEqual({ boxLabels: 0, pcsLabels: 0 });
  });
});
