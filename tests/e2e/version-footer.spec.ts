// The footer version must agree with src/lib/version.ts on every page.
//
// Before v1.8.1 the version was written out in six places (the app shell, the
// login page, and four translated strings), so a release could easily update
// some and miss others. It now comes from one constant, and this checks that
// what actually renders matches it — including that no OTHER version string is
// left behind anywhere on the page.
//
// Deliberately version-agnostic: it reads APP_VERSION rather than hard-coding
// a number, so it keeps working after the next bump without being edited.
import { test, expect, request as playwrightRequest, type BrowserContext } from "@playwright/test";
import { APP_VERSION } from "../../src/lib/version";

const BASE_URL = "http://localhost:3000";

test.use({ permissions: ["geolocation"], geolocation: { latitude: -6.2088, longitude: 106.8456 } });

// Every page inside (app) renders the shared AppShell footer. This walks the
// real routes rather than trusting that they all use the shared layout.
const APP_PAGES = [
  "/dashboard", "/products", "/products/add", "/products/pending", "/warehouse",
  "/orders", "/orders/pending", "/movements", "/opname", "/barcodes", "/reports",
  "/settings", "/settings/users", "/settings/audit-log", "/settings/opening-stock",
  "/transactions/grn", "/transactions/goods-out", "/transactions/transfer",
  "/transactions/adjustment", "/approvals", "/products/import", "/products/images",
];

/** Any vN.N or vN.N.N string, so a stale version anywhere is caught. */
const ANY_VERSION = /v\d+\.\d+(\.\d+)?/g;

async function signInBrowser(context: BrowserContext) {
  const api = await playwrightRequest.newContext({ baseURL: BASE_URL });
  const { csrfToken } = await (await api.get(`${BASE_URL}/api/auth/csrf`)).json();
  const res = await api.post(`${BASE_URL}/api/auth/callback/credentials`, {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    data: new URLSearchParams({
      csrfToken, email: "admin@mitraramah.com", password: "wirawan123",
      callbackUrl: `${BASE_URL}/dashboard`, json: "true",
    }).toString(),
  });
  if (res.status() !== 200) throw new Error(`Login failed: ${res.status()}`);
  await context.addCookies((await api.storageState()).cookies);
  await api.dispose();
}

test("login page footer shows the current version", async ({ page }) => {
  await page.goto(`${BASE_URL}/login`);
  const footerText = await page.locator("body").textContent();
  expect(footerText).toContain(APP_VERSION);
  // No other version may appear alongside it.
  for (const found of footerText?.match(ANY_VERSION) ?? []) {
    expect(found, "a stale version string is rendered on the login page").toBe(APP_VERSION);
  }
});

test("app shell footer shows the current version on every page", async ({ page, context }) => {
  await signInBrowser(context);

  for (const path of APP_PAGES) {
    await page.goto(`${BASE_URL}${path}`);
    const footer = page.locator("footer");
    await expect(footer, `footer missing on ${path}`).toBeVisible();
    await expect(footer, `wrong version on ${path}`).toContainText(APP_VERSION);

    for (const found of (await footer.textContent())?.match(ANY_VERSION) ?? []) {
      expect(found, `stale version "${found}" in the footer on ${path}`).toBe(APP_VERSION);
    }
  }
});

test("footer shows the version in Indonesian too", async ({ page, context }) => {
  await signInBrowser(context);
  await context.addCookies([{ name: "locale", value: "id", url: BASE_URL }]);

  await page.goto(`${BASE_URL}/dashboard`);
  const footer = page.locator("footer");
  await expect(footer).toContainText(APP_VERSION);
  await expect(footer).toContainText("Mitra Ramah");
});
