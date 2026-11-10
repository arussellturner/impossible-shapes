// Generates the app icons from the engine's own Penrose tribar rendering, so the icon always
// matches what EscherCAD draws.
//   npx esbuild scripts/gen-icons.ts --bundle --platform=node --outfile=/tmp/gen-icons.cjs && node /tmp/gen-icons.cjs public
// PNG versions (apple-touch-icon etc.) are rasterized from icon-square.svg with headless Chrome.
import { mkdirSync, writeFileSync } from 'fs';
import { buildEscherScene } from '../src/engine/isometricEngine';
import { SHAPE_PRESETS } from '../src/engine/presets';

const out = process.argv[2] ?? 'public';
mkdirSync(out, { recursive: true });

const preset = SHAPE_PRESETS.find((p) => p.id === 'penrose-triangle')!;
const blocks = preset.blocks.map((b, i) => ({ id: `b${i}`, ...b }));
const scene = buildEscherScene(blocks, {}, 'penrose-horizontal', 10, {});

let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
for (const t of scene.triangles)
  for (const p of t.points) {
    minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
  }

const fill: Record<string, string> = { X: '#808080', Y: '#0a0a0a', Z: '#ffffff' };

function art(size: number, pad: number, stroke: number) {
  const s = (size - 2 * pad) / Math.max(maxX - minX, maxY - minY);
  const ox = (size - (maxX - minX) * s) / 2 - minX * s;
  const oy = (size - (maxY - minY) * s) / 2 - minY * s + size * 0.02; // slight optical centering
  const P = (p: { x: number; y: number }) => `${+(p.x * s + ox).toFixed(1)},${+(p.y * s + oy).toFixed(1)}`;
  // One path per face colour (stroked in its own colour to hide hairline seams between triangles)
  const paths: Record<string, string[]> = { X: [], Y: [], Z: [] };
  for (const t of scene.triangles) paths[t.faceType].push(`M${t.points.map(P).join('L')}Z`);
  const faces = (['X', 'Y', 'Z'] as const)
    .map(
      (f) =>
        `<path fill="${fill[f]}" stroke="${fill[f]}" stroke-width="${(stroke * 0.3).toFixed(1)}" stroke-linejoin="round" d="${paths[f].join('')}"/>`
    )
    .join('');
  const lines = scene.edges.map((e) => `M${P(e.p1)}L${P(e.p2)}`).join('');
  return `${faces}<path fill="none" stroke="#000" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round" d="${lines}"/>`;
}

const gradient =
  '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fbbf24"/><stop offset="1" stop-color="#ea580c"/></linearGradient></defs>';

// Browser favicon: rounded square.
const favicon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">${gradient}<rect width="512" height="512" rx="112" fill="url(#g)"/>${art(512, 64, 12)}</svg>\n`;
// Full-bleed square for iOS home screen / Android (the OS applies its own corner mask).
const square = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">${gradient}<rect width="512" height="512" fill="url(#g)"/>${art(512, 84, 11)}</svg>\n`;

writeFileSync(`${out}/favicon.svg`, favicon);
writeFileSync(`${out}/icon-square.svg`, square);
console.log(`wrote ${out}/favicon.svg (${favicon.length} B), ${out}/icon-square.svg (${square.length} B)`);
