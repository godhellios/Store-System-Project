import { describe, it, expect, vi, beforeEach } from "vitest";
import { findSimilarProducts } from "./duplicate-detect";

// ---------------------------------------------------------------------------
// Prisma mock
// vi.mock factory is hoisted to the top of the file by vitest, so any
// variables it references must also be hoisted via vi.hoisted().
// ---------------------------------------------------------------------------

const { mockFindMany } = vi.hoisted(() => ({
  mockFindMany: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    product: {
      findMany: mockFindMany,
    },
  },
}));

beforeEach(() => {
  vi.resetAllMocks();
});

// ---------------------------------------------------------------------------
// Helper — build a minimal product row
// ---------------------------------------------------------------------------

function makeProduct(id: string, name: string, sku: string) {
  return { id, name, sku };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("findSimilarProducts", () => {
  it("1. Exact match: identical name is flagged as duplicate", async () => {
    mockFindMany.mockResolvedValue([
      makeProduct("prod-1", "Benang Yamalon 500Y 002", "THR-00001"),
    ]);

    const results = await findSimilarProducts("Benang Yamalon 500Y 002");

    expect(results).toHaveLength(1);
    expect(results[0].id).toBe("prod-1");
    expect(results[0].score).toBeCloseTo(1.0, 5);
  });

  it("2. Case-insensitive: different casing is still flagged as duplicate", async () => {
    mockFindMany.mockResolvedValue([
      makeProduct("prod-2", "Benang Yamalon", "THR-00002"),
    ]);

    // Input uses lowercase; existing product uses Title Case
    const results = await findSimilarProducts("benang yamalon");

    expect(results).toHaveLength(1);
    expect(results[0].id).toBe("prod-2");
    expect(results[0].score).toBeCloseTo(1.0, 5);
  });

  it("3. Extra spaces: extra internal whitespace is collapsed and still matches", async () => {
    mockFindMany.mockResolvedValue([
      makeProduct("prod-3", "Benang Yamalon", "THR-00003"),
    ]);

    // Input has double space between words
    const results = await findSimilarProducts("Benang  Yamalon");

    expect(results).toHaveLength(1);
    expect(results[0].id).toBe("prod-3");
    expect(results[0].score).toBeCloseTo(1.0, 5);
  });

  it("4. Different products: genuinely different names return no matches", async () => {
    mockFindMany.mockResolvedValue([
      makeProduct("prod-4", "Kancing Plastik Hitam", "BUT-00001"),
    ]);

    const results = await findSimilarProducts("Resleting HLZ 20cm");

    expect(results).toHaveLength(0);
  });

  it("5. OwnExclude: product with matching excludeId is not returned", async () => {
    mockFindMany.mockResolvedValue([
      makeProduct("prod-1", "Benang Yamalon 500Y 002", "THR-00001"),
    ]);

    // Editing the product itself — it must not flag itself
    const results = await findSimilarProducts(
      "Benang Yamalon 500Y 002",
      "prod-1"
    );

    expect(results).toHaveLength(0);
  });

  it("6. excludeId only excludes the matching product, not others", async () => {
    mockFindMany.mockResolvedValue([
      makeProduct("prod-1", "Benang Yamalon 500Y 002", "THR-00001"),
      makeProduct("prod-2", "Benang Yamalon 500Y 002", "THR-00002"), // same name, different id
    ]);

    const results = await findSimilarProducts(
      "Benang Yamalon 500Y 002",
      "prod-1"
    );

    // prod-1 excluded; prod-2 is still returned
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe("prod-2");
  });

  it("7. Score included: result objects contain a numeric score between 0 and 1", async () => {
    mockFindMany.mockResolvedValue([
      makeProduct("prod-5", "Benang Yamalon", "THR-00005"),
    ]);

    const results = await findSimilarProducts("Benang Yamalon");

    expect(results[0]).toHaveProperty("score");
    expect(typeof results[0].score).toBe("number");
    expect(results[0].score).toBeGreaterThanOrEqual(0);
    expect(results[0].score).toBeLessThanOrEqual(1);
  });

  it("8. Results sorted by score descending", async () => {
    mockFindMany.mockResolvedValue([
      // "Benang Yamalon 500Y 003" differs by 1 char in 24 → score ≈ 0.958
      makeProduct("prod-a", "Benang Yamalon 500Y 003", "THR-00010"),
      // exact match → score 1.0
      makeProduct("prod-b", "Benang Yamalon 500Y 002", "THR-00011"),
    ]);

    const results = await findSimilarProducts("Benang Yamalon 500Y 002");

    expect(results[0].id).toBe("prod-b"); // highest score first
    expect(results[0].score).toBeGreaterThan(results[1].score);
  });

  it("9. Near-identical color code variant IS flagged (1 char diff in 24 → ~0.958)", async () => {
    // "Benang Yamalon 500Y 002" vs "Benang Yamalon 500Y 003"
    // Levenshtein distance = 1, maxLen = 23 (after normalize, no change)
    // score = 1 - 1/23 ≈ 0.957 — above 0.80 threshold, so it IS flagged.
    // Staff see the warning and confirm it's intentionally different.
    mockFindMany.mockResolvedValue([
      makeProduct("prod-c", "Benang Yamalon 500Y 003", "THR-00020"),
    ]);

    const results = await findSimilarProducts("Benang Yamalon 500Y 002");

    expect(results).toHaveLength(1);
    expect(results[0].score).toBeGreaterThan(0.8);
    expect(results[0].score).toBeLessThan(1.0);
  });
});
