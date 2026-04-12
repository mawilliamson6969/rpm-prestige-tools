/**
 * Generates PWA PNG icons from vector SVG (navy + RPM wordmark).
 * Run: node scripts/generate-pwa-icons.mjs
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import sharp from "sharp";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const publicDir = path.join(root, "public");
const iconsDir = path.join(publicDir, "icons");

const NAVY = "#1B2856";

function svgForSize(size) {
  const font = Math.round(size * 0.26);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="100%" height="100%" fill="${NAVY}"/>
  <text x="50%" y="52%" dominant-baseline="middle" text-anchor="middle" fill="#ffffff" font-family="system-ui,-apple-system,Segoe UI,sans-serif" font-weight="700" font-size="${font}">RPM</text>
</svg>`;
}

async function main() {
  fs.mkdirSync(iconsDir, { recursive: true });

  for (const s of [192, 512]) {
    const buf = Buffer.from(svgForSize(s));
    await sharp(buf).png().toFile(path.join(iconsDir, `icon-${s}.png`));
    console.log(`Wrote icons/icon-${s}.png`);
  }

  const appleBuf = Buffer.from(svgForSize(180));
  await sharp(appleBuf).png().toFile(path.join(publicDir, "apple-touch-icon.png"));
  console.log("Wrote apple-touch-icon.png");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
