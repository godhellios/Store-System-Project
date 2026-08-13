import { describe, it, expect } from "vitest";
import {
  eligiblePackingUnits,
  isEligiblePackingUnit,
  packingFactorOf,
  packingUnitLabel,
  type MasterUnit,
} from "./packing-units";

// Mirrors the real production Unit master, including the Gross/Dozen split that
// caused the bug this rule exists to prevent.
const GROSS: MasterUnit = { id: "gross", name: "Gross", isActive: true, parentUnitId: null, conversionFactor: null };
const DOZEN: MasterUnit = { id: "dozen", name: "Dozen", isActive: true, parentUnitId: null, conversionFactor: null };
const BOX_500: MasterUnit = { id: "b500", name: "Box Of 500 Yard", isActive: true, parentUnitId: "gross", conversionFactor: 12 };
const BOX_5000: MasterUnit = { id: "b5000", name: "Box Of 5000 Yard", isActive: true, parentUnitId: "dozen", conversionFactor: 12 };
const SACK_10: MasterUnit = { id: "s10", name: "Sack Of Zipper 10", isActive: true, parentUnitId: "dozen", conversionFactor: 500 };
const INACTIVE: MasterUnit = { id: "old", name: "Old Box", isActive: false, parentUnitId: "gross", conversionFactor: 6 };
const NO_FACTOR: MasterUnit = { id: "nf", name: "Case", isActive: true, parentUnitId: "gross", conversionFactor: null };
const ZERO_FACTOR: MasterUnit = { id: "zf", name: "Bad Box", isActive: true, parentUnitId: "gross", conversionFactor: 0 };

const ALL = [GROSS, DOZEN, BOX_500, BOX_5000, SACK_10, INACTIVE, NO_FACTOR, ZERO_FACTOR];

describe("eligiblePackingUnits", () => {
  it("offers only units whose parent is the product's base unit", () => {
    expect(eligiblePackingUnits(ALL, "gross").map((u) => u.name)).toEqual(["Box Of 500 Yard"]);
    expect(eligiblePackingUnits(ALL, "dozen").map((u) => u.name)).toEqual(["Box Of 5000 Yard", "Sack Of Zipper 10"]);
  });

  // The exact production bug: 3 thread products counted in Dozen were given
  // "Box Of 500 Yard", which the master defines as 12 GROSS.
  it("does NOT offer a Gross box to a product counted in Dozen", () => {
    expect(eligiblePackingUnits(ALL, "dozen")).not.toContainEqual(BOX_500);
  });

  it("skips inactive units", () => {
    expect(eligiblePackingUnits(ALL, "gross")).not.toContainEqual(INACTIVE);
  });

  it("skips units with no usable factor", () => {
    const names = eligiblePackingUnits(ALL, "gross").map((u) => u.name);
    expect(names).not.toContain("Case");
    expect(names).not.toContain("Bad Box");
  });

  it("never offers a unit as packing for itself", () => {
    const selfParent: MasterUnit = { id: "gross", name: "Gross", isActive: true, parentUnitId: "gross", conversionFactor: 12 };
    expect(eligiblePackingUnits([selfParent], "gross")).toEqual([]);
  });

  it("returns nothing when the product has no base unit yet", () => {
    expect(eligiblePackingUnits(ALL, null)).toEqual([]);
    expect(eligiblePackingUnits(ALL, undefined)).toEqual([]);
    expect(eligiblePackingUnits(ALL, "")).toEqual([]);
  });

  it("preserves the caller's ordering", () => {
    expect(eligiblePackingUnits([SACK_10, BOX_5000], "dozen").map((u) => u.id)).toEqual(["s10", "b5000"]);
  });
});

describe("isEligiblePackingUnit", () => {
  it("accepts a matching unit and rejects a mismatched one", () => {
    expect(isEligiblePackingUnit(BOX_500, "gross")).toBe(true);
    expect(isEligiblePackingUnit(BOX_500, "dozen")).toBe(false);
  });

  it("rejects inactive, factorless and missing units", () => {
    expect(isEligiblePackingUnit(INACTIVE, "gross")).toBe(false);
    expect(isEligiblePackingUnit(NO_FACTOR, "gross")).toBe(false);
    expect(isEligiblePackingUnit(null, "gross")).toBe(false);
    expect(isEligiblePackingUnit(BOX_500, null)).toBe(false);
  });
});

describe("packingFactorOf", () => {
  it("returns the factor when usable", () => {
    expect(packingFactorOf(BOX_500)).toBe(12);
    expect(packingFactorOf(SACK_10)).toBe(500);
  });

  // Returning 1 here would silently record a whole box as a single unit.
  it("returns null rather than defaulting to 1", () => {
    expect(packingFactorOf(NO_FACTOR)).toBeNull();
    expect(packingFactorOf(ZERO_FACTOR)).toBeNull();
    expect(packingFactorOf(null)).toBeNull();
    expect(packingFactorOf(undefined)).toBeNull();
  });
});

describe("packingUnitLabel", () => {
  it("shows the factor against the product's base unit", () => {
    expect(packingUnitLabel(BOX_500, "Gross")).toBe("Box Of 500 Yard (12 Gross)");
    expect(packingUnitLabel(SACK_10, "Dozen")).toBe("Sack Of Zipper 10 (500 Dozen)");
  });

  it("falls back to the bare name when there is no factor", () => {
    expect(packingUnitLabel(NO_FACTOR, "Gross")).toBe("Case");
  });
});
