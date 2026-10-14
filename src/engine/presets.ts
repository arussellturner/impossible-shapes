import { ColorTheme, ShapePreset } from '../types/escher';

export const COLOR_THEMES: ColorTheme[] = [
  {
    id: 'escher-monochrome',
    name: 'Classic Penrose (Reference)',
    description: 'High-contrast white, gray, and black faces matching classic Escher/Penrose line art',
    faceX: '#808080',
    faceY: '#050505',
    faceZ: '#ffffff',
    stroke: '#000000',
    canvasBg: '#f8fafc',
    gridLine: '#cbd5e1',
  },
  {
    id: 'lithograph-ink',
    name: 'Escher Lithograph',
    description: 'Warm archival paper with charcoal, stone gray, and parchment tones',
    faceX: '#8c857b',
    faceY: '#1c1917',
    faceZ: '#faf8f5',
    stroke: '#1c1917',
    canvasBg: '#efeae1',
    gridLine: '#d6cfc2',
  },
  {
    id: 'monument-pastel',
    name: 'Monument Pastel',
    description: 'Architectural coral, slate blue, and sunlit cream',
    faceX: '#e07a5f',
    faceY: '#3d405b',
    faceZ: '#f4f1de',
    stroke: '#1d1e2c',
    canvasBg: '#232533',
    gridLine: '#35384d',
  },
  {
    id: 'Bauhaus-primary',
    name: 'Bauhaus Primary',
    description: 'Bold geometric cobalt, crimson, and warm yellow',
    faceX: '#2563eb',
    faceY: '#dc2626',
    faceZ: '#facc15',
    stroke: '#0f172a',
    canvasBg: '#f1f5f9',
    gridLine: '#cbd5e1',
  },
];

function buildPenroseTriangle(sideLength: number = 5): Array<{ x: number; y: number; z: number }> {
  const coords: Array<{ x: number; y: number; z: number }> = [];
  const L = sideLength;
  // Right arm: (0, 0, 0) -> (0, L, 0)
  for (let y = 0; y <= L; y++) {
    coords.push({ x: 0, y, z: 0 });
  }
  // Bottom arm: (1, L, 0) -> (L, L, 0)
  for (let x = 1; x <= L; x++) {
    coords.push({ x, y: L, z: 0 });
  }
  // Left arm: (L, L, 1) -> (L, L, L - 1)
  for (let z = 1; z < L; z++) {
    coords.push({ x: L, y: L, z });
  }
  return coords;
}

function buildPenroseStaircase(): Array<{ x: number; y: number; z: number }> {
  // 4-turn impossible loop with 1 Escher connection
  const coords: Array<{ x: number; y: number; z: number }> = [];
  // Corner 1 -> Corner 2 (+Y by 5)
  for (let y = 0; y <= 5; y++) coords.push({ x: 0, y, z: 0 });
  // Corner 2 -> Corner 3 (+X by 4)
  for (let x = 1; x <= 4; x++) coords.push({ x, y: 5, z: 0 });
  // Corner 3 -> Corner 4 (-Y by 1)
  coords.push({ x: 4, y: 4, z: 0 });
  // Corner 4 -> back to Corner 1 (+Z by 3: lands at (4,4,3) which has u=0, v=1, adjacent to (0,0,0)!)
  for (let z = 1; z <= 3; z++) coords.push({ x: 4, y: 4, z });
  return coords;
}

function buildDoubleTribar(): Array<{ x: number; y: number; z: number }> {
  const seen = new Set<string>();
  const coords: Array<{ x: number; y: number; z: number }> = [];
  const add = (x: number, y: number, z: number) => {
    const k = `${x},${y},${z}`;
    if (!seen.has(k)) {
      seen.add(k);
      coords.push({ x, y, z });
    }
  };

  // Upper-left Penrose loop (L = 4)
  const L = 4;
  for (let y = 0; y <= L; y++) add(0, y, 0);
  for (let x = 1; x <= L; x++) add(x, L, 0);
  for (let z = 1; z < L; z++) add(L, L, z);

  // Lower-right Penrose loop extending from (0, L, 0)
  for (let y = L + 1; y <= 2 * L; y++) add(0, y, 0);
  for (let x = 1; x <= L; x++) add(x, 2 * L, 0);
  for (let z = 1; z < L; z++) add(L, 2 * L, z);

  return coords;
}

function buildWaterfallChannel(): Array<{ x: number; y: number; z: number }> {
  const seen = new Set<string>();
  const coords: Array<{ x: number; y: number; z: number }> = [];
  const add = (x: number, y: number, z: number) => {
    const k = `${x},${y},${z}`;
    if (!seen.has(k)) {
      seen.add(k);
      coords.push({ x, y, z });
    }
  };

  // First triangle loop
  const L = 4;
  for (let y = 0; y <= L; y++) add(0, y, 0);
  for (let x = 1; x <= L; x++) add(x, L, 0);
  for (let z = 1; z < L; z++) add(L, L, z);

  // Second zig-zag tier extending down-left
  for (let x = L + 1; x <= 2 * L; x++) add(x, L, 0);
  for (let y = L + 1; y <= 2 * L; y++) add(2 * L, y, 0);
  for (let z = 1; z < L; z++) add(2 * L, 2 * L, z);

  return coords;
}

export const SHAPE_PRESETS: ShapePreset[] = [
  {
    id: 'penrose-triangle',
    name: 'Penrose Triangle',
    subtitle: 'Classic 3-beam impossible tribar matching reference',
    orientation: 'penrose-horizontal',
    blocks: buildPenroseTriangle(5),
  },
  {
    id: 'penrose-compact',
    name: 'Compact Tribar',
    subtitle: 'Tight 12-block Penrose triangle',
    orientation: 'penrose-horizontal',
    blocks: buildPenroseTriangle(4),
  },
  {
    id: 'penrose-stairs',
    name: 'Impossible Loop (4-Turn)',
    subtitle: '4-corner continuous ascending loop',
    orientation: 'isometric-vertical',
    blocks: buildPenroseStaircase(),
  },
  {
    id: 'double-tribar',
    name: 'Impossible Figure-8',
    subtitle: 'Twin interlocking Penrose loops',
    orientation: 'penrose-horizontal',
    blocks: buildDoubleTribar(),
  },
  {
    id: 'escher-waterfall',
    name: 'Escher Waterfall Zig-Zag',
    subtitle: 'Stacked double impossible aqueduct',
    orientation: 'isometric-vertical',
    blocks: buildWaterfallChannel(),
  },
  {
    id: 'single-block',
    name: 'Single Starter Block',
    subtitle: 'Start from 1 cube and build your own',
    orientation: 'penrose-horizontal',
    blocks: [{ x: 0, y: 0, z: 0 }],
  },
];
