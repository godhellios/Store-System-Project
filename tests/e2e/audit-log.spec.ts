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

async function getFirstProductAndLocation(page: any) {
  const prodRes = await page.request.get(`${BASE_URL}/api/products?perPage=5`);
  const prodData = await prodRes.json();
  const product = prodData.products?.[0];
  const locRes = await page.request.get(`${BASE_URL}/api/locations`);
  const locations = await locRes.json();
  const location = locations?.[0];
  return { product, location };
}

async function createGRN(page: any, productId: string, locationId: string) {
  const res = await page.request.post(`${BASE_URL}/api/orders`, {
    data: { type: "GRN", toLocationId: locationId, lines: [{ productId, quantity: 1 }], notes: "Audit log test" },
  });
  expect(res.status()).toBe(201);
  const data = await res.json();
  return data.order;
}

async function dismissLocationModal(page: any) {
  // Grant geolocation so the app's location modal doesn't block UI
  await page.context().grantPermissions(["geolocation"]);
  await page.context().setGeolocation({ latitude: -6.2, longitude: 106.8 });
  // Dismiss any overlay modal if still visible
  const modal = page.locator(".fixed.inset-0.z-50");
  if (await modal.isVisible().catch(() => false)) {
    await page.keyboard.press("Escape");
  }
}

test.describe("Audit Log", () => {
  test("API returns paginated entries for admin after writing an order", async ({ page }) => {
    await login(page);

    const { product, location } = await getFirstProductAndLocation(page);
    if (!product || !location) { console.log("No product/location — skipping"); return; }

    // Ensure there's at least one log entry by creating a GRN
    const order = await createGRN(page, product.id, location.id);
    console.log(`[setup] Created GRN: ${order.orderNumber}`);

    const res = await page.request.get(`${BASE_URL}/api/audit-log?page=1`);
    expect(res.status()).toBe(200);

    const data = await res.json();
    console.log(`[api] total entries: ${data.total}, pages: ${data.pages}`);
    expect(data.total).toBeGreaterThan(0);
    expect(Array.isArray(data.logs)).toBe(true);
    expect(data.logs.length).toBeGreaterThan(0);

    const first = data.logs[0];
    expect(first).toHaveProperty("id");
    expect(first).toHaveProperty("action");
    expect(first).toHaveProperty("description");
    expect(first).toHaveProperty("userName");
    expect(first).toHaveProperty("userRole");
    expect(first).toHaveProperty("createdAt");
    console.log(`[api] most recent: ${first.action} — "${first.description}" by ${first.userName}`);

    // Clean up
    await page.request.delete(`${BASE_URL}/api/orders/${order.id}`);
  });

  test("API filters by action", async ({ page }) => {
    await login(page);

    const res = await page.request.get(`${BASE_URL}/api/audit-log?action=APPROVE_ADJUSTMENT`);
    expect(res.status()).toBe(200);

    const data = await res.json();
    console.log(`[api-filter] APPROVE_ADJUSTMENT entries: ${data.total}`);
    for (const log of data.logs) {
      expect(log.action).toBe("APPROVE_ADJUSTMENT");
    }
    console.log("[api-filter] All returned logs have correct action");
  });

  test("API redirects unauthenticated users to login (middleware protection)", async ({ page }) => {
    // Next.js middleware intercepts unauthenticated requests before our handler,
    // redirecting to /login. Use maxRedirects:0 to see the raw 307.
    const res = await page.request.fetch(`${BASE_URL}/api/audit-log`, { maxRedirects: 0 });
    console.log(`[api-auth] Unauthenticated /api/audit-log status: ${res.status()}`);
    expect(res.status()).toBe(307);
    const location = res.headers()["location"];
    expect(location).toContain("/login");
    console.log(`[api-auth] Redirects to: ${location}`);
  });

  test("Audit log page loads with correct heading and sidebar link", async ({ page }) => {
    await login(page);
    await dismissLocationModal(page);

    await page.goto(`${BASE_URL}/settings/audit-log`);
    await page.waitForLoadState("networkidle");
    await dismissLocationModal(page);

    // Page heading
    const heading = page.locator("h1", { hasText: "Audit Log" });
    await expect(heading).toBeVisible({ timeout: 10000 });
    console.log("[ui] Audit Log heading visible");

    // Subtitle shows entry count
    const subtitle = page.locator("p", { hasText: /entries/ });
    await expect(subtitle).toBeVisible();
    const subtitleText = await subtitle.textContent();
    console.log(`[ui] Subtitle: ${subtitleText}`);

    // Sidebar link
    const link = page.locator('a[href="/settings/audit-log"]');
    await expect(link).toBeVisible();
    console.log("[sidebar] Audit Log link visible");
  });

  test("Audit log shows entry after writing an order", async ({ page }) => {
    await login(page);

    const { product, location } = await getFirstProductAndLocation(page);
    if (!product || !location) { console.log("No product/location — skipping"); return; }

    const totalBefore = await page.request.get(`${BASE_URL}/api/audit-log`)
      .then((r) => r.json()).then((d) => d.total);
    console.log(`[write-test] Audit log total before: ${totalBefore}`);

    const order = await createGRN(page, product.id, location.id);
    console.log(`[write-test] Created GRN: ${order.orderNumber}`);

    const afterData = await page.request.get(`${BASE_URL}/api/audit-log`).then((r) => r.json());
    console.log(`[write-test] Audit log total after: ${afterData.total}`);
    expect(afterData.total).toBeGreaterThan(totalBefore);

    const latest = afterData.logs[0];
    expect(latest.action).toBe("CREATE_GRN");
    expect(latest.entityId).toBe(order.id);
    expect(latest.entityType).toBe("ORDER");
    console.log(`[write-test] Latest: ${latest.action} — "${latest.description}" by ${latest.userName} (${latest.userRole})`);

    // Clean up
    await page.request.delete(`${BASE_URL}/api/orders/${order.id}`);
  });

  test("Audit log filter works via API (action=CREATE_GRN)", async ({ page }) => {
    await login(page);

    const { product, location } = await getFirstProductAndLocation(page);
    if (!product || !location) { console.log("No product/location — skipping"); return; }

    // Create a GRN to ensure there's at least one CREATE_GRN entry
    const order = await createGRN(page, product.id, location.id);

    const res = await page.request.get(`${BASE_URL}/api/audit-log?action=CREATE_GRN`);
    expect(res.status()).toBe(200);
    const data = await res.json();
    console.log(`[filter] CREATE_GRN entries: ${data.total}`);
    expect(data.total).toBeGreaterThan(0);
    for (const log of data.logs) {
      expect(log.action).toBe("CREATE_GRN");
    }
    console.log("[filter] All entries have action=CREATE_GRN");

    // Entity type filter
    const resOrder = await page.request.get(`${BASE_URL}/api/audit-log?entityType=ORDER`);
    const dataOrder = await resOrder.json();
    console.log(`[filter] ORDER entity entries: ${dataOrder.total}`);
    for (const log of dataOrder.logs) {
      expect(log.entityType).toBe("ORDER");
    }

    // Clean up
    await page.request.delete(`${BASE_URL}/api/orders/${order.id}`);
  });

  test("Audit log page filter UI works (dismiss location modal first)", async ({ page }) => {
    await login(page);

    // Grant geolocation permission before navigating to avoid modal blocking
    await page.context().grantPermissions(["geolocation"]);
    await page.context().setGeolocation({ latitude: -6.2, longitude: 106.8 });

    const { product, location } = await getFirstProductAndLocation(page);
    if (!product || !location) { console.log("No product/location — skipping"); return; }

    // Create a GRN so there's at least one entry to filter
    const order = await createGRN(page, product.id, location.id);

    await page.goto(`${BASE_URL}/settings/audit-log`);
    await page.waitForLoadState("networkidle");

    // Wait for heading to confirm page loaded
    await page.locator("h1", { hasText: "Audit Log" }).waitFor({ timeout: 10000 });

    // Dismiss any remaining modal
    const modal = page.locator(".fixed.inset-0.z-50");
    if (await modal.isVisible().catch(() => false)) {
      await modal.locator("button", { hasText: /dismiss|close|coba/i }).click().catch(() => {});
    }

    // Select action filter
    await page.selectOption("select", { value: "CREATE_GRN" });
    await page.click("button[type=submit]");
    // Wait for the loading state to resolve
    await page.locator("text=Loading…").waitFor({ state: "hidden", timeout: 10000 }).catch(() => {});
    await page.waitForLoadState("networkidle");

    // All log entries shown should be CREATE_GRN — target action badge (rounded-full span)
    const badges = page.locator(".rounded-xl.border .rounded-full");
    const count = await badges.count();
    console.log(`[ui-filter] Cards after CREATE_GRN filter: ${count}`);
    expect(count).toBeGreaterThan(0);
    for (let i = 0; i < count; i++) {
      const text = await badges.nth(i).textContent();
      expect(text?.trim()).toBe("CREATE GRN");
    }
    console.log("[ui-filter] All badges show CREATE GRN");

    // Clean up
    await page.request.delete(`${BASE_URL}/api/orders/${order.id}`);
  });
});
