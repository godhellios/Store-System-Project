# MRIS — Full Operational QA Session

> **Paste this entire file as a prompt into a fresh Claude Code session opened in the MRIS working directory.**
> Last updated: 2026-05-21 | Version: v1.5

---

## CRITICAL SAFETY RULES — READ FIRST

1. **NEVER test against the production URL** (`mris-beryl.vercel.app`). All tests must target `http://localhost:3000`.
2. **NEVER push to git** or make commits during this session.
3. **NEVER deploy** during this session.
4. **Check the DATABASE_URL** before touching anything. If it contains `supabase.co` and does NOT contain `sslmode=disable` or a branch indicator, STOP and warn the user — it may point to production.
5. If you find a bug that requires a code fix, **document it in the QA report** — do not fix it mid-session unless the user explicitly asks.

---

## Context

**Project:** MRIS (Mitra Ramah Inventory System) — multi-location garment accessories inventory management  
**Working directory:** `G:\Project Claude\Store System Project\mris`  
**Stack:** Next.js 16, TypeScript, Prisma 7 (adapter-pg), NextAuth v4, Tailwind CSS v4, PostgreSQL  
**Test target:** `http://localhost:3000`

**Business context:** A garment accessories warehouse with three locations (Retail Store, Medium Warehouse, Big Warehouse). Daily operations include receiving goods (GRN), issuing goods (GOODS_OUT), transferring between warehouses, adjusting stock counts, periodic opname (physical stock count), and product management.

**Roles:**
| Role | Can do |
|------|--------|
| ADMIN | Everything — approve orders, manage products, correct costs, view financials |
| STAFF | Create/submit transactions, manage products (pending admin approval) |
| OPERATOR | Approve/process existing orders only — cannot create products |
| VIEWER | Read-only — see stock, orders, reports, product cost data. No create/edit/approve. |

---

## Your Mission

Test MRIS like a real operator on their first week of work — not by reading code, but by actually using the running application. Every scenario below must be executed against `http://localhost:3000`. Log every result as PASS or FAIL with specific details.

---

## Phase 0 — Environment Setup

### 0.1 Read these files first (to understand the system before testing)
- `src/lib/auth.ts` — auth config, understand session structure
- `src/proxy.ts` — Edge middleware (rate limiting, session guard)
- `src/lib/role-guard.ts` — understand `blockViewer`, `blockOperator`, `requireAdmin`
- `prisma/seed.ts` — understand what test data will exist

### 0.2 Safety check
Read `.env.local` and verify `DATABASE_URL` is NOT pointing to production Supabase. If the URL contains `db.supabase.co` with no test/branch indicator, STOP and report this to the user before continuing.

### 0.3 Start the environment
```bash
# Confirm you are in the right directory
pwd

# Check .env.local exists and DATABASE_URL is local/dev
type .env.local 2>$null || cat .env.local

# Reset DB to a clean state and seed test data
npx prisma db push --force-reset
npm run db:seed

# Start dev server in background
npm run dev
```

Wait for the server to be ready — look for `▲ Next.js ready on http://localhost:3000`. Then verify it's up:
```bash
curl -s -o /dev/null -w "%{http_code}" http://localhost:3000
```
Expected: `200` or `307`. If not ready, wait and retry.

### 0.4 Configure Playwright for local testing
The existing `playwright.config.ts` points to production. For this session, run all Playwright tests with `--base-url http://localhost:3000`. Do NOT modify the config file.

Verify Playwright and browsers are installed:
```bash
npx playwright --version
npx playwright install chromium --with-deps
```

### 0.5 Seed verification
After seeding, confirm data exists by visiting `http://localhost:3000` — you should be redirected to `/login`. Login with `admin@mitraramah.com` / `wirawan123` and verify the dashboard loads with products and stock visible.

---

## Phase 1 — Authentication

**Test goal:** Login works, wrong credentials are rejected, logout clears session, redirects protect all pages.

### 1.1 Valid login — each role
For each account below, login at `/login`, confirm redirect to `/dashboard`, and logout:
| Email | Password | Role |
|-------|----------|------|
| admin@mitraramah.com | wirawan123 | ADMIN |
| staff@mitraramah.com | staff123 | STAFF |
| viewer@mitraramah.com | viewer123 | VIEWER |
| operator@mitraramah.com | operator123 | OPERATOR |

**Expected for all:** Login succeeds, dashboard loads, name appears in the sidebar, logout redirects to `/login`.

### 1.2 Wrong password
Attempt login with `admin@mitraramah.com` and password `wrongpassword`.  
**Expected:** Error message shown, no redirect, still on `/login`.

### 1.3 Unauthenticated route protection
While logged OUT, visit each of these URLs directly:
- `http://localhost:3000/dashboard`
- `http://localhost:3000/products`
- `http://localhost:3000/transactions/grn`
- `http://localhost:3000/api/products` (direct API)

**Expected for all:** Redirect to `/login` or `401` response — never the actual page content.

---

## Phase 2 — Role Permissions (Critical)

**Test goal:** The permission model is correct. Wrong roles are blocked at the server, not just hidden in the UI.

Use Playwright for each sub-test. Login as the role specified, then attempt the action.

### 2.1 VIEWER restrictions

Login as `viewer@mitraramah.com`.

| Action | URL / API | Expected |
|--------|-----------|----------|
| Visit `/transactions/grn` | Browser navigate | Redirect to `/dashboard` |
| Visit `/transactions/goods-out` | Browser navigate | Redirect to `/dashboard` |
| Visit `/transactions/transfer` | Browser navigate | Redirect to `/dashboard` |
| Visit `/transactions/adjustment` | Browser navigate | Redirect to `/dashboard` |
| Visit `/products/add` | Browser navigate | Redirect to `/dashboard` |
| Visit `/products/import` | Browser navigate | Redirect to `/dashboard` |
| Visit `/barcodes` | Browser navigate | Redirect to `/dashboard` |
| PATCH /api/products/:id (any productId) | API call with `{correctCost: 5000}` | `403 Forbidden` |
| Check sidebar | Visible in browser | No "Transactions" section, no "Barcodes" link |
| Visit `/products` | Browser navigate | PASS — products list visible |
| Visit `/reports` | Browser navigate | PASS — reports page visible |
| Visit `/warehouse` | Browser navigate | PASS — stock list visible |
| View a product detail | Navigate to any `/products/:id` | PASS — visible; Edit button absent; "Avg Cost" section visible |

### 2.2 OPERATOR restrictions

Login as `operator@mitraramah.com`.

| Action | Expected |
|--------|----------|
| Visit `/products/add` | Redirect to `/dashboard` |
| Visit `/products/import` | Redirect to `/dashboard` |
| Visit `/barcodes` | Redirect to `/dashboard` |
| Visit `/transactions/grn` (the create form) | Redirect to `/dashboard` |
| Visit `/orders` (order list) | PASS — visible |
| Visit a pending GRN order detail | PASS — visible with approve action if OPERATOR has it |

### 2.3 STAFF restrictions

Login as `staff@mitraramah.com`.

| Action | Expected |
|--------|----------|
| Visit `/settings` | Redirect (non-admin blocked) |
| Approve a pending GRN via API: `POST /api/orders/:id/approve` | `403 Forbidden` |
| Visit `/products/add` | PASS — form visible |
| Submit a new product | PASS — goes to pending/DRAFT state (not published directly) |
| Cost section on product detail | Hidden (only ADMIN/VIEWER see cost) |

### 2.4 ADMIN full access
Login as `admin@mitraramah.com`. Verify all sections in the sidebar are visible and accessible:
- Dashboard, Products (with Add/Import/Images sub-links), Transactions (GRN/Goods Out/Transfer/Adjustment), Orders, Warehouse, Barcodes, Reports, Settings

---

## Phase 3 — Product Management

### 3.1 Product list
Login as ADMIN. Navigate to `/products`.
- Products load with name, SKU, category, stock, status columns
- Search by SKU `THR-00001` returns "Thread Roll 100m"
- Search by partial name `"Zipper"` returns "Zipper 30cm"

### 3.2 Product detail
Click "Thread Roll 100m" (THR-00001). Verify:
- Product info card shows SKU, barcode, category, unit, reorder point
- Stock cards show quantities per location
- Cost section is visible (admin is logged in)
- `avgCost` is `null` for all seeded products → the amber **"Set Opening Cost"** banner should appear
- "Correct Cost" link should NOT appear (avgCost is null)
- "Edit" button is visible

### 3.3 Set Opening Cost (per-product form)
On the Thread Roll 100m product detail, use the "Set Opening Cost" form:
1. Enter `12000` and click Save
2. **Expected:** Page refreshes, "Set Opening Cost" banner disappears, Avg Cost card now shows `Rp 12.000`, "Correct Cost" link appears below it

Try to set it again (try entering a different value in the form — it should not appear anymore since avgCost is now set).

### 3.4 Correct Cost modal
Click "Correct Cost" on Thread Roll 100m.
1. Verify the modal shows `Current: Rp 12.000`
2. Enter `15000` and click "Confirm Override"
3. **Expected:** Modal closes, Avg Cost updates to `Rp 15.000`

Try invalid inputs:
- Submit with empty field → "Enter a valid cost greater than zero" error
- Submit with `0` → validation error

### 3.5 Add new product (Admin)
Navigate to `/products/add`. Fill in:
- Name: `Test Product QA`
- SKU: `QA-00001`
- Barcode: `QA000001`
- Category: Thread
- Unit: pcs
- Reorder Point: 10

Submit. **Expected:** Redirect to products list or product detail with the new product visible.

### 3.6 Add new product (Staff — pending approval)
Login as STAFF. Navigate to `/products/add`. Fill in the same fields with a different SKU (`QA-00002`). Submit.  
**Expected:** Product created with `approvalStatus: DRAFT` (pending admin review). A notice should indicate it's pending.

### 3.7 Edit product (Staff — pending changes)
As STAFF, click Edit on an existing product, change the reorder point, and save.  
**Expected:** Changes are stored as `pendingChanges`, not applied directly. A "pending edit" indicator should appear.

Login as ADMIN. Navigate to `/products/pending` (or wherever admin reviews pending edits). Approve the change.  
**Expected:** Product's reorder point is updated.

### 3.8 Deactivate / Activate product
As ADMIN, find "Sewing Needle Set" (BTN-00004). On edit page, toggle `isActive` to false.  
**Expected:** Product shows as Inactive. Creating a new GRN with this product should be blocked.

### 3.9 CSV Export
As ADMIN, navigate to `/products/import`. Click **"Export current products (for cost update)"**.  
**Expected:** A CSV file downloads. Open it and verify:
- Headers include: `name, sku, barcode, category, unit, reorderPoint, colorVariant, description, currentAvgCost, openingCost, correctCost`
- Products are listed (active products only)
- `currentAvgCost` is populated for Thread Roll 100m (just set to 15000) and blank for others

### 3.10 CSV Import — basic round-trip
Download the template CSV from `/products/import`. Add one new row:
```
Test Import Product,QA-IMPORT-001,QAIMP001,Thread,pcs,5,Red,,,,
```
Upload and import as ADMIN.  
**Expected:** Preview shows 1 "New" row. After confirm, 1 product created.

### 3.11 CSV Import — opening cost columns
Export the products CSV. In the exported file:
1. Find a product with blank `currentAvgCost` (not Thread Roll 100m which was already set)
2. Fill in `openingCost = 8000` for it
3. Find Thread Roll 100m and fill in `correctCost = 20000`
4. Import the CSV as ADMIN

**Expected after import:** Done screen shows "Costs set: 2". Navigate to the product details and verify:
- The product that had `openingCost` now shows `avgCost = 8000`
- Thread Roll 100m now shows `avgCost = 20000`

---

## Phase 4 — GRN (Goods Receipt) Flow

**This is the most critical flow.** Stock increases and AVCO cost must both be calculated correctly.

### 4.1 Create GRN as STAFF
Login as STAFF. Navigate to Transactions → GRN. Fill in:
- Supplier: `PT Test Supplier QA`
- Destination: `Big Warehouse`
- Add line: `Thread Roll 100m` (THR-00001), Qty: `100`, Unit Cost: `10000`
- Add line: `Button Black 15mm` (BTN-00002), Qty: `200`, Unit Cost: `5000`

Submit the GRN.  
**Expected:** Order created with `grnStatus: PENDING`. Order number generated (e.g., `GRN-XXXX`). Both line items visible.

### 4.2 Approve GRN as ADMIN
Login as ADMIN. Navigate to Orders. Find the pending GRN. Open it and click Approve.  
**Expected:**
- `grnStatus` changes to `APPROVED`
- Stock for Thread Roll 100m at Big Warehouse increases by 100
- Stock for Button Black 15mm at Big Warehouse increases by 200

### 4.3 Verify AVCO calculation
After GRN approval, check Thread Roll 100m product detail.

**Setup context for verification:**  
Thread Roll 100m had `avgCost = 20000` (set via correctCost earlier) and existing stock.  
The GRN just added 100 units at `10000` each.  

The new AVCO should be: `(existing_stock × 20000 + 100 × 10000) / (existing_stock + 100)`

Navigate to Thread Roll 100m product detail. The Avg Cost (AVCO) should reflect the recalculated average, NOT just the new GRN price. Verify the number makes sense mathematically.

**If avgCost did NOT change from the new GRN price alone — that is a bug. Report it.**

### 4.4 GRN with inactive product (guard test)
As ADMIN, deactivate `Velcro Strip 1m` (FAB-00001). Then have STAFF create a GRN with that product.  
**Expected:** When ADMIN tries to approve, should receive an error like "Product is inactive" — the GRN stays PENDING, stock is NOT modified. Then re-activate FAB-00001.

### 4.5 GRN without cost (opening cost first-GRN scenario)
Find a product with `avgCost = NULL` (e.g., `Thread Roll 200m` — THR-00002).  
Create a GRN for it with Qty: 50, Unit Cost: `9000`. Approve as ADMIN.  
**Expected:** `avgCost` becomes `9000` (no dilution from zero). This is the first-GRN case — verify the math is clean.

---

## Phase 5 — GOODS_OUT Flow

### 5.1 Create and approve GOODS_OUT
Login as STAFF. Create a Goods Out:
- From: Retail Store
- Customer: `CV Test Customer`
- Add line: `Zipper 30cm` (BTN-00001), Qty: `20`

Submit. Login as ADMIN, approve.  
**Expected:** Stock for Zipper 30cm at Retail Store decreases by 20. Visit product detail and verify.

### 5.2 GOODS_OUT blocked by insufficient stock
Retail Store has `120` units of Zipper 30cm (from seed). Try to create a GOODS_OUT for `200` units.  
**Expected:** Approval should be blocked — order stays PENDING with a clear error about insufficient stock.

### 5.3 GOODS_OUT reduces from correct location
Verify the stock decrease happened at **Retail Store**, not Medium or Big Warehouse. Stock at other locations should be unchanged.

---

## Phase 6 — TRANSFER Flow

### 6.1 Create and approve Transfer
Login as STAFF. Create a Transfer:
- From: Big Warehouse
- To: Medium Warehouse
- Add line: `Button White 12mm` (BTN-00003), Qty: `50`

Submit. Login as ADMIN, approve.  
**Expected:** Button White 12mm stock at Big Warehouse decreases by 50; stock at Medium Warehouse increases by 50. Total stock unchanged.

### 6.2 Same-location transfer blocked
Attempt to create a Transfer with From: Big Warehouse, To: Big Warehouse.  
**Expected:** Error returned — either frontend validation or API returns `400 Bad Request`. Do NOT allow it.

### 6.3 Transfer blocked by insufficient stock
Attempt to create a Transfer from Retail Store for `Zipper 30cm` (after deducting 20 in 5.1, remaining is ~100). Transfer `500` units.  
**Expected:** Approval blocked with insufficient stock error.

---

## Phase 7 — ADJUSTMENT Flow

### 7.1 Create and approve positive adjustment
Login as STAFF. Create an Adjustment:
- Location: Medium Warehouse
- Add line: `Elastic Band 2cm` (FAB-00003), Qty: `+5` (positive)
- Notes: `QA test adjustment`

Submit. Login as ADMIN, approve.  
**Expected:** Stock for Elastic Band 2cm at Medium Warehouse increases by 5.

### 7.2 Adjustment auto-rejected on negative balance
Medium Warehouse has 3 units of `Cotton Fabric Plain` (FAB-00002 — from seed). Create an Adjustment with Qty: `-10` (would go below zero).

Submit, then try to approve as ADMIN.  
**Expected:** Order is automatically set to `adjustmentStatus: REJECTED` with a reason like "Insufficient stock". Stock unchanged at 3.

### 7.3 Adjustment with zero — validation
Try to create an Adjustment with Qty: `0`.  
**Expected:** Frontend or API validation error — zero quantity is not allowed.

---

## Phase 8 — Opname (Physical Stock Count) Flow

Opname is the periodic physical count reconciliation. It blocks other transactions for the counted location.

### 8.1 Start an Opname session
Login as ADMIN. Navigate to Opname. Start a new session for `Retail Store`.  
**Expected:** Opname session created with status OPEN. A count sheet is available for all products at Retail Store.

### 8.2 Transaction blocking during Opname
While the Retail Store Opname session is OPEN, try to create a new GRN or GOODS_OUT for Retail Store.  
**Expected:** New transactions affecting Retail Store are blocked with a clear error message.

### 8.3 Enter physical counts
In the count sheet, enter physical quantities for at least 2 products — one that matches book quantity (no diff), one that is different (intentional discrepancy).

### 8.4 Submit and approve Opname
Submit the count sheet for review, then approve as ADMIN.  
**Expected after approval:**
- Opname session closes (status changes to APPROVED or COMPLETED)
- For the product with a discrepancy: a new **ADJUSTMENT** order is created in PENDING state
- Retail Store transactions unblocked

### 8.5 Approve the Opname-generated Adjustment
Navigate to Orders. Find the PENDING adjustment created by the Opname.  
Approve it as ADMIN.  
**Expected:** Stock at Retail Store updated to match the physical count.

---

## Phase 9 — Reports

### 9.1 All report tabs load without error
Login as ADMIN. Navigate to `/reports`. Check each tab loads without error or blank screen:
- Overview / Summary
- Receiving (GRN report)
- Inventory Value
- Turnover (fast/slow moving)

### 9.2 Date range filter
On the Receiving report, change the date range to last 7 days. Verify the data updates (numbers change or zero, but no error thrown).

### 9.3 VIEWER can see financial data
Login as VIEWER. Navigate to `/reports`. Verify:
- Reports page is accessible
- Financial data (inventory value, cost) is visible
- No 403 errors in the browser console

### 9.4 STAFF cannot see cost columns
Login as STAFF. Navigate to a product detail page.  
**Expected:** The "Cost (Admin Only)" section is NOT visible. The Avg Cost and Inventory Value are hidden.

---

## Phase 10 — Edge Cases & Guard Rails

These are specific regression checks for guards that were explicitly built into the system.

| # | Scenario | How to test | Expected |
|---|----------|-------------|----------|
| 10.1 | SKU change blocked with history | Admin edits a product that has orders (e.g., Thread Roll 100m) and tries to change SKU | Error: "SKU cannot be changed — this product already has transaction history" |
| 10.2 | Barcode uniqueness | Try to save two products with the same barcode | Error: "Barcode already in use" |
| 10.3 | Non-admin can't approve GRN via API | POST `http://localhost:3000/api/orders/:id/approve` while authenticated as STAFF | `403 Forbidden` |
| 10.4 | Delete product with order history | Admin tries to delete Thread Roll 100m (has orders) | Error: "Cannot delete: product has order history" |
| 10.5 | Delete product requires deactivation first | Admin tries to delete an active product | Error: "Deactivate the product before deleting" |
| 10.6 | Pending edit conflict | STAFF1 submits pending edit → STAFF2 tries to submit another pending edit for same product | Error: "This product already has a pending edit from [name]" |
| 10.7 | openingCost on already-costed product | PATCH `/api/products/:id` with `{openingCost: 5000}` on a product that already has `avgCost` | `409 Conflict` with clear error |
| 10.8 | Rate limiting active | Send 25 rapid login requests (simulate brute-force) | Requests start being rate-limited (429 or silent block) |
| 10.9 | VIEWER cannot mutate via API | While authenticated as VIEWER, POST `/api/orders` | `403 Forbidden` |
| 10.10 | Transfer same location (API level) | POST `/api/orders` with type=TRANSFER and `fromLocationId === toLocationId` | `400 Bad Request` |

---

## Phase 11 — Dashboard & UX Checks

### 11.1 Low-stock alert
Dashboard should show a low-stock widget. From seed data, multiple products are below reorder point. Verify the count is correct and the product list shows the right items.

### 11.2 Dashboard stats load
All stat cards on the dashboard should show numbers, not "—" or errors.

### 11.3 Barcode scan lookup
Navigate to `/barcodes` (as ADMIN or STAFF). Scan/enter barcode `THR00001001` (Thread Roll 100m).  
**Expected:** Product details shown with stock levels.

### 11.4 Mobile view
Using Playwright with `iPhone 13` device, navigate to `/dashboard` and `/products`. Verify:
- No horizontal overflow
- Sidebar collapses to a hamburger menu (or is hidden)
- Tables are scrollable

---

## QA Report Format

After completing all phases, write a QA report using this format:

```
# MRIS QA Report — [Date]
Environment: localhost:3000 (local DB)
Tester: Claude Code QA Session

## Summary
- Total tests run: [N]
- PASS: [N]
- FAIL: [N]
- BLOCKED (couldn't test): [N]

## PASS Results
[List each scenario that passed — one line each]

## FAIL Results (Bugs Found)
### BUG-001: [Short title]
- Scenario: [Phase X.Y]
- Steps to reproduce: [numbered steps]
- Expected: [what should happen]
- Actual: [what happened instead]
- Severity: Critical / High / Medium / Low
- Suspected cause: [file:line if known]

## BLOCKED
[Scenarios that couldn't be tested and why]

## Suggestions
[Any observations that aren't bugs but could be improvements]
```

---

## Notes for Future-Proofing This QA

- When a new feature is added, add a new Phase to this document before shipping
- When a bug is fixed, add it to Phase 10 as a regression check
- Run this full QA before every production deploy (aim for < 2 hours with AI-driven execution)
- The local DB seed (`prisma/seed.ts`) should be updated if new reference data is needed for testing
- Consider adding `playwright.local.config.ts` as a permanent local-testing config to avoid overriding the production config each session
