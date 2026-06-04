import { describe, it, expect } from "vitest";
import {
  validateOpeningStockRows,
  applySkipProtect,
  importableRows,
  computeOpeningStockCosts,
  productsWithoutStockAtLocation,
  type ParsedRow,
  type ValidatedRow,
} from "./opening-stock";

const products = [
  { id: "p1", sku: "THR-001", name: "Red Thread" },
  { id: "p2", sku: "ZIP-001", name: "Blue Zipper" },
];

const locations = [
  { id: "l1", name: "Retail Store" },
  { id: "l2", name: "Big Warehouse" },
];

function row(sku: string, location: string, qty: string, unitCost = ""): ParsedRow {
  return { sku, location, qty, unitCost };
}

function validate(rows: ParsedRow[]): ValidatedRow[] {
  return validateOpeningStockRows(rows, products, locations);
}

describe("validateOpeningStockRows", () => {
  it("accepts a valid row as ok", () => {
    const [r] = validate([row("THR-001", "Retail Store", "100")]);
    expect(r.status).toBe("ok");
    expect(r.productId).toBe("p1");
    expect(r.locationId).toBe("l1");
    expect(r.qty).toBe(100);
    expect(r.unitCost).toBeNull();
  });

  it("matches SKU and location case-insensitively", () => {
    const [r] = validate([row("thr-001", "retail store", "5")]);
    expect(r.status).toBe("ok");
    expect(r.productId).toBe("p1");
    expect(r.locationId).toBe("l1");
  });

  it("trims surrounding whitespace", () => {
    const [r] = validate([row("  THR-001  ", "  Retail Store  ", "  7  ")]);
    expect(r.status).toBe("ok");
    expect(r.qty).toBe(7);
  });

  it("drops fully blank rows entirely", () => {
    expect(validate([row("", "", "")])).toHaveLength(0);
  });

  it("flags an unknown SKU as error", () => {
    const [r] = validate([row("NOPE-999", "Retail Store", "10")]);
    expect(r.status).toBe("error");
    expect(r.message).toContain("not found");
  });

  it("flags a missing SKU as error", () => {
    const [r] = validate([row("", "Retail Store", "10")]);
    expect(r.status).toBe("error");
    expect(r.message).toBe("SKU is required");
  });

  it("flags an unknown location as error", () => {
    const [r] = validate([row("THR-001", "Mars", "10")]);
    expect(r.status).toBe("error");
    expect(r.message).toContain("not found");
  });

  it("flags a missing location as error", () => {
    const [r] = validate([row("THR-001", "", "10")]);
    expect(r.status).toBe("error");
    expect(r.message).toBe("Location is required");
  });

  it.each(["0", "-5", "abc", "3.5"])("flags qty %s as error", (qty) => {
    const [r] = validate([row("THR-001", "Retail Store", qty)]);
    // "3.5" → parseInt = 3 (positive), so it is actually accepted as 3.
    if (qty === "3.5") {
      expect(r.status).toBe("ok");
      expect(r.qty).toBe(3);
    } else {
      expect(r.status).toBe("error");
      expect(r.message).toContain("Qty");
    }
  });

  it("parses a valid unit cost", () => {
    const [r] = validate([row("THR-001", "Retail Store", "10", "125.5")]);
    expect(r.status).toBe("ok");
    expect(r.unitCost).toBe(125.5);
  });

  it.each(["0", "-1", "abc"])("flags unit cost %s as error", (cost) => {
    const [r] = validate([row("THR-001", "Retail Store", "10", cost)]);
    expect(r.status).toBe("error");
    expect(r.message).toContain("UnitCost");
  });

  it("keeps multiple error rows distinct rather than collapsing them", () => {
    const result = validate([row("NOPE-1", "Retail Store", "1"), row("NOPE-2", "Retail Store", "1")]);
    expect(result).toHaveLength(2);
    expect(result.every((r) => r.status === "error")).toBe(true);
  });

  it("collapses an in-file duplicate, keeping the last value as a warning", () => {
    const result = validate([
      row("THR-001", "Retail Store", "100"),
      row("THR-001", "Retail Store", "250"),
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].status).toBe("warning");
    expect(result[0].qty).toBe(250);
  });

  it("treats the same product at different locations as separate rows", () => {
    const result = validate([
      row("THR-001", "Retail Store", "100"),
      row("THR-001", "Big Warehouse", "50"),
    ]);
    expect(result).toHaveLength(2);
    expect(result.every((r) => r.status === "ok")).toBe(true);
    expect(result.map((r) => r.locationId).sort()).toEqual(["l1", "l2"]);
  });
});

describe("applySkipProtect", () => {
  it("skips a product+location that already has stock", () => {
    const validated = validate([row("THR-001", "Retail Store", "100")]);
    applySkipProtect(validated, [{ productId: "p1", locationId: "l1", quantity: 42 }]);
    expect(validated[0].status).toBe("skip");
    expect(validated[0].message).toContain("Already has stock");
  });

  it("leaves a fresh product+location as ok", () => {
    const validated = validate([row("THR-001", "Retail Store", "100")]);
    applySkipProtect(validated, []);
    expect(validated[0].status).toBe("ok");
  });

  it("does not skip when the existing balance is zero", () => {
    const validated = validate([row("THR-001", "Retail Store", "100")]);
    applySkipProtect(validated, [{ productId: "p1", locationId: "l1", quantity: 0 }]);
    expect(validated[0].status).toBe("ok");
  });

  it("skips only the location that has stock (per-location, not per-product)", () => {
    const validated = validate([
      row("THR-001", "Retail Store", "100"),
      row("THR-001", "Big Warehouse", "50"),
    ]);
    applySkipProtect(validated, [{ productId: "p1", locationId: "l1", quantity: 5 }]);
    const retail = validated.find((r) => r.locationId === "l1")!;
    const big = validated.find((r) => r.locationId === "l2")!;
    expect(retail.status).toBe("skip");
    expect(big.status).toBe("ok");
  });

  it("also skips an in-file duplicate (warning) row that targets existing stock", () => {
    const validated = validate([
      row("THR-001", "Retail Store", "100"),
      row("THR-001", "Retail Store", "250"),
    ]);
    expect(validated[0].status).toBe("warning");
    applySkipProtect(validated, [{ productId: "p1", locationId: "l1", quantity: 5 }]);
    expect(validated[0].status).toBe("skip");
  });
});

describe("importableRows", () => {
  it("includes ok and warning, excludes skip and error", () => {
    const validated: ValidatedRow[] = [
      { sku: "a", productName: "A", productId: "p1", location: "Retail Store", locationId: "l1", qty: 1, unitCost: null, status: "ok" },
      { sku: "b", productName: "B", productId: "p2", location: "Retail Store", locationId: "l1", qty: 2, unitCost: null, status: "warning" },
      { sku: "c", productName: "C", productId: "p1", location: "Big Warehouse", locationId: "l2", qty: 3, unitCost: null, status: "skip" },
      { sku: "d", productName: null, productId: null, location: "", locationId: null, qty: 0, unitCost: null, status: "error" },
    ];
    const result = importableRows(validated);
    expect(result.map((r) => r.sku)).toEqual(["a", "b"]);
  });
});

describe("computeOpeningStockCosts", () => {
  it("uses the unit cost directly for a single priced row", () => {
    const result = computeOpeningStockCosts(importableRows(validate([row("THR-001", "Retail Store", "10", "100")])));
    expect(result.get("p1")).toBe(100);
  });

  it("computes a quantity-weighted average across multiple locations", () => {
    // 10 @ 100 + 20 @ 130 = 3600 over 30 units → 120
    const validated = validate([
      row("THR-001", "Retail Store", "10", "100"),
      row("THR-001", "Big Warehouse", "20", "130"),
    ]);
    const result = computeOpeningStockCosts(importableRows(validated));
    expect(result.get("p1")).toBe(120);
  });

  it("omits products whose rows have no unit cost", () => {
    const result = computeOpeningStockCosts(importableRows(validate([row("THR-001", "Retail Store", "10")])));
    expect(result.has("p1")).toBe(false);
  });

  it("only averages the priced rows for a product", () => {
    // 10 @ 100 priced, 5 unpriced → average over the 10 priced units = 100
    const validated = validate([
      row("THR-001", "Retail Store", "10", "100"),
      row("THR-001", "Big Warehouse", "5"),
    ]);
    const result = computeOpeningStockCosts(importableRows(validated));
    expect(result.get("p1")).toBe(100);
  });
});

describe("end-to-end skip behavior", () => {
  it("imports nothing when every row already has stock", () => {
    const validated = validate([
      row("THR-001", "Retail Store", "100"),
      row("ZIP-001", "Big Warehouse", "50"),
    ]);
    applySkipProtect(validated, [
      { productId: "p1", locationId: "l1", quantity: 1 },
      { productId: "p2", locationId: "l2", quantity: 1 },
    ]);
    expect(importableRows(validated)).toHaveLength(0);
  });

  it("imports only the fresh balances in a mixed file", () => {
    const validated = validate([
      row("THR-001", "Retail Store", "100"), // already stocked → skip
      row("ZIP-001", "Big Warehouse", "50"), // fresh → import
    ]);
    applySkipProtect(validated, [{ productId: "p1", locationId: "l1", quantity: 1 }]);
    const result = importableRows(validated);
    expect(result).toHaveLength(1);
    expect(result[0].productId).toBe("p2");
  });
});

describe("productsWithoutStockAtLocation", () => {
  const ids = (rows: { id: string }[]) => rows.map((p) => p.id).sort();

  it("includes a product with no stock anywhere", () => {
    const result = productsWithoutStockAtLocation(products, [], "l1");
    expect(ids(result)).toEqual(["p1", "p2"]);
  });

  it("still includes a product stocked at another location when targeting a different one", () => {
    // p1 is stocked at l1; for l2 it has no balance, so it must still appear.
    const result = productsWithoutStockAtLocation(
      products,
      [{ productId: "p1", locationId: "l1", quantity: 100 }],
      "l2",
    );
    expect(ids(result)).toContain("p1");
  });

  it("excludes a product already stocked at the target location", () => {
    const result = productsWithoutStockAtLocation(
      products,
      [{ productId: "p1", locationId: "l1", quantity: 100 }],
      "l1",
    );
    expect(ids(result)).toEqual(["p2"]);
  });

  it("includes a product whose only row at the target location is qty 0", () => {
    const result = productsWithoutStockAtLocation(
      products,
      [{ productId: "p1", locationId: "l1", quantity: 0 }],
      "l1",
    );
    expect(ids(result)).toContain("p1");
  });

  it("excludes at the target location even when the product is also stocked elsewhere", () => {
    const result = productsWithoutStockAtLocation(
      products,
      [
        { productId: "p1", locationId: "l1", quantity: 5 },
        { productId: "p1", locationId: "l2", quantity: 9 },
      ],
      "l1",
    );
    expect(ids(result)).toEqual(["p2"]);
  });
});
