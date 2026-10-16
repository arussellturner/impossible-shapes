import {
  AxisDirection,
  BlockWeldOverride,
  BlockWeldPlane,
  ConnectionMode,
  EscherConnection,
  FaceType,
  PositiveAxis,
  ViewOrientation,
  VoxelBlock,
} from '../types/escher';
import { REALIZABLE_VERTEX_PATTERNS } from './realizablePatterns';

export const SQRT3 = Math.sqrt(3);
export const BASE_SCALE = 54;

export interface LatticeCoord {
  u: number;
  v: number;
}

export interface ScreenPoint {
  x: number;
  y: number;
}

export interface RenderedTriangle {
  key: string;
  kind: 'A' | 'B';
  cu: number;
  cv: number;
  blockId: string;
  faceType: FaceType;
  points: [ScreenPoint, ScreenPoint, ScreenPoint];
}

export interface RenderedEdge {
  key: string;
  p1: ScreenPoint;
  p2: ScreenPoint;
  kind: 'silhouette' | 'crease' | 'cliff' | 'seam';
}

export interface GhostCandidate {
  x: number;
  y: number;
  z: number;
  u: number;
  v: number;
  fromBlockId?: string;
  direction?: AxisDirection;
  label: string;
  willEscherConnect: boolean;
  escherTargetCount: number;
  screenCenter: ScreenPoint;
  rhombuses: {
    faceX: ScreenPoint[];
    faceY: ScreenPoint[];
    faceZ: ScreenPoint[];
  };
}

/**
 * A 3-block weld joint: three mutually linked blocks around one unit lattice triangle.
 * `plane` is the face (X gray / Y black / Z white) that welds in front at this joint.
 */
export interface WeldJoint {
  key: string;
  blockIds: [string, string, string];
  plane: PositiveAxis;
  defaultPlane: PositiveAxis;
  validPlanes: PositiveAxis[];
  center: ScreenPoint;
}

export interface EngineSceneResult {
  triangles: RenderedTriangle[];
  edges: RenderedEdge[];
  seamEdges: RenderedEdge[];
  connections: EscherConnection[];
  blockScreenCenters: Map<string, ScreenPoint>;
  weldJoints: WeldJoint[];
}

/**
 * Maps 3D integer coordinates (x, y, z) to 2D integer triangular lattice coordinates (u, v).
 * Invariant under (x, y, z) -> (x + k, y + k, z + k).
 */
export function blockToLattice(x: number, y: number, z: number): LatticeCoord {
  return {
    u: y - x,
    v: y - z,
  };
}

/**
 * True 3D depth along the isometric camera viewing vector (1, 1, 1).
 */
export function blockDepth(x: number, y: number, z: number): number {
  return x + y + z;
}

/**
 * Converts 2D lattice coordinates (u, v) to SVG screen coordinates (x, y).
 * - 'penrose-horizontal': 0° / 60° / 120° axes (matches classic Penrose triangle reference image)
 * - 'isometric-vertical': rotated -30° so the Z-axis is vertical (classic architectural isometric)
 */
export function latticeToScreen(
  u: number,
  v: number,
  orientation: ViewOrientation = 'penrose-horizontal',
  scale: number = BASE_SCALE
): ScreenPoint {
  const bx = (u - v * 0.5) * scale;
  const by = v * (SQRT3 * 0.5) * scale;

  if (orientation === 'penrose-horizontal') {
    return { x: bx, y: by };
  }

  // Rotate by -30 degrees (-pi/6) so the +Z / -Z axis is vertical on screen
  const cos30 = SQRT3 * 0.5;
  const sin30 = -0.5;
  return {
    x: bx * cos30 - by * sin30,
    y: bx * sin30 + by * cos30,
  };
}

/**
 * Inverse mapping from SVG screen coordinates (x, y) to fractional 2D lattice coordinates (u, v).
 */
export function screenToLattice(
  sx: number,
  sy: number,
  orientation: ViewOrientation = 'penrose-horizontal',
  scale: number = BASE_SCALE
): LatticeCoord {
  let bx = sx;
  let by = sy;

  if (orientation === 'isometric-vertical') {
    // Rotate by +30 degrees (+pi/6)
    const cos30 = SQRT3 * 0.5;
    const sin30 = 0.5;
    bx = sx * cos30 - sy * sin30;
    by = sx * sin30 + sy * cos30;
  }

  const v = by / ((SQRT3 * 0.5) * scale);
  const u = bx / scale + v * 0.5;
  return { u, v };
}

/**
 * Returns the 3 visible rhombus polygons for a single block at (u, v), optionally shifted by 3D depth peek.
 */
export function getBlockRhombuses(
  u: number,
  v: number,
  orientation: ViewOrientation,
  scale: number = BASE_SCALE,
  depthOffset: ScreenPoint = { x: 0, y: 0 }
): {
  faceX: ScreenPoint[];
  faceY: ScreenPoint[];
  faceZ: ScreenPoint[];
} {
  const pt = (lu: number, lv: number): ScreenPoint => {
    const p = latticeToScreen(lu, lv, orientation, scale);
    return { x: p.x + depthOffset.x, y: p.y + depthOffset.y };
  };

  return {
    // Gray (+X) face: (u,v) -> (u-1,v-1) -> (u-1,v) -> (u,v+1)
    faceX: [pt(u, v), pt(u - 1, v - 1), pt(u - 1, v), pt(u, v + 1)],
    // Black (+Y) face: (u,v) -> (u+1,v) -> (u+1,v+1) -> (u,v+1)
    faceY: [pt(u, v), pt(u + 1, v), pt(u + 1, v + 1), pt(u, v + 1)],
    // White (+Z) face: (u,v) -> (u-1,v-1) -> (u,v-1) -> (u+1,v)
    faceZ: [pt(u, v), pt(u - 1, v - 1), pt(u, v - 1), pt(u + 1, v)],
  };
}

export const AXIS_DELTAS: Record<
  AxisDirection,
  { dx: number; dy: number; dz: number; du: number; dv: number; label: string }
> = {
  '+X': { dx: 1, dy: 0, dz: 0, du: -1, dv: 0, label: '+X (Front-Left)' },
  '-X': { dx: -1, dy: 0, dz: 0, du: 1, dv: 0, label: '-X (Back-Right)' },
  '+Y': { dx: 0, dy: 1, dz: 0, du: 1, dv: 1, label: '+Y (Front-Down)' },
  '-Y': { dx: 0, dy: -1, dz: 0, du: -1, dv: -1, label: '-Y (Back-Up)' },
  '+Z': { dx: 0, dy: 0, dz: 1, du: 0, dv: -1, label: '+Z (Front-Up)' },
  '-Z': { dx: 0, dy: 0, dz: -1, du: 0, dv: 1, label: '-Z (Back-Down)' },
};

export function makeConnectionId(id1: string, id2: string): string {
  return id1 < id2 ? `${id1}__${id2}` : `${id2}__${id1}`;
}

interface GraphEdge {
  toId: string;
  dx: number;
  dy: number;
  dz: number;
  depthDelta: number;
  isEscher: boolean;
}

/**
 * Core Isometric + Escher Engine:
 * Computes all Escher visual connections, resolves local paradox depth ordering on the 2D triangular lattice,
 * and merges coplanar faces across both 3D and Escher-welded neighbors.
 */
export function buildEscherScene(
  blocks: VoxelBlock[],
  connectionModes: Record<string, ConnectionMode>,
  orientation: ViewOrientation,
  scale: number = BASE_SCALE,
  blockWeldOverrides: Record<string, BlockWeldOverride> = {}
): EngineSceneResult {
  const blockMap = new Map<string, VoxelBlock>();
  const blockLattice = new Map<string, LatticeCoord>();
  const blockScreenCenters = new Map<string, ScreenPoint>();

  for (const b of blocks) {
    blockMap.set(b.id, b);
    const lc = blockToLattice(b.x, b.y, b.z);
    blockLattice.set(b.id, lc);
    blockScreenCenters.set(b.id, latticeToScreen(lc.u, lc.v, orientation, scale));
  }

  // 1. First pass: find all Real 3D adjacencies and raw Escher visual neighbor candidates
  const adjacencyGraph = new Map<string, GraphEdge[]>();
  const realNeighbors = new Map<string, Set<string>>();
  for (const b of blocks) {
    adjacencyGraph.set(b.id, []);
    realNeighbors.set(b.id, new Set<string>());
  }

  interface RawEscherCandidate {
    normA: VoxelBlock;
    normB: VoxelBlock;
    posDir: '+X' | '+Y' | '+Z';
    kGap: number;
    connId: string;
  }

  const rawCandidates: RawEscherCandidate[] = [];

  // Only lattice-adjacent pairs can interact; index blocks by cell so each block checks its 6 neighbors.
  const blocksByCell = new Map<string, number[]>();
  blocks.forEach((b, idx) => {
    const lc = blockLattice.get(b.id)!;
    const k = `${lc.u},${lc.v}`;
    const list = blocksByCell.get(k);
    if (list) list.push(idx);
    else blocksByCell.set(k, [idx]);
  });
  const DIR_ENTRIES = Object.entries(AXIS_DELTAS) as [AxisDirection, (typeof AXIS_DELTAS)[AxisDirection]][];

  for (let i = 0; i < blocks.length; i++) {
    const a = blocks[i];
    const la = blockLattice.get(a.id)!;

    // Same visiting order as a plain j > i scan.
    const later: { j: number; dir: AxisDirection }[] = [];
    for (const [dir, info] of DIR_ENTRIES) {
      for (const j of blocksByCell.get(`${la.u + info.du},${la.v + info.dv}`) ?? []) {
        if (j > i) later.push({ j, dir });
      }
    }
    later.sort((p, q) => p.j - q.j);

    for (const { j, dir: matchedDirFromA } of later) {
      const b = blocks[j];

      const info = AXIS_DELTAS[matchedDirFromA];
      const kx = b.x - a.x - info.dx;
      const ky = b.y - a.y - info.dy;
      const kz = b.z - a.z - info.dz;

      if (kx === 0 && ky === 0 && kz === 0) {
        // Real 3D neighbor
        const dDelta = info.dx + info.dy + info.dz;
        realNeighbors.get(a.id)!.add(b.id);
        realNeighbors.get(b.id)!.add(a.id);
        adjacencyGraph.get(a.id)!.push({
          toId: b.id,
          dx: info.dx,
          dy: info.dy,
          dz: info.dz,
          depthDelta: dDelta,
          isEscher: false,
        });
        adjacencyGraph.get(b.id)!.push({
          toId: a.id,
          dx: -info.dx,
          dy: -info.dy,
          dz: -info.dz,
          depthDelta: -dDelta,
          isEscher: false,
        });
      } else {
        const isPositive =
          matchedDirFromA === '+X' ||
          matchedDirFromA === '+Y' ||
          matchedDirFromA === '+Z';
        const normA = isPositive ? a : b;
        const normB = isPositive ? b : a;
        const posDir: '+X' | '+Y' | '+Z' = isPositive
          ? (matchedDirFromA as '+X' | '+Y' | '+Z')
          : matchedDirFromA === '-X'
            ? '+X'
            : matchedDirFromA === '-Y'
              ? '+Y'
              : '+Z';
        const posInfo = AXIS_DELTAS[posDir];
        const kGap = normB.x - normA.x - posInfo.dx;

        rawCandidates.push({
          normA,
          normB,
          posDir,
          kGap,
          connId: makeConnectionId(a.id, b.id),
        });
      }
    }
  }

  // Filter out 2-hop real 3D corners (where normA and normB share a common real 3D neighbor)
  const cornerIds = new Set<string>();
  const candidateById = new Map<string, RawEscherCandidate>();
  for (const cand of rawCandidates) candidateById.set(cand.connId, cand);
  const nonCornerCandidates = rawCandidates.filter((cand) => {
    const nA = realNeighbors.get(cand.normA.id)!;
    const nB = realNeighbors.get(cand.normB.id)!;
    for (const midId of nA) {
      if (nB.has(midId)) {
        cornerIds.add(cand.connId);
        return false; // Real 3D 90-degree corner diagonal (kGap = +-1)
      }
    }
    return true;
  });

  // Helper: check if virtual step (dx, dy, dz) from block u is collinear with u's real 3D neighbors
  function isStepCollinearWithRealArm(blockId: string, dx: number, dy: number, dz: number): boolean {
    const edges = adjacencyGraph.get(blockId) ?? [];
    for (const e of edges) {
      if (!e.isEscher && Math.abs(e.dx) === Math.abs(dx) && Math.abs(e.dy) === Math.abs(dy) && Math.abs(e.dz) === Math.abs(dz)) {
        return true;
      }
    }
    return false;
  }

  // Filter out 2-hop Escher inner-corner hypotenuse diagonals:
  // If block B has two candidate Escher edges to M and A where (M, A) is a real 3D edge,
  // keep only the true corner weld (collinear with B's arm or larger |kGap|).
  const discardedIds = new Set<string>();
  const candidatesByBlock = new Map<string, number[]>();
  nonCornerCandidates.forEach((c, idx) => {
    for (const id of [c.normA.id, c.normB.id]) {
      const list = candidatesByBlock.get(id);
      if (list) list.push(idx);
      else candidatesByBlock.set(id, [idx]);
    }
  });
  for (let i = 0; i < nonCornerCandidates.length; i++) {
    const c1 = nonCornerCandidates[i];
    const partners = [
      ...new Set([...(candidatesByBlock.get(c1.normA.id) ?? []), ...(candidatesByBlock.get(c1.normB.id) ?? [])]),
    ]
      .filter((j) => j > i)
      .sort((p, q) => p - q);
    for (const j of partners) {
      const c2 = nonCornerCandidates[j];

      // Find shared block B and the other two blocks M, A
      let sharedId: string | null = null;
      let other1: string | null = null;
      let other2: string | null = null;

      if (c1.normA.id === c2.normA.id || c1.normA.id === c2.normB.id) {
        sharedId = c1.normA.id;
        other1 = c1.normB.id;
        other2 = c2.normA.id === sharedId ? c2.normB.id : c2.normA.id;
      } else if (c1.normB.id === c2.normA.id || c1.normB.id === c2.normB.id) {
        sharedId = c1.normB.id;
        other1 = c1.normA.id;
        other2 = c2.normA.id === sharedId ? c2.normB.id : c2.normA.id;
      }

      if (sharedId && other1 && other2 && realNeighbors.get(other1)?.has(other2)) {
        const info1 = AXIS_DELTAS[c1.posDir];
        const info2 = AXIS_DELTAS[c2.posDir];
        const col1 =
          isStepCollinearWithRealArm(sharedId, info1.dx, info1.dy, info1.dz) ||
          isStepCollinearWithRealArm(other1, info1.dx, info1.dy, info1.dz);
        const col2 =
          isStepCollinearWithRealArm(sharedId, info2.dx, info2.dy, info2.dz) ||
          isStepCollinearWithRealArm(other2, info2.dx, info2.dy, info2.dz);

        if (col1 && !col2) {
          discardedIds.add(c2.connId);
        } else if (col2 && !col1) {
          discardedIds.add(c1.connId);
        } else if (Math.abs(c1.kGap) >= Math.abs(c2.kGap)) {
          discardedIds.add(c2.connId);
        } else {
          discardedIds.add(c1.connId);
        }
      }
    }
  }

  const escherConnections: EscherConnection[] = [];
  const seenPairs = new Set<string>();

  for (const cand of rawCandidates) {
    // Mark all raw pairs as seen so they aren't re-added as 'crossing'
    seenPairs.add(cand.connId);
  }

  for (const cand of nonCornerCandidates) {
    if (discardedIds.has(cand.connId)) continue;

    const { normA, normB, posDir, kGap, connId } = cand;
    const mode: ConnectionMode = connectionModes[connId] ?? 'natural';
    const posInfo = AXIS_DELTAS[posDir];
    const pA = blockScreenCenters.get(normA.id)!;
    const pB = blockScreenCenters.get(normB.id)!;

    escherConnections.push({
      id: connId,
      blockAId: normA.id,
      blockBId: normB.id,
      kind: 'adjacent',
      direction: posDir,
      depthGap: kGap,
      mode,
      screenPos: {
        x: (pA.x + pB.x) * 0.5,
        y: (pA.y + pB.y) * 0.5,
      },
    });

    if (mode !== 'disconnected') {
      const forwardDepth = mode === 'natural' ? 1 : -3;
      adjacencyGraph.get(normA.id)!.push({
        toId: normB.id,
        dx: posInfo.dx,
        dy: posInfo.dy,
        dz: posInfo.dz,
        depthDelta: forwardDepth,
        isEscher: true,
      });
      adjacencyGraph.get(normB.id)!.push({
        toId: normA.id,
        dx: -posInfo.dx,
        dy: -posInfo.dy,
        dz: -posInfo.dz,
        depthDelta: -forwardDepth,
        isEscher: true,
      });
    }
  }

  // 1b. Real-corner diagonals and discarded hypotenuse candidates are also visual links; they only
  // ever live inside a 3-block weld joint (triad) and are broken by default there (real 3D look).
  for (const cand of rawCandidates) {
    if (!cornerIds.has(cand.connId) && !discardedIds.has(cand.connId)) continue;
    if ((connectionModes[cand.connId] ?? 'natural') === 'disconnected') continue;
    const posInfo = AXIS_DELTAS[cand.posDir];
    adjacencyGraph.get(cand.normA.id)!.push({
      toId: cand.normB.id,
      dx: posInfo.dx,
      dy: posInfo.dy,
      dz: posInfo.dz,
      depthDelta: 1,
      isEscher: true,
    });
    adjacencyGraph.get(cand.normB.id)!.push({
      toId: cand.normA.id,
      dx: -posInfo.dx,
      dy: -posInfo.dy,
      dz: -posInfo.dz,
      depthDelta: -1,
      isEscher: true,
    });
  }

  // 1c. Weld joints: three blocks whose lattice cells surround one unit triangle and are all linked.
  // Their +X/+Y/+Z links form a cycle (sum = (1,1,1) != 0), which is the impossible part.
  // Exactly one link must be "broken" for a consistent local depth order. Breaking the link
  // leaving the W-claimant along +W exposes that block's whole W face (plane W welds in front).
  const cellBlock = new Map<string, string>();
  for (const b of blocks) {
    const lc = blockLattice.get(b.id)!;
    const k = `${lc.u},${lc.v}`;
    if (!cellBlock.has(k)) cellBlock.set(k, b.id);
  }
  const hasEdge = (a: string, b: string) =>
    (adjacencyGraph.get(a) ?? []).some((e) => e.toId === b);

  const PLANES: PositiveAxis[] = ['X', 'Y', 'Z'];
  const weldJoints: WeldJoint[] = [];
  const brokenPairs = new Set<string>();

  const edgeBreakScore = (from: string, to: string): number => {
    const connId = makeConnectionId(from, to);
    if (cornerIds.has(connId)) return 4;
    if (discardedIds.has(connId)) return 3;
    if (realNeighbors.get(from)?.has(to)) return 0;
    const cand = candidateById.get(connId);
    return 1 + Math.min(Math.abs(cand?.kGap ?? 0), 50) / 100;
  };

  // A link P -> +D -> Q is an internal beam spine if P continues the same beam backwards (-D).
  // Breaking it would expose P's buried cross-section cap in the middle of a straight bar.
  const isSpine = (from: string, plane: PositiveAxis): boolean => {
    const lc = blockLattice.get(from)!;
    const d = AXIS_DELTAS[`-${plane}` as AxisDirection];
    const backId = cellBlock.get(`${lc.u + d.du},${lc.v + d.dv}`);
    return !!backId && hasEdge(from, backId);
  };

  const tryJoint = (
    key: string,
    kind: 'A' | 'B',
    cu: number,
    cv: number,
    cells: Record<PositiveAxis, [number, number]>,
    links: Record<PositiveAxis, [PositiveAxis, PositiveAxis]>
  ) => {
    const ids = {} as Record<PositiveAxis, string>;
    for (const p of PLANES) {
      const id = cellBlock.get(`${cells[p][0]},${cells[p][1]}`);
      if (!id) return;
      ids[p] = id;
    }
    const edges = {} as Record<PositiveAxis, { from: string; to: string }>;
    for (const p of PLANES) {
      const [f, t] = links[p];
      const from = ids[f];
      const to = ids[t];
      if (!hasEdge(from, to)) return;
      edges[p] = { from, to };
    }

    let defaultPlane: PositiveAxis = 'Y';
    let bestScore = -Infinity;
    for (const p of PLANES) {
      const s = edgeBreakScore(edges[p].from, edges[p].to);
      if (s > bestScore) {
        bestScore = s;
        defaultPlane = p;
      }
    }
    let validPlanes = PLANES.filter((p) => !isSpine(edges[p].from, p));
    if (validPlanes.length === 0) validPlanes = [...PLANES];
    if (!validPlanes.includes(defaultPlane)) validPlanes = PLANES.filter((p) => p === defaultPlane || validPlanes.includes(p));

    const ov = blockWeldOverrides[`joint:${key}`];
    const plane: PositiveAxis =
      ov && (ov.plane === 'X' || ov.plane === 'Y' || ov.plane === 'Z') && validPlanes.includes(ov.plane)
        ? ov.plane
        : defaultPlane;

    brokenPairs.add(makeConnectionId(edges[plane].from, edges[plane].to));

    const p1 = latticeToScreen(cu, cv, orientation, scale);
    const p2 = latticeToScreen(cu + 1, kind === 'A' ? cv : cv + 1, orientation, scale);
    const p3 = latticeToScreen(kind === 'A' ? cu + 1 : cu, cv + 1, orientation, scale);
    weldJoints.push({
      key,
      blockIds: [ids.X, ids.Y, ids.Z],
      plane,
      defaultPlane,
      validPlanes,
      center: { x: (p1.x + p2.x + p3.x) / 3, y: (p1.y + p2.y + p3.y) / 3 },
    });
  };

  for (const b of blocks) {
    const { u, v } = blockLattice.get(b.id)!;
    if (cellBlock.get(`${u},${v}`) !== b.id) continue;
    // ΔA(u,v): X-claimant (u+1,v), Y-claimant (u,v), Z-claimant (u+1,v+1)
    tryJoint(
      `A:${u},${v}`,
      'A',
      u,
      v,
      { X: [u + 1, v], Y: [u, v], Z: [u + 1, v + 1] },
      { X: ['X', 'Y'], Y: ['Y', 'Z'], Z: ['Z', 'X'] }
    );
    // ΔB(u,v): X-claimant (u+1,v+1), Y-claimant (u,v), Z-claimant (u,v+1)
    tryJoint(
      `B:${u},${v}`,
      'B',
      u,
      v,
      { X: [u + 1, v + 1], Y: [u, v], Z: [u, v + 1] },
      { X: ['X', 'Z'], Y: ['Y', 'X'], Z: ['Z', 'Y'] }
    );
  }

  for (const [id, edges] of adjacencyGraph.entries()) {
    adjacencyGraph.set(
      id,
      edges.filter((e) => !brokenPairs.has(makeConnectionId(id, e.toId)))
    );
  }

  // 2. Helper: Find local virtual 3D offset & relative depth between two nearby blocks via BFS (<= 4 hops)
  const MAX_LOCAL_HOPS = 4;
  type LocalRelation = {
    found: boolean;
    dx: number;
    dy: number;
    dz: number;
    depthDelta: number;
    hasEscher: boolean;
  };
  const relationCache = new Map<string, LocalRelation>();
  function findLocalRelation(startId: string, targetId: string): LocalRelation {
    const ck = `${startId}|${targetId}`;
    let rel = relationCache.get(ck);
    if (!rel) {
      rel = computeLocalRelation(startId, targetId);
      relationCache.set(ck, rel);
    }
    return rel;
  }
  function computeLocalRelation(startId: string, targetId: string): LocalRelation {
    if (startId === targetId) {
      return { found: true, dx: 0, dy: 0, dz: 0, depthDelta: 0, hasEscher: false };
    }

    const startLC = blockLattice.get(startId)!;
    const targetLC = blockLattice.get(targetId)!;
    const targetDu = targetLC.u - startLC.u;
    const targetDv = targetLC.v - startLC.v;

    interface QueueItem {
      id: string;
      hops: number;
      dx: number;
      dy: number;
      dz: number;
      depthDelta: number;
      hasEscher: boolean;
    }

    const queue: QueueItem[] = [
      { id: startId, hops: 0, dx: 0, dy: 0, dz: 0, depthDelta: 0, hasEscher: false },
    ];
    const visited = new Set<string>([startId]);

    while (queue.length > 0) {
      const curr = queue.shift()!;
      if (curr.hops >= MAX_LOCAL_HOPS) continue;

      const neighbors = adjacencyGraph.get(curr.id) ?? [];
      for (const edge of neighbors) {
        if (visited.has(edge.toId)) continue;
        const nx = curr.dx + edge.dx;
        const ny = curr.dy + edge.dy;
        const nz = curr.dz + edge.dz;
        const nDepth = curr.depthDelta + edge.depthDelta;
        const nEscher = curr.hasEscher || edge.isEscher;

        if (edge.toId === targetId) {
          // Verify that the virtual 3D offset projects to the exact 2D offset (targetDu, targetDv)
          if (ny - nx === targetDu && ny - nz === targetDv) {
            return {
              found: true,
              dx: nx,
              dy: ny,
              dz: nz,
              depthDelta: nDepth,
              hasEscher: nEscher,
            };
          }
        }

        visited.add(edge.toId);
        queue.push({
          id: edge.toId,
          hops: curr.hops + 1,
          dx: nx,
          dy: ny,
          dz: nz,
          depthDelta: nDepth,
          hasEscher: nEscher,
        });
      }
    }

    return { found: false, dx: 0, dy: 0, dz: 0, depthDelta: 0, hasEscher: false };
  }

  // 3. Populate the 2D unit triangles for all blocks
  interface TriangleClaim {
    blockId: string;
    faceType: FaceType;
  }

  const triangleClaims = new Map<string, TriangleClaim[]>();
  const triangleMeta = new Map<string, { kind: 'A' | 'B'; cu: number; cv: number }>();

  function addClaim(kind: 'A' | 'B', cu: number, cv: number, blockId: string, faceType: FaceType) {
    const key = `${kind}:${cu},${cv}`;
    let list = triangleClaims.get(key);
    if (!list) {
      list = [];
      triangleClaims.set(key, list);
      triangleMeta.set(key, { kind, cu, cv });
    }
    list.push({ blockId, faceType });
  }

  for (const b of blocks) {
    const { u, v } = blockLattice.get(b.id)!;
    // Gray (+X) face: ΔB(u-1, v-1) and ΔA(u-1, v)
    addClaim('B', u - 1, v - 1, b.id, 'X');
    addClaim('A', u - 1, v, b.id, 'X');

    // Black (+Y) face: ΔA(u, v) and ΔB(u, v)
    addClaim('A', u, v, b.id, 'Y');
    addClaim('B', u, v, b.id, 'Y');

    // White (+Z) face: ΔA(u-1, v-1) and ΔB(u, v-1)
    addClaim('A', u - 1, v - 1, b.id, 'Z');
    addClaim('B', u, v - 1, b.id, 'Z');
  }

  // Also detect non-adjacent beam crossings (blocks that share a triangle but have no local 4-hop path)
  for (const [, claims] of triangleClaims.entries()) {
    if (claims.length < 2) continue;
    for (let i = 0; i < claims.length; i++) {
      for (let j = i + 1; j < claims.length; j++) {
        const idA = claims[i].blockId;
        const idB = claims[j].blockId;
        if (idA === idB) continue;
        const connId = makeConnectionId(idA, idB);
        if (seenPairs.has(connId)) continue;

        const rel = findLocalRelation(idA, idB);
        if (!rel.found) {
          seenPairs.add(connId);
          const bA = blockMap.get(idA)!;
          const bB = blockMap.get(idB)!;
          const dA = blockDepth(bA.x, bA.y, bA.z);
          const dB = blockDepth(bB.x, bB.y, bB.z);
          const pA = blockScreenCenters.get(idA)!;
          const pB = blockScreenCenters.get(idB)!;
          const mode: ConnectionMode = connectionModes[connId] ?? 'natural';

          escherConnections.push({
            id: connId,
            blockAId: dA <= dB ? idA : idB,
            blockBId: dA <= dB ? idB : idA,
            kind: 'crossing',
            depthGap: Math.round(( Math.abs(dB - dA) ) / 3) || 1,
            mode,
            screenPos: {
              x: (pA.x + pB.x) * 0.5,
              y: (pA.y + pB.y) * 0.5,
            },
          });
        }
      }
    }
  }

  // Comparator: returns true if block2 is in front of block1.
  // Depends ONLY on the two blocks (never on which face is competing), so a block either wins
  // or loses against a neighbor consistently across every triangle they share.
  function isBlockInFront(id1: string, id2: string): boolean {
    if (id1 === id2) return false;

    const rel = findLocalRelation(id1, id2);
    if (rel.found) {
      if (rel.depthDelta !== 0) {
        return rel.depthDelta > 0;
      }
    }

    const b1 = blockMap.get(id1)!;
    const b2 = blockMap.get(id2)!;
    const d1 = blockDepth(b1.x, b1.y, b1.z);
    const d2 = blockDepth(b2.x, b2.y, b2.z);

    const connId = makeConnectionId(id1, id2);
    const crossMode = connectionModes[connId];
    if (crossMode === 'flipped') {
      return d2 < d1;
    }

    if (d2 !== d1) return d2 > d1;
    return id2 > id1;
  }

  // A face D of block P is buried (glued) when P is linked to a neighbor Q one step along +D
  // that sits directly in front of it: that face is an internal cross-section and never visible.
  function isClaimBuried(claim: TriangleClaim, claims: TriangleClaim[]): boolean {
    const d = AXIS_DELTAS[`+${claim.faceType}` as AxisDirection];
    for (const e of adjacencyGraph.get(claim.blockId) ?? []) {
      if (e.dx === d.dx && e.dy === d.dy && e.dz === d.dz && e.depthDelta > 0) {
        if (claims.some((c) => c.blockId === e.toId)) return true;
      }
    }
    return false;
  }

  // 4. Resolve the winning block and faceType for each occupied 2D unit triangle.
  // 4a. Each triangle proposes a preferred winner from the weld/depth rules, plus a ranked list of
  //     alternatives (other unburied claims cost 1, buried internal faces cost 3).
  const winningClaims = new Map<string, TriangleClaim>();
  const renderedTriangles: RenderedTriangle[] = [];
  const claimOptions = new Map<string, { claim: TriangleClaim; cost: number }[]>();

  for (const [key, allClaims] of triangleClaims.entries()) {
    const visible = allClaims.filter((c) => !isClaimBuried(c, allClaims));
    const claims = visible.length > 0 ? visible : allClaims;
    let winner = claims[0];
    for (let i = 1; i < claims.length; i++) {
      if (isBlockInFront(winner.blockId, claims[i].blockId)) {
        winner = claims[i];
      }
    }
    winningClaims.set(key, winner);

    const options = [{ claim: winner, cost: 0 }];
    for (const c of allClaims) {
      if (options.some((o) => o.claim.blockId === c.blockId && o.claim.faceType === c.faceType)) continue;
      options.push({ claim: c, cost: visible.includes(c) ? 1 : 3 });
    }
    claimOptions.set(key, options.slice(0, 4));
  }

  // 4b. Local consistency repair. Each 3-block weld joint picks its plane on its own, but up to six
  //     joints meet around a single lattice vertex; some combinations produce a vertex no cube
  //     arrangement could draw (a stray triangle or notch). Re-pick the six triangles around each such
  //     vertex, choosing the closest option to the preferred winners that makes it (and its neighbors)
  //     locally realizable.
  repairLocalConsistency(winningClaims, claimOptions, (a, b) => {
    if (a.faceType !== b.faceType) return true;
    if (a.blockId === b.blockId) return false;
    return !shouldMergeSameFaceEdge(a.blockId, b.blockId, a.faceType);
  });

  for (const [key, winner] of winningClaims.entries()) {
    const meta = triangleMeta.get(key)!;
    const { kind, cu, cv } = meta;
    const p1 = latticeToScreen(cu, cv, orientation, scale);
    const p2 =
      kind === 'A'
        ? latticeToScreen(cu + 1, cv, orientation, scale)
        : latticeToScreen(cu + 1, cv + 1, orientation, scale);
    const p3 =
      kind === 'A'
        ? latticeToScreen(cu + 1, cv + 1, orientation, scale)
        : latticeToScreen(cu, cv + 1, orientation, scale);

    renderedTriangles.push({
      key,
      kind,
      cu,
      cv,
      blockId: winner.blockId,
      faceType: winner.faceType,
      points: [p1, p2, p3],
    });
  }

  // 5. Coplanarity check for merging edges between two adjacent triangles of the same faceType
  function shouldMergeSameFaceEdge(blockId1: string, blockId2: string, face: FaceType): boolean {
    if (blockId1 === blockId2) return true;

    const rel = findLocalRelation(blockId1, blockId2);
    if (!rel.found) return false;
    if (face === 'X') return rel.dx === 0;
    if (face === 'Y') return rel.dy === 0;
    return rel.dz === 0;
  }

  // 6. Classify all lattice edges bordering occupied triangles
  interface LatticeEdgeSegment {
    u1: number;
    v1: number;
    u2: number;
    v2: number;
    kind: 'silhouette' | 'crease' | 'cliff' | 'seam';
  }

  const checkedEdges = new Set<string>();
  const rawMainEdges: LatticeEdgeSegment[] = [];
  const rawSeamEdges: LatticeEdgeSegment[] = [];

  function evaluateLatticeEdge(
    tKey1: string,
    tKey2: string,
    u1: number,
    v1: number,
    u2: number,
    v2: number
  ) {
    const eKey =
      u1 < u2 || (u1 === u2 && v1 < v2)
        ? `${u1},${v1}-${u2},${v2}`
        : `${u2},${v2}-${u1},${v1}`;
    if (checkedEdges.has(eKey)) return;
    checkedEdges.add(eKey);

    const w1 = winningClaims.get(tKey1);
    const w2 = winningClaims.get(tKey2);
    if (!w1 && !w2) return;

    const nu1 = u1 < u2 || (u1 === u2 && v1 < v2) ? u1 : u2;
    const nv1 = u1 < u2 || (u1 === u2 && v1 < v2) ? v1 : v2;
    const nu2 = u1 < u2 || (u1 === u2 && v1 < v2) ? u2 : u1;
    const nv2 = u1 < u2 || (u1 === u2 && v1 < v2) ? v2 : v1;

    if (!w1 || !w2) {
      rawMainEdges.push({ u1: nu1, v1: nv1, u2: nu2, v2: nv2, kind: 'silhouette' });
      return;
    }

    if (w1.faceType !== w2.faceType) {
      rawMainEdges.push({ u1: nu1, v1: nv1, u2: nu2, v2: nv2, kind: 'crease' });
      return;
    }

    // Same faceType: check if they belong to the same block or coplanar connected blocks
    if (w1.blockId === w2.blockId) {
      // Internal diagonal of a single rhombus face -> never draw
      return;
    }

    if (shouldMergeSameFaceEdge(w1.blockId, w2.blockId, w1.faceType)) {
      // Coplanar merged seam -> hidden in Escher view, optional in voxel grid view
      rawSeamEdges.push({ u1: nu1, v1: nv1, u2: nu2, v2: nv2, kind: 'seam' });
    } else {
      // Non-coplanar occlusion cliff between two separate beams of the same color
      rawMainEdges.push({ u1: nu1, v1: nv1, u2: nu2, v2: nv2, kind: 'cliff' });
    }
  }

  for (const [key] of winningClaims.entries()) {
    const meta = triangleMeta.get(key)!;
    const { kind, cu, cv } = meta;
    if (kind === 'A') {
      // ΔA(cu, cv) borders:
      // 1. ΔB(cu, cv - 1) along (cu, cv) - (cu + 1, cv)
      evaluateLatticeEdge(key, `B:${cu},${cv - 1}`, cu, cv, cu + 1, cv);
      // 2. ΔB(cu + 1, cv) along (cu + 1, cv) - (cu + 1, cv + 1)
      evaluateLatticeEdge(key, `B:${cu + 1},${cv}`, cu + 1, cv, cu + 1, cv + 1);
      // 3. ΔB(cu, cv) along (cu, cv) - (cu + 1, cv + 1)
      evaluateLatticeEdge(key, `B:${cu},${cv}`, cu, cv, cu + 1, cv + 1);
    } else {
      // ΔB(cu, cv) borders:
      // 1. ΔA(cu, cv) along (cu, cv) - (cu + 1, cv + 1)
      evaluateLatticeEdge(key, `A:${cu},${cv}`, cu, cv, cu + 1, cv + 1);
      // 2. ΔA(cu, cv + 1) along (cu + 1, cv + 1) - (cu, cv + 1)
      evaluateLatticeEdge(key, `A:${cu},${cv + 1}`, cu, cv + 1, cu + 1, cv + 1);
      // 3. ΔA(cu - 1, cv) along (cu, cv + 1) - (cu, cv)
      evaluateLatticeEdge(key, `A:${cu - 1},${cv}`, cu, cv, cu, cv + 1);
    }
  }

  // 7. Merge collinear contiguous lattice segments for ultra-clean vector strokes
  function mergeCollinearSegments(segments: LatticeEdgeSegment[]): RenderedEdge[] {
    const byDir = new Map<string, LatticeEdgeSegment[]>();

    for (const seg of segments) {
      const du = seg.u2 - seg.u1;
      const dv = seg.v2 - seg.v1;
      // Invariants for each of the 3 lattice line families:
      // Family (1,0): v is constant
      // Family (0,1): u is constant
      // Family (1,1): u - v is constant
      const lineId =
        du === 1 && dv === 0
          ? `H:${seg.v1}`
          : du === 0 && dv === 1
            ? `V:${seg.u1}`
            : `D:${seg.u1 - seg.v1}`;
      let list = byDir.get(lineId);
      if (!list) {
        list = [];
        byDir.set(lineId, list);
      }
      list.push(seg);
    }

    const merged: RenderedEdge[] = [];
    for (const [lineId, list] of byDir.entries()) {
      list.sort((a, b) => (a.u1 !== b.u1 ? a.u1 - b.u1 : a.v1 - b.v1));
      let curr = { ...list[0] };
      for (let i = 1; i < list.length; i++) {
        const next = list[i];
        if (curr.u2 === next.u1 && curr.v2 === next.v1) {
          curr.u2 = next.u2;
          curr.v2 = next.v2;
        } else {
          merged.push({
            key: `${lineId}:${curr.u1},${curr.v1}-${curr.u2},${curr.v2}`,
            p1: latticeToScreen(curr.u1, curr.v1, orientation, scale),
            p2: latticeToScreen(curr.u2, curr.v2, orientation, scale),
            kind: curr.kind,
          });
          curr = { ...next };
        }
      }
      merged.push({
        key: `${lineId}:${curr.u1},${curr.v1}-${curr.u2},${curr.v2}`,
        p1: latticeToScreen(curr.u1, curr.v1, orientation, scale),
        p2: latticeToScreen(curr.u2, curr.v2, orientation, scale),
        kind: curr.kind,
      });
    }
    return merged;
  }

  return {
    triangles: renderedTriangles,
    edges: mergeCollinearSegments(rawMainEdges),
    seamEdges: rawSeamEdges.map((seg) => ({
      key: `seam:${seg.u1},${seg.v1}-${seg.u2},${seg.v2}`,
      p1: latticeToScreen(seg.u1, seg.v1, orientation, scale),
      p2: latticeToScreen(seg.u2, seg.v2, orientation, scale),
      kind: 'seam',
    })),
    connections: escherConnections,
    blockScreenCenters,
    weldJoints,
  };
}

/** The 6 triangles around lattice vertex (u, v), in ring order (see realizablePatterns.ts). */
function ringTriangleKeys(u: number, v: number): string[] {
  return [
    `A:${u},${v}`,
    `B:${u},${v}`,
    `A:${u - 1},${v}`,
    `B:${u - 1},${v - 1}`,
    `A:${u - 1},${v - 1}`,
    `B:${u},${v - 1}`,
  ];
}

const RING_NEIGHBORS: [number, number][] = [
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 0],
  [-1, -1],
  [0, -1],
];

/** Vertex patterns packed into 18 bits: per ring triangle, (face code * 2 + line bit) << 3i. */
const FACE_CODE: Record<string, number> = { '.': 0, X: 1, Y: 2, Z: 3 };
const REALIZABLE_CODES: ReadonlySet<number> = new Set(
  [...REALIZABLE_VERTEX_PATTERNS].map((p) => {
    let code = 0;
    for (let i = 0; i < 6; i++) code |= (FACE_CODE[p[2 * i]] * 2 + (p[2 * i + 1] === '|' ? 1 : 0)) << (3 * i);
    return code;
  })
);

/**
 * Makes every lattice vertex locally realizable (see realizablePatterns.ts) by re-picking triangle
 * winners among their claim options, preferring the cheapest deviation from the current winners.
 * Only strict improvements are applied, so it always terminates.
 */
function repairLocalConsistency<C extends { blockId: string; faceType: FaceType }>(
  winners: Map<string, C>,
  options: Map<string, { claim: C; cost: number }[]>,
  needsLine: (a: C, b: C) => boolean
): void {
  const lineCache = new Map<C, Map<C, boolean>>();
  const hasLine = (a: C | undefined, b: C | undefined): boolean => {
    if (!a && !b) return false;
    if (!a || !b) return true;
    let row = lineCache.get(a);
    if (!row) {
      row = new Map();
      lineCache.set(a, row);
    }
    let r = row.get(b);
    if (r === undefined) {
      r = needsLine(a, b);
      row.set(b, r);
    }
    return r;
  };
  const isBad = (u: number, v: number): boolean => {
    const keys = ringTriangleKeys(u, v);
    const tris = keys.map((k) => winners.get(k));
    let code = 0;
    for (let i = 0; i < 6; i++) {
      const a = tris[i];
      code |= ((a ? FACE_CODE[a.faceType] : 0) * 2 + (hasLine(a, tris[(i + 1) % 6]) ? 1 : 0)) << (3 * i);
    }
    return !REALIZABLE_CODES.has(code);
  };

  const queue: [number, number][] = [];
  const seenVertex = new Set<string>();
  for (const key of winners.keys()) {
    const [kind, rest] = key.split(':');
    const [cu, cv] = rest.split(',').map(Number);
    const verts: [number, number][] =
      kind === 'A'
        ? [[cu, cv], [cu + 1, cv], [cu + 1, cv + 1]]
        : [[cu, cv], [cu + 1, cv + 1], [cu, cv + 1]];
    for (const [u, v] of verts) {
      const vk = `${u},${v}`;
      if (seenVertex.has(vk)) continue;
      seenVertex.add(vk);
      if (isBad(u, v)) queue.push([u, v]);
    }
  }

  const vertsOfTriangle = (key: string): [number, number][] => {
    const [kind, rest] = key.split(':');
    const [cu, cv] = rest.split(',').map(Number);
    return kind === 'A'
      ? [[cu, cv], [cu + 1, cv], [cu + 1, cv + 1]]
      : [[cu, cv], [cu + 1, cv + 1], [cu, cv + 1]];
  };
  const costOf = (k: string, c: C) => options.get(k)!.find((o) => o.claim === c)?.cost ?? 0;

  /** Exhaustive branch-and-bound over the winners of `keys`; applies the result if it strictly
   *  reduces the number of unrealizable vertices touched by the window. */
  const tryWindow = (keys: string[]): [number, number][] | null => {
    const vmap = new Map<string, [number, number]>();
    for (const k of keys) for (const p of vertsOfTriangle(k)) vmap.set(`${p[0]},${p[1]}`, p);
    const verts = [...vmap.values()];
    // A vertex can be judged once the last of its window triangles has been assigned.
    const checkAt: [number, number][][] = keys.map(() => []);
    for (const p of verts) {
      const ring = new Set(ringTriangleKeys(p[0], p[1]));
      let last = -1;
      keys.forEach((k, i) => {
        if (ring.has(k)) last = i;
      });
      checkAt[last].push(p);
    }
    const original = keys.map((k) => winners.get(k)!);
    const startBad = verts.reduce((n, [a, b]) => n + (isBad(a, b) ? 1 : 0), 0);
    let bestBad = startBad;
    let bestCost = keys.reduce((s, k, i) => s + costOf(k, original[i]), 0);
    let best = original.slice();
    const pick = original.slice();

    const search = (i: number, bad: number, cost: number) => {
      if (bad > bestBad || (bad === bestBad && cost >= bestCost)) return;
      if (i === keys.length) {
        bestBad = bad;
        bestCost = cost;
        best = pick.slice();
        return;
      }
      for (const o of options.get(keys[i])!) {
        pick[i] = o.claim;
        winners.set(keys[i], o.claim);
        let b = bad;
        for (const [a, c] of checkAt[i]) if (isBad(a, c)) b++;
        search(i + 1, b, cost + o.cost);
      }
      winners.set(keys[i], original[i]);
    };
    search(0, 0, 0);

    const improved = bestBad < startBad;
    keys.forEach((k, i) => winners.set(k, improved ? best[i] : original[i]));
    return improved ? verts : null;
  };

  let budget = queue.length * 4 + 16;
  while (queue.length > 0 && budget-- > 0) {
    const [u, v] = queue.shift()!;
    if (!isBad(u, v)) continue;

    const own = ringTriangleKeys(u, v).filter((k) => options.has(k));
    let touched = tryWindow(own);
    // Some artifacts (e.g. a block hidden on all six sides) need two neighboring vertices re-picked together.
    for (let n = 0; !touched && n < RING_NEIGHBORS.length; n++) {
      const [du, dv] = RING_NEIGHBORS[n];
      const extra = ringTriangleKeys(u + du, v + dv).filter((k) => options.has(k) && !own.includes(k));
      if (extra.length > 0) touched = tryWindow([...own, ...extra]);
    }
    if (touched) {
      for (const [au, av] of touched) if (isBad(au, av)) queue.push([au, av]);
    }
  }
}

/**
 * Given a cursor position in SVG screen coordinates, finds the best ghost block placement candidate
 * adjacent to existing blocks (or on the empty lattice if no blocks exist yet).
 */
export function findBestGhostCandidate(
  screenX: number,
  screenY: number,
  blocks: VoxelBlock[],
  orientation: ViewOrientation,
  scale: number = BASE_SCALE
): GhostCandidate | null {
  if (blocks.length === 0) {
    const lc = screenToLattice(screenX, screenY, orientation, scale);
    const ru = Math.round(lc.u);
    const rv = Math.round(lc.v);
    // Pick integer (x, y, z) with y = 0 => x = -ru, z = -rv
    const x = -ru;
    const y = 0;
    const z = -rv;
    return {
      x,
      y,
      z,
      u: ru,
      v: rv,
      label: 'Place Starter Block',
      willEscherConnect: false,
      escherTargetCount: 0,
      screenCenter: latticeToScreen(ru, rv, orientation, scale),
      rhombuses: getBlockRhombuses(ru, rv, orientation, scale),
    };
  }

  // Occupied 2D lattice cells
  const occupiedByLattice = new Map<string, VoxelBlock[]>();
  for (const b of blocks) {
    const lc = blockToLattice(b.x, b.y, b.z);
    const key = `${lc.u},${lc.v}`;
    const arr = occupiedByLattice.get(key) ?? [];
    arr.push(b);
    occupiedByLattice.set(key, arr);
  }

  // Generate all 6 neighbor candidates around every existing block
  let bestCandidate: GhostCandidate | null = null;
  let bestDistSq = Infinity;

  const directions: AxisDirection[] = ['+X', '-X', '+Y', '-Y', '+Z', '-Z'];

  for (const b of blocks) {
    const blc = blockToLattice(b.x, b.y, b.z);
    const bScreen = latticeToScreen(blc.u, blc.v, orientation, scale);

    for (const dir of directions) {
      const info = AXIS_DELTAS[dir];
      const nx = b.x + info.dx;
      const ny = b.y + info.dy;
      const nz = b.z + info.dz;
      const nu = blc.u + info.du;
      const nv = blc.v + info.dv;

      // Skip if this 2D cell is already occupied by any block
      if (occupiedByLattice.has(`${nu},${nv}`)) {
        continue;
      }

      const nScreen = latticeToScreen(nu, nv, orientation, scale);
      // Bias slightly toward the face anchor between bScreen and nScreen for ergonomic hover
      const anchorX = bScreen.x * 0.25 + nScreen.x * 0.75;
      const anchorY = bScreen.y * 0.25 + nScreen.y * 0.75;

      const dx = screenX - anchorX;
      const dy = screenY - anchorY;
      const distSq = dx * dx + dy * dy;

      if (distSq < bestDistSq && distSq <= (scale * 1.45) ** 2) {
        // Check if placing at (nx, ny, nz) creates any Escher connections with other existing blocks!
        let escherTargetCount = 0;
        for (const other of blocks) {
          if (other.id === b.id) continue;
          const olc = blockToLattice(other.x, other.y, other.z);
          const odu = olc.u - nu;
          const odv = olc.v - nv;
          for (const dInfo of Object.values(AXIS_DELTAS)) {
            if (dInfo.du === odu && dInfo.dv === odv) {
              const kx = other.x - nx - dInfo.dx;
              if (kx !== 0) {
                escherTargetCount++;
              }
            }
          }
        }

        bestDistSq = distSq;
        bestCandidate = {
          x: nx,
          y: ny,
          z: nz,
          u: nu,
          v: nv,
          fromBlockId: b.id,
          direction: dir,
          label: info.label,
          willEscherConnect: escherTargetCount > 0,
          escherTargetCount,
          screenCenter: nScreen,
          rhombuses: getBlockRhombuses(nu, nv, orientation, scale),
        };
      }
    }
  }

  return bestCandidate;
}

/**
 * Resolves a GhostCandidate at a specific 2D lattice coordinate (u, v) for keyboard navigation.
 * If (u, v) is adjacent to an existing block (preferring preferredAnchorId), snaps its 3D (x, y, z)
 * to that block's 3D neighbor so it connects seamlessly.
 */
export function resolveGhostAtLattice(
  u: number,
  v: number,
  fallbackXYZ: { x: number; y: number; z: number },
  blocks: VoxelBlock[],
  preferredAnchorId: string | null,
  orientation: ViewOrientation,
  scale: number = BASE_SCALE
): GhostCandidate {
  const screenCenter = latticeToScreen(u, v, orientation, scale);
  const rhombuses = getBlockRhombuses(u, v, orientation, scale);

  if (blocks.length === 0) {
    return {
      x: fallbackXYZ.x,
      y: fallbackXYZ.y,
      z: fallbackXYZ.z,
      u,
      v,
      label: 'Starter Block (Space to Add)',
      willEscherConnect: false,
      escherTargetCount: 0,
      screenCenter,
      rhombuses,
    };
  }

  // Order blocks so preferredAnchorId is checked first, then most recently added blocks
  const orderedBlocks: VoxelBlock[] = [];
  if (preferredAnchorId) {
    const pref = blocks.find((b) => b.id === preferredAnchorId);
    if (pref) orderedBlocks.push(pref);
  }
  for (let i = blocks.length - 1; i >= 0; i--) {
    if (blocks[i].id !== preferredAnchorId) {
      orderedBlocks.push(blocks[i]);
    }
  }

  const directions: AxisDirection[] = ['+X', '-X', '+Y', '-Y', '+Z', '-Z'];
  let matchedBlock: VoxelBlock | undefined;
  let matchedDir: AxisDirection | undefined;

  for (const b of orderedBlocks) {
    const blc = blockToLattice(b.x, b.y, b.z);
    const du = u - blc.u;
    const dv = v - blc.v;
    for (const dir of directions) {
      const info = AXIS_DELTAS[dir];
      if (info.du === du && info.dv === dv) {
        matchedBlock = b;
        matchedDir = dir;
        break;
      }
    }
    if (matchedBlock) break;
  }

  const nx = matchedBlock && matchedDir ? matchedBlock.x + AXIS_DELTAS[matchedDir].dx : fallbackXYZ.x;
  const ny = matchedBlock && matchedDir ? matchedBlock.y + AXIS_DELTAS[matchedDir].dy : fallbackXYZ.y;
  const nz = matchedBlock && matchedDir ? matchedBlock.z + AXIS_DELTAS[matchedDir].dz : fallbackXYZ.z;

  // Check if placing at (nx, ny, nz) creates any Escher connections with other existing blocks
  let escherTargetCount = 0;
  for (const other of blocks) {
    if (matchedBlock && other.id === matchedBlock.id) continue;
    const olc = blockToLattice(other.x, other.y, other.z);
    const odu = olc.u - u;
    const odv = olc.v - v;
    for (const dInfo of Object.values(AXIS_DELTAS)) {
      if (dInfo.du === odu && dInfo.dv === odv) {
        const kx = other.x - nx - dInfo.dx;
        if (kx !== 0) {
          escherTargetCount++;
        }
      }
    }
  }

  return {
    x: nx,
    y: ny,
    z: nz,
    u,
    v,
    fromBlockId: matchedBlock?.id,
    direction: matchedDir,
    label: matchedDir ? AXIS_DELTAS[matchedDir].label : 'Free Lattice Cell',
    willEscherConnect: escherTargetCount > 0,
    escherTargetCount,
    screenCenter,
    rhombuses,
  };
}

export const WELD_PLANE_LABELS: Record<BlockWeldPlane, string> = {
  auto: 'Auto Weld',
  X: 'Gray (X) face welds in front',
  Y: 'Black (Y) face welds in front',
  Z: 'White (Z) face welds in front',
  front: 'All Faces Front',
  back: 'All Faces Back',
};

/**
 * Finds the weld joint (3-block impossible corner) that Shift+Click on `blockId` should act on.
 * Prefers joints containing the block, nearest to `point` (screen/world coords) if given.
 */
export function findWeldJointForBlock(
  scene: EngineSceneResult,
  blockId: string | null | undefined,
  point?: ScreenPoint | null
): WeldJoint | null {
  const ref = point ?? (blockId ? scene.blockScreenCenters.get(blockId) : undefined) ?? null;
  const dist = (j: WeldJoint) => (ref ? (j.center.x - ref.x) ** 2 + (j.center.y - ref.y) ** 2 : 0);

  const owned = blockId ? scene.weldJoints.filter((j) => j.blockIds.includes(blockId)) : [];
  if (owned.length > 0) {
    return owned.reduce((best, j) => (dist(j) < dist(best) ? j : best));
  }
  if (!ref || scene.weldJoints.length === 0) return null;
  const nearest = scene.weldJoints.reduce((best, j) => (dist(j) < dist(best) ? j : best));
  return dist(nearest) <= (BASE_SCALE * 1.2) ** 2 ? nearest : null;
}

export interface WeldJointToggle {
  joint: WeldJoint;
  /** Key into blockWeldOverrides (`joint:<key>`). */
  jointKey: string;
  nextPlane: PositiveAxis;
  nextOrder: number;
}

const sceneSignature = (s: EngineSceneResult) =>
  s.triangles
    .map((t) => `${t.key}=${t.faceType}`)
    .sort()
    .join('|');

/**
 * Lists every weld joint whose plane can be cycled to a different, visibly distinct look
 * (X -> Y -> Z order, skipping planes that render identically). Each entry carries the plane that
 * the next toggle would switch to.
 */
export function listToggleableJoints(
  blocks: VoxelBlock[],
  connectionModes: Record<string, ConnectionMode>,
  blockWeldOverrides: Record<string, BlockWeldOverride>,
  orientation: ViewOrientation,
  scene: EngineSceneResult = buildEscherScene(blocks, connectionModes, orientation, BASE_SCALE, blockWeldOverrides)
): WeldJointToggle[] {
  let maxOrder = 0;
  for (const ov of Object.values(blockWeldOverrides)) {
    if (ov.order > maxOrder) maxOrder = ov.order;
  }
  const nextOrder = maxOrder + 1;
  const currentSig = sceneSignature(scene);
  const order: PositiveAxis[] = ['X', 'Y', 'Z'];
  const result: WeldJointToggle[] = [];

  for (const joint of scene.weldJoints) {
    if (joint.validPlanes.length < 2) continue;
    const jointKey = `joint:${joint.key}`;
    const start = order.indexOf(joint.plane);
    for (let offset = 1; offset < order.length; offset++) {
      const candidate = order[(start + offset) % order.length];
      if (!joint.validPlanes.includes(candidate)) continue;
      const test = buildEscherScene(blocks, connectionModes, orientation, BASE_SCALE, {
        ...blockWeldOverrides,
        [jointKey]: { plane: candidate, order: nextOrder },
      });
      if (sceneSignature(test) !== currentSig) {
        result.push({ joint, jointKey, nextPlane: candidate, nextOrder });
        break;
      }
    }
  }
  return result;
}

/**
 * Shift+Click: cycles the nearest weld joint to the next coherent plane (X -> Y -> Z) that
 * produces a visible change. Only geometrically consistent options are offered: each option
 * breaks exactly one link of the joint's impossible cycle, so every face stays whole.
 */
export function getNextWeldJointToggle(
  targetBlockId: string,
  blocks: VoxelBlock[],
  connectionModes: Record<string, ConnectionMode>,
  blockWeldOverrides: Record<string, BlockWeldOverride>,
  orientation: ViewOrientation,
  point?: ScreenPoint | null
): { jointKey: string; nextPlane: PositiveAxis; nextOrder: number } | null {
  const scene = buildEscherScene(blocks, connectionModes, orientation, BASE_SCALE, blockWeldOverrides);
  const toggles = listToggleableJoints(blocks, connectionModes, blockWeldOverrides, orientation, scene);
  if (toggles.length === 0) return null;
  // Reuse the Shift+Click targeting rules, restricted to joints that actually change the picture.
  const joint = findWeldJointForBlock(
    { ...scene, weldJoints: toggles.map((t) => t.joint) },
    targetBlockId,
    point
  );
  const hit = joint ? toggles.find((t) => t.joint.key === joint.key) : undefined;
  return hit ? { jointKey: hit.jointKey, nextPlane: hit.nextPlane, nextOrder: hit.nextOrder } : null;
}
