export interface VoxelBlock {
  id: string;
  x: number;
  y: number;
  z: number;
}

export type PositiveAxis = 'X' | 'Y' | 'Z';

export type AxisDirection = '+X' | '-X' | '+Y' | '-Y' | '+Z' | '-Z';

export type FaceType = 'X' | 'Y' | 'Z';

export type BlockWeldPlane = 'auto' | 'X' | 'Y' | 'Z' | 'front' | 'back';

export interface BlockWeldOverride {
  plane: BlockWeldPlane;
  order: number;
}

export type ConnectionMode = 'natural' | 'flipped' | 'disconnected';

export interface EscherConnection {
  id: string;
  blockAId: string;
  blockBId: string;
  kind: 'adjacent' | 'crossing';
  /** Normalized positive axis direction from blockA to blockB for 'adjacent' welds */
  direction?: '+X' | '+Y' | '+Z';
  /** Depth difference in 3D ray units */
  depthGap: number;
  mode: ConnectionMode;
  /** 2D SVG coordinates for the interactive connection badge */
  screenPos: { x: number; y: number };
}

export type ViewOrientation = 'penrose-horizontal' | 'isometric-vertical';

export interface ColorTheme {
  id: string;
  name: string;
  description: string;
  faceX: string; // Left / Gray in classic Penrose
  faceY: string; // Bottom / Black in classic Penrose
  faceZ: string; // Top-Right / White in classic Penrose
  stroke: string;
  canvasBg: string;
  gridLine: string;
}

export interface ShapePreset {
  id: string;
  name: string;
  subtitle: string;
  orientation?: ViewOrientation;
  blocks: Array<{ x: number; y: number; z: number }>;
  /** Optional explicit overrides for connections (keyed by canonical pair or coords) */
  connectionOverrides?: Record<string, ConnectionMode>;
}

export type ToolMode = 'build' | 'erase' | 'connect';
