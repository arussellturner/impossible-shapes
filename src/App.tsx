import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AxisDirection,
  BlockWeldOverride,
  ColorTheme,
  ConnectionMode,
  EscherConnection,
  ShapePreset,
  ToolMode,
  ViewOrientation,
  VoxelBlock,
} from './types/escher';
import {
  AXIS_DELTAS,
  BASE_SCALE,
  GhostCandidate,
  ScreenPoint,
  WELD_PLANE_LABELS,
  blockDepth,
  blockToLattice,
  buildEscherScene,
  findBestGhostCandidate,
  getBlockRhombuses,
  findWeldJointForBlock,
  getNextWeldJointToggle,
  latticeToScreen,
  listToggleableJoints,
  resolveGhostAtLattice,
  WeldJointToggle,
} from './engine/isometricEngine';
import { COLOR_THEMES, SHAPE_PRESETS } from './engine/presets';
import {
  Box,
  CheckCircle2,
  Compass,
  Download,
  Eraser,
  ExternalLink,
  Eye,
  FlipHorizontal2,
  Grid,
  HelpCircle,
  Image as ImageIcon,
  Layers,
  Link2,
  Loader2,
  Maximize2,
  MessageSquarePlus,
  Palette,
  Plus,
  Redo2,
  RotateCcw,
  Send,
  Sparkles,
  Trash2,
  Undo2,
  Unlink2,
  Zap,
  ZoomIn,
  ZoomOut,
  Menu,
  X,
  Settings,
  ArrowUp,
  Minus,
} from 'lucide-react';

interface HistorySnapshot {
  blocks: VoxelBlock[];
  connectionModes: Record<string, ConnectionMode>;
  blockWeldOverrides: Record<string, BlockWeldOverride>;
}

const WELD_PLANE_SHORT: Record<'X' | 'Y' | 'Z', string> = {
  X: 'Gray front',
  Y: 'Black front',
  Z: 'White front',
};

function pointsToSvgPolygon(pts: ScreenPoint[]): string {
  return pts.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ');
}

function ToggleRow({
  label,
  description,
  value,
  onChange,
}: {
  label: string;
  description?: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      onClick={() => onChange(!value)}
      className="w-full px-3 py-3 rounded-xl bg-neutral-950/60 border border-neutral-800 hover:bg-neutral-950 flex items-center justify-between gap-3 text-left transition"
      role="switch"
      aria-checked={value}
    >
      <span>
        <span className="block text-sm text-neutral-200">{label}</span>
        {description && <span className="block text-[11px] text-neutral-500">{description}</span>}
      </span>
      <span
        className={`w-10 h-6 flex-shrink-0 flex items-center rounded-full p-0.5 transition ${
          value ? 'bg-amber-500 justify-end' : 'bg-neutral-700 justify-start'
        }`}
      >
        <span className="w-5 h-5 rounded-full bg-white shadow" />
      </span>
    </button>
  );
}

export default function App() {
  // Initial preset: Classic Penrose Triangle matching the user's uploaded image
  const initialPreset = SHAPE_PRESETS[0];

  const [blocks, setBlocks] = useState<VoxelBlock[]>(() =>
    initialPreset.blocks.map((b, idx) => ({
      id: `b_${idx}_${b.x}_${b.y}_${b.z}`,
      x: b.x,
      y: b.y,
      z: b.z,
    }))
  );
  const [connectionModes, setConnectionModes] = useState<Record<string, ConnectionMode>>({});
  const [blockWeldOverrides, setBlockWeldOverrides] = useState<Record<string, BlockWeldOverride>>({});
  const [activePresetId, setActivePresetId] = useState<string>(initialPreset.id);

  // Undo / Redo history
  const [past, setPast] = useState<HistorySnapshot[]>([]);
  const [future, setFuture] = useState<HistorySnapshot[]>([]);

  // Tool & View states
  const [toolMode, setToolMode] = useState<ToolMode>('build');
  const [orientation, setOrientation] = useState<ViewOrientation>(
    initialPreset.orientation ?? 'penrose-horizontal'
  );
  const [theme, setTheme] = useState<ColorTheme>(COLOR_THEMES[0]);
  const [showGrid, setShowGrid] = useState<boolean>(true);
  const [showVoxelSeams, setShowVoxelSeams] = useState<boolean>(false);
  const [showConnectionBadges, setShowConnectionBadges] = useState<boolean>(false);
  const [strokeWidth, setStrokeWidth] = useState<number>(2.4);
  const [autoConnect, setAutoConnect] = useState<boolean>(true);

  const [showHelpModal, setShowHelpModal] = useState<boolean>(false);

  // Hamburger menu (Settings / Starters / Export)
  const [menuOpen, setMenuOpen] = useState<boolean>(
    () => typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('openmenu')
  );
  const [menuSection, setMenuSection] = useState<'settings' | 'starters' | 'export'>('starters');

  // Touch device detection (shows the on-screen D-pad)
  const [isTouch, setIsTouch] = useState<boolean>(
    () =>
      typeof window !== 'undefined' &&
      (window.matchMedia('(pointer: coarse)').matches ||
        new URLSearchParams(window.location.search).has('touch'))
  );
  useEffect(() => {
    const mq = window.matchMedia('(pointer: coarse)');
    const forced = new URLSearchParams(window.location.search).has('touch');
    const onChange = () => setIsTouch(forced || mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  // Canvas size (used to center the drawing in the SVG)
  const [viewSize, setViewSize] = useState<{ w: number; h: number }>(() => ({
    w: typeof window !== 'undefined' ? window.innerWidth : 800,
    h: typeof window !== 'undefined' ? window.innerHeight : 600,
  }));

  // Touch gestures: one-finger pan, two-finger pinch zoom
  const touchRef = useRef<{
    mode: 'pan' | 'pinch';
    startX: number;
    startY: number;
    panX: number;
    panY: number;
    dist: number;
    zoom: number;
    moved: boolean;
  } | null>(null);
  const suppressClickRef = useRef<boolean>(false);

  // Suggestion / GitHub Issue Modal state
  const [showSuggestionModal, setShowSuggestionModal] = useState<boolean>(false);
  const [suggestionTitle, setSuggestionTitle] = useState<string>('');
  const [suggestionCategory, setSuggestionCategory] = useState<
    'enhancement' | 'ux' | 'geometry' | 'bug'
  >('enhancement');
  const [suggestionDescription, setSuggestionDescription] = useState<string>('');
  const [suggestionSubmitter, setSuggestionSubmitter] = useState<string>('');
  const [includeSceneContext, setIncludeSceneContext] = useState<boolean>(true);
  const [isSubmittingSuggestion, setIsSubmittingSuggestion] = useState<boolean>(false);
  const [suggestionError, setSuggestionError] = useState<string | null>(null);
  const [createdIssue, setCreatedIssue] = useState<{
    number: number;
    html_url: string;
    title: string;
  } | null>(null);

  // Selected / active block for keyboard or compass extrusion
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);
  // Welds mode: key of the weld joint under the cyan cursor
  const [selectedJointKey, setSelectedJointKey] = useState<string | null>(null);
  const [isShiftHeld, setIsShiftHeld] = useState<boolean>(false);
  const [lastWeldBanner, setLastWeldBanner] = useState<string | null>(null);

  // Keyboard Next-Block Cursor state (Arrow keys move next block, Spacebar adds block)
  const [inputMode, setInputMode] = useState<'mouse' | 'keyboard'>('keyboard');
  const [lastBuildDir, setLastBuildDir] = useState<AxisDirection>('+Y');
  const [kbGhost, setKbGhost] = useState<{
    u: number;
    v: number;
    x: number;
    y: number;
    z: number;
    movedSincePlace: boolean;
  }>(() => {
    const last = initialPreset.blocks[initialPreset.blocks.length - 1] ?? { x: 0, y: 0, z: 0 };
    const lc = blockToLattice(last.x, last.y, last.z);
    const d = AXIS_DELTAS['+X'];
    return {
      u: lc.u + d.du,
      v: lc.v + d.dv,
      x: last.x + d.dx,
      y: last.y + d.dy,
      z: last.z + d.dz,
      movedSincePlace: false,
    };
  });

  // Pan & Zoom state
  const [zoom, setZoom] = useState<number>(1.05);
  const [pan, setPan] = useState<ScreenPoint>({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState<boolean>(false);
  const panStartRef = useRef<{ clientX: number; clientY: number; panX: number; panY: number } | null>(
    null
  );

  // Mouse position in SVG world coordinates
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [cursorWorld, setCursorWorld] = useState<ScreenPoint | null>(null);
  const [hoveredBlockId, setHoveredBlockId] = useState<string | null>(null);

  // Helper to position the keyboard ghost one step along `dir` from a reference block
  const syncKbGhostFromBlock = useCallback(
    (refBlock: { x: number; y: number; z: number } | undefined, dir: AxisDirection = lastBuildDir) => {
      if (!refBlock) {
        setKbGhost({ u: 0, v: 0, x: 0, y: 0, z: 0, movedSincePlace: false });
        return;
      }
      const lc = blockToLattice(refBlock.x, refBlock.y, refBlock.z);
      const d = AXIS_DELTAS[dir];
      setKbGhost({
        u: lc.u + d.du,
        v: lc.v + d.dv,
        x: refBlock.x + d.dx,
        y: refBlock.y + d.dy,
        z: refBlock.z + d.dz,
        movedSincePlace: false,
      });
    },
    [lastBuildDir]
  );

  // Push snapshot to history before mutating state
  const commitChange = useCallback(
    (
      nextBlocks: VoxelBlock[],
      nextConnModes: Record<string, ConnectionMode> = connectionModes,
      nextWeldOverrides: Record<string, BlockWeldOverride> = blockWeldOverrides
    ) => {
      setPast((prev) => [
        ...prev.slice(-39),
        { blocks, connectionModes, blockWeldOverrides },
      ]);
      setFuture([]);
      setBlocks(nextBlocks);
      setConnectionModes(nextConnModes);
      setBlockWeldOverrides(nextWeldOverrides);
    },
    [blocks, connectionModes, blockWeldOverrides]
  );

  const handleUndo = useCallback(() => {
    if (past.length === 0) return;
    const previous = past[past.length - 1];
    setPast((prev) => prev.slice(0, -1));
    setFuture((prev) => [{ blocks, connectionModes, blockWeldOverrides }, ...prev]);
    setBlocks(previous.blocks);
    setConnectionModes(previous.connectionModes);
    setBlockWeldOverrides(previous.blockWeldOverrides ?? {});
    const lastBlock = previous.blocks[previous.blocks.length - 1];
    setSelectedBlockId(lastBlock?.id ?? null);
    syncKbGhostFromBlock(lastBlock, lastBuildDir);
  }, [past, blocks, connectionModes, blockWeldOverrides, lastBuildDir, syncKbGhostFromBlock]);

  const handleRedo = useCallback(() => {
    if (future.length === 0) return;
    const next = future[0];
    setFuture((prev) => prev.slice(1));
    setPast((prev) => [...prev, { blocks, connectionModes, blockWeldOverrides }]);
    setBlocks(next.blocks);
    setConnectionModes(next.connectionModes);
    setBlockWeldOverrides(next.blockWeldOverrides ?? {});
    const lastBlock = next.blocks[next.blocks.length - 1];
    setSelectedBlockId(lastBlock?.id ?? null);
    syncKbGhostFromBlock(lastBlock, lastBuildDir);
  }, [future, blocks, connectionModes, blockWeldOverrides, lastBuildDir, syncKbGhostFromBlock]);

  // Compute scene geometry & Escher connections
  const scene = useMemo(() => {
    return buildEscherScene(
      blocks,
      connectionModes,
      orientation,
      BASE_SCALE,
      blockWeldOverrides
    );
  }, [blocks, connectionModes, orientation, blockWeldOverrides]);

  // The impossible weld joint that Shift+Click / W would currently toggle
  const activeJoint = useMemo(
    () =>
      findWeldJointForBlock(
        scene,
        hoveredBlockId ?? selectedBlockId ?? blocks[blocks.length - 1]?.id,
        hoveredBlockId ? cursorWorld : null
      ),
    [scene, hoveredBlockId, selectedBlockId, blocks, cursorWorld]
  );

  // Welds mode: every joint whose toggle visibly changes the drawing (only computed in this mode)
  const weldToggles: WeldJointToggle[] = useMemo(
    () =>
      toolMode === 'welds'
        ? listToggleableJoints(blocks, connectionModes, blockWeldOverrides, orientation, scene)
        : [],
    [toolMode, blocks, connectionModes, blockWeldOverrides, orientation, scene]
  );
  const selectedToggle = useMemo(
    () => weldToggles.find((t) => t.joint.key === selectedJointKey) ?? null,
    [weldToggles, selectedJointKey]
  );

  // Keep a valid weld selected: if the current one disappears, jump to the nearest remaining weld
  useEffect(() => {
    if (toolMode !== 'welds' || weldToggles.length === 0 || selectedToggle) return;
    const prev = scene.weldJoints.find((j) => j.key === selectedJointKey)?.center;
    const ref =
      prev ??
      scene.blockScreenCenters.get(selectedBlockId ?? '') ??
      scene.blockScreenCenters.get(blocks[blocks.length - 1]?.id ?? '');
    let best = weldToggles[0];
    if (ref) {
      let bestD = Infinity;
      for (const t of weldToggles) {
        const d = (t.joint.center.x - ref.x) ** 2 + (t.joint.center.y - ref.y) ** 2;
        if (d < bestD) {
          bestD = d;
          best = t;
        }
      }
    }
    setSelectedJointKey(best.joint.key);
  }, [toolMode, weldToggles, selectedToggle, selectedJointKey, scene, selectedBlockId, blocks]);

  // Welds mode: arrows / D-pad jump to the nearest toggleable weld roughly in that on-screen direction
  const moveWeldCursor = useCallback(
    (dir: AxisDirection) => {
      if (weldToggles.length === 0) return;
      const from = selectedToggle?.joint.center;
      if (!from) {
        setSelectedJointKey(weldToggles[0].joint.key);
        return;
      }
      const d = AXIS_DELTAS[dir];
      const dv = latticeToScreen(d.du, d.dv, orientation, 1);
      const dLen = Math.hypot(dv.x, dv.y) || 1;
      let target: WeldJointToggle | null = null;
      let bestScore = Infinity;
      for (const t of weldToggles) {
        if (t === selectedToggle) continue;
        const ox = t.joint.center.x - from.x;
        const oy = t.joint.center.y - from.y;
        const dist = Math.hypot(ox, oy);
        if (dist < 1e-6) continue;
        const cos = (ox * dv.x + oy * dv.y) / (dist * dLen);
        if (cos < 0.5) continue; // within ±60° of the arrow direction
        const score = dist * (2.2 - cos);
        if (score < bestScore) {
          bestScore = score;
          target = t;
        }
      }
      if (target) setSelectedJointKey(target.joint.key);
      else setLastWeldBanner('No more welds that way');
    },
    [weldToggles, selectedToggle, orientation]
  );

  // Welds mode: Tab / Shift+Tab steps through welds in reading order (top-to-bottom, left-to-right)
  const cycleWeldCursor = useCallback(
    (step: 1 | -1) => {
      if (weldToggles.length === 0) return;
      const sorted = [...weldToggles].sort((a, b) =>
        Math.abs(a.joint.center.y - b.joint.center.y) > 1
          ? a.joint.center.y - b.joint.center.y
          : a.joint.center.x - b.joint.center.x
      );
      const idx = sorted.findIndex((t) => t.joint.key === selectedJointKey);
      const next = sorted[(idx + step + sorted.length) % sorted.length];
      setSelectedJointKey(next.joint.key);
    },
    [weldToggles, selectedJointKey]
  );

  // Welds mode: cycle the selected weld to its next visibly distinct plane
  const toggleSelectedWeld = useCallback(() => {
    if (!selectedToggle) {
      setLastWeldBanner(weldToggles.length ? 'Pick a weld first' : 'No toggleable welds in this shape');
      return;
    }
    commitChange(blocks, connectionModes, {
      ...blockWeldOverrides,
      [selectedToggle.jointKey]: { plane: selectedToggle.nextPlane, order: selectedToggle.nextOrder },
    });
    setLastWeldBanner(`Weld: ${WELD_PLANE_LABELS[selectedToggle.nextPlane]}`);
  }, [selectedToggle, weldToggles.length, blocks, connectionModes, blockWeldOverrides, commitChange]);

  // Center the view on the current structure
  const centerViewOnBlocks = useCallback(
    (targetBlocks: VoxelBlock[], targetOrientation: ViewOrientation = orientation) => {
      if (targetBlocks.length === 0) {
        setPan({ x: 0, y: 0 });
        return;
      }
      let minX = Infinity;
      let maxX = -Infinity;
      let minY = Infinity;
      let maxY = -Infinity;

      for (const b of targetBlocks) {
        const lc = blockToLattice(b.x, b.y, b.z);
        const pt = latticeToScreen(lc.u, lc.v, targetOrientation, BASE_SCALE);
        if (pt.x < minX) minX = pt.x;
        if (pt.x > maxX) maxX = pt.x;
        if (pt.y < minY) minY = pt.y;
        if (pt.y > maxY) maxY = pt.y;
      }

      // Fit the shape into the free area between the top and bottom control bars
      const vw = svgRef.current?.clientWidth || window.innerWidth;
      const vh = svgRef.current?.clientHeight || window.innerHeight;
      const landscapeTouch = isTouch && vw > vh;
      const topReserve = 70;
      const bottomReserve = isTouch && !landscapeTouch ? 220 : landscapeTouch ? 16 : 80;
      const sideReserve = landscapeTouch ? 190 : 16;
      const availW = Math.max(120, vw - sideReserve * 2);
      const availH = Math.max(120, vh - topReserve - bottomReserve);
      const shapeW = maxX - minX + BASE_SCALE * 2.4;
      const shapeH = maxY - minY + BASE_SCALE * 2.4;
      const fitZoom = Math.min(1.4, Math.max(0.35, Math.min(availW / shapeW, availH / shapeH)));
      const screenOffsetY = topReserve + availH / 2 - vh / 2;

      setZoom(fitZoom);
      setPan({
        x: -((minX + maxX) * 0.5),
        y: -((minY + maxY) * 0.5) + screenOffsetY / fitZoom,
      });
    },
    [orientation, isTouch]
  );

  // Center on initial mount
  useEffect(() => {
    centerViewOnBlocks(blocks, orientation);
    if (blocks.length > 0) {
      const last = blocks[blocks.length - 1];
      setSelectedBlockId(last.id);
      syncKbGhostFromBlock(last, '+X');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load a preset shape
  const handleLoadPreset = (preset: ShapePreset) => {
    const newBlocks: VoxelBlock[] = preset.blocks.map((b, idx) => ({
      id: `b_${Date.now()}_${idx}_${b.x}_${b.y}_${b.z}`,
      x: b.x,
      y: b.y,
      z: b.z,
    }));
    const nextOrientation = preset.orientation ?? orientation;
    setOrientation(nextOrientation);
    setActivePresetId(preset.id);
    setMenuOpen(false);
    commitChange(newBlocks, preset.connectionOverrides ?? {}, {});
    centerViewOnBlocks(newBlocks, nextOrientation);
    const last = newBlocks[newBlocks.length - 1];
    setSelectedBlockId(last?.id ?? null);
    syncKbGhostFromBlock(last, '+Y');
  };

  // Active Ghost Block Candidate (combines Keyboard arrow-key cursor and Mouse hover)
  const ghostCandidate: GhostCandidate | null = useMemo(() => {
    if (toolMode !== 'build' || isPanning || isShiftHeld) {
      return null;
    }

    if (inputMode === 'keyboard') {
      return resolveGhostAtLattice(
        kbGhost.u,
        kbGhost.v,
        { x: kbGhost.x, y: kbGhost.y, z: kbGhost.z },
        blocks,
        selectedBlockId,
        orientation,
        BASE_SCALE
      );
    }

    if (cursorWorld) {
      const mouseCand = findBestGhostCandidate(
        cursorWorld.x,
        cursorWorld.y,
        blocks,
        orientation,
        BASE_SCALE
      );
      if (mouseCand) return mouseCand;
    }

    return resolveGhostAtLattice(
      kbGhost.u,
      kbGhost.v,
      { x: kbGhost.x, y: kbGhost.y, z: kbGhost.z },
      blocks,
      selectedBlockId,
      orientation,
      BASE_SCALE
    );
  }, [
    toolMode,
    isPanning,
    isShiftHeld,
    inputMode,
    kbGhost,
    blocks,
    selectedBlockId,
    orientation,
    cursorWorld,
  ]);

  // Add a block at (x, y, z) and advance the next-block cursor along `advanceDir`
  const addBlockAt = useCallback(
    (x: number, y: number, z: number, advanceDir?: AxisDirection) => {
      const targetLC = blockToLattice(x, y, z);
      const stepDir = advanceDir ?? lastBuildDir;

      // If an existing block already occupies this exact 3D coordinate, just select it and advance ghost
      const exactExisting = blocks.find((b) => b.x === x && b.y === y && b.z === z);
      if (exactExisting) {
        setSelectedBlockId(exactExisting.id);
        syncKbGhostFromBlock(exactExisting, stepDir);
        return;
      }

      const newBlock: VoxelBlock = {
        id: `b_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        x,
        y,
        z,
      };
      const nextBlocks = [...blocks, newBlock];
      const nextModes = { ...connectionModes };

      // If autoConnect is disabled, mark newly created Escher connections as 'disconnected' by default
      if (!autoConnect) {
        const previewScene = buildEscherScene(
          nextBlocks,
          nextModes,
          orientation,
          BASE_SCALE,
          blockWeldOverrides
        );
        for (const conn of previewScene.connections) {
          if (!(conn.id in nextModes)) {
            nextModes[conn.id] = 'disconnected';
          }
        }
      }

      commitChange(nextBlocks, nextModes, blockWeldOverrides);
      setSelectedBlockId(newBlock.id);
      if (advanceDir) {
        setLastBuildDir(advanceDir);
      }

      // Advance the keyboard ghost one step further in `stepDir` so repeated Spacebar presses build a beam
      const d = AXIS_DELTAS[stepDir];
      setKbGhost({
        u: targetLC.u + d.du,
        v: targetLC.v + d.dv,
        x: x + d.dx,
        y: y + d.dy,
        z: z + d.dz,
        movedSincePlace: false,
      });
    },
    [
      blocks,
      connectionModes,
      blockWeldOverrides,
      autoConnect,
      orientation,
      lastBuildDir,
      commitChange,
      syncKbGhostFromBlock,
    ]
  );

  // Erase mode: arrows / D-pad move a red cursor between EXISTING blocks.
  // Prefers the block exactly one lattice step in that direction, otherwise the nearest
  // block roughly in that on-screen direction (within ±55°).
  const moveEraseCursor = useCallback(
    (dir: AxisDirection) => {
      const current = blocks.find((b) => b.id === selectedBlockId) ?? blocks[blocks.length - 1];
      if (!current) return;
      const d = AXIS_DELTAS[dir];
      const cl = blockToLattice(current.x, current.y, current.z);

      let target = blocks.find((b) => {
        if (b.id === current.id) return false;
        const lc = blockToLattice(b.x, b.y, b.z);
        return lc.u === cl.u + d.du && lc.v === cl.v + d.dv;
      });

      if (!target) {
        const dv = latticeToScreen(d.du, d.dv, orientation, 1);
        const dLen = Math.hypot(dv.x, dv.y) || 1;
        let bestScore = Infinity;
        for (const b of blocks) {
          if (b.id === current.id) continue;
          const lc = blockToLattice(b.x, b.y, b.z);
          const off = latticeToScreen(lc.u - cl.u, lc.v - cl.v, orientation, 1);
          const dist = Math.hypot(off.x, off.y);
          if (dist === 0) continue;
          const cos = (off.x * dv.x + off.y * dv.y) / (dist * dLen);
          if (cos < 0.57) continue;
          const score = dist * (2 - cos);
          if (score < bestScore) {
            bestScore = score;
            target = b;
          }
        }
      }

      if (target) setSelectedBlockId(target.id);
    },
    [blocks, selectedBlockId, orientation]
  );

  // Move the "Next Block" ghost cursor using Arrow keys (or Q/E)
  const moveNextBlockCursor = useCallback(
    (dir: AxisDirection) => {
      if (toolMode === 'erase') {
        setLastBuildDir(dir);
        moveEraseCursor(dir);
        return;
      }
      if (toolMode === 'welds') {
        moveWeldCursor(dir);
        return;
      }
      setInputMode('keyboard');
      setLastBuildDir(dir);

      const delta = AXIS_DELTAS[dir];
      const anchor =
        blocks.find((b) => b.id === selectedBlockId) ?? blocks[blocks.length - 1];

      setKbGhost((prev) => {
        // First arrow press right after placing a block branches directly from the anchor block's face
        const base =
          !prev.movedSincePlace && anchor
            ? {
                u: blockToLattice(anchor.x, anchor.y, anchor.z).u,
                v: blockToLattice(anchor.x, anchor.y, anchor.z).v,
                x: anchor.x,
                y: anchor.y,
                z: anchor.z,
              }
            : prev;

        const nu = base.u + delta.du;
        const nv = base.v + delta.dv;
        const nx = base.x + delta.dx;
        const ny = base.y + delta.dy;
        const nz = base.z + delta.dz;

        // If the user steered back onto the anchor block itself, reset movedSincePlace so next arrow picks a face
        if (anchor) {
          const alc = blockToLattice(anchor.x, anchor.y, anchor.z);
          if (nu === alc.u && nv === alc.v) {
            return {
              u: alc.u,
              v: alc.v,
              x: anchor.x,
              y: anchor.y,
              z: anchor.z,
              movedSincePlace: false,
            };
          }
        }

        return {
          u: nu,
          v: nv,
          x: nx,
          y: ny,
          z: nz,
          movedSincePlace: true,
        };
      });
    },
    [blocks, selectedBlockId, toolMode, moveEraseCursor, moveWeldCursor]
  );

  // Step-extrude from the currently selected (or last) block along one of the 6 isometric directions
  const handleExtrudeDirection = useCallback(
    (dir: AxisDirection) => {
      setInputMode('keyboard');
      setLastBuildDir(dir);
      if (blocks.length === 0) {
        addBlockAt(0, 0, 0, dir);
        return;
      }
      const anchor =
        blocks.find((b) => b.id === selectedBlockId) ?? blocks[blocks.length - 1];
      const delta = AXIS_DELTAS[dir];
      const nx = anchor.x + delta.dx;
      const ny = anchor.y + delta.dy;
      const nz = anchor.z + delta.dz;

      // Check if an existing block already occupies the target 2D lattice cell
      const targetLC = blockToLattice(nx, ny, nz);
      const existingAtCell = blocks.find((b) => {
        const lc = blockToLattice(b.x, b.y, b.z);
        return lc.u === targetLC.u && lc.v === targetLC.v;
      });

      if (existingAtCell) {
        setSelectedBlockId(existingAtCell.id);
        syncKbGhostFromBlock(existingAtCell, dir);
        return;
      }

      addBlockAt(nx, ny, nz, dir);
    },
    [blocks, selectedBlockId, addBlockAt, syncKbGhostFromBlock]
  );

  // Remove a block by ID
  const removeBlockById = useCallback(
    (id: string) => {
      const nextBlocks = blocks.filter((b) => b.id !== id);
      const nextOverrides = { ...blockWeldOverrides };
      delete nextOverrides[id];
      commitChange(nextBlocks, connectionModes, nextOverrides);
      if (selectedBlockId === id) {
        const nextAnchor = nextBlocks.length > 0 ? nextBlocks[nextBlocks.length - 1] : undefined;
        setSelectedBlockId(nextAnchor?.id ?? null);
        syncKbGhostFromBlock(nextAnchor, lastBuildDir);
      }
    },
    [
      blocks,
      connectionModes,
      blockWeldOverrides,
      selectedBlockId,
      lastBuildDir,
      commitChange,
      syncKbGhostFromBlock,
    ]
  );

  // Erase mode: delete the block under the red cursor, then move the cursor to the nearest block
  const deleteEraseTarget = useCallback(() => {
    const target = blocks.find((b) => b.id === selectedBlockId) ?? blocks[blocks.length - 1];
    if (!target) return;
    const tl = blockToLattice(target.x, target.y, target.z);
    let next: VoxelBlock | undefined;
    let best = Infinity;
    for (const b of blocks) {
      if (b.id === target.id) continue;
      const lc = blockToLattice(b.x, b.y, b.z);
      const off = latticeToScreen(lc.u - tl.u, lc.v - tl.v, orientation, 1);
      const dist = Math.hypot(off.x, off.y);
      if (dist < best) {
        best = dist;
        next = b;
      }
    }
    removeBlockById(target.id);
    setSelectedBlockId(next?.id ?? null);
    syncKbGhostFromBlock(next, lastBuildDir);
  }, [blocks, selectedBlockId, orientation, removeBlockById, syncKbGhostFromBlock, lastBuildDir]);

  // Switch tools. Build mode resumes from the block the cursor was on.
  const switchTool = useCallback(
    (mode: ToolMode) => {
      setToolMode(mode);
      if (mode === 'erase') {
        if (!blocks.some((b) => b.id === selectedBlockId)) {
          setSelectedBlockId(blocks[blocks.length - 1]?.id ?? null);
        }
        setLastWeldBanner(isTouch ? 'Erase: use the arrows to pick a block, then press −' : 'Erase: arrows pick a block, Space/Delete removes it (or click a block)');
      } else if (mode === 'welds') {
        setSelectedJointKey(null); // re-picks the weld nearest the current block
        setLastWeldBanner(
          isTouch
            ? 'Welds: arrows jump between welds, center button toggles'
            : 'Welds: arrows / Tab jump between welds, W toggles (or click a weld twice)'
        );
      } else {
        const anchor = blocks.find((b) => b.id === selectedBlockId) ?? blocks[blocks.length - 1];
        syncKbGhostFromBlock(anchor, lastBuildDir);
      }
    },
    [blocks, selectedBlockId, isTouch, syncKbGhostFromBlock, lastBuildDir]
  );

  // Shift+Click (or 'W' key): Toggle which face/plane welds in front at the nearest impossible joint
  const handleToggleBlockWeldPlane = useCallback(
    (targetBlockId?: string, point?: ScreenPoint | null) => {
      const id =
        targetBlockId ??
        hoveredBlockId ??
        selectedBlockId ??
        blocks[blocks.length - 1]?.id;
      if (!id) return;

      const result = getNextWeldJointToggle(
        id,
        blocks,
        connectionModes,
        blockWeldOverrides,
        orientation,
        point ?? null
      );
      setSelectedBlockId(id);
      if (!result) {
        setLastWeldBanner('No impossible joint here — Shift+Click where 3 blocks meet');
        return;
      }
      const nextOverrides: Record<string, BlockWeldOverride> = {
        ...blockWeldOverrides,
        [result.jointKey]: { plane: result.nextPlane, order: result.nextOrder },
      };

      commitChange(blocks, connectionModes, nextOverrides);
      setLastWeldBanner(`Joint: ${WELD_PLANE_LABELS[result.nextPlane]}`);
    },
    [
      hoveredBlockId,
      selectedBlockId,
      blocks,
      connectionModes,
      blockWeldOverrides,
      orientation,
      commitChange,
    ]
  );

  // Cycle an Escher connection's mode: natural -> flipped -> disconnected -> natural
  const handleCycleConnection = useCallback(
    (conn: EscherConnection, e?: React.MouseEvent) => {
      if (e) e.stopPropagation();
      if (e?.shiftKey) {
        handleToggleBlockWeldPlane(conn.blockBId);
        return;
      }
      const order: ConnectionMode[] = ['natural', 'flipped', 'disconnected'];
      const nextMode = order[(order.indexOf(conn.mode) + 1) % order.length];
      const nextModes = {
        ...connectionModes,
        [conn.id]: nextMode,
      };
      commitChange(blocks, nextModes, blockWeldOverrides);
    },
    [blocks, connectionModes, blockWeldOverrides, commitChange, handleToggleBlockWeldPlane]
  );

  // Convert mouse event to SVG world coordinates
  const clientToWorld = useCallback(
    (clientX: number, clientY: number): ScreenPoint | null => {
      const svg = svgRef.current;
      if (!svg) return null;
      const rect = svg.getBoundingClientRect();
      const centerX = rect.width * 0.5;
      const centerY = rect.height * 0.5;
      const wx = (clientX - rect.left - centerX) / zoom - pan.x;
      const wy = (clientY - rect.top - centerY) / zoom - pan.y;
      return { x: wx, y: wy };
    },
    [zoom, pan]
  );

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (e.shiftKey !== isShiftHeld) {
      setIsShiftHeld(e.shiftKey);
    }
    if (isPanning && panStartRef.current) {
      const dx = (e.clientX - panStartRef.current.clientX) / zoom;
      const dy = (e.clientY - panStartRef.current.clientY) / zoom;
      setPan({
        x: panStartRef.current.panX + dx,
        y: panStartRef.current.panY + dy,
      });
      return;
    }

    if (!isTouch) setInputMode('mouse');
    const world = clientToWorld(e.clientX, e.clientY);
    setCursorWorld(world);

    // Find closest block center if within hover radius
    if (world) {
      let closestId: string | null = null;
      let minDistSq = (BASE_SCALE * 0.95) ** 2;
      for (const b of blocks) {
        const center = scene.blockScreenCenters.get(b.id);
        if (!center) continue;
        const dSq = (world.x - center.x) ** 2 + (world.y - center.y) ** 2;
        if (dSq < minDistSq) {
          minDistSq = dSq;
          closestId = b.id;
        }
      }
      setHoveredBlockId(closestId);
    }
  };

  const handleMouseDown = (e: React.MouseEvent<SVGSVGElement>) => {
    // Middle click panning (Shift+Click is reserved for toggling block face welds)
    if (e.button === 1) {
      e.preventDefault();
      setIsPanning(true);
      panStartRef.current = {
        clientX: e.clientX,
        clientY: e.clientY,
        panX: pan.x,
        panY: pan.y,
      };
    }
  };

  const handleMouseUp = () => {
    if (isPanning) {
      setIsPanning(false);
      panStartRef.current = null;
    }
  };

  // Closest block to a world point (within hover radius)
  const blockAtWorld = (world: ScreenPoint): string | null => {
    let closestId: string | null = null;
    let minDistSq = (BASE_SCALE * 0.95) ** 2;
    for (const b of blocks) {
      const center = scene.blockScreenCenters.get(b.id);
      if (!center) continue;
      const dSq = (world.x - center.x) ** 2 + (world.y - center.y) ** 2;
      if (dSq < minDistSq) {
        minDistSq = dSq;
        closestId = b.id;
      }
    }
    return closestId;
  };

  const handleCanvasClick = (e: React.MouseEvent<SVGSVGElement>) => {
    if (isPanning) return;
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    // Resolve everything from the actual click/tap position (taps have no prior hover)
    const world = clientToWorld(e.clientX, e.clientY);
    const hitBlockId = world ? blockAtWorld(world) : hoveredBlockId;

    // Shift + Click toggles which face/plane welds at the nearest impossible joint
    if (e.shiftKey) {
      handleToggleBlockWeldPlane(hitBlockId ?? selectedBlockId ?? undefined, world);
      return;
    }

    // Alt/Option + Click erases a block quickly
    if (e.altKey && hitBlockId) {
      removeBlockById(hitBlockId);
      return;
    }

    if (toolMode === 'erase') {
      if (hitBlockId) {
        if (isTouch) {
          setSelectedBlockId(hitBlockId); // pick it; the − button deletes
        } else {
          removeBlockById(hitBlockId);
        }
      }
      return;
    }

    if (toolMode === 'welds') {
      if (!world) return;
      let nearest: WeldJointToggle | null = null;
      let best = (BASE_SCALE * 1.1) ** 2;
      for (const t of weldToggles) {
        const d = (t.joint.center.x - world.x) ** 2 + (t.joint.center.y - world.y) ** 2;
        if (d < best) {
          best = d;
          nearest = t;
        }
      }
      if (!nearest) return;
      if (nearest.joint.key === selectedJointKey) toggleSelectedWeld();
      else setSelectedJointKey(nearest.joint.key);
      return;
    }

    if (toolMode === 'build') {
      const cand = world
        ? findBestGhostCandidate(world.x, world.y, blocks, orientation, BASE_SCALE)
        : ghostCandidate;
      if (cand) {
        addBlockAt(cand.x, cand.y, cand.z, cand.direction);
      } else if (hitBlockId) {
        setSelectedBlockId(hitBlockId);
        const b = blocks.find((blk) => blk.id === hitBlockId);
        syncKbGhostFromBlock(b, lastBuildDir);
      }
    }
  };

  // Touch gestures: one-finger drag pans, two-finger pinch zooms
  const handleTouchStart = (e: React.TouchEvent<SVGSVGElement>) => {
    if (e.touches.length === 1) {
      const t = e.touches[0];
      touchRef.current = {
        mode: 'pan',
        startX: t.clientX,
        startY: t.clientY,
        panX: pan.x,
        panY: pan.y,
        dist: 0,
        zoom,
        moved: false,
      };
    } else if (e.touches.length === 2) {
      const [a, b] = [e.touches[0], e.touches[1]];
      touchRef.current = {
        mode: 'pinch',
        startX: (a.clientX + b.clientX) / 2,
        startY: (a.clientY + b.clientY) / 2,
        panX: pan.x,
        panY: pan.y,
        dist: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY),
        zoom,
        moved: true,
      };
    }
  };

  const handleTouchMove = (e: React.TouchEvent<SVGSVGElement>) => {
    const st = touchRef.current;
    if (!st) return;
    if (st.mode === 'pan' && e.touches.length === 1) {
      const t = e.touches[0];
      const dx = t.clientX - st.startX;
      const dy = t.clientY - st.startY;
      if (!st.moved && Math.abs(dx) + Math.abs(dy) < 10) return;
      st.moved = true;
      setPan({ x: st.panX + dx / zoom, y: st.panY + dy / zoom });
    } else if (st.mode === 'pinch' && e.touches.length === 2) {
      const [a, b] = [e.touches[0], e.touches[1]];
      const d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      if (st.dist > 0) {
        setZoom(Math.min(3.0, Math.max(0.35, st.zoom * (d / st.dist))));
      }
    }
  };

  const handleTouchEnd = (e: React.TouchEvent<SVGSVGElement>) => {
    const st = touchRef.current;
    if (st?.moved) {
      suppressClickRef.current = true;
      window.setTimeout(() => {
        suppressClickRef.current = false;
      }, 400);
    }
    if (e.touches.length === 0) touchRef.current = null;
  };

  const handleContextMenu = (e: React.MouseEvent<SVGSVGElement>) => {
    e.preventDefault();
    if (hoveredBlockId) {
      removeBlockById(hoveredBlockId);
    }
  };

  const handleWheel = (e: React.WheelEvent<SVGSVGElement>) => {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) {
      const factor = e.deltaY < 0 ? 1.1 : 0.9;
      setZoom((z) => Math.min(3.0, Math.max(0.35, z * factor)));
    } else {
      setPan((p) => ({
        x: p.x - e.deltaX / zoom,
        y: p.y - e.deltaY / zoom,
      }));
    }
  };

  // Keyboard shortcuts: Arrow keys move the next block, Spacebar places the block, Shift+Click / W toggles weld plane!
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Shift') {
        setIsShiftHeld(true);
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) {
          handleRedo();
        } else {
          handleUndo();
        }
        return;
      }
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }

      // Arrow keys move the next block cursor
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        moveNextBlockCursor('+X');
        return;
      }
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        moveNextBlockCursor('-X');
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        moveNextBlockCursor(e.shiftKey ? '-Y' : '+Z');
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        moveNextBlockCursor(e.shiftKey ? '+Y' : '-Z');
        return;
      }
      if (e.key.toLowerCase() === 'q') {
        e.preventDefault();
        moveNextBlockCursor('-Y');
        return;
      }
      if (e.key.toLowerCase() === 'e') {
        e.preventDefault();
        moveNextBlockCursor('+Y');
        return;
      }
      if (e.key.toLowerCase() === 'w') {
        e.preventDefault();
        if (toolMode === 'welds') toggleSelectedWeld();
        else handleToggleBlockWeldPlane();
        return;
      }
      if (toolMode === 'welds' && e.key === 'Tab') {
        e.preventDefault();
        cycleWeldCursor(e.shiftKey ? -1 : 1);
        return;
      }

      // Spacebar places the block at the current ghost position
      if (e.code === 'Space' || e.key === ' ' || (toolMode === 'welds' && e.key === 'Enter')) {
        e.preventDefault();
        if (toolMode === 'erase') {
          deleteEraseTarget();
          return;
        }
        if (toolMode === 'welds') {
          toggleSelectedWeld();
          return;
        }
        setToolMode('build');
        setInputMode('keyboard');
        if (ghostCandidate) {
          addBlockAt(
            ghostCandidate.x,
            ghostCandidate.y,
            ghostCandidate.z,
            ghostCandidate.direction ?? lastBuildDir
          );
        }
        return;
      }

      if (e.key === '1') switchTool('build');
      if (e.key === '2') switchTool('erase');
      if (e.key === '3') switchTool('welds');
      if (e.key.toLowerCase() === 'g') setShowGrid((g) => !g);
      if (e.key.toLowerCase() === 'v') setShowVoxelSeams((v) => !v);
      if (e.key === 'Backspace' || e.key === 'Delete') {
        if (toolMode === 'erase') {
          deleteEraseTarget();
        } else if (toolMode !== 'welds' && selectedBlockId && blocks.length > 0) {
          removeBlockById(selectedBlockId);
        }
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Shift') {
        setIsShiftHeld(false);
      }
    };
    const onWindowBlur = () => setIsShiftHeld(false);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onWindowBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onWindowBlur);
    };
  }, [
    handleUndo,
    handleRedo,
    moveNextBlockCursor,
    handleToggleBlockWeldPlane,
    ghostCandidate,
    addBlockAt,
    lastBuildDir,
    selectedBlockId,
    blocks.length,
    removeBlockById,
    toolMode,
    deleteEraseTarget,
    switchTool,
    toggleSelectedWeld,
    cycleWeldCursor,
  ]);

  // Generate clean standalone SVG string for export
  const generateExportSvgString = useCallback((): string => {
    if (scene.triangles.length === 0) return '';

    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;

    for (const tri of scene.triangles) {
      for (const p of tri.points) {
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
      }
    }

    const padding = 48;
    const width = Math.ceil(maxX - minX + padding * 2);
    const height = Math.ceil(maxY - minY + padding * 2);
    const viewBox = `${(minX - padding).toFixed(1)} ${(minY - padding).toFixed(1)} ${width} ${height}`;

    const getFill = (face: 'X' | 'Y' | 'Z') =>
      face === 'X' ? theme.faceX : face === 'Y' ? theme.faceY : theme.faceZ;

    const polyStrings = scene.triangles.map((tri) => {
      const fill = getFill(tri.faceType);
      const pts = pointsToSvgPolygon(tri.points);
      return `  <polygon points="${pts}" fill="${fill}" stroke="${fill}" stroke-width="0.65" stroke-linejoin="round" />`;
    });

    const seamStrings = showVoxelSeams
      ? scene.seamEdges.map(
          (e) =>
            `  <line x1="${e.p1.x.toFixed(2)}" y1="${e.p1.y.toFixed(2)}" x2="${e.p2.x.toFixed(2)}" y2="${e.p2.y.toFixed(2)}" stroke="${theme.stroke}" stroke-width="${(strokeWidth * 0.45).toFixed(2)}" stroke-opacity="0.35" stroke-dasharray="4 4" stroke-linecap="round" />`
        )
      : [];

    const edgeStrings = scene.edges.map(
      (e) =>
        `  <line x1="${e.p1.x.toFixed(2)}" y1="${e.p1.y.toFixed(2)}" x2="${e.p2.x.toFixed(2)}" y2="${e.p2.y.toFixed(2)}" stroke="${theme.stroke}" stroke-width="${strokeWidth.toFixed(2)}" stroke-linecap="round" stroke-linejoin="round" />`
    );

    return [
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" width="${width}" height="${height}">`,
      `  <rect x="${(minX - padding).toFixed(1)}" y="${(minY - padding).toFixed(1)}" width="${width}" height="${height}" fill="${theme.canvasBg}" />`,
      ...polyStrings,
      ...seamStrings,
      ...edgeStrings,
      `</svg>`,
    ].join('\n');
  }, [scene, theme, showVoxelSeams, strokeWidth]);

  const handleExportSvg = () => {
    const svgString = generateExportSvgString();
    if (!svgString) return;
    const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `impossible-shape-${activePresetId || 'custom'}.svg`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleExportPng = () => {
    const svgString = generateExportSvgString();
    if (!svgString) return;
    const img = new Image();
    const svgBlob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(svgBlob);
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const scaleFactor = 2; // 2x Retina PNG
      canvas.width = img.width * scaleFactor;
      canvas.height = img.height * scaleFactor;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.scale(scaleFactor, scaleFactor);
        ctx.drawImage(img, 0, 0);
        canvas.toBlob((pngBlob) => {
          if (pngBlob) {
            const pngUrl = URL.createObjectURL(pngBlob);
            const a = document.createElement('a');
            a.href = pngUrl;
            a.download = `impossible-shape-${activePresetId || 'custom'}.png`;
            a.click();
            URL.revokeObjectURL(pngUrl);
          }
        }, 'image/png');
      }
      URL.revokeObjectURL(url);
    };
    img.src = url;
  };

  // Background isometric grid lines
  const backgroundGridLines = useMemo(() => {
    if (!showGrid) return [];
    const lines: Array<{ key: string; p1: ScreenPoint; p2: ScreenPoint }> = [];
    const N = 40;
    for (let i = -N; i <= N; i++) {
      // Constant v lines (u from -N to N)
      lines.push({
        key: `gv_${i}`,
        p1: latticeToScreen(-N, i, orientation, BASE_SCALE),
        p2: latticeToScreen(N, i, orientation, BASE_SCALE),
      });
      // Constant u lines (v from -N to N)
      lines.push({
        key: `gu_${i}`,
        p1: latticeToScreen(i, -N, orientation, BASE_SCALE),
        p2: latticeToScreen(i, N, orientation, BASE_SCALE),
      });
      // Constant u - v = i diagonals
      const uStart = Math.max(-N, -N + i);
      const uEnd = Math.min(N, N + i);
      lines.push({
        key: `gd_${i}`,
        p1: latticeToScreen(uStart, uStart - i, orientation, BASE_SCALE),
        p2: latticeToScreen(uEnd, uEnd - i, orientation, BASE_SCALE),
      });
    }
    return lines;
  }, [showGrid, orientation]);


  const activeEscherCount = scene.connections.filter((c) => c.mode !== 'disconnected').length;

  const handleOpenSuggestionModal = () => {
    setSuggestionError(null);
    setCreatedIssue(null);
    setShowSuggestionModal(true);
  };

  const handleSubmitSuggestion = async (e: React.FormEvent) => {
    e.preventDefault();
    const title = suggestionTitle.trim();
    const description = suggestionDescription.trim();
    if (!title || !description) {
      setSuggestionError('Please enter both a suggestion title and description.');
      return;
    }

    setIsSubmittingSuggestion(true);
    setSuggestionError(null);

    const payload = {
      title,
      category: suggestionCategory,
      description,
      submitter: suggestionSubmitter.trim(),
      includeSceneContext,
      sceneContext: {
        presetId: activePresetId,
        orientation,
        blockCount: blocks.length,
        weldCount: activeEscherCount,
        blocks: blocks.map((b) => ({ x: b.x, y: b.y, z: b.z })),
      },
    };

    try {
      const res = await fetch('/api/suggestions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const contentType = res.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        const data = (await res.json()) as {
          number?: number;
          html_url?: string;
          title?: string;
          error?: string;
          fallback?: boolean;
        };

        if (res.ok && data.html_url && data.number) {
          setCreatedIssue({
            number: data.number,
            html_url: data.html_url,
            title: data.title || title,
          });
          setSuggestionTitle('');
          setSuggestionDescription('');
          setIsSubmittingSuggestion(false);
          return;
        }

        if (!data.fallback && data.error) {
          throw new Error(data.error);
        }
      }

      // Fallback for static hosting (GitHub Pages): open pre-filled GitHub Issue and display direct link
      const issueTitle = title.startsWith('[Suggestion]') ? title : `[Suggestion] ${title}`;
      const bodyLines = [
        `### Suggestion Summary`,
        `**Category:** \`${suggestionCategory}\``,
        suggestionSubmitter.trim() ? `**Submitted by:** ${suggestionSubmitter.trim()}` : '',
        '',
        '### Description',
        description,
      ].filter(Boolean);

      if (includeSceneContext) {
        bodyLines.push(
          '',
          '---',
          `**Canvas Context:** Preset \`${activePresetId}\` · ${blocks.length} blocks · ${activeEscherCount} Escher welds`
        );
      }

      const fallbackUrl = `https://github.com/arussellturner/impossible-shapes/issues/new?title=${encodeURIComponent(
        issueTitle
      )}&body=${encodeURIComponent(bodyLines.join('\n'))}&labels=${encodeURIComponent(
        suggestionCategory === 'bug' ? 'bug' : 'enhancement'
      )}`;
      window.open(fallbackUrl, '_blank', 'noopener,noreferrer');
      setCreatedIssue({
        number: 0,
        html_url: fallbackUrl,
        title: issueTitle,
      });
      setSuggestionTitle('');
      setSuggestionDescription('');
    } catch (err) {
      setSuggestionError(
        err instanceof Error ? err.message : 'Could not submit suggestion to GitHub.'
      );
    } finally {
      setIsSubmittingSuggestion(false);
    }
  };

  // Keyboard/D-pad "next block" ghost (independent of mouse hover)
  const kbCandidate: GhostCandidate | null = useMemo(() => {
    if (toolMode !== 'build') return null;
    return resolveGhostAtLattice(
      kbGhost.u,
      kbGhost.v,
      { x: kbGhost.x, y: kbGhost.y, z: kbGhost.z },
      blocks,
      selectedBlockId,
      orientation,
      BASE_SCALE
    );
  }, [toolMode, kbGhost, blocks, selectedBlockId, orientation]);

  const placeKbBlock = () => {
    setToolMode('build');
    setInputMode('keyboard');
    if (kbCandidate) {
      addBlockAt(kbCandidate.x, kbCandidate.y, kbCandidate.z, kbCandidate.direction ?? lastBuildDir);
    }
  };

  // Toggle the weld of the most recently added block
  const toggleLastBlockWeld = () => {
    const last = blocks[blocks.length - 1];
    if (last) handleToggleBlockWeldPlane(last.id);
  };

  // D-pad: place each of the 6 isometric directions at its true on-screen angle
  const dpadDirs = useMemo(
    () =>
      (['+X', '-X', '+Y', '-Y', '+Z', '-Z'] as AxisDirection[]).map((dir) => {
        const d = AXIS_DELTAS[dir];
        const p = latticeToScreen(d.du, d.dv, orientation, 1);
        const len = Math.hypot(p.x, p.y) || 1;
        return { dir, nx: p.x / len, ny: p.y / len };
      }),
    [orientation]
  );

  // Track canvas size so the drawing stays centered on any screen
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const update = () => setViewSize({ w: el.clientWidth, h: el.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Auto-hide the weld toast
  useEffect(() => {
    if (!lastWeldBanner) return;
    const t = window.setTimeout(() => setLastWeldBanner(null), 2600);
    return () => window.clearTimeout(t);
  }, [lastWeldBanner]);

  const loadEmptyCanvas = () => {
    setActivePresetId('empty');
    commitChange([], {}, {});
    setSelectedBlockId(null);
    syncKbGhostFromBlock(undefined);
    setMenuOpen(false);
  };

  const ctrlBtn =
    'flex items-center justify-center rounded-xl bg-neutral-900/90 backdrop-blur-md border border-neutral-700/80 text-neutral-200 hover:text-white hover:bg-neutral-800 active:scale-95 shadow-lg transition select-none';

  return (
    <div className="relative h-[100dvh] w-screen overflow-hidden bg-neutral-950 text-neutral-100 font-sans">
      {/* FULL-SCREEN INTERACTIVE ISOMETRIC CANVAS */}
      <svg
        ref={svgRef}
        onMouseMove={handleMouseMove}
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
        onClick={handleCanvasClick}
        onContextMenu={handleContextMenu}
        onWheel={handleWheel}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        style={{ backgroundColor: theme.canvasBg, touchAction: 'none' }}
        className={`absolute inset-0 w-full h-full transition-colors duration-200 ${
          isPanning
            ? 'cursor-grabbing'
            : isShiftHeld || toolMode === 'erase' || toolMode === 'welds'
              ? 'cursor-pointer'
              : 'cursor-crosshair'
        }`}
      >
        <g
          transform={`translate(${viewSize.w * 0.5}, ${viewSize.h * 0.5}) scale(${zoom}) translate(${pan.x}, ${pan.y})`}
        >
          {/* 1. Isometric Lattice Grid */}
          {showGrid && (
            <g className="pointer-events-none">
              {backgroundGridLines.map((line) => (
                <line
                  key={line.key}
                  x1={line.p1.x}
                  y1={line.p1.y}
                  x2={line.p2.x}
                  y2={line.p2.y}
                  stroke={theme.gridLine}
                  strokeWidth={0.75}
                  strokeOpacity={0.55}
                />
              ))}
            </g>
          )}

          {/* 2. Filled Triangles (merged Escher ribbons) */}
          <g>
            {scene.triangles.map((tri) => {
              const fill =
                tri.faceType === 'X' ? theme.faceX : tri.faceType === 'Y' ? theme.faceY : theme.faceZ;
              const isHoveredErase = toolMode === 'erase' && hoveredBlockId === tri.blockId;
              const isHoveredShiftWeld = isShiftHeld && hoveredBlockId === tri.blockId;
              return (
                <polygon
                  key={tri.key}
                  points={pointsToSvgPolygon(tri.points)}
                  fill={isHoveredErase ? '#f43f5e' : fill}
                  stroke={isHoveredErase ? '#f43f5e' : isHoveredShiftWeld ? '#06b6d4' : fill}
                  strokeWidth={isHoveredShiftWeld ? 1.8 : 0.65}
                  strokeLinejoin="round"
                  onMouseEnter={() => setHoveredBlockId(tri.blockId)}
                  onClick={(e) => {
                    if (e.shiftKey) {
                      e.stopPropagation();
                      handleToggleBlockWeldPlane(tri.blockId, clientToWorld(e.clientX, e.clientY));
                    }
                  }}
                />
              );
            })}
          </g>

          {/* Optional Internal Voxel Seams */}
          {showVoxelSeams && (
            <g className="pointer-events-none">
              {scene.seamEdges.map((edge) => (
                <line
                  key={edge.key}
                  x1={edge.p1.x}
                  y1={edge.p1.y}
                  x2={edge.p2.x}
                  y2={edge.p2.y}
                  stroke={theme.stroke}
                  strokeWidth={strokeWidth * 0.45}
                  strokeOpacity={0.4}
                  strokeDasharray="4 4"
                  strokeLinecap="round"
                />
              ))}
            </g>
          )}

          {/* Crisp Merged Contour & Crease Outlines */}
          <g className="pointer-events-none">
            {scene.edges.map((edge) => (
              <line
                key={edge.key}
                x1={edge.p1.x}
                y1={edge.p1.y}
                x2={edge.p2.x}
                y2={edge.p2.y}
                stroke={theme.stroke}
                strokeWidth={strokeWidth}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            ))}
          </g>

          {/* Erase mode: red indicator on the block that − / Delete will remove */}
          {toolMode === 'erase' &&
            (() => {
              const target = blocks.find((b) => b.id === selectedBlockId) ?? blocks[blocks.length - 1];
              if (!target) return null;
              const lc = blockToLattice(target.x, target.y, target.z);
              const r = getBlockRhombuses(lc.u, lc.v, orientation, BASE_SCALE);
              return (
                <g className="pointer-events-none">
                  {[r.faceX, r.faceY, r.faceZ].map((pts, i) => (
                    <polygon
                      key={i}
                      points={pointsToSvgPolygon(pts)}
                      fill="#f43f5e"
                      fillOpacity={0.4}
                      stroke="#f43f5e"
                      strokeWidth={2.5}
                      strokeDasharray="6 3"
                      strokeLinejoin="round"
                    />
                  ))}
                </g>
              );
            })()}

          {/* Welds mode: markers on every toggleable weld + cursor on the selected one */}
          {toolMode === 'welds' && (
            <g className="pointer-events-none">
              {weldToggles.map((t) => (
                <circle
                  key={t.joint.key}
                  cx={t.joint.center.x}
                  cy={t.joint.center.y}
                  r={t.joint.key === selectedToggle?.joint.key ? 0 : 5}
                  fill="#06b6d4"
                  fillOpacity={0.85}
                  stroke="#083344"
                  strokeWidth={1.5}
                />
              ))}
              {selectedToggle &&
                (() => {
                  const { joint } = selectedToggle;
                  return (
                    <g>
                      {joint.blockIds.map((id) => {
                        const b = blocks.find((blk) => blk.id === id);
                        if (!b) return null;
                        const lc = blockToLattice(b.x, b.y, b.z);
                        const r = getBlockRhombuses(lc.u, lc.v, orientation, BASE_SCALE);
                        return [r.faceX, r.faceY, r.faceZ].map((pts, i) => (
                          <polygon
                            key={`${id}_${i}`}
                            points={pointsToSvgPolygon(pts)}
                            fill="none"
                            stroke="#06b6d4"
                            strokeOpacity={0.75}
                            strokeWidth={1.5}
                            strokeDasharray="5 4"
                            strokeLinejoin="round"
                          />
                        ));
                      })}
                      <circle cx={joint.center.x} cy={joint.center.y} r={11} fill="none" stroke="#06b6d4" strokeWidth={3} />
                      <circle cx={joint.center.x} cy={joint.center.y} r={4} fill="#06b6d4" stroke="#083344" strokeWidth={1.5} />
                      <g transform={`translate(${joint.center.x}, ${joint.center.y - 34})`}>
                        <rect x={-118} y={-12} width={236} height={22} rx={11} fill="#09090b" fillOpacity={0.92} stroke="#06b6d4" strokeWidth={1.5} />
                        <text x={0} y={3} textAnchor="middle" fill="#67e8f9" fontSize={10} fontWeight="bold">
                          {`${WELD_PLANE_SHORT[joint.plane]} now · ${isTouch ? 'tap ⟲' : 'W'} → ${WELD_PLANE_SHORT[selectedToggle.nextPlane]}`}
                        </text>
                      </g>
                    </g>
                  );
                })()}
            </g>
          )}

          {/* Selected Block Anchor Dot */}
          {toolMode !== 'welds' && selectedBlockId && scene.blockScreenCenters.has(selectedBlockId) && (
            <circle
              cx={scene.blockScreenCenters.get(selectedBlockId)!.x}
              cy={scene.blockScreenCenters.get(selectedBlockId)!.y}
              r={4}
              fill="#f59e0b"
              stroke="#000"
              strokeWidth={1.5}
              className="pointer-events-none opacity-75"
            />
          )}

          {/* Shift-Hover: highlight the impossible joint that Shift+Click will toggle */}
          {isShiftHeld && hoveredBlockId && (
            <g
              transform={`translate(${
                (activeJoint?.center ?? scene.blockScreenCenters.get(hoveredBlockId))?.x ?? 0
              }, ${(activeJoint?.center ?? scene.blockScreenCenters.get(hoveredBlockId))?.y ?? 0})`}
              className="pointer-events-none"
            >
              {activeJoint && (
                <circle r={9} fill="none" stroke="#06b6d4" strokeWidth={2.5} strokeDasharray="3 2" />
              )}
              <g transform="translate(0, -30)">
                <rect
                  x={-104}
                  y={-12}
                  width={208}
                  height={22}
                  rx={11}
                  fill="#09090b"
                  fillOpacity={0.92}
                  stroke="#06b6d4"
                  strokeWidth={1.5}
                />
                <text x={0} y={3} textAnchor="middle" fill="#67e8f9" fontSize={10} fontWeight="bold">
                  {activeJoint
                    ? `⇧+Click: ${WELD_PLANE_LABELS[activeJoint.plane]}`
                    : 'No impossible joint here'}
                </text>
              </g>
            </g>
          )}

          {/* Ghost Block Preview in Build Mode */}
          {ghostCandidate && (
            <g className="pointer-events-none">
              {(['faceX', 'faceY', 'faceZ'] as const).map((face) => (
                <polygon
                  key={face}
                  points={pointsToSvgPolygon(ghostCandidate.rhombuses[face])}
                  fill={face === 'faceX' ? theme.faceX : face === 'faceY' ? theme.faceY : theme.faceZ}
                  fillOpacity={face === 'faceZ' ? 0.62 : 0.48}
                  stroke={ghostCandidate.willEscherConnect ? '#f59e0b' : '#06b6d4'}
                  strokeWidth={2.0}
                  strokeDasharray={ghostCandidate.willEscherConnect ? undefined : '5 3'}
                />
              ))}
            </g>
          )}

          {/* Optional Interactive Escher Weld Badges */}
          {showConnectionBadges &&
            scene.connections.map((conn) => {
              const isFlipped = conn.mode === 'flipped';
              const isDisconnected = conn.mode === 'disconnected';
              return (
                <g
                  key={conn.id}
                  transform={`translate(${conn.screenPos.x}, ${conn.screenPos.y})`}
                  onClick={(e) => handleCycleConnection(conn, e)}
                  className="cursor-pointer group"
                >
                  <circle r={16} fill="transparent" className="group-hover:fill-amber-400/20 transition" />
                  <circle
                    r={10.5}
                    fill={isDisconnected ? '#27272a' : isFlipped ? '#06b6d4' : '#f59e0b'}
                    stroke="#09090b"
                    strokeWidth={2}
                  />
                  <text
                    x={0}
                    y={3.5}
                    textAnchor="middle"
                    fontSize={10}
                    fontWeight="bold"
                    fill={isDisconnected ? '#a1a1aa' : '#09090b'}
                  >
                    {isDisconnected ? '×' : isFlipped ? '⇄' : '⚡'}
                  </text>
                </g>
              );
            })}
        </g>
      </svg>

      {/* TOP-LEFT: Hamburger menu button */}
      <button
        onClick={() => setMenuOpen(true)}
        className={`${ctrlBtn} absolute top-3 left-3 z-20 w-11 h-11`}
        style={{ marginTop: 'env(safe-area-inset-top)' }}
        title="Menu"
        aria-label="Open menu"
      >
        <Menu className="w-5 h-5" />
      </button>

      {/* Weld toast */}
      {lastWeldBanner && (
        <div
          className={`absolute ${isTouch ? 'top-[4.5rem]' : 'top-3'} left-1/2 -translate-x-1/2 z-20 max-w-[80vw] px-3 py-2 rounded-xl bg-neutral-900/95 border border-cyan-500/40 text-cyan-200 text-xs font-medium shadow-lg pointer-events-none text-center`}
          style={{ marginTop: 'env(safe-area-inset-top)' }}
        >
          {lastWeldBanner}
        </div>
      )}

      {/* ZOOM + CENTER (top-right on touch, bottom-left on desktop) */}
      <div
        className={`absolute z-10 flex items-center gap-1 p-1 rounded-xl bg-neutral-900/90 backdrop-blur-md border border-neutral-700/80 shadow-lg ${
          isTouch ? 'top-3 right-3' : 'bottom-4 left-4'
        }`}
        style={isTouch ? { marginTop: 'env(safe-area-inset-top)' } : undefined}
      >
        <button
          onClick={() => setZoom((z) => Math.max(0.35, z * 0.85))}
          className="w-9 h-9 flex items-center justify-center rounded-lg text-neutral-300 hover:text-white hover:bg-neutral-800 transition"
          title="Zoom Out"
        >
          <ZoomOut className="w-4 h-4" />
        </button>
        <button
          onClick={() => setZoom((z) => Math.min(3.0, z * 1.15))}
          className="w-9 h-9 flex items-center justify-center rounded-lg text-neutral-300 hover:text-white hover:bg-neutral-800 transition"
          title="Zoom In"
        >
          <ZoomIn className="w-4 h-4" />
        </button>
        <button
          onClick={() => centerViewOnBlocks(blocks)}
          className="h-9 px-2.5 rounded-lg text-xs font-medium text-neutral-300 hover:text-white hover:bg-neutral-800 flex items-center gap-1 transition"
          title="Center View"
        >
          <Maximize2 className="w-3.5 h-3.5" />
          Center
        </button>
      </div>

      {/* PRIMARY CONTROLS: Add/Erase + Toggle Weld (+ Undo on touch) */}
      <div
        className={`absolute z-10 flex gap-2 ${
          isTouch ? 'left-3 flex-col items-start' : 'bottom-4 left-1/2 -translate-x-1/2 items-center'
        }`}
        style={isTouch ? { bottom: 'calc(env(safe-area-inset-bottom) + 12px)' } : undefined}
      >
        <div className="flex p-1 rounded-xl bg-neutral-900/90 backdrop-blur-md border border-neutral-700/80 shadow-lg">
          <button
            onClick={() => switchTool('build')}
            className={`h-10 px-3 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition ${
              toolMode === 'build' ? 'bg-amber-500 text-neutral-950' : 'text-neutral-300 hover:text-white'
            }`}
          >
            <Plus className="w-4 h-4" />
            Add
          </button>
          <button
            onClick={() => switchTool('erase')}
            className={`h-10 px-3 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition ${
              toolMode === 'erase' ? 'bg-rose-500 text-white' : 'text-neutral-300 hover:text-white'
            }`}
          >
            <Eraser className="w-4 h-4" />
            Erase
          </button>
          <button
            onClick={() => switchTool('welds')}
            className={`h-10 px-3 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition ${
              toolMode === 'welds' ? 'bg-cyan-500 text-neutral-950' : 'text-neutral-300 hover:text-white'
            }`}
            title="Welds mode: arrows jump between toggleable welds, W toggles (key 3)"
          >
            <Zap className="w-4 h-4" />
            Welds
          </button>
        </div>
        <button
          onClick={toolMode === 'welds' ? toggleSelectedWeld : toggleLastBlockWeld}
          disabled={toolMode === 'welds' ? !selectedToggle : blocks.length === 0}
          className={`${ctrlBtn} h-12 px-3.5 gap-2 text-xs font-semibold text-cyan-200 border-cyan-500/40 disabled:opacity-40`}
          title={
            toolMode === 'welds'
              ? 'Toggle the selected weld (W)'
              : 'Toggle the weld plane at the last block you added (W / Shift+Click)'
          }
        >
          <FlipHorizontal2 className="w-4 h-4 text-cyan-400" />
          Toggle Weld
          {!isTouch && (
            <kbd className="px-1.5 py-0.5 text-[10px] font-mono bg-neutral-950 text-cyan-300 rounded border border-neutral-800">
              W
            </kbd>
          )}
        </button>
        {isTouch && (
          <button
            onClick={handleUndo}
            disabled={past.length === 0}
            className={`${ctrlBtn} h-12 px-3.5 gap-2 text-xs font-semibold disabled:opacity-40`}
            title="Undo"
          >
            <Undo2 className="w-4 h-4" />
            Undo
          </button>
        )}
      </div>

      {/* TOUCH D-PAD: 6 isometric directions around a central Place button */}
      {isTouch && (
        <div
          className="absolute right-3 z-10 w-44 h-44"
          style={{ bottom: 'calc(env(safe-area-inset-bottom) + 12px)' }}
        >
          {dpadDirs.map(({ dir, nx, ny }) => {
            const angle = (Math.atan2(ny, nx) * 180) / Math.PI + 90;
            const active = lastBuildDir === dir;
            return (
              <button
                key={dir}
                onClick={() => moveNextBlockCursor(dir)}
                className={`${ctrlBtn.replace('rounded-xl', 'rounded-full')} absolute w-12 h-12 ${
                  active ? 'border-amber-500 text-amber-300' : ''
                }`}
                style={{
                  left: `calc(50% + ${nx * 62}px - 24px)`,
                  top: `calc(50% + ${ny * 62}px - 24px)`,
                }}
                aria-label={`Move next block ${dir}`}
              >
                <ArrowUp className="w-5 h-5" style={{ transform: `rotate(${angle}deg)` }} />
              </button>
            );
          })}
          {toolMode === 'erase' ? (
            <button
              onClick={deleteEraseTarget}
              disabled={blocks.length === 0}
              className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-14 h-14 rounded-full bg-rose-500 hover:bg-rose-400 active:scale-95 text-white shadow-lg shadow-rose-500/30 flex items-center justify-center transition disabled:opacity-40"
              aria-label="Delete selected block"
            >
              <Minus className="w-7 h-7 stroke-[3]" />
            </button>
          ) : toolMode === 'welds' ? (
            <button
              onClick={toggleSelectedWeld}
              disabled={!selectedToggle}
              className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-14 h-14 rounded-full bg-cyan-500 hover:bg-cyan-400 active:scale-95 text-neutral-950 shadow-lg shadow-cyan-500/30 flex items-center justify-center transition disabled:opacity-40"
              aria-label="Toggle selected weld"
            >
              <FlipHorizontal2 className="w-7 h-7 stroke-[2.5]" />
            </button>
          ) : (
            <button
              onClick={placeKbBlock}
              className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-14 h-14 rounded-full bg-amber-500 hover:bg-amber-400 active:scale-95 text-neutral-950 shadow-lg shadow-amber-500/30 flex items-center justify-center transition"
              aria-label="Place block"
            >
              <Plus className="w-7 h-7 stroke-[3]" />
            </button>
          )}
        </div>
      )}

      {/* HAMBURGER DRAWER: Settings / Starters / Export */}
      {menuOpen && (
        <div className="fixed inset-0 z-40 flex" onClick={() => setMenuOpen(false)}>
          <div className="absolute inset-0 bg-black/55 backdrop-blur-[2px]" />
          <aside
            className="relative h-full w-[88vw] max-w-sm bg-neutral-900 border-r border-neutral-800 shadow-2xl flex flex-col"
            style={{ paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b border-neutral-800">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-amber-400 to-orange-600 flex items-center justify-center text-neutral-950">
                  <Box className="w-5 h-5 stroke-[2.5]" />
                </div>
                <div>
                  <h1 className="text-base font-bold tracking-tight text-white">EscherCAD</h1>
                  <p className="text-xs text-neutral-400">Impossible Shape Studio</p>
                </div>
              </div>
              <button
                onClick={() => setMenuOpen(false)}
                className="w-10 h-10 flex items-center justify-center rounded-lg text-neutral-400 hover:text-white hover:bg-neutral-800"
                aria-label="Close menu"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Section tabs */}
            <div className="grid grid-cols-3 gap-1 m-3 p-1 bg-neutral-950 rounded-xl border border-neutral-800">
              {(
                [
                  { id: 'starters', label: 'Starters', icon: Layers },
                  { id: 'settings', label: 'Settings', icon: Settings },
                  { id: 'export', label: 'Export', icon: Download },
                ] as const
              ).map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  onClick={() => setMenuSection(id)}
                  className={`py-2 rounded-lg text-xs font-semibold flex flex-col items-center gap-1 transition ${
                    menuSection === id
                      ? 'bg-amber-500 text-neutral-950'
                      : 'text-neutral-400 hover:text-white hover:bg-neutral-900'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  {label}
                </button>
              ))}
            </div>

            <div className="flex-1 overflow-y-auto px-3 pb-3 space-y-2">
              {menuSection === 'starters' && (
                <>
                  {SHAPE_PRESETS.map((preset) => {
                    const isSelected = activePresetId === preset.id;
                    return (
                      <button
                        key={preset.id}
                        onClick={() => handleLoadPreset(preset)}
                        className={`w-full text-left px-3 py-3 rounded-xl border transition flex items-center justify-between ${
                          isSelected
                            ? 'bg-amber-500/15 border-amber-500/50 text-white'
                            : 'bg-neutral-950/60 border-neutral-800 text-neutral-300 hover:bg-neutral-800/60 hover:text-white'
                        }`}
                      >
                        <div>
                          <div className="text-sm font-semibold">{preset.name}</div>
                          <div className="text-xs text-neutral-400">{preset.subtitle}</div>
                        </div>
                        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-neutral-900 text-neutral-400 border border-neutral-800">
                          {preset.blocks.length}b
                        </span>
                      </button>
                    );
                  })}
                  <div className="pt-1">
                    <button
                      onClick={loadEmptyCanvas}
                      className="w-full py-3 rounded-xl bg-neutral-950/60 border border-neutral-800 text-xs font-medium text-neutral-300 hover:text-rose-300 hover:border-rose-500/40 flex items-center justify-center gap-1.5"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      Empty Canvas
                    </button>
                  </div>
                </>
              )}

              {menuSection === 'settings' && (
                <>
                  <ToggleRow
                    label="Auto-connect impossible joints"
                    description="Blocks that visually touch fuse into an Escher weld"
                    value={autoConnect}
                    onChange={setAutoConnect}
                  />
                  <ToggleRow label="Show voxel block seams" value={showVoxelSeams} onChange={setShowVoxelSeams} />
                  <ToggleRow label="Isometric guide grid" value={showGrid} onChange={setShowGrid} />
                  <ToggleRow label="Show weld badges" value={showConnectionBadges} onChange={setShowConnectionBadges} />

                  <div className="pt-2">
                    <div className="text-[11px] font-semibold uppercase tracking-wider text-neutral-400 mb-1.5">
                      Orientation
                    </div>
                    <div className="grid grid-cols-2 gap-1 p-1 bg-neutral-950 rounded-xl border border-neutral-800">
                      {(
                        [
                          { id: 'penrose-horizontal', label: 'Penrose' },
                          { id: 'isometric-vertical', label: 'Vertical' },
                        ] as const
                      ).map((o) => (
                        <button
                          key={o.id}
                          onClick={() => {
                            setOrientation(o.id);
                            centerViewOnBlocks(blocks, o.id);
                          }}
                          className={`py-2 rounded-lg text-xs font-medium transition ${
                            orientation === o.id
                              ? 'bg-neutral-800 text-white border border-neutral-700 font-semibold'
                              : 'text-neutral-400 hover:text-white'
                          }`}
                        >
                          {o.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="pt-2 space-y-1.5">
                    <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-wider text-neutral-400">
                      <span>Line weight</span>
                      <span className="font-mono normal-case">{strokeWidth.toFixed(1)}px</span>
                    </div>
                    <input
                      type="range"
                      min={1.0}
                      max={4.5}
                      step={0.2}
                      value={strokeWidth}
                      onChange={(e) => setStrokeWidth(parseFloat(e.target.value))}
                      className="w-full accent-amber-500 cursor-pointer"
                    />
                  </div>

                  <div className="pt-2">
                    <div className="text-[11px] font-semibold uppercase tracking-wider text-neutral-400 mb-1.5 flex items-center gap-1.5">
                      <Palette className="w-3.5 h-3.5 text-amber-400" />
                      Shading palette
                    </div>
                    <div className="space-y-1.5">
                      {COLOR_THEMES.map((t) => {
                        const active = theme.id === t.id;
                        return (
                          <button
                            key={t.id}
                            onClick={() => setTheme(t)}
                            className={`w-full px-3 py-2.5 rounded-xl border text-left transition flex items-center justify-between ${
                              active
                                ? 'bg-neutral-800 border-amber-500/50 text-white'
                                : 'bg-neutral-950/60 border-neutral-800 text-neutral-300 hover:bg-neutral-800/50'
                            }`}
                          >
                            <span className="text-xs font-medium">{t.name}</span>
                            <div className="flex items-center gap-1">
                              {[t.faceZ, t.faceX, t.faceY].map((c, i) => (
                                <span
                                  key={i}
                                  className="w-3.5 h-3.5 rounded-full border border-neutral-600"
                                  style={{ backgroundColor: c }}
                                />
                              ))}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </>
              )}

              {menuSection === 'export' && (
                <>
                  <button
                    onClick={() => {
                      handleExportSvg();
                      setMenuOpen(false);
                    }}
                    className="w-full px-3 py-3 rounded-xl bg-neutral-950/60 border border-neutral-800 text-sm font-medium text-neutral-200 hover:bg-neutral-800 flex items-center gap-2.5"
                  >
                    <Download className="w-4 h-4 text-amber-400" />
                    Export SVG
                  </button>
                  <button
                    onClick={() => {
                      handleExportPng();
                      setMenuOpen(false);
                    }}
                    className="w-full px-3 py-3 rounded-xl bg-neutral-950/60 border border-neutral-800 text-sm font-medium text-neutral-200 hover:bg-neutral-800 flex items-center gap-2.5"
                  >
                    <ImageIcon className="w-4 h-4 text-amber-400" />
                    Export PNG
                  </button>
                </>
              )}
            </div>

            {/* Footer: Suggestion + Help */}
            <div className="p-3 border-t border-neutral-800 space-y-2">
              <button
                onClick={() => {
                  setMenuOpen(false);
                  handleOpenSuggestionModal();
                }}
                className="w-full py-3 px-3 rounded-xl bg-gradient-to-r from-cyan-500/20 to-amber-500/20 border border-cyan-500/40 text-xs font-semibold text-cyan-200 hover:text-white flex items-center justify-center gap-2"
              >
                <MessageSquarePlus className="w-4 h-4 text-cyan-400" />
                Offer a Suggestion to Improve This
              </button>
              <button
                onClick={() => {
                  setMenuOpen(false);
                  setShowHelpModal(true);
                }}
                className="w-full py-2.5 px-3 rounded-xl text-xs font-medium text-neutral-400 hover:text-white hover:bg-neutral-800 flex items-center justify-center gap-2"
              >
                <HelpCircle className="w-4 h-4" />
                How it works
              </button>
            </div>
          </aside>
        </div>
      )}

      {/* OFFER A SUGGESTION (GITHUB ISSUE) MODAL */}
      {showSuggestionModal && (
        <div
          className="fixed inset-0 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4 z-50"
          onClick={() => !isSubmittingSuggestion && setShowSuggestionModal(false)}
        >
          <div
            className="max-w-lg w-full rounded-2xl bg-neutral-900 border border-neutral-800 p-6 space-y-4 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-cyan-500/15 border border-cyan-500/30 flex items-center justify-center text-cyan-400">
                  <MessageSquarePlus className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-base font-bold text-white">
                    Offer a Suggestion to Improve This
                  </h2>
                  <p className="text-xs text-neutral-400">
                    Automatically saved as a GitHub Issue on{' '}
                    <span className="font-mono text-cyan-300">arussellturner/impossible-shapes</span>
                  </p>
                </div>
              </div>
              <button
                onClick={() => !isSubmittingSuggestion && setShowSuggestionModal(false)}
                className="text-neutral-400 hover:text-white text-sm p-1"
              >
                ✕
              </button>
            </div>

            {createdIssue ? (
              <div className="p-4 rounded-xl bg-emerald-950/40 border border-emerald-500/40 space-y-3">
                <div className="flex items-center gap-2 text-emerald-300 font-semibold text-sm">
                  <CheckCircle2 className="w-5 h-5 text-emerald-400 flex-shrink-0" />
                  <span>
                    {createdIssue.number > 0
                      ? `Suggestion saved as GitHub Issue #${createdIssue.number}!`
                      : 'GitHub Issue Ready to Submit!'}
                  </span>
                </div>
                <p className="text-xs text-neutral-300 leading-relaxed">
                  {createdIssue.number > 0 ? (
                    <>
                      Thank you! Your suggestion (<strong>{createdIssue.title}</strong>) has been
                      created in the repository issue tracker.
                    </>
                  ) : (
                    <>
                      Your suggestion (<strong>{createdIssue.title}</strong>) has been pre-filled
                      for the GitHub issue tracker. Click below if the GitHub tab did not open
                      automatically.
                    </>
                  )}
                </p>
                <div className="pt-1 flex items-center justify-between gap-2">
                  <a
                    href={createdIssue.html_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-3.5 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-neutral-950 text-xs font-bold inline-flex items-center gap-1.5 transition"
                  >
                    <span>
                      {createdIssue.number > 0
                        ? `View Issue #${createdIssue.number} on GitHub`
                        : 'Open & Save Issue on GitHub'}
                    </span>
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setCreatedIssue(null)}
                      className="px-3 py-2 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-neutral-200 text-xs font-medium transition"
                    >
                      Submit Another
                    </button>
                    <button
                      onClick={() => setShowSuggestionModal(false)}
                      className="px-3.5 py-2 rounded-xl bg-neutral-950 hover:bg-neutral-800 border border-neutral-700 text-neutral-200 text-xs font-medium transition"
                    >
                      Close
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <form onSubmit={handleSubmitSuggestion} className="space-y-3.5">
                {/* Category Selector */}
                <div>
                  <label className="block text-[11px] font-semibold uppercase tracking-wider text-neutral-400 mb-1.5">
                    Category
                  </label>
                  <div className="grid grid-cols-4 gap-1.5">
                    {(
                      [
                        { id: 'enhancement', label: 'Feature Idea' },
                        { id: 'ux', label: 'UI / Controls' },
                        { id: 'geometry', label: 'Weld / 3D' },
                        { id: 'bug', label: 'Bug Report' },
                      ] as const
                    ).map((cat) => (
                      <button
                        type="button"
                        key={cat.id}
                        onClick={() => setSuggestionCategory(cat.id)}
                        className={`py-1.5 px-2 rounded-lg text-xs font-medium border transition ${
                          suggestionCategory === cat.id
                            ? 'bg-cyan-500/20 border-cyan-400 text-cyan-200 font-semibold'
                            : 'bg-neutral-950 border-neutral-800 text-neutral-400 hover:text-white'
                        }`}
                      >
                        {cat.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Title */}
                <div>
                  <label className="block text-[11px] font-semibold uppercase tracking-wider text-neutral-400 mb-1">
                    Short Summary / Title *
                  </label>
                  <input
                    type="text"
                    required
                    value={suggestionTitle}
                    onChange={(e) => setSuggestionTitle(e.target.value)}
                    placeholder="e.g., Add keyboard shortcut to rotate the entire shape"
                    className="w-full px-3 py-2 rounded-xl bg-neutral-950 border border-neutral-800 focus:border-cyan-400 focus:outline-none text-xs text-white placeholder-neutral-500"
                  />
                </div>

                {/* Description */}
                <div>
                  <label className="block text-[11px] font-semibold uppercase tracking-wider text-neutral-400 mb-1">
                    Suggestion Details *
                  </label>
                  <textarea
                    required
                    rows={4}
                    value={suggestionDescription}
                    onChange={(e) => setSuggestionDescription(e.target.value)}
                    placeholder="Describe how we can improve EscherCAD, what workflow you'd like to see, or what behaved unexpectedly..."
                    className="w-full px-3 py-2 rounded-xl bg-neutral-950 border border-neutral-800 focus:border-cyan-400 focus:outline-none text-xs text-white placeholder-neutral-500 resize-y"
                  />
                </div>

                {/* Optional Name / Handle */}
                <div>
                  <label className="block text-[11px] font-semibold uppercase tracking-wider text-neutral-400 mb-1">
                    Your Name or GitHub Handle <span className="text-neutral-500">(Optional)</span>
                  </label>
                  <input
                    type="text"
                    value={suggestionSubmitter}
                    onChange={(e) => setSuggestionSubmitter(e.target.value)}
                    placeholder="e.g., @arussellturner"
                    className="w-full px-3 py-2 rounded-xl bg-neutral-950 border border-neutral-800 focus:border-cyan-400 focus:outline-none text-xs text-white placeholder-neutral-500"
                  />
                </div>

                {/* Include canvas diagnostic snapshot */}
                <label className="flex items-center gap-2.5 p-2.5 rounded-xl bg-neutral-950/80 border border-neutral-800 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={includeSceneContext}
                    onChange={(e) => setIncludeSceneContext(e.target.checked)}
                    className="rounded accent-cyan-400"
                  />
                  <span className="text-xs text-neutral-300">
                    Attach current shape snapshot ({blocks.length} blocks, {activeEscherCount}{' '}
                    Escher welds) to the GitHub issue
                  </span>
                </label>

                {suggestionError && (
                  <div className="p-2.5 rounded-xl bg-rose-950/50 border border-rose-500/40 text-xs text-rose-300">
                    {suggestionError}
                  </div>
                )}

                <div className="pt-2 flex items-center justify-end gap-2">
                  <button
                    type="button"
                    disabled={isSubmittingSuggestion}
                    onClick={() => setShowSuggestionModal(false)}
                    className="px-3.5 py-2 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-neutral-300 text-xs font-medium transition"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmittingSuggestion}
                    className="px-4 py-2 rounded-xl bg-cyan-400 hover:bg-cyan-300 disabled:opacity-50 text-neutral-950 text-xs font-bold flex items-center gap-1.5 shadow-lg shadow-cyan-500/20 transition"
                  >
                    {isSubmittingSuggestion ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        <span>Creating GitHub Issue...</span>
                      </>
                    ) : (
                      <>
                        <Send className="w-3.5 h-3.5" />
                        <span>Submit Suggestion</span>
                      </>
                    )}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* HOW IT WORKS MODAL */}
      {showHelpModal && (
        <div
          className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50"
          onClick={() => setShowHelpModal(false)}
        >
          <div
            className="max-w-lg w-full rounded-2xl bg-neutral-900 border border-neutral-800 p-6 space-y-4 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-amber-400" />
                How Isometric Impossible Shapes Work
              </h2>
              <button
                onClick={() => setShowHelpModal(false)}
                className="text-neutral-400 hover:text-white text-sm"
              >
                ✕
              </button>
            </div>
            <div className="space-y-3 text-xs text-neutral-300 leading-relaxed">
              <p>
                In a 3D isometric projection, moving by{' '}
                <code className="px-1.5 py-0.5 rounded bg-neutral-800 text-amber-300 font-mono">
                  (+k, +k, +k)
                </code>{' '}
                along all three axes shifts a block deeper in 3D space while projecting to the{' '}
                <strong>exact same 2D screen position</strong>.
              </p>
              <p>
                <strong>1. Building in 3D:</strong> Tap or click near any block to add a neighbor,
                or use the arrow keys / on-screen D-pad to move the next block and Space / the
                center button to place it.
              </p>
              <p>
                <strong>2. Automatic Escher Welds (⚡):</strong> Whenever a newly placed block
                visually touches another block at a different 3D depth, EscherCAD automatically
                welds them together—merging their coplanar faces and weaving their local depth order
                to create seamless M.C. Escher &amp; Penrose illusions.
              </p>
              <p>
                <strong>3. Flip or Break the Illusion:</strong> Turn on weld badges in Settings and
                click any{' '}
                <span className="text-amber-400 font-semibold">⚡ badge</span> to flip which beam
                passes in front or unmerge the joint, or{' '}
                <span className="text-cyan-300 font-semibold">Shift + Click</span> any block to
                change which face plane welds at an impossible joint (or use the Toggle Weld
                button for the last block you added).
              </p>
              <p>
                <strong>4. Welds Mode:</strong> Switch to{' '}
                <span className="text-cyan-300 font-semibold">Welds</span> (key 3) to jump a cyan
                cursor between every weld you can toggle using the arrow keys (or Tab), then press{' '}
                <span className="text-cyan-300 font-semibold">W</span> to cycle which face welds in
                front. Clicking a weld selects it; clicking it again toggles it.
              </p>
            </div>
            <div className="pt-2 flex justify-end">
              <button
                onClick={() => setShowHelpModal(false)}
                className="px-4 py-2 rounded-xl bg-amber-500 text-neutral-950 text-xs font-bold hover:bg-amber-400 transition"
              >
                Got it, let&apos;s build!
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
