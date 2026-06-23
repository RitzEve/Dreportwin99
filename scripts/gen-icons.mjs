/*
 * One-off icon generator for the PWA. Rasterizes the app's blue "bank" logo
 * (the same glyph used as the favicon) into the PNG sizes a home-screen install
 * needs, and writes them to public/icons/. Re-run with: node scripts/gen-icons.mjs
 *
 * Source of truth is the SVG below — change the colors/glyph here and re-run.
 */
import sharp from 'sharp';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');
mkdirSync(outDir, { recursive: true });

// The white bank/building glyph on a 24x24 grid (matches index.html favicon).
const GLYPH = 'M5 10h14M5 10l7-4 7 4M7 10v6M12 10v6M17 10v6M5 19h14';
const gradient =
  '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">' +
  '<stop offset="0" stop-color="#3b82f6"/><stop offset="1" stop-color="#2563eb"/>' +
  '</linearGradient></defs>';
const glyph = (tx, scale) =>
  `<g transform="translate(${tx},${tx}) scale(${scale})" fill="none" stroke="#ffffff" ` +
  `stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="${GLYPH}"/></g>`;

// Rounded blue tile — for the normal ("any") icons + apple-touch.
const rounded =
  `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">` +
  gradient +
  `<rect width="512" height="512" rx="112" fill="url(#g)"/>` +
  glyph(112.5, 11.96) +
  `</svg>`;

// Full-bleed square with the glyph kept inside the safe zone — for "maskable".
const maskable =
  `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">` +
  gradient +
  `<rect width="512" height="512" fill="url(#g)"/>` +
  glyph(138.5, 9.79) +
  `</svg>`;

async function png(svg, size, name) {
  await sharp(Buffer.from(svg)).resize(size, size).png().toFile(join(outDir, name));
  console.log('wrote', name);
}

await png(rounded, 192, 'icon-192.png');
await png(rounded, 512, 'icon-512.png');
await png(rounded, 180, 'apple-touch-icon.png');
await png(maskable, 512, 'icon-512-maskable.png');
console.log('done');
