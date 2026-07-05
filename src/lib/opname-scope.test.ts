import { describe, it, expect } from "vitest";
import { transactionBlockedBy, overlapsExistingCount, type OpenSession } from "./opname-scope";

const session = (id: string, categoryIds: string[]): OpenSession => ({
  id, sessionNumber: id, locationId: "loc", categoryIds,
});

// ── transactionBlockedBy: which live transactions an open count stops ─────────

describe("transactionBlockedBy", () => {
  it("a whole-warehouse count (no categories) blocks a transaction of any category", () => {
    const r = transactionBlockedBy([session("s1", [])], ["thread"]);
    expect(r?.session.id).toBe("s1");
    expect(r?.categoryId).toBeNull();
  });

  it("a category count blocks a transaction touching that category", () => {
    const r = transactionBlockedBy([session("s1", ["thread"])], ["thread"]);
    expect(r?.session.id).toBe("s1");
    expect(r?.categoryId).toBe("thread");
  });

  it("a category count does NOT block a transaction in other categories", () => {
    expect(transactionBlockedBy([session("s1", ["thread"])], ["button"])).toBeNull();
  });

  it("blocks a multi-category transaction when it shares even one counted category", () => {
    const r = transactionBlockedBy([session("s1", ["thread"])], ["button", "thread"]);
    expect(r?.session.id).toBe("s1");
    expect(r?.categoryId).toBe("thread");
  });

  it("returns null when nothing is being counted", () => {
    expect(transactionBlockedBy([], ["thread"])).toBeNull();
  });

  it("finds the matching count among several open counts", () => {
    const r = transactionBlockedBy([session("zip", ["zipper"]), session("thr", ["thread"])], ["thread"]);
    expect(r?.session.id).toBe("thr");
  });
});

// ── overlapsExistingCount: can a new count start alongside open ones ──────────

describe("overlapsExistingCount", () => {
  it("a new whole-warehouse count overlaps any open count", () => {
    expect(overlapsExistingCount([session("s1", ["thread"])], [])?.id).toBe("s1");
  });

  it("an existing whole-warehouse count blocks any new count", () => {
    expect(overlapsExistingCount([session("s1", [])], ["thread"])?.id).toBe("s1");
  });

  it("non-overlapping categories can run concurrently", () => {
    expect(overlapsExistingCount([session("s1", ["zipper"])], ["thread"])).toBeNull();
  });

  it("a new count sharing a category with an open count is rejected", () => {
    expect(overlapsExistingCount([session("s1", ["thread", "button"])], ["thread"])?.id).toBe("s1");
  });

  it("nothing open means no overlap", () => {
    expect(overlapsExistingCount([], ["thread"])).toBeNull();
  });
});
