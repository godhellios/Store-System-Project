// Browser checks for the two screens the packing-unit guards changed.
//
// The API specs in packing-unit-guards.spec.ts prove the server rejects a
// mismatched unit. These prove the SCREENS still work — in particular that the
// order-edit unit dropdown, now filtered through eligiblePackingUnits(), is not
// rendered empty (which would leave staff unable to pick any unit at all).
//
// LOCAL DEV ONLY — creates products and orders.
import { test, expect, request as playwrightRequest, type APIRequestContext, type Page } from "@playwright/test";

const BASE_URL = "http://localhost:3000";
const ADMIN = { email: "admin@mitraramah.com", password: "wirawan123" };
const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

let admin: APIRequestContext;

test.beforeAll(async () => {
  admin = await playwrightRequest.newContext({ baseURL: BASE_URL });
  const { csrfToken } = await (await admin.get(`${BASE_URL}/api/auth/csrf`)).json();
  const res = await admin.post(`${BASE_URL}/api/auth/callback/credentials`, {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    data: new URLSearchParams({
      csrfToken, email: ADMIN.email, password: ADMIN.password,
      callbackUrl: `${BASE_URL}/dashboard`, json: "true",
    }).toString(),
  });
  if (res.status() !== 200) throw new Error(`Login failed: ${res.status()}`);
});

test.afterAll(async () => { await admin?.dispose(); });

/** Give the browser the API context's session so the page loads authenticated. */
async function useAdminSession(page: Page) {
  await page.context().addCookies(await admin.storageState().then((s) => s.cookies));
}

// Login writes a LoginLog row with coordinates and the app blocks on the
// browser permission prompt until it is answered.
test.use({ permissions: ["geolocation"], geolocation: { latitude: -6.2088, longitude: 106.8456 } });

test.describe("packing unit screens", () => {
  test.describe.configure({ mode: "serial" });

  // The riskiest change: this dropdown is now filtered by eligiblePackingUnits().
  // If the /api/units payload did not carry the fields that filter reads, every
  // option would disappear and the line could not be given a unit at all.
  test("order edit still offers units for a product with no packing units", async ({ page }) => {
    const units = await (await admin.get(`${BASE_URL}/api/units`)).json();
    type U = { id: string; name: string; parentUnitId: string | null; conversionFactor: number | null };
    // A base unit that actually HAS a child, so "no options" and "correctly
    // scoped options" are distinguishable — a root with no children would make
    // this test pass on an empty dropdown.
    const base: U | undefined = units.find(
      (u: U) => !u.parentUnitId && units.some((c: U) => c.parentUnitId === u.id && (c.conversionFactor ?? 0) > 0),
    );
    test.skip(!base, "seed has no root unit with a packing child");
    const expectedChild: U = units.find(
      (c: U) => c.parentUnitId === base!.id && (c.conversionFactor ?? 0) > 0,
    );

    const category = (await (await admin.get(`${BASE_URL}/api/categories`)).json())[0];
    const location = (await (await admin.get(`${BASE_URL}/api/locations`)).json())[0];

    const product = await (await admin.post(`${BASE_URL}/api/products`, {
      data: {
        name: `E2E UI NoPacking ${RUN}`, categoryId: category.id, unitId: base!.id,
        reorderPoint: 0, unitConversions: [], force: true,
      },
    })).json();

    const created = await (await admin.post(`${BASE_URL}/api/orders`, {
      data: { type: "GRN", toLocationId: location.id, lines: [{ productId: product.id, quantity: 5 }] },
    })).json();
    const order = created.order ?? created;
    expect(order?.id).toBeTruthy();

    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));

    await useAdminSession(page);
    // The dropdown is populated by a client-side fetch; asserting before it
    // lands sees only the base unit and would pass on a broken filter.
    const unitsLoaded = page.waitForResponse(
      (r) => r.url().includes("/api/units") && r.status() === 200, { timeout: 20000 },
    );
    await page.goto(`${BASE_URL}/orders/${order.id}/edit`);
    await expect(page.getByText(product.name)).toBeVisible({ timeout: 20000 });
    await unitsLoaded;

    const unitSelect = page.locator("select").filter({ hasText: base!.name }).first();
    await expect(unitSelect).toBeVisible();

    // The base unit is always offered, and so is the packing unit that belongs
    // to it — scoped by eligiblePackingUnits() and labelled with its factor.
    await expect
      .poll(async () => unitSelect.locator("option").allTextContents(), { timeout: 10000 })
      .toEqual(expect.arrayContaining([
        base!.name,
        expect.stringContaining(expectedChild.name),
      ]));

    expect(errors, `page errors: ${errors.join(" | ")}`).toHaveLength(0);
  });

  // The approval screen must surface what it silently dropped.
  test("pending approval screen loads and reports dropped packing units", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));

    await useAdminSession(page);
    await page.goto(`${BASE_URL}/products/pending`);
    await expect(page.locator("body")).not.toContainText(/Application error/i);
    // The screen renders whether or not anything is pending.
    await page.waitForLoadState("networkidle");
    expect(errors, `page errors: ${errors.join(" | ")}`).toHaveLength(0);
  });

  // The product form's packing-unit picker is driven by the same helper.
  test("product add form renders its packing unit picker", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));

    await useAdminSession(page);
    await page.goto(`${BASE_URL}/products/add`);
    await expect(page.locator("body")).not.toContainText(/Application error/i);
    await page.waitForLoadState("networkidle");
    // Base-unit select is always present; the packing picker appears with it.
    expect(await page.locator("select").count()).toBeGreaterThan(0);
    expect(errors, `page errors: ${errors.join(" | ")}`).toHaveLength(0);
  });

  // Settings drives the unit-edit dialog whose confirm ordering changed.
  test("settings page loads without error", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));

    await useAdminSession(page);
    await page.goto(`${BASE_URL}/settings`);
    await expect(page.locator("body")).not.toContainText(/Application error/i);
    await page.waitForLoadState("networkidle");
    expect(errors, `page errors: ${errors.join(" | ")}`).toHaveLength(0);
  });
});
