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

export interface EngineSceneResult {
  triangles: RenderedTriangle[];
  edges: RenderedEdge[];
  seamEdges: RenderedEdge[];
  connections: EscherConnection[];
  blockScreenCenters: Map<string, ScreenPoint>;
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

  for (let i = 0; i < blocks.length; i++) {
    const a = blocks[i];
    const la = blockLattice.get(a.id)!;

    for (let j = i + 1; j < blocks.length; j++) {
      const b = blocks[j];
      const lb = blockLattice.get(b.id)!;

      const du = lb.u - la.u;
      const dv = lb.v - la.v;

      let matchedDirFromA: AxisDirection | null = null;
      for (const [dir, info] of Object.entries(AXIS_DELTAS) as [
        AxisDirection,
        (typeof AXIS_DELTAS)[AxisDirection],
      ][]) {
        if (info.du === du && info.dv === dv) {
          matchedDirFromA = dir;
          break;
        }
      }

      if (!matchedDirFromA) continue;

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
  const nonCornerCandidates = rawCandidates.filter((cand) => {
    const nA = realNeighbors.get(cand.normA.id)!;
    const nB = realNeighbors.get(cand.normB.id)!;
    for (const midId of nA) {
      if (nB.has(midId)) {
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
  for (let i = 0; i < nonCornerCandidates.length; i++) {
    for (let j = i + 1; j < nonCornerCandidates.length; j++) {
      const c1 = nonCornerCandidates[i];
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

  // 2. Helper: Find local virtual 3D offset & relative depth between two nearby blocks via BFS (<= 4 hops)
  const MAX_LOCAL_HOPS = 4;
  function findLocalRelation(
    startId: string,
    targetId: string
  ): {
    found: boolean;
    dx: number;
    dy: number;
    dz: number;
    depthDelta: number;
    hasEscher: boolean;
  } {
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

  // Helper: find active weld plane override affecting a pair of competing blocks (including shared 1-hop corner block)
  function findActiveWeldOverride(
    id1: string,
    id2: string
  ): { ownerId: string; plane: BlockWeldPlane; order: number } | null {
    const candidateIds: string[] = [id1, id2];
    const edges1 = adjacencyGraph.get(id1) ?? [];
    const edges2 = adjacencyGraph.get(id2) ?? [];
    for (const e1 of edges1) {
      if (edges2.some((e2) => e2.toId === e1.toId)) {
        candidateIds.push(e1.toId);
      }
    }

    let best: { ownerId: string; plane: BlockWeldPlane; order: number } | null = null;
    for (const cid of candidateIds) {
      const ov = blockWeldOverrides[cid];
      if (ov && ov.plane !== 'auto') {
        if (!best || ov.order > best.order) {
          best = { ownerId: cid, plane: ov.plane, order: ov.order };
        }
      }
    }
    return best;
  }

  // Comparator: returns true if claim2 is in front of claim1
  function isClaimInFront(claim1: TriangleClaim, claim2: TriangleClaim): boolean {
    if (claim1.blockId === claim2.blockId) return false;

    // Check if the user toggled a specific block face/plane weld via Shift+Click
    const ov = findActiveWeldOverride(claim1.blockId, claim2.blockId);
    if (ov) {
      if (ov.plane === 'X' || ov.plane === 'Y' || ov.plane === 'Z') {
        if (claim2.faceType === ov.plane && claim1.faceType !== ov.plane) return true;
        if (claim1.faceType === ov.plane && claim2.faceType !== ov.plane) return false;
      } else if (ov.plane === 'front') {
        if (claim2.blockId === ov.ownerId) return true;
        if (claim1.blockId === ov.ownerId) return false;
      } else if (ov.plane === 'back') {
        if (claim2.blockId === ov.ownerId) return false;
        if (claim1.blockId === ov.ownerId) return true;
      }
    }

    const rel = findLocalRelation(claim1.blockId, claim2.blockId);
    if (rel.found) {
      if (rel.depthDelta !== 0) {
        return rel.depthDelta > 0;
      }
    }

    const b1 = blockMap.get(claim1.blockId)!;
    const b2 = blockMap.get(claim2.blockId)!;
    const d1 = blockDepth(b1.x, b1.y, b1.z);
    const d2 = blockDepth(b2.x, b2.y, b2.z);

    const connId = makeConnectionId(claim1.blockId, claim2.blockId);
    const crossMode = connectionModes[connId];
    if (crossMode === 'flipped') {
      return d2 < d1;
    }

    return d2 > d1;
  }

  // 4. Resolve the winning block and faceType for each occupied 2D unit triangle
  const winningClaims = new Map<string, TriangleClaim>();
  const renderedTriangles: RenderedTriangle[] = [];

  for (const [key, claims] of triangleClaims.entries()) {
    let winner = claims[0];
    for (let i = 1; i < claims.length; i++) {
      if (isClaimInFront(winner, claims[i])) {
        winner = claims[i];
      }
    }
    winningClaims.set(key, winner);

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

    const ov = findActiveWeldOverride(blockId1, blockId2);
    if (ov) {
      const lc1 = blockLattice.get(blockId1)!;
      const lc2 = blockLattice.get(blockId2)!;
      if (Math.abs(lc1.u - lc2.u) <= 2 && Math.abs(lc1.v - lc2.v) <= 2) {
        if (ov.plane === face || ov.plane === 'front' || ov.plane === 'back') {
          return true;
        }
      }
    }

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
  };
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
  X: 'X-Plane (Left/Gray Face)',
  Y: 'Y-Plane (Bottom/Black Face)',
  Z: 'Z-Plane (Top/White Face)',
  front: 'All Faces Front',
  back: 'All Faces Back',
};

/**
 * Cycles through ['X', 'Y', 'Z', 'front', 'back', 'auto'] for `targetBlockId` and returns
 * the next BlockWeldPlane that produces an immediately visible change in which block face welds.
 */
export function getNextDistinctWeldPlane(
  targetBlockId: string,
  blocks: VoxelBlock[],
  connectionModes: Record<string, ConnectionMode>,
  blockWeldOverrides: Record<string, BlockWeldOverride>,
  orientation: ViewOrientation
): { nextPlane: BlockWeldPlane; nextOrder: number } {
  const cycle: BlockWeldPlane[] = ['X', 'Y', 'Z', 'front', 'back', 'auto'];
  const currentPlane: BlockWeldPlane = blockWeldOverrides[targetBlockId]?.plane ?? 'auto';
  const startIdx = cycle.indexOf(currentPlane);

  let maxOrder = 0;
  for (const ov of Object.values(blockWeldOverrides)) {
    if (ov.order > maxOrder) maxOrder = ov.order;
  }
  const nextOrder = maxOrder + 1;

  const faceSignature = (scene: EngineSceneResult) =>
    scene.triangles
      .map((t) => `${t.key}=${t.faceType}`)
      .sort()
      .join('|');

  const currentScene = buildEscherScene(
    blocks,
    connectionModes,
    orientation,
    BASE_SCALE,
    blockWeldOverrides
  );
  const currentSig = faceSignature(currentScene);

  for (let offset = 1; offset <= cycle.length; offset++) {
    const candidate = cycle[(startIdx + offset) % cycle.length];
    const testOverrides: Record<string, BlockWeldOverride> = {
      ...blockWeldOverrides,
      [targetBlockId]: { plane: candidate, order: nextOrder },
    };
    const testScene = buildEscherScene(
      blocks,
      connectionModes,
      orientation,
      BASE_SCALE,
      testOverrides
    );
    if (faceSignature(testScene) !== currentSig) {
      return { nextPlane: candidate, nextOrder };
    }
  }

  // Fallback if isolated block
  const fallback = cycle[(startIdx + 1) % cycle.length];
  return { nextPlane: fallback, nextOrder };
}


