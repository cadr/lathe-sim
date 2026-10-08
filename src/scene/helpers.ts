// Pure helpers for the 3D scene: coordinate mapping, handwheel angles, poses and
// workpiece geometry. No React here, so everything is unit tested under node/jsdom.
//
// Scene conventions (1 scene unit = 1 inch):
//   scene +X = machine +Z (along the spindle, toward the tailstock; headstock on the left)
//   scene +Y = up; the spindle axis is at y = 0
//   scene +Z = machine +X (radius) on the operator's side, so the tool sits between
//              the work and the camera.
import * as THREE from 'three';
import { MACHINE, TAILSTOCK_TOOLS } from '../engine';
import type { CameraPreset, LatheState, Material, TailstockToolId, ToolId, Workpiece } from '../engine';

export type Vec3 = [number, number, number];

/** Height of the bed ways below the spindle axis (7" swing => 3.5" centre height). */
export const CENTER_HEIGHT = 3.5;
/** Y of the top of the bed ways. */
export const WAYS_TOP_Y = -CENTER_HEIGHT;
/** Bed extent along scene X (machine Z). */
export const BED_X_MIN = -10.5;
export const BED_X_MAX = 13;
/** Total width of the bed across the ways (scene Z). */
export const BED_WIDTH = 3.5;
export const BED_DEPTH = 2.2;
/** Y of the floor of the chip tray (where parted pieces land). */
export const CHIP_TRAY_Y = -7.2;
/** Chuck dimensions (scene units = inches). */
export const CHUCK_BODY_RADIUS = MACHINE.chuckBodyRadius;
export const CHUCK_BODY_LENGTH = 1.25;
/** Default jaw grip radius when no stock is loaded. */
export const EMPTY_JAW_RADIUS = 0.25;
/** Duration of the parted-piece fall animation, seconds. */
export const PART_FALL_DURATION = 0.6;
/** Frame dt clamp for the simulation tick. */
export const MAX_FRAME_DT = 0.05;

/** Machine (x = radius, z = along spindle) → scene position at centre height. */
export function toScene(x: number, z: number, y = 0): Vec3 {
  return [z, y, x];
}

/** Scene position → machine {x, z}. Inverse of toScene. */
export function fromScene(p: Vec3): { x: number; z: number } {
  return { x: p[2], z: p[0] };
}

/**
 * Clockwise rotation (radians) of a handwheel that has moved its slide `position`
 * inches with `pitch` inches per revolution. Callers apply the sign that turns
 * "clockwise as seen by the operator" into a rotation about their own axis.
 */
export function handwheelAngle(position: number, pitch: number): number {
  if (pitch === 0) return 0;
  return (position / pitch) * Math.PI * 2;
}

/** Clockwise handwheel angles for each axis, matching DESIGN.md §4 sign conventions. */
export function handwheelAngles(state: Pick<LatheState, 'x' | 'z' | 'quill'>): { x: number; z: number; quill: number } {
  return {
    // clockwise moves the cross-slide toward centre (−x)
    x: handwheelAngle(-state.x, MACHINE.xHandwheelPitch),
    // clockwise moves the carriage toward the tailstock (+z)
    z: handwheelAngle(state.z, MACHINE.zHandwheelPitch),
    // clockwise advances the quill (+q)
    quill: handwheelAngle(state.quill, MACHINE.quillPitch),
  };
}

/** Largest outer radius of stock inside the jaws (z ∈ [−jawLength, 0]). */
export function gripRadius(wp: Workpiece): number {
  let r = 0;
  const n = wp.outer.length;
  for (let i = 0; i < n; i++) {
    const zc = wp.zStart + (i + 0.5) * wp.dz;
    if (zc < -MACHINE.chuckJawLength || zc > 0) continue;
    const outer = wp.outer[i];
    if (outer > wp.inner[i] && outer > r) r = outer;
  }
  return r;
}

/** Radial position of the jaw gripping face: the stock radius, or 0.25 with no stock. */
export function jawRadius(state: Pick<LatheState, 'workpiece'>): number {
  const wp = state.workpiece;
  if (!wp) return EMPTY_JAW_RADIUS;
  const r = gripRadius(wp);
  return r > 0 ? r : EMPTY_JAW_RADIUS;
}

/**
 * Position of the tool tip relative to the toolpost origin (centre of the tool slot
 * floor), in scene coordinates. The carriage assembly is placed so the tip lands on
 * the machine (x, z), so different tools put the toolpost in slightly different places,
 * just like a real lathe.
 */
export function toolTipOffset(tool: ToolId): Vec3 {
  switch (tool) {
    // tools sit in the chuck-side slot of the 4-way post (post-relative x ∈ [−0.75, −0.375])
    // the blade holder sits further out of the post, so the blade stands well clear of it
    case 'parting':
      return [-0.44, 0.375, -2.0];
    case 'boring':
      return [-2.2625, 0.375, -0.75];
    case 'turning':
    case 'none':
      return [-0.75, 0.375, -1.5];
  }
}

/** Toolpost origin in scene coordinates for a tool tip at machine (x, z). */
export function toolpostPosition(tool: ToolId, x: number, z: number): Vec3 {
  const tip = toScene(x, z);
  const off = toolTipOffset(tool);
  return [tip[0] - off[0], tip[1] - off[1], tip[2] - off[2]];
}

/** Scene X of the quill face (where the tailstock tool is held). */
export function quillFaceX(tailstockZ: number, quill: number): number {
  return tailstockZ - quill;
}

/** Scene X of the tailstock tool tip (machine tailstockTipZ). */
export function tailstockToolTipX(tool: TailstockToolId, tailstockZ: number, quill: number): number {
  return tailstockZ - quill - TAILSTOCK_TOOLS[tool].length;
}

export interface CameraPose {
  position: Vec3;
  target: Vec3;
}

export const CAMERA_PRESETS: Record<CameraPreset, CameraPose> = {
  overview: { position: [4, 8.5, 23], target: [0.5, -2.2, 0] },
  // front-right of the tip and a little above it, looking down past the toolpost cap at the
  // cutting edge (framed for TOOL_PRESET_TIP; cameraPresetFor shifts it with the tool)
  tool: { position: [2.9, 1.95, 3.6], target: [0.85, 0.15, 0.25] },
  chuck: { position: [2.6, 2.2, 4.6], target: [-0.3, -0.2, 0] },
  tailstock: { position: [5.8, 2.6, 6.4], target: [3.2, -0.4, 0] },
};

export const CAMERA_PRESET_NAMES = Object.keys(CAMERA_PRESETS) as CameraPreset[];

/** Tool tip (machine x, z) that CAMERA_PRESETS.tool is framed around. */
export const TOOL_PRESET_TIP = { x: 0.5, z: 1.0 };

/**
 * Camera pose for a preset; unknown names fall back to the overview. Returns a fresh copy.
 * With `tip` (machine x, z of the tool tip), the 'tool' preset is shifted to follow the tool.
 */
export function cameraPresetFor(name: CameraPreset | string, tip?: { x: number; z: number }): CameraPose {
  const p = (CAMERA_PRESETS as Record<string, CameraPose | undefined>)[name] ?? CAMERA_PRESETS.overview;
  const out: CameraPose = { position: [...p.position], target: [...p.target] };
  if (name === 'tool' && tip) {
    const dx = tip.z - TOOL_PRESET_TIP.z;
    const dz = Math.max(0, tip.x) - TOOL_PRESET_TIP.x;
    out.position[0] += dx;
    out.target[0] += dx;
    out.position[2] += dz;
    out.target[2] += dz;
  }
  return out;
}

export interface Box3 {
  min: Vec3;
  max: Vec3;
}

/**
 * Rough boxes around the 4-way toolpost for a tool tip at machine (x, z), in scene coordinates:
 * the block with its clamp bolts, the clamp handle in the middle, and the lever's ball. Used to
 * check that the tool camera sees the tip (see `parts/Compound.tsx` for the real shapes).
 */
export function toolpostBounds(tool: ToolId, x: number, z: number): Box3[] {
  const [px, py, pz] = toolpostPosition(tool, x, z);
  const half = 0.75;
  const cap = py + 0.39 + 0.3;
  // lever: 0.9 long, turned −0.8 rad about Y from +X, so it points toward the operator's right
  const bx = px + 0.9 * Math.cos(0.8);
  const bz = pz + 0.9 * Math.sin(0.8);
  return [
    { min: [px - half, py - 0.575, pz - half], max: [px + half, cap + 0.14, pz + half] },
    { min: [px - 0.2, cap, pz - 0.2], max: [px + 0.2, cap + 0.45, pz + 0.2] },
    { min: [bx - 0.15, cap + 0.25, bz - 0.15], max: [bx + 0.15, cap + 0.55, bz + 0.15] },
  ];
}

/** Whether the segment a→b passes through the axis-aligned box (slab test). */
export function segmentHitsBox(a: Vec3, b: Vec3, box: Box3): boolean {
  let t0 = 0;
  let t1 = 1;
  for (let k = 0; k < 3; k++) {
    const d = b[k] - a[k];
    if (Math.abs(d) < 1e-12) {
      if (a[k] < box.min[k] || a[k] > box.max[k]) return false;
      continue;
    }
    let ta = (box.min[k] - a[k]) / d;
    let tb = (box.max[k] - a[k]) / d;
    if (ta > tb) [ta, tb] = [tb, ta];
    t0 = Math.max(t0, ta);
    t1 = Math.min(t1, tb);
    if (t0 > t1) return false;
  }
  return true;
}

export interface Pose {
  position: Vec3;
  /** Euler XYZ, radians */
  rotation: Vec3;
}

/**
 * Where the `index`-th parted piece rests in the chip tray (front of the bed, under
 * the work). Pieces are laid side by side along the tray so several stay visible.
 */
export function partedPieceRestPose(index: number, radius = 0.5): Pose {
  const i = Math.max(0, Math.floor(index));
  const col = i % 6;
  const row = Math.floor(i / 6) % 2;
  const yaw = ((i * 37) % 7) / 7 - 0.5; // deterministic small yaw in [-0.5, 0.36]
  return {
    position: [1.5 + col * 1.3, CHIP_TRAY_Y + radius, BED_WIDTH / 2 + 2.1 + row * 0.8],
    rotation: [0, yaw * 0.6, 0],
  };
}

/** Ease-in (gravity-like) progress for the fall animation, t in seconds since parting. */
export function fallProgress(t: number, duration = PART_FALL_DURATION): number {
  if (duration <= 0) return 1;
  const u = Math.min(1, Math.max(0, t / duration));
  return u * u;
}

/** Linear interpolation between two poses (u in [0,1]) into `out`. */
export function lerpPose(from: Pose, to: Pose, u: number, out: Pose): Pose {
  for (let k = 0; k < 3; k++) {
    out.position[k] = from.position[k] + (to.position[k] - from.position[k]) * u;
    out.rotation[k] = from.rotation[k] + (to.rotation[k] - from.rotation[k]) * u;
  }
  return out;
}

/** Centre of a workpiece's material along machine Z, and its max outer radius. */
export function workpieceExtent(wp: Workpiece): { zMin: number; zMax: number; center: number; radius: number } | null {
  let a = -1;
  let b = -1;
  let r = 0;
  for (let i = 0; i < wp.outer.length; i++) {
    if (wp.outer[i] > wp.inner[i]) {
      if (a < 0) a = i;
      b = i;
      if (wp.outer[i] > r) r = wp.outer[i];
    }
  }
  if (a < 0) return null;
  const zMin = wp.zStart + a * wp.dz;
  const zMax = wp.zStart + (b + 1) * wp.dz;
  return { zMin, zMax, center: (zMin + zMax) / 2, radius: r };
}

/** Number of radial segments for workpiece geometry. */
export const LATHE_SEGMENTS = 64;

/**
 * Builds a THREE.LatheGeometry from a closed profile (x = radius, y = machine z).
 *
 * The profile has sharp shoulders, and LatheGeometry averages normals across
 * corners, which smears the shading of every face. So each profile segment gets its
 * own pair of points (corners are duplicated) and the normals are rewritten so each
 * band is flat in profile and smooth around the axis. UVs: u wraps 3 times around,
 * v follows the profile arc length (2 repeats per inch) so the texture never stretches.
 *
 * Vertex layout matches LatheGeometry: (segments + 1) meridians × expanded.length,
 * where expanded.length = 2 × (points.length − 1).
 */
export function latheGeometryFromPoints(
  points: { x: number; y: number }[],
  segments = LATHE_SEGMENTS,
  yOffset = 0,
): THREE.LatheGeometry {
  if (points.length < 2) return new THREE.LatheGeometry([], segments);
  const expanded: THREE.Vector2[] = [];
  const segNormals: number[] = [];
  const arc: number[] = [];
  let len = 0;
  for (let k = 0; k < points.length - 1; k++) {
    const p = points[k];
    const q = points[k + 1];
    const dx = q.x - p.x;
    const dy = q.y - p.y;
    const l = Math.hypot(dx, dy);
    expanded.push(new THREE.Vector2(Math.max(0, p.x), p.y + yOffset), new THREE.Vector2(Math.max(0, q.x), q.y + yOffset));
    if (l > 1e-12) segNormals.push(dy / l, -dx / l);
    else segNormals.push(1, 0);
    arc.push(len, len + l);
    len += l;
  }
  const geo = new THREE.LatheGeometry(expanded, segments);
  const n = expanded.length;
  const normal = geo.getAttribute('normal') as THREE.BufferAttribute;
  const uv = geo.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i <= segments; i++) {
    const phi = (i / segments) * Math.PI * 2;
    const sin = Math.sin(phi);
    const cos = Math.cos(phi);
    for (let j = 0; j < n; j++) {
      const seg = j >> 1;
      const nr = segNormals[seg * 2];
      const ny = segNormals[seg * 2 + 1];
      const idx = i * n + j;
      normal.setXYZ(idx, nr * sin, ny, nr * cos);
      uv.setXY(idx, (i / segments) * 3, arc[j] * 2);
    }
  }
  normal.needsUpdate = true;
  uv.needsUpdate = true;
  geo.computeBoundingSphere();
  return geo;
}

export interface MaterialLook {
  color: string;
  metalness: number;
  roughness: number;
}

/** PBR parameters for each stock material. */
export const MATERIAL_LOOKS: Record<Material, MaterialLook> = {
  brass: { color: '#e0b553', metalness: 1, roughness: 0.28 },
  aluminum: { color: '#d3d7dc', metalness: 1, roughness: 0.32 },
  steel: { color: '#aeb5bd', metalness: 0.85, roughness: 0.4 },
  delrin: { color: '#f1eee4', metalness: 0, roughness: 0.55 },
};

/** Chip colours: a touch darker/warmer than the stock so they read against it. */
export const CHIP_COLORS: Record<Material, string> = {
  brass: '#e8bf5a',
  aluminum: '#e2e5e9',
  steel: '#6f6a74',
  delrin: '#fbfaf4',
};

export function materialLookFor(material: Material): MaterialLook {
  return MATERIAL_LOOKS[material];
}

/** Maximum number of live chip particles. */
export const MAX_CHIPS = 200;

/**
 * Number of chips to spawn this frame while cutting. Scales with rpm (busier at speed),
 * at least 1, and an accumulator carries the fractional part between frames.
 */
export function chipSpawnCount(dt: number, rpm: number, carry: { value: number }): number {
  const rate = 40 + Math.min(2000, Math.max(0, rpm)) * 0.08; // chips per second
  carry.value += rate * Math.max(0, dt);
  const n = Math.floor(carry.value);
  carry.value -= n;
  return n;
}
