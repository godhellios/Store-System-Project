// One-off PWA icon generator. Renders public/icons/icon.svg to the PNG sizes
// the manifest + iOS need. Re-run with: node scripts/gen-icons.mjs
import sharp from "sharp";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const svg = readFileSync(join(root, "public/icons/icon.svg"));
const out = (name) => join(root, "public/icons", name);

const targets = [
  { size: 192, file: "icon-192.png" },
  { size: 512, file: "icon-512.png" },
  { size: 180, file: "apple-touch-icon.png" }, // iOS home screen
];

for (const { size, file } of targets) {
  await sharp(svg, { density: 384 })
    .resize(size, size)
    .png()
    .toFile(out(file));
  console.log(`wrote public/icons/${file} (${size}x${size})`);
}
