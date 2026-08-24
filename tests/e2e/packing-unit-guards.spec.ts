// End-to-end guards for the packing-unit validation gaps.
//
// These exercise the two write paths that lib/packing-units.test.ts cannot:
// the STAFF-submit -> ADMIN-approve round trip, and the order-edit unit picker.
// Both write real rows through the real route handlers.
//
// LOCAL DEV ONLY - these create and mutate products. BASE_URL is pinned to
// localhost so a stray `--project` cannot point them at the Vercel deployment
// configured in playwright.config.ts.
import { test, expect, request as playwrightRequest, type APIRequestContext } from "@playwright/test";

const BASE_URL = "http://localhost:3000";

const ADMIN = { email: "admin@mitraramah.com", password: "wirawan123" };
const STAFF = { email: "staff@mitraramah.com", password: "staff123" };

// Unique per run so the duplicate-name detector cannot match a previous run's
// leftovers; `force` still covers the case where it flags something anyway.
const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

// One context per role, signed in ONCE for the whole file. Two reasons:
// /api/auth is rate limited (repeated logins return 429), and the app enforces
// a single active session per user, so re-logging in mid-file would silently
// invalidate the cookie an earlier context is still holding.
let admin: APIRequestContext;
let staff: APIRequestContext;

async function signIn(who: { email: string; password: string }): Promise<APIRequestContext> {
  const ctx = await playwrightRequest.newContext({ baseURL: BASE_URL });
  const { csrfToken } = await (await ctx.get(`${BASE_URL}/api/auth/csrf`)).json();
  const res = await ctx.post(`${BASE_URL}/api/auth/callback/credentials`, {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    data: new URLSearchParams({
      csrfToken, email: who.email, password: who.password,
      callbackUrl: `${BASE_URL}/dashboard`, json: "true",
    }).toString(),
  });
  if (res.status() !== 200) throw new Error(`Login failed for ${who.email}: ${res.status()}`);
  return ctx;
}

test.beforeAll(async () => {
  admin = await signIn(ADMIN);
  staff = await signIn(STAFF);
});

test.afterAll(async () => {
  await admin?.dispose();
  await staff?.dispose();
});

/** Units from the master, with the fields the eligibility rule needs. */
async function getUnits(api: APIRequestContext) {
  const res = await api.get(`${BASE_URL}/api/units`);
  expect(res.ok()).toBeTruthy();
  return (await res.json()) as Array<{
    id: string; name: string; parentUnitId: string | null; conversionFactor: number | null;
  }>;
}

/**
 * Pick a base unit and a packing unit that belongs to a DIFFERENT base - the
 * shape of the production Dozen/Gross bug. Returns null if the seed has no
 * such pair, in which case the tests that need it skip.
 */
async function pickMismatchedPair(api: APIRequestContext) {
  const units = await getUnits(api);
  const packing = units.filter((u) => u.parentUnitId && (u.conversionFactor ?? 0) > 0);
  for (const p of packing) {
    const otherBase = units.find((u) => !u.parentUnitId && u.id !== p.parentUnitId);
    if (otherBase) return { baseUnit: otherBase, packingUnit: p, units };
  }
  return null;
}

/** Create a product, forcing past the similar-name check these tests trigger. */
async function createProduct(api: APIRequestContext, label: string, unitId: string) {
  const category = (await (await api.get(`${BASE_URL}/api/categories`)).json())[0];
  const res = await api.post(`${BASE_URL}/api/products`, {
    data: {
      name: `E2E ${label} ${RUN}`,
      categoryId: category.id,
      unitId,
      reorderPoint: 0,
      unitConversions: [],
      force: true,
    },
  });
  expect(res.ok(), `create failed: ${res.status()} ${await res.text()}`).toBeTruthy();
  return res.json();
}

test.describe("packing unit guards", () => {
  test.describe.configure({ mode: "serial" });

  // -- The CRITICAL path: approving a pending edit must re-validate ----------
  test("approving a staff edit does not apply a packing unit from another base unit", async () => {
    const pair = await pickMismatchedPair(admin);
    test.skip(!pair, "seed has no unit pair that can express the mismatch");
    const { baseUnit, packingUnit } = pair!;

    // A product whose base unit is NOT the packing unit's parent.
    const product = await createProduct(admin, "Guard", baseUnit.id);

    // STAFF submits an edit carrying the mismatched packing unit. Submissions
    // are stored raw, so this is expected to be accepted here...
    const submitted = await staff.put(`${BASE_URL}/api/products/${product.id}`, {
      data: { unitConversions: [{ unitId: packingUnit.id, barcode: null }] },
    });
    expect(submitted.ok()).toBeTruthy();
    expect((await submitted.json())._pendingSubmitted).toBe(true);

    // ...and rejected HERE, at approval - the last checkpoint before it is real.
    const approved = await admin.post(`${BASE_URL}/api/products/${product.id}/approve`, {
      data: { action: "approve" },
    });
    expect(approved.ok()).toBeTruthy();
    const result = await approved.json();

    // The mismatched unit must NOT have been written...
    expect(result.unitConversions ?? []).toHaveLength(0);
    // ...and the admin must be told which one was dropped, by NAME not by id.
    expect(result.unresolvedPackingUnits).toContain(packingUnit.name);

    // Confirm it really is absent from storage, not just from the response.
    const reread = await admin.get(`${BASE_URL}/api/products/${product.id}`);
    expect((await reread.json()).unitConversions ?? []).toHaveLength(0);
  });

  // -- The same round trip, with a VALID unit, must still work ---------------
  test("approving a staff edit still applies a packing unit that does belong", async () => {
    const units = await getUnits(admin);
    const packingUnit = units.find((u) => u.parentUnitId && (u.conversionFactor ?? 0) > 0);
    test.skip(!packingUnit, "seed has no usable packing unit");

    // base IS the packing unit's parent, so the unit is legitimate here.
    const product = await createProduct(admin, "GuardOK", packingUnit!.parentUnitId!);

    await staff.put(`${BASE_URL}/api/products/${product.id}`, {
      data: { unitConversions: [{ unitId: packingUnit!.id, barcode: null }] },
    });

    const approved = await admin.post(`${BASE_URL}/api/products/${product.id}/approve`, {
      data: { action: "approve" },
    });
    const result = await approved.json();

    // The guard must not be over-eager: a legitimate unit still lands.
    expect(result.unitConversions).toHaveLength(1);
    expect(result.unitConversions[0].unitId).toBe(packingUnit!.id);
    expect(result.unresolvedPackingUnits).toBeUndefined();
  });

  // -- Direct admin edit keeps rejecting outright (pre-existing guard) -------
  test("a direct admin edit rejects a mismatched packing unit with 400", async () => {
    const pair = await pickMismatchedPair(admin);
    test.skip(!pair, "seed has no unit pair that can express the mismatch");

    const product = await createProduct(admin, "GuardDirect", pair!.baseUnit.id);

    const res = await admin.put(`${BASE_URL}/api/products/${product.id}`, {
      data: { unitConversions: [{ unitId: pair!.packingUnit.id, barcode: null }] },
    });
    expect(res.status()).toBe(400);
    expect((await res.json()).error).toContain("packing unit");
  });

  // -- Order edit must not accept a unit unrelated to the line's product -----
  // Builds its own product and GRN so the mismatch is guaranteed, and so the
  // test never mutates seeded orders other tests rely on.
  test("order edit rejects an input unit from a different base unit", async () => {
    const pair = await pickMismatchedPair(admin);
    test.skip(!pair, "seed has no unit pair that can express the mismatch");
    const { baseUnit, packingUnit } = pair!;

    const location = (await (await admin.get(`${BASE_URL}/api/locations`)).json())[0];
    const product = await createProduct(admin, "OrderGuard", baseUnit.id);

    const orderRes = await admin.post(`${BASE_URL}/api/orders`, {
      data: { type: "GRN", toLocationId: location.id, lines: [{ productId: product.id, quantity: 10 }] },
    });
    // POST /api/orders answers { order: {...} }, not a bare order.
    const created = await orderRes.json();
    const order = created.order ?? created;
    expect(order?.id, `GRN create failed: ${orderRes.status()} ${JSON.stringify(created).slice(0, 300)}`).toBeTruthy();

    const res = await admin.put(`${BASE_URL}/api/orders/${order.id}`, {
      data: {
        lines: [{
          productId: product.id,
          quantity: 10,
          inputQty: 1,
          inputUnit: packingUnit.name,   // measured in a different base unit
        }],
      },
    });
    expect(res.status()).toBe(400);
    expect((await res.json()).error).toContain("not a valid packing unit");

    // The order must be untouched - a rejected edit changes nothing.
    const after = await (await admin.get(`${BASE_URL}/api/orders/${order.id}`)).json();
    expect(after.lines).toHaveLength(1);
    expect(after.lines[0].quantity).toBe(10);
  });

  // -- A packing unit added on EDIT must get a barcode, like one added on -----
  //    CREATE. Without it the box cannot be scanned or labelled, and the form
  //    says "auto if blank" — so a silent null here is a broken promise.
  test("a packing unit added while editing is given a barcode", async () => {
    const units = await getUnits(admin);
    const packingUnit = units.find((u) => u.parentUnitId && (u.conversionFactor ?? 0) > 0);
    test.skip(!packingUnit, "seed has no usable packing unit");

    // Created with NO packing units, then given one via edit.
    const product = await createProduct(admin, "EditBarcode", packingUnit!.parentUnitId!);
    expect((await (await admin.get(`${BASE_URL}/api/products/${product.id}`)).json()).unitConversions)
      .toHaveLength(0);

    const res = await admin.put(`${BASE_URL}/api/products/${product.id}`, {
      data: { unitConversions: [{ unitId: packingUnit!.id, barcode: null }] },
    });
    expect(res.ok(), `edit failed: ${res.status()} ${await res.text()}`).toBeTruthy();

    const saved = (await res.json()).unitConversions;
    expect(saved).toHaveLength(1);
    expect(saved[0].barcode, "packing unit saved without a barcode").toBeTruthy();

    // Re-saving must not churn the barcode it was just given.
    const again = await admin.put(`${BASE_URL}/api/products/${product.id}`, {
      data: { unitConversions: [{ unitId: packingUnit!.id, barcode: saved[0].barcode }] },
    });
    expect((await again.json()).unitConversions[0].barcode).toBe(saved[0].barcode);
  });

  // -- Settings: re-pointing an in-use unit's parent is refused outright -----
  test("changing an in-use unit's parent never asks to confirm a factor change", async () => {
    const units = await getUnits(admin);
    const packingUnit = units.find((u) => u.parentUnitId && (u.conversionFactor ?? 0) > 0);
    test.skip(!packingUnit, "no packing unit in the seed");
    const otherRoot = units.find((u) => !u.parentUnitId && u.id !== packingUnit!.parentUnitId);
    test.skip(!otherRoot, "no alternative parent to point at");

    const res = await admin.put(`${BASE_URL}/api/units/${packingUnit!.id}`, {
      data: { parentUnitId: otherRoot!.id, conversionFactor: packingUnit!.conversionFactor },
    });
    const body = await res.json();

    // Whether or not the unit is currently in use, a parent-only change must
    // never come back as a factor-change confirmation prompt.
    expect(body.warning).toBeUndefined();
    if (res.status() === 409) expect(body.error).toContain("Cannot change what");
  });
});
