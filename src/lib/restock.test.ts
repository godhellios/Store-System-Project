import { describe, it, expect } from "vitest";
import { computeRestockSuggestions, roundUpToBox, type RestockInput } from "./restock";

// Minimal input builder — only override what each test cares about.
function item(over: Partial<RestockInput> = {}): RestockInput {
  return {
    productId: "p1",
    name: "Thread Black",
    sku: "THR-001",
    category: "Thread",
    unit: "pcs",
    reorderPoint: 0,
    currentStock: 0,
    totalOut: 0,
    lastCost: null,
    lastSupplier: null,
    boxFactor: null,
    ...over,
  };
}

describe("roundUpToBox", () => {
  it("rounds up to the next whole box when packaging is known", () => {
    expect(roundUpToBox(29, 12)).toBe(36); // 3 boxes of 12
    expect(roundUpToBox(24, 12)).toBe(24); // already a whole box
  });
  it("rounds up to whole units when no box factor", () => {
    expect(roundUpToBox(4.2, null)).toBe(5);
    expect(roundUpToBox(4.2, 1)).toBe(5); // factor of 1 is not a box
  });
  it("returns 0 for non-positive input", () => {
    expect(roundUpToBox(0, 12)).toBe(0);
    expect(roundUpToBox(-3, 12)).toBe(0);
  });
});

describe("computeRestockSuggestions", () => {
  it("returns nothing when stock is healthy and there is no demand pressure", () => {
    const rows = computeRestockSuggestions(
      [item({ reorderPoint: 10, currentStock: 100, totalOut: 0 })],
      { dayRange: 30 }
    );
    expect(rows).toHaveLength(0);
  });

  it("suggests enough to cover the coverage window minus current stock", () => {
    // 60 out over 30 days = 2/day; 30-day coverage target = 60; have 10 → order 50
    const rows = computeRestockSuggestions(
      [item({ currentStock: 10, totalOut: 60 })],
      { dayRange: 30, coverageDays: 30 }
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].avgDailyOut).toBe(2);
    expect(rows[0].daysOfStock).toBe(5);
    expect(rows[0].suggestedQty).toBe(50);
  });

  it("never suggests below the reorder point even with low velocity", () => {
    // tiny velocity, but reorderPoint 100 and stock 20 → bring up to 100 → order 80
    const rows = computeRestockSuggestions(
      [item({ reorderPoint: 100, currentStock: 20, totalOut: 3 })],
      { dayRange: 30, coverageDays: 30 }
    );
    expect(rows[0].suggestedQty).toBe(80);
  });

  it("rounds the suggested quantity up to whole boxes", () => {
    // target 60, have 13 → raw 47 → round up to 48 (4 boxes of 12)
    const rows = computeRestockSuggestions(
      [item({ currentStock: 13, totalOut: 60, boxFactor: 12 })],
      { dayRange: 30, coverageDays: 30 }
    );
    expect(rows[0].suggestedQty).toBe(48);
  });

  it("includes a product at/below reorder even when nothing has moved", () => {
    const rows = computeRestockSuggestions(
      [item({ reorderPoint: 50, currentStock: 50, totalOut: 0 })],
      { dayRange: 30 }
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].urgency).toBe("low");
    expect(rows[0].daysOfStock).toBeNull();
  });

  it("computes estimated cost from last purchase price", () => {
    const rows = computeRestockSuggestions(
      [item({ currentStock: 10, totalOut: 60, lastCost: 1500 })],
      { dayRange: 30, coverageDays: 30 }
    );
    expect(rows[0].estCost).toBe(75000); // 50 × 1500
  });

  it("leaves estCost null when last cost is unknown", () => {
    const rows = computeRestockSuggestions(
      [item({ currentStock: 10, totalOut: 60, lastCost: null })],
      { dayRange: 30 }
    );
    expect(rows[0].estCost).toBeNull();
  });

  it("flags out-of-stock as 'out' and ranks it first", () => {
    const rows = computeRestockSuggestions(
      [
        item({ productId: "watch", reorderPoint: 5, currentStock: 4, totalOut: 1 }),
        item({ productId: "out", currentStock: 0, totalOut: 30 }),
        item({ productId: "critical", currentStock: 5, totalOut: 30 }), // 5 days of stock
      ],
      { dayRange: 30, coverageDays: 30 }
    );
    expect(rows.map((r) => r.productId)).toEqual(["out", "critical", "watch"]);
    expect(rows[0].urgency).toBe("out");
    expect(rows[1].urgency).toBe("critical");
  });

  it("clamps a zero/negative day range instead of dividing by it", () => {
    const rows = computeRestockSuggestions(
      [item({ currentStock: 0, totalOut: 10 })],
      { dayRange: 0 }
    );
    // dayRange clamps to 1 → avgDailyOut = 10, no crash
    expect(rows[0].avgDailyOut).toBe(10);
    expect(rows[0].urgency).toBe("out");
  });
});
