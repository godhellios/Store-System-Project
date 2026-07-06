// End-to-end smoke for EVERY stock mutation path. Exercises the REAL Next.js
// routes via real NextAuth login — no mocks. Verifies exact stock balances in
// the DB after every step, single-line AND multi-line. Restores all data it
// touches (snapshot → run → hard-restore + delete created rows).
// Run against LOCAL dev (Neon) only:  node scripts/smoke-stock-paths.mjs
import { readFileSync } from "node:fs";
import pg from "pg";

const BASE = "http://localhost:3000";
const env = readFileSync(new URL("../.env", import.meta.url), "utf8");
const dbUrl = env.split(/\r?\n/).find((l) => /^\s*DATABASE_URL\s*=/.test(l))
  .replace(/^\s*DATABASE_URL\s*=\s*/, "").trim().replace(/^["']|["']$/g, "");
const db = new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });

const jar = new Map();
const cookieHeader = () => [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
function absorb(res) {
  for (const c of res.headers.getSetCookie?.() ?? []) {
    const [pair] = c.split(";");
    const i = pair.indexOf("=");
    jar.set(pair.slice(0, i), pair.slice(i + 1));
  }
}
async function login(email, password) {
  jar.clear();
  const csrfRes = await fetch(`${BASE}/api/auth/csrf`);
  absorb(csrfRes);
  const { csrfToken } = await csrfRes.json();
  const body = new URLSearchParams({ csrfToken, email, password, callbackUrl: BASE, json: "true" });
  const res = await fetch(`${BASE}/api/auth/callback/credentials`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: cookieHeader() },
    body, redirect: "manual",
  });
  absorb(res);
  const sess = await (await fetch(`${BASE}/api/auth/session`, { headers: { Cookie: cookieHeader() } })).json();
  return sess?.user?.role ?? null;
}
const api = (method, path, payload) =>
  fetch(`${BASE}${path}`, {
    method,
    headers: { "Content-Type": "application/json", Cookie: cookieHeader() },
    ...(payload !== undefined ? { body: JSON.stringify(payload) } : {}),
  });

let pass = 0, fail = 0;
const check = (name, ok, detail = "") => { (ok ? pass++ : fail++); console.log(`${ok ? "✅" : "❌"} ${name}${detail ? ` — ${detail}` : ""}`); };

async function qty(productId, locationId) {
  const { rows } = await db.query(
    `SELECT quantity FROM "Stock" WHERE "productId"=$1 AND "locationId"=$2`, [productId, locationId]);
  return rows[0]?.quantity ?? 0;
}
const createdOrderIds = [];
async function createOrder(payload) {
  const res = await api("POST", "/api/orders", payload);
  const data = await res.json().catch(() => ({}));
  if (data.order?.id) createdOrderIds.push(data.order.id);
  return { res, data };
}

async function main() {
  await db.connect();

  // ── Setup: 3 active products + 2 locations, snapshot balances ─────────────
  const { rows: prods } = await db.query(
    `SELECT id, name FROM "Product" WHERE "isActive"=true ORDER BY name LIMIT 3`);
  const [P1, P2, P3] = prods;
  const { rows: locs } = await db.query(
    `SELECT id, name FROM "Location" WHERE "isActive"=true ORDER BY name LIMIT 2`);
  const [A, B] = locs;
  console.log(`Products: ${prods.map((p) => p.name).join(", ")}`);
  console.log(`Locations: A=${A.name}, B=${B.name}\n`);

  const snapshot = new Map();
  for (const p of prods) for (const l of locs)
    snapshot.set(`${p.id}:${l.id}`, await qty(p.id, l.id));
  const base = (p, l) => snapshot.get(`${p.id}:${l.id}`);

  const role = await login("admin@mitraramah.com", "wirawan123");
  check("admin login", role === "ADMIN", `role=${role}`);

  // ── 1. GRN single line (admin → immediate) ────────────────────────────────
  let r = await createOrder({ type: "GRN", toLocationId: A.id, lines: [{ productId: P1.id, quantity: 100 }] });
  check("GRN single: 200", r.res.ok, JSON.stringify(r.data.error ?? ""));
  check("GRN single: +100 applied", (await qty(P1.id, A.id)) === base(P1, A) + 100);
  const grnSingleId = r.data.order?.id;

  // ── 2. GRN multi line ──────────────────────────────────────────────────────
  r = await createOrder({ type: "GRN", toLocationId: A.id, lines: [
    { productId: P1.id, quantity: 40 }, { productId: P2.id, quantity: 60 }, { productId: P3.id, quantity: 80 }] });
  check("GRN multi: 200", r.res.ok);
  check("GRN multi: P1 +40", (await qty(P1.id, A.id)) === base(P1, A) + 140);
  check("GRN multi: P2 +60", (await qty(P2.id, A.id)) === base(P2, A) + 60);
  check("GRN multi: P3 +80", (await qty(P3.id, A.id)) === base(P3, A) + 80);
  const grnMultiId = r.data.order?.id;

  // ── 3. GOODS_OUT single ────────────────────────────────────────────────────
  r = await createOrder({ type: "GOODS_OUT", fromLocationId: A.id, lines: [{ productId: P1.id, quantity: 30 }] });
  check("OUT single: 200", r.res.ok);
  check("OUT single: -30 applied", (await qty(P1.id, A.id)) === base(P1, A) + 110);
  const outSingleId = r.data.order?.id;

  // ── 4. GOODS_OUT multi ─────────────────────────────────────────────────────
  r = await createOrder({ type: "GOODS_OUT", fromLocationId: A.id, lines: [
    { productId: P1.id, quantity: 10 }, { productId: P2.id, quantity: 20 }, { productId: P3.id, quantity: 30 }] });
  check("OUT multi: 200", r.res.ok);
  check("OUT multi: P1 -10", (await qty(P1.id, A.id)) === base(P1, A) + 100);
  check("OUT multi: P2 -20", (await qty(P2.id, A.id)) === base(P2, A) + 40);
  check("OUT multi: P3 -30", (await qty(P3.id, A.id)) === base(P3, A) + 50);

  // ── 5. GOODS_OUT insufficient (single) → blocked, unchanged ───────────────
  r = await createOrder({ type: "GOODS_OUT", fromLocationId: A.id, lines: [{ productId: P1.id, quantity: 999999 }] });
  check("OUT insufficient: 400", r.res.status === 400);
  check("OUT insufficient: unchanged", (await qty(P1.id, A.id)) === base(P1, A) + 100);

  // ── 6. GOODS_OUT multi with ONE bad line → atomic: NOTHING applied ────────
  r = await createOrder({ type: "GOODS_OUT", fromLocationId: A.id, lines: [
    { productId: P1.id, quantity: 5 }, { productId: P2.id, quantity: 999999 }] });
  check("OUT multi 1-bad-line: 400", r.res.status === 400);
  check("OUT multi 1-bad-line: P1 untouched (atomic)", (await qty(P1.id, A.id)) === base(P1, A) + 100);
  check("OUT multi 1-bad-line: P2 untouched (atomic)", (await qty(P2.id, A.id)) === base(P2, A) + 40);

  // ── 7. TRANSFER single A→B ─────────────────────────────────────────────────
  r = await createOrder({ type: "TRANSFER", fromLocationId: A.id, toLocationId: B.id, lines: [{ productId: P1.id, quantity: 15 }] });
  check("TRANSFER single: 200", r.res.ok);
  check("TRANSFER single: A -15", (await qty(P1.id, A.id)) === base(P1, A) + 85);
  check("TRANSFER single: B +15", (await qty(P1.id, B.id)) === base(P1, B) + 15);
  const transferSingleId = r.data.order?.id;

  // ── 8. TRANSFER multi A→B ──────────────────────────────────────────────────
  r = await createOrder({ type: "TRANSFER", fromLocationId: A.id, toLocationId: B.id, lines: [
    { productId: P2.id, quantity: 10 }, { productId: P3.id, quantity: 20 }] });
  check("TRANSFER multi: 200", r.res.ok);
  check("TRANSFER multi: P2 A -10 / B +10",
    (await qty(P2.id, A.id)) === base(P2, A) + 30 && (await qty(P2.id, B.id)) === base(P2, B) + 10);
  check("TRANSFER multi: P3 A -20 / B +20",
    (await qty(P3.id, A.id)) === base(P3, A) + 30 && (await qty(P3.id, B.id)) === base(P3, B) + 20);

  // ── 9. STAFF pending GOODS_OUT → no stock until admin approves ────────────
  const staffRole = await login("staff@mitraramah.com", "staff123");
  check("staff login", staffRole === "STAFF", `role=${staffRole}`);
  r = await createOrder({ type: "GOODS_OUT", fromLocationId: A.id, lines: [{ productId: P1.id, quantity: 5 }] });
  check("staff OUT: 200 (pending)", r.res.ok && r.data.order?.goodsOutStatus === "PENDING");
  check("staff OUT: stock NOT yet changed", (await qty(P1.id, A.id)) === base(P1, A) + 85);
  await login("admin@mitraramah.com", "wirawan123");
  let ar = await api("PATCH", `/api/orders/${r.data.order.id}`, { action: "approve" });
  check("approve staff OUT: 200", ar.ok);
  check("approve staff OUT: -5 applied", (await qty(P1.id, A.id)) === base(P1, A) + 80);

  // ── 10. Manual ADJUSTMENT (+7) → pending → approve ─────────────────────────
  r = await createOrder({ type: "ADJUSTMENT", toLocationId: A.id, adjustmentReason: "smoke", lines: [{ productId: P1.id, quantity: 7 }] });
  check("ADJ +7: created pending", r.res.ok && r.data.order?.adjustmentStatus === "PENDING");
  check("ADJ +7: stock unchanged while pending", (await qty(P1.id, A.id)) === base(P1, A) + 80);
  ar = await api("PATCH", `/api/orders/${r.data.order.id}`, { action: "approve" });
  check("ADJ +7: approved", ar.ok);
  check("ADJ +7: applied", (await qty(P1.id, A.id)) === base(P1, A) + 87);

  // ── 11. ADJUSTMENT below zero → auto-rejected, unchanged ──────────────────
  r = await createOrder({ type: "ADJUSTMENT", toLocationId: A.id, adjustmentReason: "smoke-neg", lines: [{ productId: P2.id, quantity: -999999 }] });
  check("ADJ neg: created pending", r.res.ok);
  ar = await api("PATCH", `/api/orders/${r.data.order.id}`, { action: "approve" });
  const arData = await ar.json().catch(() => ({}));
  check("ADJ neg: auto-rejected 400", ar.status === 400 && arData.autoRejected === true);
  check("ADJ neg: stock unchanged", (await qty(P2.id, A.id)) === base(P2, A) + 30);

  // ── 12. EDIT immediate GRN lines (multi): P1 40→25 → net -15 ──────────────
  let er = await api("PUT", `/api/orders/${grnMultiId}`, { lines: [
    { productId: P1.id, quantity: 25 }, { productId: P2.id, quantity: 60 }, { productId: P3.id, quantity: 80 }] });
  check("EDIT GRN: 200", er.ok);
  check("EDIT GRN: P1 net -15", (await qty(P1.id, A.id)) === base(P1, A) + 72);
  check("EDIT GRN: P2 unchanged", (await qty(P2.id, A.id)) === base(P2, A) + 30);

  // ── 13. WAREHOUSE CHANGE on GRN single: A→B, reverse+reapply ──────────────
  let wr = await api("PATCH", `/api/orders/${grnSingleId}/warehouse`, { toLocationId: B.id, reason: "smoke warehouse change" });
  check("WAREHOUSE CHANGE: 200", wr.ok, wr.ok ? "" : JSON.stringify((await wr.json().catch(() => ({}))).error ?? wr.status));
  check("WAREHOUSE CHANGE: A -100", (await qty(P1.id, A.id)) === base(P1, A) - 28);
  check("WAREHOUSE CHANGE: B +100", (await qty(P1.id, B.id)) === base(P1, B) + 115);

  // ── 14. CANCEL transfer → reversed both sides ──────────────────────────────
  let cr = await api("POST", `/api/orders/${transferSingleId}/cancel`, { reason: "smoke cancel" });
  check("CANCEL transfer: 200", cr.ok);
  check("CANCEL transfer: A restored +15", (await qty(P1.id, A.id)) === base(P1, A) - 13);
  check("CANCEL transfer: B reversed -15", (await qty(P1.id, B.id)) === base(P1, B) + 100);

  // ── 15. OPNAME full flow @B: count P1 physical = book+3 → approve → adj ───
  r = await api("POST", "/api/opname", { locationId: B.id, notes: "smoke opname" });
  const opname = await r.json();
  check("OPNAME create: 200", r.ok, opname.error ?? "");
  const opnameFull = await (await api("GET", `/api/opname/${opname.id}`)).json();
  const lineP1 = opnameFull.lines.find((l) => l.productId === P1.id);
  check("OPNAME prefill: bookQty = live stock", lineP1?.bookQty === base(P1, B) + 100, `book=${lineP1?.bookQty}`);
  // count all lines: P1 = book+3, everything else = book (no diff)
  const counts = opnameFull.lines.map((l) => ({ id: l.id, physicalQty: l.productId === P1.id ? l.bookQty + 3 : l.bookQty, staffConfirmed: true }));
  let ur = await api("PUT", `/api/opname/${opname.id}`, { action: "update-counts", lines: counts });
  check("OPNAME counts saved", ur.ok);
  ur = await api("PUT", `/api/opname/${opname.id}`, { action: "submit" });
  check("OPNAME submitted", ur.ok);
  ur = await api("PUT", `/api/opname/${opname.id}`, { action: "approve" });
  const approveData = await ur.json().catch(() => ({}));
  check("OPNAME approved", ur.ok);
  check("OPNAME: stock NOT yet changed (pending adj)", (await qty(P1.id, B.id)) === base(P1, B) + 100);
  const { rows: [adjOrder] } = await db.query(
    `SELECT id FROM "Order" WHERE notes LIKE '%' || $1 || '%' AND "adjustmentStatus"='PENDING'`, [opnameFull.sessionNumber]);
  check("OPNAME: pending adjustment created", !!adjOrder);
  if (adjOrder) {
    createdOrderIds.push(adjOrder.id);
    ar = await api("PATCH", `/api/orders/${adjOrder.id}`, { action: "approve" });
    check("OPNAME adj approved", ar.ok);
    check("OPNAME: +3 applied", (await qty(P1.id, B.id)) === base(P1, B) + 103);
  }

  // ── 16. EDIT beyond stock → guarded: 400 + rolled back ─────────────────────
  const before = await qty(P1.id, A.id);
  er = await api("PUT", `/api/orders/${outSingleId}`, { lines: [{ productId: P1.id, quantity: 999999 }] });
  check("EDIT beyond stock: 400", er.status === 400);
  check("EDIT beyond stock: rolled back, unchanged", (await qty(P1.id, A.id)) === before);

  // ── 17. DELETE GRN whose goods were consumed → guarded: 400 + rolled back ──
  // GRN +50 @B, then OUT everything at B (base + 50) so reversal would go negative.
  r = await createOrder({ type: "GRN", toLocationId: B.id, lines: [{ productId: P2.id, quantity: 50 }] });
  const delGrnId = r.data.order?.id;
  const bQty = await qty(P2.id, B.id);
  r = await createOrder({ type: "GOODS_OUT", fromLocationId: B.id, lines: [{ productId: P2.id, quantity: bQty }] });
  check("DELETE setup: B emptied", (await qty(P2.id, B.id)) === 0);
  let dr = await api("DELETE", `/api/orders/${delGrnId}`);
  check("DELETE consumed GRN: 400 (guarded)", dr.status === 400);
  check("DELETE consumed GRN: rolled back, unchanged", (await qty(P2.id, B.id)) === 0);

  // ── Cleanup: delete created rows, hard-restore snapshot ───────────────────
  console.log("\n— cleanup —");
  await db.query(`DELETE FROM "Movement" WHERE "orderId" = ANY($1)`, [createdOrderIds]);
  await db.query(`DELETE FROM "OrderLine" WHERE "orderId" = ANY($1)`, [createdOrderIds]);
  await db.query(`DELETE FROM "Order" WHERE id = ANY($1)`, [createdOrderIds]);
  if (opname?.id) {
    await db.query(`DELETE FROM "OpnameLine" WHERE "sessionId"=$1`, [opname.id]);
    await db.query(`DELETE FROM "OpnameSession" WHERE id=$1`, [opname.id]);
  }
  for (const p of prods) for (const l of locs) {
    const target = snapshot.get(`${p.id}:${l.id}`);
    await db.query(
      `INSERT INTO "Stock" (id, "productId", "locationId", quantity, "updatedAt")
       VALUES (gen_random_uuid()::text, $1, $2, $3, now())
       ON CONFLICT ("productId","locationId") DO UPDATE SET quantity=$3`,
      [p.id, l.id, target]);
  }
  let restored = true;
  for (const p of prods) for (const l of locs)
    if ((await qty(p.id, l.id)) !== snapshot.get(`${p.id}:${l.id}`)) restored = false;
  check("cleanup: all balances restored to baseline", restored);

  console.log(`\n${pass} passed, ${fail} failed`);
  await db.end();
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(async (e) => { console.error(e); try { await db.end(); } catch {} process.exit(1); });
