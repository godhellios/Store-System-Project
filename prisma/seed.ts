import "dotenv/config";
import { PrismaClient, UserRole } from "../src/generated/prisma";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import bcrypt from "bcryptjs";

const adapter = new PrismaBetterSqlite3({
  url: process.env.DATABASE_URL ?? "file:./prisma/dev.db",
});
const prisma = new PrismaClient({ adapter });

async function main() {
  // Seed default units
  const unitNames = ["Pack", "Dozen", "Roll", "Piece", "Meter"];
  const units = await Promise.all(
    unitNames.map((name) =>
      prisma.unit.upsert({ where: { name }, update: {}, create: { name } })
    )
  );
  console.log("Seeded units:", units.map((u) => u.name));

  // Seed default categories
  const categoryNames = ["Button", "Zipper", "Thread", "Interlining", "Other"];
  const categories = await Promise.all(
    categoryNames.map((name) =>
      prisma.category.upsert({ where: { name }, update: {}, create: { name } })
    )
  );
  console.log("Seeded categories:", categories.map((c) => c.name));

  // Seed locations
  const locationDefs = [
    { name: "Retail Store", type: "Retail" },
    { name: "Medium Warehouse", type: "Warehouse" },
    { name: "Big Warehouse", type: "Warehouse" },
  ];
  const locations = await Promise.all(
    locationDefs.map(({ name, type }) =>
      prisma.location.upsert({ where: { name }, update: {}, create: { name, type } })
    )
  );
  console.log("Seeded locations:", locations.map((l) => l.name));

  // Seed admin user
  const hashedPassword = await bcrypt.hash("admin123", 10);
  const admin = await prisma.user.upsert({
    where: { email: "admin@mitraramah.com" },
    update: {},
    create: {
      name: "Admin",
      email: "admin@mitraramah.com",
      password: hashedPassword,
      role: UserRole.ADMIN,
    },
  });
  console.log("Seeded admin user:", admin.email);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
