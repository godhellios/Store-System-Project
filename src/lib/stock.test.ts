import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  checkSufficientStock,
  applyAdjustmentDelta,
  toBaseUnits,
  applyGrnApproval,
  applyGoodsOutApproval,
  applyTransferApproval,
  applyAdjustmentApproval,
  InsufficientStockError,
} from "./stock";

// ---------------------------------------------------------------------------
// In-memory stock store — stands in for a Prisma tx during tests.
// Tests assert on final stock quantities, not on which mock methods were called.
// ---------------------------------------------------------------------------

function makeStockStore(initial: Record<string, number> = {}) {
  // key format: `${productId}:${locationId}`
  const store = new Map(Object.entries(initial));

  const tx = {
    stock: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      upsert: async ({ where: { productId_locationId: loc }, create, update }: any) => {
        const key = `${loc.productId}:${loc.locationId}`;
        const existing = store.get(key);
        if (existing === undefined) {
          store.set(key, create.quantity);
        } else {
          const inc = update.quantity.increment ?? -(update.quantity.decrement ?? 0);
          store.set(key, existing + inc);
        }
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      update: async ({ where: { productId_locationId: loc }, data }: any) => {
        const key = `${loc.productId}:${loc.locationId}`;
        const current = store.get(key) ?? 0;
        if (typeof data.quantity === "number") {
          store.set(key, data.quantity);
        } else if ("decrement" in data.quantity) {
          store.set(key, current - data.quantity.decrement);
        } else if ("increment" in data.quantity) {
          store.set(key, current + data.quantity.increment);
        }
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      findUnique: async ({ where: { productId_locationId: loc } }: any) => {
        const key = `${loc.productId}:${loc.locationId}`;
        const qty = store.get(key);
        return qty !== undefined ? { quantity: qty } : null;
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      create: async ({ data }: any) => {
        const key = `${data.productId}:${data.locationId}`;
        store.set(key, data.quantity);
      },
    },
    product: {
      findUnique: vi.fn(async () => ({ name: "Test Product", sku: "TEST-00001" })),
    },
  };

  const getStock = (productId: string, locationId: string) =>
    store.get(`${productId}:${locationId}`) ?? 0;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { tx: tx as any, getStock };
}

// ---------------------------------------------------------------------------
// checkSufficientStock
// ---------------------------------------------------------------------------

describe("checkSufficientStock", () => {
  it("returns empty array when all lines have sufficient stock", () => {
    const stockMap = new Map([
      ["prod-1", { quantity: 100, name: "Thread Roll" }],
      ["prod-2", { quantity: 50, name: "Button" }],
    ]);
    const lines = [
      { productId: "prod-1", quantity: 50 },
      { productId: "prod-2", quantity: 50 },
    ];

    expect(checkSufficientStock(lines, stockMap)).toHaveLength(0);
  });

  it("reports shortage when available quantity is less than requested", () => {
    const stockMap = new Map([["prod-1", { quantity: 5, name: "Thread Roll" }]]);
    const lines = [{ productId: "prod-1", quantity: 10 }];

    const shortages = checkSufficientStock(lines, stockMap);

    expect(shortages).toHaveLength(1);
    expect(shortages[0]).toContain("Thread Roll");
    expect(shortages[0]).toContain("available: 5");
    expect(shortages[0]).toContain("requested: 10");
  });

  it("treats missing stock record as zero quantity", () => {
    const stockMap = new Map<string, { quantity: number; name: string }>();
    const lines = [{ productId: "prod-new", quantity: 1 }];

    const shortages = checkSufficientStock(lines, stockMap);

    expect(shortages).toHaveLength(1);
    expect(shortages[0]).toContain("available: 0");
  });

  it("reports only the lines that are insufficient, not all lines", () => {
    const stockMap = new Map([
      ["prod-ok", { quantity: 100, name: "Zipper" }],
      ["prod-low", { quantity: 3, name: "Button" }],
    ]);
    const lines = [
      { productId: "prod-ok", quantity: 10 },
      { productId: "prod-low", quantity: 5 },
    ];

    const shortages = checkSufficientStock(lines, stockMap);

    expect(shortages).toHaveLength(1);
    expect(shortages[0]).toContain("Button");
  });

  it("passes when requested quantity exactly equals available", () => {
    const stockMap = new Map([["prod-1", { quantity: 20, name: "Elastic" }]]);
    const lines = [{ productId: "prod-1", quantity: 20 }];

    expect(checkSufficientStock(lines, stockMap)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// applyAdjustmentDelta
// ---------------------------------------------------------------------------

describe("applyAdjustmentDelta", () => {
  it("returns increased quantity for a positive delta", () => {
    expect(applyAdjustmentDelta(30, 20)).toBe(50);
  });

  it("returns decreased quantity for a negative delta that stays above zero", () => {
    expect(applyAdjustmentDelta(30, -10)).toBe(20);
  });

  it("returns zero when delta exactly cancels current quantity", () => {
    expect(applyAdjustmentDelta(15, -15)).toBe(0);
  });

  it("throws when delta would push quantity below zero", () => {
    expect(() => applyAdjustmentDelta(10, -15)).toThrow();
  });

  it("thrown error message includes the resulting negative value", () => {
    expect(() => applyAdjustmentDelta(10, -15)).toThrow("-5");
  });
});

// ---------------------------------------------------------------------------
// toBaseUnits
// ---------------------------------------------------------------------------

describe("toBaseUnits", () => {
  it("converts 1 box to 12 base units with factor 12", () => {
    expect(toBaseUnits(1, 12)).toBe(12);
  });

  it("converts 3 boxes to 36 base units", () => {
    expect(toBaseUnits(3, 12)).toBe(36);
  });

  it("rounds fractional results to the nearest integer", () => {
    // 2.5 × 12 = 30 exactly
    expect(toBaseUnits(2.5, 12)).toBe(30);
    // 1 × 144 = 144 (carton to pieces)
    expect(toBaseUnits(1, 144)).toBe(144);
  });

  it("returns inputQty unchanged when conversion factor is 1 (base unit)", () => {
    expect(toBaseUnits(7, 1)).toBe(7);
  });

  it("rounds 0.4 × 12 = 4.8 down to 5 (rounds to nearest)", () => {
    // Math.round(4.8) = 5
    expect(toBaseUnits(0.4, 12)).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// applyGrnApproval
// ---------------------------------------------------------------------------

describe("applyGrnApproval", () => {
  it("creates stock at destination when no stock exists yet", async () => {
    const { tx, getStock } = makeStockStore();

    await applyGrnApproval(tx, [{ productId: "prod-1", quantity: 50 }], "loc-store");

    expect(getStock("prod-1", "loc-store")).toBe(50);
  });

  it("adds to existing stock at destination", async () => {
    const { tx, getStock } = makeStockStore({ "prod-1:loc-store": 30 });

    await applyGrnApproval(tx, [{ productId: "prod-1", quantity: 20 }], "loc-store");

    expect(getStock("prod-1", "loc-store")).toBe(50);
  });

  it("applies multiple lines independently", async () => {
    const { tx, getStock } = makeStockStore();

    await applyGrnApproval(
      tx,
      [
        { productId: "prod-1", quantity: 100 },
        { productId: "prod-2", quantity: 60 },
      ],
      "loc-warehouse",
    );

    expect(getStock("prod-1", "loc-warehouse")).toBe(100);
    expect(getStock("prod-2", "loc-warehouse")).toBe(60);
  });
});

// ---------------------------------------------------------------------------
// applyGoodsOutApproval
// ---------------------------------------------------------------------------

describe("applyGoodsOutApproval", () => {
  it("decrements stock at source location by order quantity", async () => {
    const { tx, getStock } = makeStockStore({ "prod-1:loc-store": 100 });

    await applyGoodsOutApproval(tx, [{ productId: "prod-1", quantity: 30 }], "loc-store");

    expect(getStock("prod-1", "loc-store")).toBe(70);
  });

  it("decrements all lines from the same source location", async () => {
    const { tx, getStock } = makeStockStore({
      "prod-1:loc-store": 100,
      "prod-2:loc-store": 50,
    });

    await applyGoodsOutApproval(
      tx,
      [
        { productId: "prod-1", quantity: 10 },
        { productId: "prod-2", quantity: 20 },
      ],
      "loc-store",
    );

    expect(getStock("prod-1", "loc-store")).toBe(90);
    expect(getStock("prod-2", "loc-store")).toBe(30);
  });
});

// ---------------------------------------------------------------------------
// applyTransferApproval
// ---------------------------------------------------------------------------

describe("applyTransferApproval", () => {
  it("decrements source and creates stock at destination", async () => {
    const { tx, getStock } = makeStockStore({ "prod-1:loc-warehouse": 100 });

    await applyTransferApproval(
      tx,
      [{ productId: "prod-1", quantity: 40 }],
      "loc-warehouse",
      "loc-store",
    );

    expect(getStock("prod-1", "loc-warehouse")).toBe(60);
    expect(getStock("prod-1", "loc-store")).toBe(40);
  });

  it("adds to existing stock at destination when product already there", async () => {
    const { tx, getStock } = makeStockStore({
      "prod-1:loc-warehouse": 100,
      "prod-1:loc-store": 20,
    });

    await applyTransferApproval(
      tx,
      [{ productId: "prod-1", quantity: 30 }],
      "loc-warehouse",
      "loc-store",
    );

    expect(getStock("prod-1", "loc-warehouse")).toBe(70);
    expect(getStock("prod-1", "loc-store")).toBe(50);
  });

  it("stock removed from source equals stock added to destination", async () => {
    const { tx, getStock } = makeStockStore({ "prod-1:loc-a": 80 });
    const qty = 25;

    await applyTransferApproval(tx, [{ productId: "prod-1", quantity: qty }], "loc-a", "loc-b");

    const sourceRemaining = getStock("prod-1", "loc-a");
    const destReceived = getStock("prod-1", "loc-b");

    expect(80 - sourceRemaining).toBe(qty); // source lost exactly qty
    expect(destReceived).toBe(qty);         // destination gained exactly qty
  });
});

// ---------------------------------------------------------------------------
// applyAdjustmentApproval
// ---------------------------------------------------------------------------

describe("applyAdjustmentApproval", () => {
  it("increases stock when adjustment delta is positive", async () => {
    const { tx, getStock } = makeStockStore({ "prod-1:loc-store": 20 });

    await applyAdjustmentApproval(tx, [{ productId: "prod-1", quantity: 10 }], "loc-store");

    expect(getStock("prod-1", "loc-store")).toBe(30);
  });

  it("decreases stock when adjustment delta is negative but stays above zero", async () => {
    const { tx, getStock } = makeStockStore({ "prod-1:loc-store": 20 });

    await applyAdjustmentApproval(tx, [{ productId: "prod-1", quantity: -10 }], "loc-store");

    expect(getStock("prod-1", "loc-store")).toBe(10);
  });

  it("creates stock record when product has no existing stock", async () => {
    const { tx, getStock } = makeStockStore();

    await applyAdjustmentApproval(tx, [{ productId: "prod-new", quantity: 15 }], "loc-store");

    expect(getStock("prod-new", "loc-store")).toBe(15);
  });

  it("throws InsufficientStockError when negative adjustment exceeds current stock", async () => {
    const { tx } = makeStockStore({ "prod-1:loc-store": 5 });

    await expect(
      applyAdjustmentApproval(tx, [{ productId: "prod-1", quantity: -10 }], "loc-store"),
    ).rejects.toThrow(InsufficientStockError);
  });

  it("rolls back all lines if any line would go negative (transaction semantics)", async () => {
    const { tx, getStock } = makeStockStore({
      "prod-1:loc-store": 100,
      "prod-2:loc-store": 2,
    });

    await expect(
      applyAdjustmentApproval(
        tx,
        [
          { productId: "prod-1", quantity: -10 }, // fine
          { productId: "prod-2", quantity: -5 },  // would go to -3 — must throw
        ],
        "loc-store",
      ),
    ).rejects.toThrow(InsufficientStockError);

    // prod-1 should NOT have been decremented (tx rollback)
    expect(getStock("prod-1", "loc-store")).toBe(100);
  });
});
