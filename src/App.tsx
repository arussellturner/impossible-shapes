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
  getNextDistinctWeldPlane,
  latticeToScreen,
  resolveGhostAtLattice,
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
} from 'lucide-react';

interface HistorySnapshot {
  blocks: VoxelBlock[];
  connectionModes: Record<string, ConnectionMode>;
  blockWeldOverrides: Record<string, BlockWeldOverride>;
}

function pointsToSvgPolygon(pts: ScreenPoint[]): string {
  return pts.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ');
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
  const [showConnectionBadges, setShowConnectionBadges] = useState<boolean>(true);
  const [strokeWidth, setStrokeWidth] = useState<number>(2.4);
  const [autoConnect, setAutoConnect] = useState<boolean>(true);

  // 3D Illusion Peek state (0 = locked isometric sweet spot, != 0 = tilted 3D reveal)
  const [peekAmount, setPeekAmount] = useState<number>(0);
  const [showHelpModal, setShowHelpModal] = useState<boolean>(false);

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

      setPan({
        x: -((minX + maxX) * 0.5),
        y: -((minY + maxY) * 0.5),
      });
    },
    [orientation]
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
    setPeekAmount(0);
    commitChange(newBlocks, preset.connectionOverrides ?? {}, {});
    centerViewOnBlocks(newBlocks, nextOrientation);
    const last = newBlocks[newBlocks.length - 1];
    setSelectedBlockId(last?.id ?? null);
    syncKbGhostFromBlock(last, '+Y');
  };

  // Active Ghost Block Candidate (combines Keyboard arrow-key cursor and Mouse hover)
  const ghostCandidate: GhostCandidate | null = useMemo(() => {
    if (toolMode !== 'build' || isPanning || isShiftHeld || Math.abs(peekAmount) > 0.01) {
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
    peekAmount,
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

  // Move the "Next Block" ghost cursor using Arrow keys (or Q/E)
  const moveNextBlockCursor = useCallback(
    (dir: AxisDirection) => {
      setToolMode('build');
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
    [blocks, selectedBlockId]
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

  // Shift+Click (or 'W' key): Toggle which block face/plane visually welds at this block
  const handleToggleBlockWeldPlane = useCallback(
    (targetBlockId?: string) => {
      const id =
        targetBlockId ??
        hoveredBlockId ??
        selectedBlockId ??
        blocks[blocks.length - 1]?.id;
      if (!id) return;

      const { nextPlane, nextOrder } = getNextDistinctWeldPlane(
        id,
        blocks,
        connectionModes,
        blockWeldOverrides,
        orientation
      );
      const nextOverrides: Record<string, BlockWeldOverride> = {
        ...blockWeldOverrides,
        [id]: { plane: nextPlane, order: nextOrder },
      };

      commitChange(blocks, connectionModes, nextOverrides);
      setSelectedBlockId(id);
      setLastWeldBanner(`Weld Plane: ${WELD_PLANE_LABELS[nextPlane]}`);
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

    setInputMode('mouse');
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

  const handleCanvasClick = (e: React.MouseEvent<SVGSVGElement>) => {
    if (isPanning) return;
    if (Math.abs(peekAmount) > 0.01) {
      // Snap back to isometric lock on click
      setPeekAmount(0);
      return;
    }

    // Shift + Click toggles which block face/plane visually welds
    if (e.shiftKey) {
      handleToggleBlockWeldPlane(hoveredBlockId ?? selectedBlockId ?? undefined);
      return;
    }

    // Alt/Option + Click erases hovered block quickly
    if (e.altKey && hoveredBlockId) {
      removeBlockById(hoveredBlockId);
      return;
    }

    if (toolMode === 'erase') {
      if (hoveredBlockId) {
        removeBlockById(hoveredBlockId);
      }
      return;
    }

    if (toolMode === 'build') {
      if (ghostCandidate) {
        addBlockAt(
          ghostCandidate.x,
          ghostCandidate.y,
          ghostCandidate.z,
          ghostCandidate.direction
        );
      } else if (hoveredBlockId) {
        setSelectedBlockId(hoveredBlockId);
        const b = blocks.find((blk) => blk.id === hoveredBlockId);
        syncKbGhostFromBlock(b, lastBuildDir);
      }
    }
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
        handleToggleBlockWeldPlane();
        return;
      }

      // Spacebar places the block at the current ghost position
      if (e.code === 'Space' || e.key === ' ') {
        e.preventDefault();
        if (Math.abs(peekAmount) > 0.01) {
          setPeekAmount(0);
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

      if (e.key === '1') setToolMode('build');
      if (e.key === '2') setToolMode('erase');
      if (e.key === '3') setToolMode('connect');
      if (e.key.toLowerCase() === 'g') setShowGrid((g) => !g);
      if (e.key.toLowerCase() === 'v') setShowVoxelSeams((v) => !v);
      if (e.key === 'Backspace' || e.key === 'Delete') {
        if (selectedBlockId && blocks.length > 0) {
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
    peekAmount,
    ghostCandidate,
    addBlockAt,
    lastBuildDir,
    selectedBlockId,
    blocks.length,
    removeBlockById,
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
    const N = 16;
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

  // Blocks sorted by true 3D depth for "3D Illusion Peek" mode
  const peekSortedBlocks = useMemo(() => {
    if (Math.abs(peekAmount) <= 0.01) return [];
    return [...blocks]
      .sort((a, b) => blockDepth(a.x, a.y, a.z) - blockDepth(b.x, b.y, b.z))
      .map((b) => {
        const lc = blockToLattice(b.x, b.y, b.z);
        const d = blockDepth(b.x, b.y, b.z);
        const offset: ScreenPoint = {
          x: d * peekAmount * 22,
          y: -d * peekAmount * 16,
        };
        const center = latticeToScreen(lc.u, lc.v, orientation, BASE_SCALE);
        return {
          block: b,
          depth: d,
          center: { x: center.x + offset.x, y: center.y + offset.y },
          rhombuses: getBlockRhombuses(lc.u, lc.v, orientation, BASE_SCALE, offset),
        };
      });
  }, [blocks, peekAmount, orientation]);

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

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-neutral-950 text-neutral-100 font-sans">
      {/* LEFT SIDEBAR: Presets, Tools & Isometric Extrusion Pad */}
      <aside className="w-80 flex-shrink-0 border-r border-neutral-800/80 bg-neutral-900/90 backdrop-blur-md flex flex-col justify-between z-20">
        <div className="p-4 space-y-5 overflow-y-auto">
          {/* App Header */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-amber-400 to-orange-600 flex items-center justify-center shadow-lg shadow-amber-500/20 text-neutral-950 font-black">
                <Box className="w-5 h-5 stroke-[2.5]" />
              </div>
              <div>
                <h1 className="text-base font-bold tracking-tight text-white flex items-center gap-1.5">
                  EscherCAD
                  <span className="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30">
                    Iso-3D
                  </span>
                </h1>
                <p className="text-xs text-neutral-400">Impossible Shape Studio</p>
              </div>
            </div>
            <button
              onClick={() => setShowHelpModal(true)}
              className="p-2 rounded-lg text-neutral-400 hover:text-white hover:bg-neutral-800 transition"
              title="How Impossible Shapes Work"
            >
              <HelpCircle className="w-4 h-4" />
            </button>
          </div>

          {/* Primary Tool Selector */}
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wider text-neutral-400 mb-2 flex items-center justify-between">
              <span>Interaction Mode</span>
              <span className="text-[10px] text-neutral-500">Keys 1 · 2 · 3</span>
            </div>
            <div className="grid grid-cols-3 gap-1.5 p-1 bg-neutral-950 rounded-xl border border-neutral-800">
              <button
                onClick={() => setToolMode('build')}
                className={`flex flex-col items-center gap-1 py-2 px-2 rounded-lg text-xs font-medium transition ${
                  toolMode === 'build'
                    ? 'bg-amber-500 text-neutral-950 shadow-md shadow-amber-500/20 font-semibold'
                    : 'text-neutral-400 hover:text-white hover:bg-neutral-900'
                }`}
              >
                <Plus className="w-4 h-4" />
                <span>Add Block</span>
              </button>
              <button
                onClick={() => setToolMode('erase')}
                className={`flex flex-col items-center gap-1 py-2 px-2 rounded-lg text-xs font-medium transition ${
                  toolMode === 'erase'
                    ? 'bg-rose-500 text-white shadow-md shadow-rose-500/20 font-semibold'
                    : 'text-neutral-400 hover:text-white hover:bg-neutral-900'
                }`}
              >
                <Eraser className="w-4 h-4" />
                <span>Erase</span>
              </button>
              <button
                onClick={() => setToolMode('connect')}
                className={`flex flex-col items-center gap-1 py-2 px-2 rounded-lg text-xs font-medium transition ${
                  toolMode === 'connect'
                    ? 'bg-cyan-400 text-neutral-950 shadow-md shadow-cyan-400/20 font-semibold'
                    : 'text-neutral-400 hover:text-white hover:bg-neutral-900'
                }`}
              >
                <Zap className="w-4 h-4" />
                <span>Welds ({scene.connections.length})</span>
              </button>
            </div>
          </div>

          {/* Auto-Connect & Escher Paradox Status */}
          <div className="p-3 rounded-xl bg-neutral-950/90 border border-neutral-800 space-y-2.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-amber-400" />
                <span className="text-xs font-semibold text-neutral-200">
                  Auto-Connect Impossible Joints
                </span>
              </div>
              <button
                onClick={() => setAutoConnect((a) => !a)}
                className={`w-10 h-5 flex items-center rounded-full p-0.5 transition ${
                  autoConnect ? 'bg-amber-500 justify-end' : 'bg-neutral-700 justify-start'
                }`}
              >
                <span className="w-4 h-4 rounded-full bg-white shadow" />
              </button>
            </div>
            <p className="text-[11px] text-neutral-400 leading-relaxed">
              When two blocks at different 3D depths visually touch in isometric projection, they
              automatically fuse into a seamless Escher ribbon.
            </p>
            {scene.connections.length > 0 && (
              <div className="pt-1 border-t border-neutral-800/80 flex items-center justify-between text-[11px]">
                <span className="text-amber-300 font-medium flex items-center gap-1">
                  <Zap className="w-3.5 h-3.5" />
                  {activeEscherCount} active Escher{' '}
                  {activeEscherCount === 1 ? 'weld' : 'welds'}
                </span>
                <span className="text-neutral-400">⇧+Click block to change weld plane</span>
              </div>
            )}
          </div>

          {/* 6-Direction Step Builder Pad + Keyboard Controls */}
          <div className="p-3 rounded-xl bg-neutral-950/80 border border-neutral-800 space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-neutral-400 flex items-center gap-1.5">
                <Compass className="w-3.5 h-3.5 text-amber-400" />
                Move Next Block
              </span>
              <span className="text-[10px] font-mono text-amber-300/90">Arrows + Space</span>
            </div>
            <div className="grid grid-cols-3 gap-1.5 pt-0.5">
              {(
                [
                  { dir: '+X', keyHint: '←' },
                  { dir: '+Y', keyHint: 'E / ⇧↓' },
                  { dir: '+Z', keyHint: '↑' },
                  { dir: '-X', keyHint: '→' },
                  { dir: '-Y', keyHint: 'Q / ⇧↑' },
                  { dir: '-Z', keyHint: '↓' },
                ] as Array<{ dir: AxisDirection; keyHint: string }>
              ).map(({ dir, keyHint }) => {
                const isCurrentDir = ghostCandidate?.direction === dir;
                return (
                  <button
                    key={dir}
                    onClick={() => moveNextBlockCursor(dir)}
                    className={`px-2 py-1.5 rounded-lg border text-xs font-mono flex flex-col items-center justify-center gap-0.5 transition ${
                      isCurrentDir
                        ? 'bg-amber-500/20 border-amber-500 text-amber-200'
                        : 'bg-neutral-900 hover:bg-neutral-800 border-neutral-800 hover:border-amber-500/40 text-neutral-200'
                    }`}
                    title={`Move next block along ${AXIS_DELTAS[dir].label} (${keyHint})`}
                  >
                    <span className="font-bold">{dir}</span>
                    <span className="text-[9px] text-neutral-400">{keyHint}</span>
                  </button>
                );
              })}
            </div>
            <button
              onClick={() => {
                if (ghostCandidate) {
                  addBlockAt(
                    ghostCandidate.x,
                    ghostCandidate.y,
                    ghostCandidate.z,
                    ghostCandidate.direction ?? lastBuildDir
                  );
                }
              }}
              className="w-full py-2 px-3 rounded-lg bg-amber-500 hover:bg-amber-400 text-neutral-950 text-xs font-bold flex items-center justify-center gap-1.5 shadow-md shadow-amber-500/15 transition"
            >
              <Plus className="w-3.5 h-3.5 stroke-[2.5]" />
              <span>Add Next Block</span>
              <kbd className="ml-1 px-1.5 py-0.5 text-[10px] font-mono bg-neutral-950/20 rounded">
                Space
              </kbd>
            </button>

            {/* Shift + Click Weld Plane Toggle Button */}
            <div className="pt-2 border-t border-neutral-800/80 space-y-1.5">
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-neutral-400">Block Face Weld:</span>
                <span className="font-mono text-cyan-300 font-semibold">
                  {WELD_PLANE_LABELS[
                    blockWeldOverrides[
                      hoveredBlockId ?? selectedBlockId ?? blocks[blocks.length - 1]?.id ?? ''
                    ]?.plane ?? 'auto'
                  ]}
                </span>
              </div>
              <button
                onClick={() => handleToggleBlockWeldPlane()}
                className="w-full py-1.5 px-2.5 rounded-lg bg-neutral-900 hover:bg-neutral-800 border border-cyan-500/40 text-cyan-200 text-xs font-medium flex items-center justify-between transition"
                title="Toggle which face/plane of the block visually welds (Shift+Click any block or press W)"
              >
                <span className="flex items-center gap-1.5">
                  <FlipHorizontal2 className="w-3.5 h-3.5 text-cyan-400" />
                  <span>Toggle Weld Plane</span>
                </span>
                <kbd className="px-1.5 py-0.5 text-[10px] font-mono bg-neutral-950 text-cyan-300 rounded border border-neutral-800">
                  ⇧+Click / W
                </kbd>
              </button>
            </div>
          </div>

          {/* Shape Presets Gallery */}
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wider text-neutral-400 mb-2">
              Escher & Penrose Presets
            </div>
            <div className="space-y-1.5">
              {SHAPE_PRESETS.map((preset) => {
                const isSelected = activePresetId === preset.id;
                return (
                  <button
                    key={preset.id}
                    onClick={() => handleLoadPreset(preset)}
                    className={`w-full text-left px-3 py-2.5 rounded-xl border transition flex items-center justify-between ${
                      isSelected
                        ? 'bg-amber-500/15 border-amber-500/50 text-white'
                        : 'bg-neutral-950/60 border-neutral-800/80 text-neutral-300 hover:bg-neutral-800/60 hover:text-white'
                    }`}
                  >
                    <div>
                      <div className="text-xs font-semibold flex items-center gap-1.5">
                        {preset.name}
                      </div>
                      <div className="text-[11px] text-neutral-400">{preset.subtitle}</div>
                    </div>
                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-neutral-900 text-neutral-400 border border-neutral-800">
                      {preset.blocks.length}b
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Bottom Actions: Undo, Redo, Clear */}
        <div className="p-3 border-t border-neutral-800 bg-neutral-950/60 flex items-center justify-between gap-2">
          <div className="flex items-center gap-1">
            <button
              onClick={handleUndo}
              disabled={past.length === 0}
              className="p-2 rounded-lg bg-neutral-900 border border-neutral-800 text-neutral-300 hover:text-white disabled:opacity-35 disabled:pointer-events-none transition"
              title="Undo (Cmd+Z)"
            >
              <Undo2 className="w-4 h-4" />
            </button>
            <button
              onClick={handleRedo}
              disabled={future.length === 0}
              className="p-2 rounded-lg bg-neutral-900 border border-neutral-800 text-neutral-300 hover:text-white disabled:opacity-35 disabled:pointer-events-none transition"
              title="Redo (Cmd+Shift+Z)"
            >
              <Redo2 className="w-4 h-4" />
            </button>
          </div>

          <button
            onClick={() => {
              const starter = { id: `b_${Date.now()}_0`, x: 0, y: 0, z: 0 };
              setActivePresetId('custom');
              commitChange([starter], {}, {});
              centerViewOnBlocks([starter]);
              setSelectedBlockId(starter.id);
              syncKbGhostFromBlock(starter, '+Y');
            }}
            className="flex-1 py-2 px-3 rounded-lg bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-xs font-medium text-neutral-300 hover:text-white flex items-center justify-center gap-1.5 transition"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Reset to 1 Block
          </button>

          <button
            onClick={() => {
              setActivePresetId('empty');
              commitChange([], {}, {});
              setSelectedBlockId(null);
              syncKbGhostFromBlock(undefined);
            }}
            className="p-2 rounded-lg bg-neutral-900 hover:bg-rose-950/60 border border-neutral-800 hover:border-rose-500/40 text-neutral-400 hover:text-rose-300 transition"
            title="Clear Canvas"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </aside>

      {/* CENTER INTERACTIVE ISOMETRIC VIEWPORT */}
      <main className="relative flex-1 h-full overflow-hidden flex flex-col">
        {/* Top Floating HUD Bar */}
        <div className="absolute top-4 left-4 right-4 flex items-center justify-between pointer-events-none z-10">
          {/* Left status pill */}
          <div className="pointer-events-auto flex items-center gap-2 px-3.5 py-2 rounded-xl bg-neutral-900/90 backdrop-blur-md border border-neutral-800 shadow-lg text-xs">
            <span className="flex items-center gap-1.5 font-medium text-neutral-200">
              <Layers className="w-3.5 h-3.5 text-amber-400" />
              {blocks.length} {blocks.length === 1 ? 'Block' : 'Blocks'}
            </span>
            <span className="text-neutral-700">|</span>
            <span className="text-neutral-300">
              {isShiftHeld
                ? '⇧ Shift+Click any block to toggle which block face/plane visually welds'
                : toolMode === 'build'
                  ? ghostCandidate
                    ? ghostCandidate.willEscherConnect
                      ? '⚡ Space (or Click): Escher-weld · ⇧+Click block: Toggle weld plane'
                      : `Arrows: Move (${
                          ghostCandidate.direction ?? 'grid'
                        }) · Space: Add · ⇧+Click: Toggle Weld Plane`
                    : 'Arrows: Move · Space: Add · ⇧+Click: Toggle Weld Plane'
                  : toolMode === 'erase'
                    ? 'Click any block to remove it'
                    : 'Click ⚡ badge or ⇧+Click any block to toggle which face welds'}
            </span>
            {lastWeldBanner && (
              <>
                <span className="text-neutral-700">|</span>
                <span className="px-2 py-0.5 rounded-md bg-cyan-500/20 border border-cyan-500/40 text-cyan-300 font-mono text-[11px]">
                  {lastWeldBanner}
                </span>
              </>
            )}
          </div>

          {/* Right Action & Export Buttons */}
          <div className="pointer-events-auto flex items-center gap-2">
            <button
              onClick={handleOpenSuggestionModal}
              className="px-3 py-2 rounded-xl bg-neutral-900/90 hover:bg-neutral-800 backdrop-blur-md border border-cyan-500/40 text-xs font-medium text-cyan-200 hover:text-white flex items-center gap-1.5 shadow-lg transition"
              title="Open suggestion form to file a GitHub Issue on arussellturner/impossible-shapes"
            >
              <MessageSquarePlus className="w-3.5 h-3.5 text-cyan-400" />
              Offer a Suggestion to Improve This
            </button>
            <button
              onClick={handleExportSvg}
              className="px-3 py-2 rounded-xl bg-neutral-900/90 hover:bg-neutral-800 backdrop-blur-md border border-neutral-800 text-xs font-medium text-neutral-200 flex items-center gap-1.5 shadow-lg transition"
            >
              <Download className="w-3.5 h-3.5 text-amber-400" />
              Export SVG
            </button>
            <button
              onClick={handleExportPng}
              className="px-3 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-neutral-950 text-xs font-semibold flex items-center gap-1.5 shadow-lg shadow-amber-500/20 transition"
            >
              <ImageIcon className="w-3.5 h-3.5" />
              Export PNG
            </button>
          </div>
        </div>

        {/* Interactive SVG Canvas */}
        <svg
          ref={svgRef}
          onMouseMove={handleMouseMove}
          onMouseDown={handleMouseDown}
          onMouseUp={handleMouseUp}
          onClick={handleCanvasClick}
          onContextMenu={handleContextMenu}
          onWheel={handleWheel}
          style={{ backgroundColor: theme.canvasBg }}
          className={`w-full h-full flex-1 transition-colors duration-200 ${
            isPanning
              ? 'cursor-grabbing'
              : isShiftHeld || toolMode === 'erase'
                ? 'cursor-pointer'
                : 'cursor-crosshair'
          }`}
        >
          <g
            transform={`translate(${
              (svgRef.current?.clientWidth ?? window.innerWidth - 600) * 0.5
            }, ${
              (svgRef.current?.clientHeight ?? window.innerHeight) * 0.5
            }) scale(${zoom}) translate(${pan.x}, ${pan.y})`}
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

            {/* 2A. STANDARD ISOMETRIC LOCK MODE (Merged Escher Ribbons) */}
            {Math.abs(peekAmount) <= 0.01 && (
              <>
                {/* Filled Triangles */}
                <g>
                  {scene.triangles.map((tri) => {
                    const fill =
                      tri.faceType === 'X'
                        ? theme.faceX
                        : tri.faceType === 'Y'
                          ? theme.faceY
                          : theme.faceZ;
                    const isHoveredErase =
                      toolMode === 'erase' && hoveredBlockId === tri.blockId;
                    const isHoveredShiftWeld =
                      isShiftHeld && hoveredBlockId === tri.blockId;
                    return (
                      <polygon
                        key={tri.key}
                        points={pointsToSvgPolygon(tri.points)}
                        fill={isHoveredErase ? '#f43f5e' : fill}
                        stroke={
                          isHoveredErase
                            ? '#f43f5e'
                            : isHoveredShiftWeld
                              ? '#06b6d4'
                              : fill
                        }
                        strokeWidth={isHoveredShiftWeld ? 1.8 : 0.65}
                        strokeLinejoin="round"
                        onMouseEnter={() => setHoveredBlockId(tri.blockId)}
                        onClick={(e) => {
                          if (e.shiftKey) {
                            e.stopPropagation();
                            handleToggleBlockWeldPlane(tri.blockId);
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

                {/* Selected Block Subtle Anchor Dot */}
                {selectedBlockId && scene.blockScreenCenters.has(selectedBlockId) && (
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

                {/* Shift-Hover Block Weld Plane Tooltip on Canvas */}
                {isShiftHeld &&
                  hoveredBlockId &&
                  scene.blockScreenCenters.has(hoveredBlockId) && (
                    <g
                      transform={`translate(${
                        scene.blockScreenCenters.get(hoveredBlockId)!.x
                      }, ${scene.blockScreenCenters.get(hoveredBlockId)!.y - 30})`}
                      className="pointer-events-none"
                    >
                      <rect
                        x={-88}
                        y={-12}
                        width={176}
                        height={22}
                        rx={11}
                        fill="#09090b"
                        fillOpacity={0.92}
                        stroke="#06b6d4"
                        strokeWidth={1.5}
                      />
                      <text
                        x={0}
                        y={3}
                        textAnchor="middle"
                        fill="#67e8f9"
                        fontSize={10}
                        fontWeight="bold"
                      >
                        ⇧+Click: {WELD_PLANE_LABELS[blockWeldOverrides[hoveredBlockId]?.plane ?? 'auto']}
                      </text>
                    </g>
                  )}

                {/* Ghost Block Preview in Build Mode */}
                {ghostCandidate && (
                  <g className="pointer-events-none">
                    <polygon
                      points={pointsToSvgPolygon(ghostCandidate.rhombuses.faceX)}
                      fill={theme.faceX}
                      fillOpacity={0.48}
                      stroke={ghostCandidate.willEscherConnect ? '#f59e0b' : '#06b6d4'}
                      strokeWidth={2.0}
                      strokeDasharray={ghostCandidate.willEscherConnect ? undefined : '5 3'}
                    />
                    <polygon
                      points={pointsToSvgPolygon(ghostCandidate.rhombuses.faceY)}
                      fill={theme.faceY}
                      fillOpacity={0.48}
                      stroke={ghostCandidate.willEscherConnect ? '#f59e0b' : '#06b6d4'}
                      strokeWidth={2.0}
                      strokeDasharray={ghostCandidate.willEscherConnect ? undefined : '5 3'}
                    />
                    <polygon
                      points={pointsToSvgPolygon(ghostCandidate.rhombuses.faceZ)}
                      fill={theme.faceZ}
                      fillOpacity={0.62}
                      stroke={ghostCandidate.willEscherConnect ? '#f59e0b' : '#06b6d4'}
                      strokeWidth={2.0}
                      strokeDasharray={ghostCandidate.willEscherConnect ? undefined : '5 3'}
                    />
                    <g
                      transform={`translate(${ghostCandidate.screenCenter.x}, ${
                        ghostCandidate.screenCenter.y - 28
                      })`}
                    >
                      <rect
                        x={ghostCandidate.willEscherConnect ? -68 : -54}
                        y={-12}
                        width={ghostCandidate.willEscherConnect ? 136 : 108}
                        height={22}
                        rx={11}
                        fill={ghostCandidate.willEscherConnect ? '#f59e0b' : '#09090b'}
                        fillOpacity={0.9}
                        stroke={ghostCandidate.willEscherConnect ? '#000' : '#06b6d4'}
                        strokeWidth={1.5}
                      />
                      <text
                        x={0}
                        y={3}
                        textAnchor="middle"
                        fill={ghostCandidate.willEscherConnect ? '#09090b' : '#e0f2fe'}
                        fontSize={10}
                        fontWeight="bold"
                      >
                        {ghostCandidate.willEscherConnect
                          ? '⚡ Escher Weld [Space]'
                          : `Next ${ghostCandidate.direction ?? ''} [Space]`}
                      </text>
                    </g>
                  </g>
                )}

                {/* Interactive Escher Connection Badges */}
                {(showConnectionBadges || toolMode === 'connect') &&
                  scene.connections.map((conn) => {
                    const isNatural = conn.mode === 'natural';
                    const isFlipped = conn.mode === 'flipped';
                    const isDisconnected = conn.mode === 'disconnected';
                    return (
                      <g
                        key={conn.id}
                        transform={`translate(${conn.screenPos.x}, ${conn.screenPos.y})`}
                        onClick={(e) => handleCycleConnection(conn, e)}
                        className="cursor-pointer group"
                      >
                        <circle
                          r={16}
                          fill="transparent"
                          className="group-hover:fill-amber-400/20 transition"
                        />
                        <circle
                          r={10.5}
                          fill={
                            isDisconnected
                              ? '#27272a'
                              : isFlipped
                                ? '#06b6d4'
                                : '#f59e0b'
                          }
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
              </>
            )}

            {/* 2B. 3D ILLUSION PEEK MODE (Reveals true 3D depth separation & Escher tether lines) */}
            {Math.abs(peekAmount) > 0.01 && (
              <g>
                {peekSortedBlocks.map(({ block, rhombuses, depth }) => (
                  <g key={block.id}>
                    <polygon
                      points={pointsToSvgPolygon(rhombuses.faceX)}
                      fill={theme.faceX}
                      stroke={theme.stroke}
                      strokeWidth={1.8}
                      strokeLinejoin="round"
                    />
                    <polygon
                      points={pointsToSvgPolygon(rhombuses.faceY)}
                      fill={theme.faceY}
                      stroke={theme.stroke}
                      strokeWidth={1.8}
                      strokeLinejoin="round"
                    />
                    <polygon
                      points={pointsToSvgPolygon(rhombuses.faceZ)}
                      fill={theme.faceZ}
                      stroke={theme.stroke}
                      strokeWidth={1.8}
                      strokeLinejoin="round"
                    />
                    <text
                      x={rhombuses.faceZ[0].x}
                      y={rhombuses.faceZ[0].y - 6}
                      textAnchor="middle"
                      fontSize={9}
                      fontWeight="bold"
                      fill="#f59e0b"
                    >
                      d={depth}
                    </text>
                  </g>
                ))}

                {/* Dashed Tether Lines showing the 3D gap bridged by each Escher Connection */}
                {scene.connections.map((conn) => {
                  const bA = peekSortedBlocks.find((x) => x.block.id === conn.blockAId);
                  const bB = peekSortedBlocks.find((x) => x.block.id === conn.blockBId);
                  if (!bA || !bB) return null;
                  return (
                    <g key={`tether_${conn.id}`}>
                      <line
                        x1={bA.center.x}
                        y1={bA.center.y}
                        x2={bB.center.x}
                        y2={bB.center.y}
                        stroke="#f59e0b"
                        strokeWidth={2.5}
                        strokeDasharray="6 4"
                      />
                      <circle cx={bA.center.x} cy={bA.center.y} r={5} fill="#f59e0b" />
                      <circle cx={bB.center.x} cy={bB.center.y} r={5} fill="#06b6d4" />
                    </g>
                  );
                })}
              </g>
            )}
          </g>
        </svg>

        {/* Bottom Floating Viewport Controls (Zoom, Fit, 3D Illusion Peek Slider) */}
        <div className="absolute bottom-4 left-4 right-4 flex items-center justify-between pointer-events-none z-10">
          {/* Zoom & Center Controls */}
          <div className="pointer-events-auto flex items-center gap-1 p-1 rounded-xl bg-neutral-900/90 backdrop-blur-md border border-neutral-800 shadow-lg">
            <button
              onClick={() => setZoom((z) => Math.max(0.35, z * 0.85))}
              className="p-2 rounded-lg text-neutral-300 hover:text-white hover:bg-neutral-800 transition"
              title="Zoom Out"
            >
              <ZoomOut className="w-4 h-4" />
            </button>
            <span className="px-2 text-xs font-mono text-neutral-300 min-w-[52px] text-center">
              {Math.round(zoom * 100)}%
            </span>
            <button
              onClick={() => setZoom((z) => Math.min(3.0, z * 1.15))}
              className="p-2 rounded-lg text-neutral-300 hover:text-white hover:bg-neutral-800 transition"
              title="Zoom In"
            >
              <ZoomIn className="w-4 h-4" />
            </button>
            <div className="w-px h-4 bg-neutral-800 mx-0.5" />
            <button
              onClick={() => {
                setZoom(1.05);
                centerViewOnBlocks(blocks);
              }}
              className="px-2.5 py-1.5 rounded-lg text-xs font-medium text-neutral-300 hover:text-white hover:bg-neutral-800 flex items-center gap-1 transition"
              title="Center View"
            >
              <Maximize2 className="w-3.5 h-3.5" />
              Center
            </button>
          </div>

          {/* 3D Illusion Peek Slider ("Break the Illusion" Inspector) */}
          <div className="pointer-events-auto flex items-center gap-3 px-4 py-2 rounded-xl bg-neutral-900/95 backdrop-blur-md border border-neutral-800 shadow-lg">
            <div className="flex items-center gap-1.5">
              <Eye className="w-4 h-4 text-amber-400" />
              <span className="text-xs font-semibold text-neutral-200">
                Inspect 3D Depth Illusion:
              </span>
            </div>
            <input
              type="range"
              min={-1}
              max={1}
              step={0.02}
              value={peekAmount}
              onChange={(e) => setPeekAmount(parseFloat(e.target.value))}
              className="w-32 accent-amber-500 cursor-pointer"
            />
            {Math.abs(peekAmount) > 0.01 ? (
              <button
                onClick={() => setPeekAmount(0)}
                className="px-2.5 py-1 rounded-lg bg-amber-500 text-neutral-950 text-xs font-bold hover:bg-amber-400 transition"
              >
                Lock Isometric
              </button>
            ) : (
              <span className="text-[11px] font-mono text-emerald-400">
                Isometric Locked
              </span>
            )}
          </div>
        </div>
      </main>

      {/* RIGHT SIDEBAR: Style, Orientation & Active Escher Connections Inspector */}
      <aside className="w-72 flex-shrink-0 border-l border-neutral-800/80 bg-neutral-900/90 backdrop-blur-md flex flex-col justify-between z-20 overflow-y-auto">
        <div className="p-4 space-y-5">
          {/* Isometric Projection Orientation */}
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wider text-neutral-400 mb-2">
              Isometric Axis Orientation
            </div>
            <div className="grid grid-cols-2 gap-1.5 p-1 bg-neutral-950 rounded-xl border border-neutral-800">
              <button
                onClick={() => {
                  setOrientation('penrose-horizontal');
                  centerViewOnBlocks(blocks, 'penrose-horizontal');
                }}
                className={`py-2 px-2.5 rounded-lg text-xs font-medium transition ${
                  orientation === 'penrose-horizontal'
                    ? 'bg-neutral-800 text-white shadow font-semibold border border-neutral-700'
                    : 'text-neutral-400 hover:text-white'
                }`}
              >
                Penrose (0°/60°)
              </button>
              <button
                onClick={() => {
                  setOrientation('isometric-vertical');
                  centerViewOnBlocks(blocks, 'isometric-vertical');
                }}
                className={`py-2 px-2.5 rounded-lg text-xs font-medium transition ${
                  orientation === 'isometric-vertical'
                    ? 'bg-neutral-800 text-white shadow font-semibold border border-neutral-700'
                    : 'text-neutral-400 hover:text-white'
                }`}
              >
                Vertical (30°/90°)
              </button>
            </div>
          </div>

          {/* Display Toggles */}
          <div className="space-y-2">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-neutral-400">
              Rendering & Overlays
            </div>

            <button
              onClick={() => setShowVoxelSeams((s) => !s)}
              className="w-full px-3 py-2 rounded-xl bg-neutral-950/70 hover:bg-neutral-950 border border-neutral-800 flex items-center justify-between text-xs transition"
            >
              <span className="flex items-center gap-2 text-neutral-200">
                <Box className="w-3.5 h-3.5 text-amber-400" />
                Show Voxel Block Seams
              </span>
              <span
                className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${
                  showVoxelSeams
                    ? 'bg-amber-500/20 text-amber-300'
                    : 'bg-neutral-800 text-neutral-400'
                }`}
              >
                {showVoxelSeams ? 'ON' : 'MERGED'}
              </span>
            </button>

            <button
              onClick={() => setShowGrid((g) => !g)}
              className="w-full px-3 py-2 rounded-xl bg-neutral-950/70 hover:bg-neutral-950 border border-neutral-800 flex items-center justify-between text-xs transition"
            >
              <span className="flex items-center gap-2 text-neutral-200">
                <Grid className="w-3.5 h-3.5 text-cyan-400" />
                Isometric Guide Grid
              </span>
              <span
                className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${
                  showGrid
                    ? 'bg-cyan-500/20 text-cyan-300'
                    : 'bg-neutral-800 text-neutral-400'
                }`}
              >
                {showGrid ? 'ON' : 'OFF'}
              </span>
            </button>

            <button
              onClick={() => setShowConnectionBadges((b) => !b)}
              className="w-full px-3 py-2 rounded-xl bg-neutral-950/70 hover:bg-neutral-950 border border-neutral-800 flex items-center justify-between text-xs transition"
            >
              <span className="flex items-center gap-2 text-neutral-200">
                <Zap className="w-3.5 h-3.5 text-amber-400" />
                Show ⚡ Weld Badges
              </span>
              <span
                className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${
                  showConnectionBadges
                    ? 'bg-amber-500/20 text-amber-300'
                    : 'bg-neutral-800 text-neutral-400'
                }`}
              >
                {showConnectionBadges ? 'VISIBLE' : 'HIDDEN'}
              </span>
            </button>

            {/* Outline Thickness */}
            <div className="p-3 rounded-xl bg-neutral-950/70 border border-neutral-800 space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="text-neutral-300">Line Art Stroke Weight</span>
                <span className="font-mono text-neutral-400">{strokeWidth.toFixed(1)}px</span>
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
          </div>

          {/* Color Themes */}
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wider text-neutral-400 mb-2 flex items-center gap-1.5">
              <Palette className="w-3.5 h-3.5 text-amber-400" />
              Shading Palette
            </div>
            <div className="space-y-1.5">
              {COLOR_THEMES.map((t) => {
                const active = theme.id === t.id;
                return (
                  <button
                    key={t.id}
                    onClick={() => setTheme(t)}
                    className={`w-full px-3 py-2 rounded-xl border text-left transition flex items-center justify-between ${
                      active
                        ? 'bg-neutral-800 border-amber-500/50 text-white'
                        : 'bg-neutral-950/60 border-neutral-800 text-neutral-300 hover:bg-neutral-800/50'
                    }`}
                  >
                    <span className="text-xs font-medium">{t.name}</span>
                    <div className="flex items-center gap-1">
                      <span
                        className="w-3.5 h-3.5 rounded-full border border-neutral-600"
                        style={{ backgroundColor: t.faceZ }}
                      />
                      <span
                        className="w-3.5 h-3.5 rounded-full border border-neutral-600"
                        style={{ backgroundColor: t.faceX }}
                      />
                      <span
                        className="w-3.5 h-3.5 rounded-full border border-neutral-600"
                        style={{ backgroundColor: t.faceY }}
                      />
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Active Escher Connections List */}
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wider text-neutral-400 mb-2 flex items-center justify-between">
              <span>Impossible Connections</span>
              <span className="font-mono text-amber-400">{scene.connections.length}</span>
            </div>
            {scene.connections.length === 0 ? (
              <div className="p-3 rounded-xl bg-neutral-950/50 border border-neutral-800/80 text-xs text-neutral-400 leading-relaxed">
                No impossible connections yet. Build a 3-axis loop (extend along X, Y, and Z) until
                two ends visually meet!
              </div>
            ) : (
              <div className="space-y-1.5">
                {scene.connections.map((conn, idx) => (
                  <div
                    key={conn.id}
                    className="p-2.5 rounded-xl bg-neutral-950/80 border border-neutral-800 flex items-center justify-between gap-2"
                  >
                    <div>
                      <div className="text-xs font-semibold text-neutral-200 flex items-center gap-1.5">
                        <span className="text-amber-400">#{idx + 1}</span>
                        <span>
                          {conn.kind === 'adjacent'
                            ? `${conn.direction} Escher Weld`
                            : 'Beam Crossing'}
                        </span>
                      </div>
                      <div className="text-[10px] text-neutral-400 font-mono">
                        Depth gap: Δk = {conn.depthGap} ·{' '}
                        <span
                          className={
                            conn.mode === 'natural'
                              ? 'text-amber-300'
                              : conn.mode === 'flipped'
                                ? 'text-cyan-300'
                                : 'text-neutral-500'
                          }
                        >
                          {conn.mode.toUpperCase()}
                        </span>
                      </div>
                    </div>
                    <button
                      onClick={() => handleCycleConnection(conn)}
                      className="px-2.5 py-1.5 rounded-lg bg-neutral-900 hover:bg-neutral-800 border border-neutral-700 text-xs font-medium text-neutral-200 flex items-center gap-1 transition"
                      title="Cycle connection mode (Natural -> Flipped -> Disconnected)"
                    >
                      {conn.mode === 'disconnected' ? (
                        <>
                          <Unlink2 className="w-3.5 h-3.5 text-neutral-400" />
                          <span>Off</span>
                        </>
                      ) : conn.mode === 'flipped' ? (
                        <>
                          <FlipHorizontal2 className="w-3.5 h-3.5 text-cyan-400" />
                          <span>Flip</span>
                        </>
                      ) : (
                        <>
                          <Link2 className="w-3.5 h-3.5 text-amber-400" />
                          <span>Weld</span>
                        </>
                      )}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right Sidebar Footer: Offer a Suggestion */}
        <div className="p-3 border-t border-neutral-800 bg-neutral-950/60">
          <button
            onClick={handleOpenSuggestionModal}
            className="w-full py-2.5 px-3 rounded-xl bg-gradient-to-r from-cyan-500/20 to-amber-500/20 hover:from-cyan-500/30 hover:to-amber-500/30 border border-cyan-500/40 text-xs font-semibold text-cyan-200 hover:text-white flex items-center justify-center gap-2 shadow-md transition"
          >
            <MessageSquarePlus className="w-4 h-4 text-cyan-400" />
            <span>Offer a Suggestion to Improve This</span>
          </button>
        </div>
      </aside>

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
                <strong>1. Building in 3D:</strong> Hover near any existing block to preview a new
                block along any of its 6 isometric directions (
                <code className="text-amber-300 font-mono">+X, -X, +Y, -Y, +Z, -Z</code>), or use
                the <strong>3D Axis Step Builder</strong> pad in the left sidebar.
              </p>
              <p>
                <strong>2. Automatic Escher Welds (⚡):</strong> Whenever a newly placed block
                visually touches another block at a different 3D depth, EscherCAD automatically
                welds them together—merging their coplanar faces and weaving their local depth order
                to create seamless M.C. Escher &amp; Penrose illusions.
              </p>
              <p>
                <strong>3. Flip or Break the Illusion:</strong> Click any{' '}
                <span className="text-amber-400 font-semibold">⚡ weld badge</span> on the canvas to
                flip which beam passes in front or unmerge the joint, or{' '}
                <span className="text-cyan-300 font-semibold">Shift + Click</span> any block to
                change which face plane welds. Drag the{' '}
                <strong>Inspect 3D Depth Illusion</strong> slider at the bottom to tilt the camera
                and see the secret 3D depth gap!
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
