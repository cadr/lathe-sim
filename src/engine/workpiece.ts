// Workpiece model: a solid of revolution sampled along Z, plus pure helpers.
import { MACHINE, type Footprint, type ProfileSegment, type StockSpec, type Workpiece } from './types';

const EPS = 1e-9;
const DRILL_HALF_ANGLE_TAN = Math.tan((59 * Math.PI) / 180); // 118 deg included angle

export function sampleCount(wp: Workpiece): number {
  return wp.outer.length;
}

/** Center Z of sample i. */
export function sampleZ(wp: Workpiece, i: number): number {
  return wp.zStart + (i + 0.5) * wp.dz;
}

export function isGone(wp: Workpiece, i: number): boolean {
  return wp.outer[i] <= wp.inner[i] + EPS;
}

export function createStock(spec: StockSpec): Workpiece {
  if (!(spec.diameter > 0) || !(spec.length > 0)) {
    throw new Error('Stock diameter and length must be positive');
  }
  if (spec.stickOut < 0 || spec.stickOut > spec.length) {
    throw new Error('Stick-out must be between 0 and the stock length');
  }
  const dz = MACHINE.sampleDz;
  const n = Math.max(1, Math.round(spec.length / dz));
  const zEnd = spec.stickOut;
  const zStart = zEnd - n * dz;
  const outer = new Float64Array(n).fill(spec.diameter / 2);
  const inner = new Float64Array(n);
  return { material: spec.material, zStart, zEnd, dz, outer, inner };
}

export function cloneWorkpiece(wp: Workpiece): Workpiece {
  return { ...wp, outer: Float64Array.from(wp.outer), inner: Float64Array.from(wp.inner) };
}

/** Radius of the footprint's solid at height z for a drill; rect handled separately. */
export function drillRadiusAt(fp: { radius: number; tipZ: number }, z: number): number {
  if (z < fp.tipZ) return 0;
  return Math.min(fp.radius, (z - fp.tipZ) * DRILL_HALF_ANGLE_TAN);
}

/** Index range [i0, i1] of samples whose centers fall inside [zMin, zMax] (may be empty: i0 > i1). */
export function sampleRange(wp: Workpiece, zMin: number, zMax: number): [number, number] {
  const n = wp.outer.length;
  const i0 = Math.max(0, Math.ceil((zMin - wp.zStart) / wp.dz - 0.5 - EPS));
  const i1 = Math.min(n - 1, Math.floor((zMax - wp.zStart) / wp.dz - 0.5 + EPS));
  return [i0, i1];
}

function footprintZRange(wp: Workpiece, fp: Footprint): [number, number] {
  if (fp.kind === 'rect') return sampleRange(wp, fp.zMin, fp.zMax);
  return sampleRange(wp, fp.tipZ, Infinity);
}

const maxOuterCache = new WeakMap<Workpiece, number>();

/** Largest outer radius of the work (cached; removeMaterialInPlace invalidates it). */
export function maxOuterRadius(wp: Workpiece): number {
  let r = maxOuterCache.get(wp);
  if (r === undefined) {
    r = 0;
    for (let i = 0; i < wp.outer.length; i++) if (wp.outer[i] > r) r = wp.outer[i];
    maxOuterCache.set(wp, r);
  }
  return r;
}

/** Does the footprint overlap any material? */
export function intersectsMaterial(wp: Workpiece, fp: Footprint): boolean {
  // fast path: a tool above the largest diameter touches nothing (most moves are in air)
  if (fp.kind === 'rect' && fp.xMin >= maxOuterRadius(wp) - EPS) return false;
  const [i0, i1] = footprintZRange(wp, fp);
  for (let i = i0; i <= i1; i++) {
    if (isGone(wp, i)) continue;
    const o = wp.outer[i];
    const inn = wp.inner[i];
    if (fp.kind === 'rect') {
      if (fp.xMin < o - EPS && fp.xMax > inn + EPS) return true;
    } else {
      if (drillRadiusAt(fp, sampleZ(wp, i)) > inn + EPS) return true;
    }
  }
  return false;
}

export interface RemovalStats {
  /** cubic inches removed */
  removedVolume: number;
  /** largest change in radial wall thickness of any single column */
  maxRadialDepth: number;
  /** axial extent (inches) of the columns that changed */
  axialExtent: number;
  /** largest radius at which material was removed (pre-cut), for surface speed */
  maxRadiusEngaged: number;
  columnsChanged: number;
  /** first and last changed column (iMin > iMax when none changed) */
  iMin: number;
  iMax: number;
  /** last column index inside the footprint's z-range */
  rangeEnd: number;
}

/**
 * Removes material inside the footprint, mutating wp. Internal fast path used by the engine.
 * Rect footprints cut from the outside when they extend past the outer radius, otherwise
 * they enlarge the bore. Gone columns are normalised to outer = inner = 0.
 */
export function removeMaterialInPlace(wp: Workpiece, fp: Footprint): RemovalStats {
  maxOuterCache.delete(wp);
  const stats: RemovalStats = {
    removedVolume: 0,
    maxRadialDepth: 0,
    axialExtent: 0,
    maxRadiusEngaged: 0,
    columnsChanged: 0,
    iMin: 0,
    iMax: -1,
    rangeEnd: -1,
  };
  const [i0, i1] = footprintZRange(wp, fp);
  // unclipped: a footprint reaching past the end of the bar ends beyond the last column
  stats.rangeEnd =
    fp.kind === 'rect' && Number.isFinite(fp.zMax) ? Math.floor((fp.zMax - wp.zStart) / wp.dz - 0.5 + EPS) : Infinity;
  stats.iMin = i1 + 1;
  for (let i = i0; i <= i1; i++) {
    if (isGone(wp, i)) continue;
    const o = wp.outer[i];
    const inn = wp.inner[i];
    let no = o;
    let ni = inn;
    if (fp.kind === 'rect') {
      if (!(fp.xMin < o - EPS && fp.xMax > inn + EPS)) continue;
      if (fp.internal) ni = Math.max(inn, fp.xMax);
      else if (fp.xMax >= o) no = Math.max(0, fp.xMin);
      else ni = Math.max(inn, fp.xMax);
    } else {
      const r = drillRadiusAt(fp, sampleZ(wp, i));
      if (r <= inn + EPS) continue;
      ni = r;
    }
    if (no <= ni + EPS) {
      no = 0;
      ni = 0;
    }
    const before = o * o - inn * inn;
    const after = no * no - ni * ni;
    stats.removedVolume += Math.PI * (before - after) * wp.dz;
    const thicknessLoss = o - inn - (no - ni);
    stats.maxRadialDepth = Math.max(stats.maxRadialDepth, thicknessLoss);
    stats.maxRadiusEngaged = Math.max(stats.maxRadiusEngaged, no < o ? o : ni);
    stats.columnsChanged++;
    if (i < stats.iMin) stats.iMin = i;
    stats.iMax = i;
    wp.outer[i] = no;
    wp.inner[i] = ni;
  }
  stats.axialExtent = stats.columnsChanged * wp.dz;
  return stats;
}

/**
 * For an internal tool (boring bar): true when the footprint touches material that has no hole
 * big enough to work in (bore radius under minBore, or the bar body buried below the bore wall).
 */
export function internalToolBlocked(wp: Workpiece, fp: Footprint, minBore: number): boolean {
  if (fp.kind !== 'rect' || !fp.internal) return false;
  const [i0, i1] = footprintZRange(wp, fp);
  for (let i = i0; i <= i1; i++) {
    if (isGone(wp, i)) continue;
    const o = wp.outer[i];
    const inn = wp.inner[i];
    if (!(fp.xMin < o - EPS && fp.xMax > inn + EPS)) continue;
    if (inn < minBore - EPS || inn < fp.xMin - EPS) return true;
  }
  return false;
}

/** Pure material removal: returns a new workpiece. */
export function removeMaterial(
  wp: Workpiece,
  footprint: Footprint,
): { wp: Workpiece; removedVolume: number; maxRadialDepth: number; axialExtent: number } {
  const copy = cloneWorkpiece(wp);
  const s = removeMaterialInPlace(copy, footprint);
  return { wp: copy, removedVolume: s.removedVolume, maxRadialDepth: s.maxRadialDepth, axialExtent: s.axialExtent };
}

function materialBounds(wp: Workpiece): [number, number] | null {
  let a = -1;
  let b = -1;
  for (let i = 0; i < wp.outer.length; i++) {
    if (!isGone(wp, i)) {
      if (a < 0) a = i;
      b = i;
    }
  }
  return a < 0 ? null : [a, b];
}

/** Crops a workpiece to columns [a, b]. */
function crop(wp: Workpiece, a: number, b: number): Workpiece {
  const zStart = wp.zStart + a * wp.dz;
  return {
    material: wp.material,
    zStart,
    zEnd: wp.zStart + (b + 1) * wp.dz,
    dz: wp.dz,
    outer: wp.outer.slice(a, b + 1),
    inner: wp.inner.slice(a, b + 1),
  };
}

/**
 * Finds the first gone column with center z >= 0 that has material on both sides;
 * everything in front of it becomes the parted piece (cropped to its material).
 */
export function splitIfParted(wp: Workpiece): { remaining: Workpiece; parted?: Workpiece } {
  const bounds = materialBounds(wp);
  if (!bounds) return { remaining: wp };
  const [a, b] = bounds;
  const [startAtZero] = sampleRange(wp, 0, Infinity);
  for (let i = Math.max(startAtZero, a + 1); i < b; i++) {
    if (!isGone(wp, i)) continue;
    let first = i + 1;
    while (first <= b && isGone(wp, first)) first++;
    const parted = crop(wp, first, b);
    const remaining = cloneWorkpiece(wp);
    for (let j = i; j < remaining.outer.length; j++) {
      remaining.outer[j] = 0;
      remaining.inner[j] = 0;
    }
    return { remaining, parted };
  }
  return { remaining: wp };
}

/** Z of the front edge of the frontmost column with material, or null if none. */
export function facePosition(wp: Workpiece): number | null {
  const bounds = materialBounds(wp);
  return bounds ? wp.zStart + (bounds[1] + 1) * wp.dz : null;
}

/** Z of the back edge of the rearmost column with material, or null if none. */
export function backPosition(wp: Workpiece): number | null {
  const bounds = materialBounds(wp);
  return bounds ? wp.zStart + bounds[0] * wp.dz : null;
}

function columnIndex(wp: Workpiece, z: number): number {
  return Math.floor((z - wp.zStart) / wp.dz + EPS);
}

/** Outer diameter at z (0 where there is no material). */
export function diameterAt(wp: Workpiece, z: number): number {
  const i = columnIndex(wp, z);
  if (i < 0 || i >= wp.outer.length || isGone(wp, i)) return 0;
  return 2 * wp.outer[i];
}

/** Bore diameter at z (0 if solid or no material). */
export function boreDiameterAt(wp: Workpiece, z: number): number {
  const i = columnIndex(wp, z);
  if (i < 0 || i >= wp.outer.length || isGone(wp, i)) return 0;
  return 2 * wp.inner[i];
}

/** Run-length encodes material columns into segments (gone columns are omitted). */
export function profileSegments(wp: Workpiece, tol = 1e-6): ProfileSegment[] {
  const segs: ProfileSegment[] = [];
  let cur: ProfileSegment | null = null;
  for (let i = 0; i < wp.outer.length; i++) {
    if (isGone(wp, i)) {
      cur = null;
      continue;
    }
    const z0 = wp.zStart + i * wp.dz;
    const z1 = z0 + wp.dz;
    const d = 2 * wp.outer[i];
    const bd = 2 * wp.inner[i];
    if (cur && Math.abs(cur.diameter - d) <= tol && Math.abs(cur.boreDiameter - bd) <= tol) {
      cur.z1 = z1;
    } else {
      cur = { z0, z1, diameter: d, boreDiameter: bd };
      segs.push(cur);
    }
  }
  return segs;
}

/**
 * Closed outline for THREE.LatheGeometry: {x: radius, y: z}. Traces the outer surface from the
 * back end to the front, down the front face, then the bore (or axis) back to the start.
 * Gaps (parted columns) collapse to radius 0.
 */
export function latheGeometryPoints(wp: Workpiece): { x: number; y: number }[] {
  const bounds = materialBounds(wp);
  if (!bounds) return [];
  const [a, b] = bounds;
  const z = (i: number) => wp.zStart + i * wp.dz;
  const pts: { x: number; y: number }[] = [];
  const push = (x: number, y: number) => {
    const last = pts[pts.length - 1];
    if (last && Math.abs(last.x - x) < 1e-12 && Math.abs(last.y - y) < 1e-12) return;
    pts.push({ x, y });
  };
  const radius = (arr: Float64Array, i: number) => (isGone(wp, i) ? 0 : arr[i]);
  // outer, back to front
  push(radius(wp.inner, a), z(a));
  for (let i = a; i <= b; i++) {
    const r = radius(wp.outer, i);
    push(r, z(i));
    push(r, z(i + 1));
  }
  // inner, front to back
  for (let i = b; i >= a; i--) {
    const r = radius(wp.inner, i);
    push(r, z(i + 1));
    push(r, z(i));
  }
  return simplify(pts);
}

/** Removes interior points that lie on a straight horizontal or vertical run. */
function simplify(pts: { x: number; y: number }[]): { x: number; y: number }[] {
  if (pts.length < 3) return pts;
  const out = [pts[0]];
  for (let i = 1; i < pts.length - 1; i++) {
    const p = out[out.length - 1];
    const c = pts[i];
    const n = pts[i + 1];
    const sameX = Math.abs(p.x - c.x) < 1e-12 && Math.abs(c.x - n.x) < 1e-12;
    const sameY = Math.abs(p.y - c.y) < 1e-12 && Math.abs(c.y - n.y) < 1e-12;
    if (!sameX && !sameY) out.push(c);
  }
  out.push(pts[pts.length - 1]);
  return out;
}

/** Total material volume in cubic inches. */
export function volume(wp: Workpiece): number {
  let v = 0;
  for (let i = 0; i < wp.outer.length; i++) {
    if (!isGone(wp, i)) v += Math.PI * (wp.outer[i] ** 2 - wp.inner[i] ** 2) * wp.dz;
  }
  return v;
}
