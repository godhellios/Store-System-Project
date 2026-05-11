import { test, expect } from "@playwright/test";

const BASE_URL = "https://mris-beryl.vercel.app";
const EMAIL = "admin@mitraramah.com";
const PASSWORD = "wirawan123";

async function login(page: any) {
  await page.context().grantPermissions(["geolocation"]);
  await page.context().setGeolocation({ latitude: -6.2, longitude: 106.8 });
  await page.goto(`${BASE_URL}/login`);
  await page.waitForLoadState("networkidle");
  const csrfRes = await page.request.get(`${BASE_URL}/api/auth/csrf`);
  const { csrfToken } = await csrfRes.json();
  await page.request.post(`${BASE_URL}/api/auth/callback/credentials`, {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    data: new URLSearchParams({ csrfToken, email: EMAIL, password: PASSWORD, callbackUrl: `${BASE_URL}/dashboard`, json: "true" }).toString(),
  });
  await page.goto(`${BASE_URL}/dashboard`);
  await page.waitForURL("**/dashboard", { timeout: 10000 });
}

const PAGES = [
  "/dashboard",
  "/products",
  "/warehouse",
  "/orders",
  "/movements",
  "/reports",
  "/opname",
  "/barcodes",
  "/transactions/grn",
  "/transactions/goods-out",
  "/transactions/transfer",
  "/transactions/adjustment",
  "/settings",
  "/settings/users",
  "/settings/audit-log",
];

test("health check — all pages load without server error", async ({ page }) => {
  test.setTimeout(90000);
  await login(page);

  for (const path of PAGES) {
    await page.goto(`${BASE_URL}${path}`);
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(1500);

    const bodyText = await page.locator("body").textContent();
    const hasServerError = bodyText?.includes("server error") || bodyText?.includes("A server error occurred");
    const url = page.url();

    if (hasServerError) {
      console.log(`❌ ${path} — SERVER ERROR`);
    } else {
      console.log(`✓ ${path}`);
    }

    expect(hasServerError, `${path} shows a server error`).toBe(false);
  }
});
