// Tool catalog and footprints.
import type { DrillFootprint, RectFootprint, TailstockToolId, ToolId } from './types';

export interface ToolInfo {
  id: ToolId;
  name: string;
  description: string;
  /** true for tools that are a stretch goal */
  optional?: boolean;
}

export interface TailstockToolInfo {
  id: TailstockToolId;
  name: string;
  description: string;
  /** length from the quill face to the tip */
  length: number;
  /** cutting radius (drills) or body radius (live center) */
  radius: number;
  /** removes material when the spindle runs */
  cuts: boolean;
}

export const TURNING_TOOL_WIDTH = 0.25;
export const PARTING_BLADE_WIDTH = 0.0625;
/** Extra width of the parting blade holder on the chuck side, used only for jaw crash checks. */
export const PARTING_HOLDER_CLEARANCE = 0.0625;
export const BORING_BAR_WIDTH = 0.125;
export const BORING_BAR_LENGTH = 1.5;
/** The boring bar needs a hole at least this big (radius) to work in: a 3/16" hole or larger. */
export const BORING_MIN_BORE_RADIUS = 0.09;

export const TOOLS: Record<ToolId, ToolInfo> = {
  none: { id: 'none', name: 'No tool', description: 'Nothing mounted in the toolpost.' },
  turning: {
    id: 'turning',
    name: 'Turning tool',
    description: 'Right-hand turning and facing tool. Cuts toward the chuck and across the face.',
  },
  parting: {
    id: 'parting',
    name: 'Parting tool',
    description: 'Thin 1/16" blade for cutting grooves and parting off finished parts.',
  },
  boring: {
    id: 'boring',
    name: 'Boring bar',
    description: 'Small boring bar for opening up a drilled hole from the inside.',
    optional: true,
  },
};

export const TAILSTOCK_TOOLS: Record<TailstockToolId, TailstockToolInfo> = {
  none: { id: 'none', name: 'Empty', description: 'Nothing in the tailstock.', length: 0, radius: 0, cuts: false },
  'center-drill': {
    id: 'center-drill',
    name: 'Center drill',
    description: 'Short, stiff drill that starts a hole exactly on center.',
    length: 1.5,
    radius: 0.0625,
    cuts: true,
  },
  'drill-1/8': {
    id: 'drill-1/8',
    name: '1/8" drill',
    description: 'Jobber drill, 0.125" diameter.',
    length: 2.5,
    radius: 0.0625,
    cuts: true,
  },
  'drill-1/4': {
    id: 'drill-1/4',
    name: '1/4" drill',
    description: 'Jobber drill, 0.250" diameter.',
    length: 2.5,
    radius: 0.125,
    cuts: true,
  },
  'live-center': {
    id: 'live-center',
    name: 'Live center',
    description: 'Spinning center that supports the end of long work. Never cuts.',
    length: 2.0,
    radius: 0.2,
    cuts: false,
  },
};

export const TOOL_IDS = Object.keys(TOOLS) as ToolId[];
export const TAILSTOCK_TOOL_IDS = Object.keys(TAILSTOCK_TOOLS) as TailstockToolId[];

/** Region the toolpost tool removes material from, or null if nothing is mounted. */
export function toolFootprint(tool: ToolId, x: number, z: number): RectFootprint | null {
  switch (tool) {
    case 'turning':
      return { kind: 'rect', xMin: x, xMax: Infinity, zMin: z, zMax: z + TURNING_TOOL_WIDTH };
    case 'parting':
      return { kind: 'rect', xMin: x, xMax: Infinity, zMin: z, zMax: z + PARTING_BLADE_WIDTH };
    case 'boring':
      return { kind: 'rect', internal: true, xMin: x - BORING_BAR_WIDTH, xMax: x, zMin: z, zMax: z + BORING_BAR_LENGTH };
    case 'none':
      return null;
  }
}

/** Region the toolpost tool (with its holder) occupies for crash checks. */
export function crashEnvelope(tool: ToolId, x: number, z: number): RectFootprint | null {
  const fp = toolFootprint(tool, x, z);
  if (!fp) return null;
  if (tool === 'parting') return { ...fp, zMin: fp.zMin - PARTING_HOLDER_CLEARANCE };
  return fp;
}

/** Drill tip Z for a tailstock tool given the quill extension. */
export function tailstockTipZ(tool: TailstockToolId, tailstockZ: number, quill: number): number {
  return tailstockZ - quill - TAILSTOCK_TOOLS[tool].length;
}

/** Cutting footprint of the tailstock tool, or null if it does not cut. */
export function tailstockFootprint(tool: TailstockToolId, tipZ: number): DrillFootprint | null {
  const info = TAILSTOCK_TOOLS[tool];
  if (!info.cuts) return null;
  return { kind: 'drill', radius: info.radius, tipZ, tipAngleDeg: 118 };
}
