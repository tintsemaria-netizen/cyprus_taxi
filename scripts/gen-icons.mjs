// Generate IL-Yas favicon + app icons from the lime Y-symbol. Flat fills, crisp
// edges, charcoal tile background. Run: node scripts/gen-icons.mjs
import sharp from 'sharp';
import { writeFileSync, mkdirSync } from 'node:fs';

const CHARCOAL = '#10191C';
const LIME = '#C8FF46';

// The Y-shaped branching-road symbol drawn in a 100x100 box, scaled/centered into
// a tile of `size` px. `inset` (0..1) is the fraction of padding for maskable safe area.
function tileSvg(size, { bg = true, inset = 0.2 } = {}) {
  const box = size * (1 - inset * 2);
  const off = (size - box) / 2;
  const s = box / 100;
  const t = (x) => off + x * s;
  const sw = 11 * s;
  const r = size * 0.22;
  const symbol = `
    <g fill="none" stroke="${LIME}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round">
      <path d="M${t(50)} ${t(86)} L${t(50)} ${t(54)}" />
      <path d="M${t(50)} ${t(54)} L${t(30)} ${t(22)}" />
      <path d="M${t(50)} ${t(54)} L${t(70)} ${t(22)}" />
    </g>
    <circle cx="${t(30)}" cy="${t(20)}" r="${7 * s}" fill="${LIME}" />
    <circle cx="${t(70)}" cy="${t(20)}" r="${7 * s}" fill="${LIME}" />
    <circle cx="${t(50)}" cy="${t(88)}" r="${6.5 * s}" fill="${LIME}" />`;
  const rect = bg ? `<rect width="${size}" height="${size}" rx="${r}" fill="${CHARCOAL}"/>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}">${rect}${symbol}</svg>`;
}

async function png(size, opts, out) {
  await sharp(Buffer.from(tileSvg(size, opts))).png().toFile(out);
  console.log('wrote', out);
}

mkdirSync('public/icons', { recursive: true });
// Scalable favicon (charcoal tile so it reads on any tab background).
writeFileSync('public/icons/favicon.svg', tileSvg(64, { inset: 0.16 }));
writeFileSync('public/icons/logo-mark.svg', tileSvg(100, { bg: false, inset: 0 }));

await png(192, { inset: 0.18 }, 'public/icons/icon-192.png');
await png(512, { inset: 0.18 }, 'public/icons/icon-512.png');
await png(180, { inset: 0.16 }, 'public/icons/apple-touch-icon.png');
// Maskable needs a larger safe area so the symbol survives circular masks.
await png(512, { inset: 0.28 }, 'public/icons/maskable-512.png');
// Classic favicon.ico fallback (32px png is widely accepted by browsers as .ico).
await sharp(Buffer.from(tileSvg(32, { inset: 0.12 }))).png().toFile('public/icons/favicon-32.png');
console.log('icons done');
