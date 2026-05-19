// Seed script for staging environment.
// Run with: npm run db:seed
// Safe to run multiple times — upserts reference data, skips orders that already exist.

import "dotenv/config";
import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma";
import bcrypt from "bcryptjs";

const rawUrl = process.env.DATABASE_URL!;
const pool = new Pool({
  connectionString: rawUrl,
  max: 1,
  ssl: rawUrl?.includes("sslmode=disable") ? false : { rejectUnauthorized: false },
});
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

async function main() {
  console.log("🌱 Seeding staging database…");

  // ── Locations ──────────────────────────────────────────────────────────────
  const [retail, medium, big] = await Promise.all([
    prisma.location.upsert({ where: { name: "Retail Store" },     update: {}, create: { name: "Retail Store",     type: "STORE" } }),
    prisma.location.upsert({ where: { name: "Medium Warehouse" }, update: {}, create: { name: "Medium Warehouse", type: "WAREHOUSE" } }),
    prisma.location.upsert({ where: { name: "Big Warehouse" },    update: {}, create: { name: "Big Warehouse",    type: "WAREHOUSE" } }),
  ]);
  console.log("  ✓ Locations (3)");

  // ── Categories ─────────────────────────────────────────────────────────────
  const [catThread, catButton, catFabric] = await Promise.all([
    prisma.category.upsert({ where: { name: "Thread" }, update: {}, create: { name: "Thread", code: "THR" } }),
    prisma.category.upsert({ where: { name: "Button" }, update: {}, create: { name: "Button", code: "BTN" } }),
    prisma.category.upsert({ where: { name: "Fabric" }, update: {}, create: { name: "Fabric", code: "FAB" } }),
  ]);
  console.log("  ✓ Categories (3)");

  // ── Units ──────────────────────────────────────────────────────────────────
  const [unitPcs, unitRoll] = await Promise.all([
    prisma.unit.upsert({ where: { name: "pcs" },  update: {}, create: { name: "pcs" } }),
    prisma.unit.upsert({ where: { name: "Roll" }, update: {}, create: { name: "Roll" } }),
  ]);
  await prisma.unit.upsert({
    where: { name: "Box" },
    update: {},
    create: { name: "Box", parentUnitId: unitPcs.id, conversionFactor: 12 },
  });
  console.log("  ✓ Units (3: pcs, Roll, Box)");

  // ── Users (all 4 roles for testing) ───────────────────────────────────────
  const hash = (raw: string) => bcrypt.hashSync(raw, 10);
  await Promise.all([
    prisma.user.upsert({ where: { email: "admin@mitraramah.com" },    update: {}, create: { name: "Admin",         email: "admin@mitraramah.com",    password: hash("wirawan123"),  role: "ADMIN"    } }),
    prisma.user.upsert({ where: { email: "staff@mitraramah.com" },    update: {}, create: { name: "Staff Test",    email: "staff@mitraramah.com",    password: hash("staff123"),    role: "STAFF"    } }),
    prisma.user.upsert({ where: { email: "viewer@mitraramah.com" },   update: {}, create: { name: "Viewer Test",   email: "viewer@mitraramah.com",   password: hash("viewer123"),   role: "VIEWER"   } }),
    prisma.user.upsert({ where: { email: "operator@mitraramah.com" }, update: {}, create: { name: "Operator Test", email: "operator@mitraramah.com", password: hash("operator123"), role: "OPERATOR" } }),
  ]);
  console.log("  ✓ Users (admin / staff / viewer / operator)");

  // ── Products ───────────────────────────────────────────────────────────────
  const defs = [
    { sku: "THR-00001", barcode: "THR00001001", name: "Thread Roll 100m",    categoryId: catThread.id, unitId: unitPcs.id,  reorderPoint: 20  },
    { sku: "THR-00002", barcode: "THR00002001", name: "Thread Roll 200m",    categoryId: catThread.id, unitId: unitPcs.id,  reorderPoint: 15  },
    { sku: "THR-00003", barcode: "THR00003001", name: "Thread Roll 50m",     categoryId: catThread.id, unitId: unitPcs.id,  reorderPoint: 30  },
    { sku: "BTN-00001", barcode: "BTN00001001", name: "Zipper 30cm",         categoryId: catButton.id, unitId: unitPcs.id,  reorderPoint: 50  },
    { sku: "BTN-00002", barcode: "BTN00002001", name: "Button Black 15mm",   categoryId: catButton.id, unitId: unitPcs.id,  reorderPoint: 100 },
    { sku: "BTN-00003", barcode: "BTN00003001", name: "Button White 12mm",   categoryId: catButton.id, unitId: unitPcs.id,  reorderPoint: 80  },
    { sku: "BTN-00004", barcode: "BTN00004001", name: "Sewing Needle Set",   categoryId: catButton.id, unitId: unitPcs.id,  reorderPoint: 20  },
    { sku: "FAB-00001", barcode: "FAB00001001", name: "Velcro Strip 1m",     categoryId: catFabric.id, unitId: unitRoll.id, reorderPoint: 10  },
    { sku: "FAB-00002", barcode: "FAB00002001", name: "Cotton Fabric Plain",  categoryId: catFabric.id, unitId: unitRoll.id, reorderPoint: 5   },
    { sku: "FAB-00003", barcode: "FAB00003001", name: "Elastic Band 2cm",    categoryId: catFabric.id, unitId: unitRoll.id, reorderPoint: 8   },
  ];
  const products = await Promise.all(
    defs.map((p) => prisma.product.upsert({ where: { sku: p.sku }, update: {}, create: { ...p, approvalStatus: "ACTIVE" } }))
  );
  console.log(`  ✓ Products (${products.length})`);

  // ── Stock — several items intentionally below reorder to test alerts ────────
  const stockData: { pi: number; locId: string; qty: number }[] = [
    { pi: 0, locId: retail.id,  qty: 45  },
    { pi: 1, locId: retail.id,  qty: 8   }, // below reorder (15)
    { pi: 3, locId: retail.id,  qty: 120 },
    { pi: 4, locId: retail.id,  qty: 45  }, // below reorder (100)
    { pi: 7, locId: retail.id,  qty: 6   },
    { pi: 0, locId: medium.id,  qty: 200 },
    { pi: 2, locId: medium.id,  qty: 15  }, // below reorder (30)
    { pi: 5, locId: medium.id,  qty: 300 },
    { pi: 6, locId: medium.id,  qty: 12  }, // below reorder (20)
    { pi: 8, locId: medium.id,  qty: 3   }, // below reorder (5)
    { pi: 1, locId: big.id,     qty: 500 },
    { pi: 3, locId: big.id,     qty: 1000 },
    { pi: 4, locId: big.id,     qty: 800 },
    { pi: 9, locId: big.id,     qty: 5   }, // below reorder (8)
  ];
  await Promise.all(
    stockData.map(({ pi, locId, qty }) =>
      prisma.stock.upsert({
        where: { productId_locationId: { productId: products[pi].id, locationId: locId } },
        update: { quantity: qty },
        create: { productId: products[pi].id, locationId: locId, quantity: qty },
      })
    )
  );
  console.log(`  ✓ Stock records (${stockData.length})`);

  // ── Orders (skipped if already created) ───────────────────────────────────
  const orderSeeds = [
    {
      orderNumber: "GRN-SEED-0001",
      data: { type: "GRN" as const, toLocationId: big.id, grnStatus: "APPROVED", createdByName: "Admin", reviewedByName: "Admin", reviewedAt: new Date("2026-05-01T08:00:00Z"), supplier: "PT Sumber Benang Jaya" },
      lines: [{ productId: products[0].id, quantity: 500 }, { productId: products[3].id, quantity: 1000 }, { productId: products[4].id, quantity: 800 }],
    },
    {
      orderNumber: "GOUT-SEED-0001",
      data: { type: "GOODS_OUT" as const, fromLocationId: big.id, goodsOutStatus: "APPROVED", createdByName: "Staff Test", reviewedByName: "Admin", reviewedAt: new Date("2026-05-10T10:00:00Z"), customer: "CV Mitra Fashion" },
      lines: [{ productId: products[3].id, quantity: 100 }, { productId: products[4].id, quantity: 200 }],
    },
    {
      orderNumber: "TRF-SEED-0001",
      data: { type: "TRANSFER" as const, fromLocationId: big.id, toLocationId: retail.id, transferStatus: "APPROVED", createdByName: "Staff Test", reviewedByName: "Admin", reviewedAt: new Date("2026-05-12T09:00:00Z") },
      lines: [{ productId: products[0].id, quantity: 50 }, { productId: products[5].id, quantity: 30 }],
    },
    {
      orderNumber: "GRN-SEED-0002",
      data: { type: "GRN" as const, toLocationId: medium.id, grnStatus: "PENDING", createdByName: "Staff Test", supplier: "PT Rajawali Tekstil" },
      lines: [{ productId: products[2].id, quantity: 100 }, { productId: products[6].id, quantity: 50 }],
    },
    {
      orderNumber: "ADJ-SEED-0001",
      data: { type: "ADJUSTMENT" as const, toLocationId: retail.id, adjustmentStatus: "PENDING", createdByName: "Staff Test", notes: "Physical count correction — Retail Q2 opname" },
      lines: [{ productId: products[1].id, quantity: -3 }, { productId: products[7].id, quantity: 2 }],
    },
  ];

  let created = 0;
  for (const { orderNumber, data, lines } of orderSeeds) {
    const exists = await prisma.order.findUnique({ where: { orderNumber } });
    if (exists) continue;
    await prisma.order.create({ data: { ...data, orderNumber, lines: { create: lines } } });
    created++;
  }
  console.log(`  ✓ Orders (${created} new, ${orderSeeds.length - created} already existed)`);

  console.log("\n✅ Seed complete.");
  console.log("   Credentials:");
  console.log("     admin@mitraramah.com    / wirawan123");
  console.log("     staff@mitraramah.com    / staff123");
  console.log("     viewer@mitraramah.com   / viewer123");
  console.log("     operator@mitraramah.com / operator123");
}

main()
  .catch((err) => { console.error("Seed failed:", err); process.exit(1); })
  .finally(() => pool.end());
