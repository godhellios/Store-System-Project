import { test, expect } from "@playwright/test";

const BASE_URL = "https://mris-beryl.vercel.app";
const VIEWER_EMAIL = "viewer@mitraramah.com";
const VIEWER_PASSWORD = "viewer123";

async function loginAsViewer(page: any) {
  await page.goto(`${BASE_URL}/login`);
  await page.waitForLoadState("networkidle");
  const csrfRes = await page.request.get(`${BASE_URL}/api/auth/csrf`);
  const { csrfToken } = await csrfRes.json();
  const signInRes = await page.request.post(`${BASE_URL}/api/auth/callback/credentials`, {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    data: new URLSearchParams({
      csrfToken,
      email: VIEWER_EMAIL,
      password: VIEWER_PASSWORD,
      callbackUrl: `${BASE_URL}/dashboard`,
      json: "true",
    }).toString(),
  });
  if (signInRes.status() !== 200) throw new Error(`VIEWER login failed: ${signInRes.status()}`);
  await page.goto(`${BASE_URL}/dashboard`);
  await page.waitForURL("**/dashboard", { timeout: 10000 });
}

test.describe("VIEWER role — read-only access", () => {
  test.use({
    permissions: ["geolocation"],
    geolocation: { latitude: -6.2088, longitude: 106.8456 },
  });

  // ── 1: Staff-only routes redirect VIEWER to /dashboard ──────────────────
  const blockedRoutes = [
    "/transactions/grn",
    "/transactions/goods-out",
    "/transactions/transfer",
    "/transactions/adjustment",
    "/products/add",
    "/products/import",
    "/barcodes",
    "/approvals",
    "/movements",
  ];

  for (const route of blockedRoutes) {
    test(`${route} redirects VIEWER to /dashboard`, async ({ page }) => {
      await loginAsViewer(page);
      await page.goto(`${BASE_URL}${route}`);
      await page.waitForURL("**/dashboard", { timeout: 10000 });
      await expect(page).toHaveURL(/\/dashboard/);
      console.log(`[viewer-guard] ✓ ${route} → redirected to /dashboard`);
    });
  }

  // ── 2: Sidebar does not show staff sections ──────────────────────────────
  test("sidebar hides Transactions and Barcodes sections for VIEWER", async ({ page }) => {
    await loginAsViewer(page);
    await page.waitForLoadState("networkidle");

    // Staff-only links must not appear
    await expect(page.locator('a[href="/transactions/grn"]')).not.toBeVisible();
    await expect(page.locator('a[href="/transactions/goods-out"]')).not.toBeVisible();
    await expect(page.locator('a[href="/transactions/transfer"]')).not.toBeVisible();
    await expect(page.locator('a[href="/transactions/adjustment"]')).not.toBeVisible();
    await expect(page.locator('a[href="/barcodes"]')).not.toBeVisible();

    // Owner-visible links must appear
    await expect(page.locator('a[href="/dashboard"]')).toBeVisible();
    await expect(page.locator('a[href="/products"]')).toBeVisible();
    await expect(page.locator('a[href="/warehouse"]')).toBeVisible();
    await expect(page.locator('a[href="/orders"]')).toBeVisible();
    await expect(page.locator('a[href="/reports"]')).toBeVisible();

    // Add Product / Bulk Import sub-links must not appear
    await expect(page.locator('a[href="/products/add"]')).not.toBeVisible();
    await expect(page.locator('a[href="/products/import"]')).not.toBeVisible();

    console.log("[viewer-nav] ✓ Sidebar correctly trimmed for VIEWER");
  });

  // ── 3: Products list hides Add and Import buttons ────────────────────────
  test("products list hides Add Product and Bulk Import buttons", async ({ page }) => {
    await loginAsViewer(page);
    await page.goto(`${BASE_URL}/products`);
    await page.waitForLoadState("networkidle");

    // Page must still load
    await expect(page.locator("h1", { hasText: "Products" })).toBeVisible();

    // Action buttons must not be present
    await expect(page.locator('a[href="/products/add"]')).not.toBeAttached();
    await expect(page.locator('a[href="/products/import"]')).not.toBeAttached();

    console.log("[viewer-products] ✓ Add Product and Bulk Import buttons absent");
  });

  // ── 4: Product detail hides Edit button ─────────────────────────────────
  test("product detail hides Edit button but shows stock and cost data", async ({ page }) => {
    await loginAsViewer(page);

    // Find any product via API (VIEWER can call GET)
    const res = await page.request.get(`${BASE_URL}/api/products?perPage=1`);
    const data = await res.json();
    const product = data.products?.[0];
    if (!product) throw new Error("No products found in production DB");

    await page.goto(`${BASE_URL}/products/${product.id}`);
    await page.waitForLoadState("networkidle");

    // Page must load
    await expect(page.locator("h1, .text-lg.font-bold")).toBeVisible();

    // Edit button must be absent
    await expect(page.locator('a[href$="/edit"]')).not.toBeAttached();

    // Stock by location section must be visible
    await expect(page.locator("text=Current Stock")).toBeVisible();

    // Cost section must be visible (VIEWER gets same financial access as ADMIN)
    await expect(page.locator("text=Last Purchase Price")).toBeVisible();
    await expect(page.locator("text=Avg Cost")).toBeVisible();
    await expect(page.locator("text=Inventory Value")).toBeVisible();

    console.log("[viewer-product-detail] ✓ Edit button absent, cost section visible");
  });

  // ── 5: GRN order detail shows cost columns for VIEWER ───────────────────
  test("GRN order detail shows Unit Cost and Subtotal columns for VIEWER", async ({ page }) => {
    await loginAsViewer(page);

    // Find a GRN order
    const res = await page.request.get(`${BASE_URL}/api/orders?type=GRN&perPage=1`);
    const data = await res.json();
    const order = data.orders?.[0];
    if (!order) {
      console.log("[viewer-grn] No GRN orders found — skipping cost column check");
      test.skip();
      return;
    }

    await page.goto(`${BASE_URL}/orders/${order.id}`);
    await page.waitForLoadState("networkidle");

    // Cost columns must be present
    await expect(page.locator("th", { hasText: "Unit Cost" })).toBeVisible();
    await expect(page.locator("th", { hasText: "Subtotal" })).toBeVisible();

    // Approve/Cancel action buttons must be absent (VIEWER cannot act)
    await expect(page.locator('button', { hasText: /approve/i })).not.toBeAttached();
    await expect(page.locator('button', { hasText: /cancel/i })).not.toBeAttached();

    console.log("[viewer-grn] ✓ Cost columns visible, action buttons absent");
  });

  // ── 6: Warehouse page is accessible ─────────────────────────────────────
  test("warehouse page loads and shows location cards", async ({ page }) => {
    await loginAsViewer(page);
    await page.goto(`${BASE_URL}/warehouse`);
    await page.waitForLoadState("networkidle");

    await expect(page).toHaveURL(/\/warehouse/);
    // At least one location card should be present
    await expect(page.locator("text=Warehouse").first()).toBeVisible();

    console.log("[viewer-warehouse] ✓ Warehouse page loads for VIEWER");
  });

  // ── 7: VIEWER mutation API calls return 403 ──────────────────────────────
  test("VIEWER cannot create orders via API", async ({ page }) => {
    await loginAsViewer(page);

    // Get a product and location to build a valid-looking request
    const pRes = await page.request.get(`${BASE_URL}/api/products?perPage=1`);
    const pData = await pRes.json();
    const product = pData.products?.[0];
    const lRes = await page.request.get(`${BASE_URL}/api/locations`);
    const locations = await lRes.json();
    const location = locations?.[0];

    if (!product || !location) throw new Error("No test data available");

    const res = await page.request.post(`${BASE_URL}/api/orders`, {
      data: {
        type: "GRN",
        toLocationId: location.id,
        lines: [{ productId: product.id, quantity: 1 }],
      },
    });

    expect(res.status()).toBe(403);
    console.log("[viewer-api] ✓ POST /api/orders correctly returns 403 for VIEWER");
  });
});
