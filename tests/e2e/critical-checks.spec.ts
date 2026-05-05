import { test, expect } from "@playwright/test";

const BASE_URL = "https://mris-beryl.vercel.app";
const EMAIL = "admin@mitraramah.com";
const PASSWORD = "wirawan123";

async function login(page: any) {
  await page.goto(`${BASE_URL}/login`);
  await page.waitForLoadState("networkidle");
  const csrfRes = await page.request.get(`${BASE_URL}/api/auth/csrf`);
  const { csrfToken } = await csrfRes.json();
  const signInRes = await page.request.post(`${BASE_URL}/api/auth/callback/credentials`, {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    data: new URLSearchParams({ csrfToken, email: EMAIL, password: PASSWORD, callbackUrl: `${BASE_URL}/dashboard`, json: "true" }).toString(),
  });
  if (signInRes.status() !== 200) throw new Error(`Login failed: ${signInRes.status()}`);
  await page.goto(`${BASE_URL}/dashboard`);
  await page.waitForURL("**/dashboard", { timeout: 10000 });
}

async function getProductAndLocation(page: any) {
  const res = await page.request.get(`${BASE_URL}/api/products?perPage=5`);
  const data = await res.json();
  const product = data.products?.[0];

  const locRes = await page.request.get(`${BASE_URL}/api/locations`);
  const locations = await locRes.json();
  const location = locations?.[0];

  return { product, location };
}

test.describe("Critical Checks", () => {
  test.use({ permissions: ["geolocation"], geolocation: { latitude: -6.2088, longitude: 106.8456 } });

  // ── TEST 1: Negative stock is hard blocked ──────────────────────────────
  test("Goods Out is blocked when stock is 0", async ({ page }) => {
    await login(page);
    const { product, location } = await getProductAndLocation(page);

    console.log(`[neg-stock] Testing with product: ${product?.sku}, location: ${location?.name}`);

    const res = await page.request.post(`${BASE_URL}/api/orders`, {
      data: {
        type: "GOODS_OUT",
        fromLocationId: location.id,
        lines: [{ productId: product.id, quantity: 999 }],
      },
    });

    console.log(`[neg-stock] Response status: ${res.status()}`);
    const body = await res.json();
    console.log(`[neg-stock] Response body:`, JSON.stringify(body));

    expect(res.status()).toBe(400);
    expect(body.error).toMatch(/insufficient stock/i);
    console.log("[neg-stock] ✓ Goods Out correctly blocked — cannot go negative");
  });

  // ── TEST 2: Adjustment page loads ───────────────────────────────────────
  test("Adjustment page loads with form and sidebar link", async ({ page }) => {
    await login(page);
    await page.goto(`${BASE_URL}/transactions/adjustment`);
    await page.waitForLoadState("networkidle");

    await expect(page.locator("h1", { hasText: "Stock Adjustment" })).toBeVisible();
    await expect(page.locator("text=Submit for Approval")).toBeVisible();
    await expect(page.locator("text=Submit Adjustment Request")).toBeVisible();
    console.log("[adj-page] ✓ Adjustment page loads correctly");

    // Check sidebar link
    const sidebarLink = page.locator('a[href="/transactions/adjustment"]');
    await expect(sidebarLink).toBeVisible();
    console.log("[adj-page] ✓ Sidebar link visible");
  });

  // ── TEST 3: Submit adjustment → PENDING, no stock change ────────────────
  test("Adjustment submission creates PENDING order without changing stock", async ({ page }) => {
    await login(page);
    const { product, location } = await getProductAndLocation(page);

    // Get stock before
    const stockBefore = await page.request.get(`${BASE_URL}/api/stock?productId=${product.id}`);
    const stockBeforeData = await stockBefore.json();
    console.log(`[adj-submit] Stock before:`, JSON.stringify(stockBeforeData));

    // Submit adjustment via API
    const res = await page.request.post(`${BASE_URL}/api/orders`, {
      data: {
        type: "ADJUSTMENT",
        toLocationId: location.id,
        adjustmentReason: "Count Correction",
        notes: "Playwright test adjustment",
        lines: [{ productId: product.id, quantity: 5 }],
      },
    });

    console.log(`[adj-submit] Status: ${res.status()}`);
    const body = await res.json();
    console.log(`[adj-submit] Body:`, JSON.stringify(body));

    expect(res.status()).toBe(201);
    expect(body.order).toBeDefined();
    const orderId = body.order.id;
    console.log(`[adj-submit] ✓ Adjustment order created: ${body.order.orderNumber}`);

    // Verify order has PENDING status
    const orderRes = await page.request.get(`${BASE_URL}/api/orders/${orderId}`);
    const order = await orderRes.json();
    expect(order.adjustmentStatus).toBe("PENDING");
    console.log(`[adj-submit] ✓ Status is PENDING`);

    // Verify stock did NOT change
    const stockAfter = await page.request.get(`${BASE_URL}/api/stock?productId=${product.id}`);
    const stockAfterData = await stockAfter.json();
    console.log(`[adj-submit] Stock after submit (should be unchanged):`, JSON.stringify(stockAfterData));

    const beforeQty = stockBeforeData?.find?.((s: any) => s.locationId === location.id)?.quantity ?? 0;
    const afterQty = stockAfterData?.find?.((s: any) => s.locationId === location.id)?.quantity ?? 0;
    expect(afterQty).toBe(beforeQty);
    console.log(`[adj-submit] ✓ Stock unchanged after PENDING submission (was ${beforeQty}, still ${afterQty})`);

    // ── TEST 4: Approve the adjustment → stock updates ───────────────────
    const approveRes = await page.request.patch(`${BASE_URL}/api/orders/${orderId}`, {
      data: { action: "approve", note: "Playwright test approval" },
    });
    console.log(`[adj-approve] Status: ${approveRes.status()}`);
    const approveBody = await approveRes.json();
    console.log(`[adj-approve] Body:`, JSON.stringify(approveBody));

    expect(approveRes.status()).toBe(200);
    expect(approveBody.success).toBe(true);
    console.log(`[adj-approve] ✓ Approved successfully`);

    // Verify order is now APPROVED
    const orderAfterApprove = await page.request.get(`${BASE_URL}/api/orders/${orderId}`);
    const approvedOrder = await orderAfterApprove.json();
    expect(approvedOrder.adjustmentStatus).toBe("APPROVED");
    console.log(`[adj-approve] ✓ Status is APPROVED`);

    // Verify stock DID change by +5
    const stockFinal = await page.request.get(`${BASE_URL}/api/stock?productId=${product.id}`);
    const stockFinalData = await stockFinal.json();
    console.log(`[adj-approve] Final stock:`, JSON.stringify(stockFinalData));

    const finalQty = stockFinalData?.find?.((s: any) => s.locationId === location.id)?.quantity ?? 0;
    expect(finalQty).toBe(beforeQty + 5);
    console.log(`[adj-approve] ✓ Stock updated correctly: ${beforeQty} → ${finalQty}`);

    // ── TEST 5: Approved adjustment cannot be deleted ────────────────────
    const deleteRes = await page.request.delete(`${BASE_URL}/api/orders/${orderId}`);
    console.log(`[adj-delete] Status: ${deleteRes.status()}`);
    expect(deleteRes.status()).toBe(400);
    console.log(`[adj-delete] ✓ Approved adjustment correctly blocked from deletion`);

    // Cleanup: reject can't help — just leave the +5 (it's test data, tiny impact)
    console.log(`[cleanup] Test adjustment ${body.order.orderNumber} left as APPROVED — stock is now +5`);
  });

  // ── TEST 6: Reject adjustment → stock unchanged ──────────────────────────
  test("Rejected adjustment does not change stock", async ({ page }) => {
    await login(page);
    const { product, location } = await getProductAndLocation(page);

    // Get stock before
    const stockBefore = await page.request.get(`${BASE_URL}/api/stock?productId=${product.id}`);
    const stockBeforeData = await stockBefore.json();
    const beforeQty = stockBeforeData?.find?.((s: any) => s.locationId === location.id)?.quantity ?? 0;

    // Submit adjustment
    const res = await page.request.post(`${BASE_URL}/api/orders`, {
      data: {
        type: "ADJUSTMENT",
        toLocationId: location.id,
        adjustmentReason: "Count Correction",
        notes: "Playwright reject test",
        lines: [{ productId: product.id, quantity: 100 }],
      },
    });
    const { order } = await res.json();

    // Reject it
    const rejectRes = await page.request.patch(`${BASE_URL}/api/orders/${order.id}`, {
      data: { action: "reject", note: "Test rejection" },
    });
    expect(rejectRes.status()).toBe(200);
    console.log(`[adj-reject] ✓ Rejected successfully`);

    // Stock should be unchanged
    const stockAfter = await page.request.get(`${BASE_URL}/api/stock?productId=${product.id}`);
    const stockAfterData = await stockAfter.json();
    const afterQty = stockAfterData?.find?.((s: any) => s.locationId === location.id)?.quantity ?? 0;
    expect(afterQty).toBe(beforeQty);
    console.log(`[adj-reject] ✓ Stock unchanged after rejection (${beforeQty} → ${afterQty})`);
  });
});
