/*
 * One-off icon generator for the PWA. Rasterizes the app logo
 * (scripts/logo-source.png — the gold shield on a black tile) into the PNG sizes
 * a home-screen install needs, and writes them to public/icons/.
 * Re-run after changing the logo with:  node scripts/gen-icons.mjs   (needs `npm i -D sharp`)
 *
 * Pipeline: trim the transparent margin around the tile, then scale to fill a
 * square and flatten onto solid black — so every icon is a full-bleed black tile
 * with the gold shield centered (the OS rounds the corners itself; "maskable"
 * keeps the shield well inside the safe zone).
 */
import sharp from 'sharp';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, '..', 'public', 'icons');
mkdirSync(outDir, { recursive: true });
const SRC = join(here, 'logo-source.png');
const BLACK = '#000000';

// Trim the transparent border once, up front, so the tile fills the frame.
const trimmed = await sharp(SRC).trim({ threshold: 12 }).png().toBuffer();

// scale = how much of the square the logo fills (1 = edge-to-edge). Maskable uses
// a smaller scale so the shield stays inside the ~80% safe zone after OS masking.
async function png(size, name, scale = 1) {
  const inner = Math.round(size * scale);
  const logo = await sharp(trimmed)
    .resize(inner, inner, { fit: 'cover' })
    .toBuffer();
  await sharp({ create: { width: size, height: size, channels: 4, background: BLACK } })
    .composite([{ input: logo, gravity: 'center' }])
    .flatten({ background: BLACK })
    .png()
    .toFile(join(outDir, name));
  console.log('wrote', name);
}

await png(192, 'icon-192.png', 1);
await png(512, 'icon-512.png', 1);
await png(180, 'apple-touch-icon.png', 1);
await png(512, 'icon-512-maskable.png', 0.78); // shield kept inside the maskable safe zone
console.log('done');
