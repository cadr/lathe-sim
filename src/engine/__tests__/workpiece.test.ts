import { describe, expect, it } from 'vitest';
import {
  backPosition,
  boreDiameterAt,
  cloneWorkpiece,
  createStock,
  diameterAt,
  drillRadiusAt,
  facePosition,
  intersectsMaterial,
  latheGeometryPoints,
  profileSegments,
  removeMaterial,
  sampleRange,
  sampleZ,
  splitIfParted,
  volume,
} from '../workpiece';
import type { Footprint } from '../types';

const stock = () => createStock({ material: 'brass', diameter: 1, length: 3, stickOut: 1.5 });

describe('createStock', () => {
  it('lays the stock out along z with stick-out in front of the jaws', () => {
    const wp = stock();
    expect(wp.zStart).toBeCloseTo(-1.5, 9);
    expect(wp.zEnd).toBe(1.5);
    expect(wp.dz).toBe(0.005);
    expect(wp.outer.length).toBe(600);
    expect(wp.outer.every((r) => r === 0.5)).toBe(true);
    expect(wp.inner.every((r) => r === 0)).toBe(true);
    expect(facePosition(wp)).toBeCloseTo(1.5, 9);
    expect(backPosition(wp)).toBeCloseTo(-1.5, 9);
    expect(volume(wp)).toBeCloseTo(Math.PI * 0.25 * 3, 6);
  });

  it('rejects bad specs', () => {
    expect(() => createStock({ material: 'brass', diameter: 0, length: 1, stickOut: 0.5 })).toThrow();
    expect(() => createStock({ material: 'brass', diameter: 1, length: 1, stickOut: 2 })).toThrow();
    expect(() => createStock({ material: 'brass', diameter: 1, length: 1, stickOut: -1 })).toThrow();
  });
});

describe('sampling helpers', () => {
  it('sampleRange selects samples whose centers are inside the range', () => {
    const wp = stock();
    const [a, b] = sampleRange(wp, 1.0, 1.25);
    expect(sampleZ(wp, a)).toBeGreaterThanOrEqual(1.0);
    expect(sampleZ(wp, a - 1)).toBeLessThan(1.0);
    expect(sampleZ(wp, b)).toBeLessThanOrEqual(1.25);
    expect(sampleZ(wp, b + 1)).toBeGreaterThan(1.25);
    const [c, d] = sampleRange(wp, 5, 6);
    expect(c).toBeGreaterThan(d);
  });

  it('diameterAt and boreDiameterAt return 0 outside the stock', () => {
    const wp = stock();
    expect(diameterAt(wp, 0.3)).toBe(1);
    expect(diameterAt(wp, 2)).toBe(0);
    expect(diameterAt(wp, -2)).toBe(0);
    expect(boreDiameterAt(wp, 0.3)).toBe(0);
    expect(boreDiameterAt(wp, 9)).toBe(0);
  });

  it('drillRadiusAt is a 118 degree cone capped at the drill radius', () => {
    const fp = { radius: 0.125, tipZ: 1 };
    expect(drillRadiusAt(fp, 0.9)).toBe(0);
    expect(drillRadiusAt(fp, 1.03)).toBeCloseTo(0.03 * Math.tan((59 * Math.PI) / 180), 9);
    expect(drillRadiusAt(fp, 2)).toBe(0.125);
  });
});

describe('removeMaterial', () => {
  it('turns the outside down without mutating the input', () => {
    const wp = stock();
    const fp: Footprint = { kind: 'rect', xMin: 0.4, xMax: Infinity, zMin: 1.0, zMax: 1.25 };
    const r = removeMaterial(wp, fp);
    expect(wp.outer.every((v) => v === 0.5)).toBe(true);
    expect(diameterAt(r.wp, 1.1)).toBeCloseTo(0.8, 9);
    expect(diameterAt(r.wp, 0.9)).toBe(1);
    expect(r.maxRadialDepth).toBeCloseTo(0.1, 9);
    expect(r.axialExtent).toBeCloseTo(0.25, 9);
    expect(r.removedVolume).toBeCloseTo(Math.PI * (0.25 - 0.16) * 0.25, 6);
  });

  it('removes columns entirely when the tool passes center', () => {
    const wp = stock();
    const r = removeMaterial(wp, { kind: 'rect', xMin: -0.02, xMax: Infinity, zMin: 1.49, zMax: 1.74 });
    expect(facePosition(r.wp)).toBeCloseTo(1.49, 9);
    expect(r.axialExtent).toBeCloseTo(0.01, 9);
  });

  it('leaves material alone when the footprint misses it', () => {
    const wp = stock();
    const r = removeMaterial(wp, { kind: 'rect', xMin: 0.6, xMax: Infinity, zMin: 0, zMax: 1 });
    expect(r.removedVolume).toBe(0);
    expect(intersectsMaterial(wp, { kind: 'rect', xMin: 0.6, xMax: Infinity, zMin: 0, zMax: 1 })).toBe(false);
    expect(intersectsMaterial(wp, { kind: 'rect', xMin: 0.4, xMax: Infinity, zMin: 0, zMax: 1 })).toBe(true);
  });

  it('enlarges the bore with an internal rect (boring)', () => {
    let wp = stock();
    wp = removeMaterial(wp, { kind: 'drill', radius: 0.125, tipZ: 0.5, tipAngleDeg: 118 }).wp;
    const r = removeMaterial(wp, { kind: 'rect', xMin: 0.05, xMax: 0.2, zMin: 1.0, zMax: 2.5 });
    expect(boreDiameterAt(r.wp, 1.2)).toBeCloseTo(0.4, 9);
    expect(diameterAt(r.wp, 1.2)).toBe(1);
    expect(boreDiameterAt(r.wp, 0.8)).toBeCloseTo(0.25, 9);
  });

  it('drills a cone-tipped hole', () => {
    const wp = stock();
    const fp: Footprint = { kind: 'drill', radius: 0.125, tipZ: 1.0, tipAngleDeg: 118 };
    expect(intersectsMaterial(wp, fp)).toBe(true);
    const r = removeMaterial(wp, fp);
    expect(boreDiameterAt(r.wp, 1.4)).toBeCloseTo(0.25, 9);
    expect(boreDiameterAt(r.wp, 1.02)).toBeGreaterThan(0);
    expect(boreDiameterAt(r.wp, 1.02)).toBeLessThan(0.25);
    expect(boreDiameterAt(r.wp, 0.99)).toBe(0);
    expect(intersectsMaterial(r.wp, fp)).toBe(false);
  });

  it('a drill bigger than the stock removes whole columns', () => {
    const wp = createStock({ material: 'brass', diameter: 0.2, length: 1, stickOut: 1 });
    const r = removeMaterial(wp, { kind: 'drill', radius: 0.125, tipZ: 0.5, tipAngleDeg: 118 });
    expect(facePosition(r.wp)!).toBeLessThan(0.6);
  });
});

describe('splitIfParted', () => {
  it('returns the work unchanged when nothing is parted', () => {
    const wp = stock();
    expect(splitIfParted(wp).parted).toBeUndefined();
    const empty = cloneWorkpiece(wp);
    empty.outer.fill(0);
    expect(splitIfParted(empty).parted).toBeUndefined();
    expect(facePosition(empty)).toBeNull();
    expect(backPosition(empty)).toBeNull();
    expect(latheGeometryPoints(empty)).toEqual([]);
  });

  it('splits off the material in front of a gap', () => {
    const wp = removeMaterial(stock(), { kind: 'rect', xMin: -0.01, xMax: Infinity, zMin: 0.5, zMax: 0.5625 }).wp;
    const { remaining, parted } = splitIfParted(wp);
    expect(parted).toBeDefined();
    expect(facePosition(parted!)).toBeCloseTo(1.5, 9);
    expect(backPosition(parted!)).toBeCloseTo(0.565, 9);
    expect(parted!.zStart).toBeCloseTo(0.565, 9);
    expect(parted!.outer.length).toBe(187);
    expect(facePosition(remaining)!).toBeLessThan(0.51);
    expect(remaining.outer.length).toBe(600);
  });

  it('ignores gaps inside the chuck (z < 0)', () => {
    const wp = stock();
    for (let i = 10; i < 20; i++) wp.outer[i] = 0;
    expect(splitIfParted(wp).parted).toBeUndefined();
  });
});

describe('profileSegments and latheGeometryPoints', () => {
  it('run-length encodes the profile, skipping gaps', () => {
    let wp = stock();
    wp = removeMaterial(wp, { kind: 'rect', xMin: 0.25, xMax: Infinity, zMin: 1.0, zMax: 2 }).wp;
    wp = removeMaterial(wp, { kind: 'drill', radius: 0.125, tipZ: 1.3, tipAngleDeg: 118 }).wp;
    const segs = profileSegments(wp);
    expect(segs[0]).toMatchObject({ diameter: 1, boreDiameter: 0 });
    expect(segs[0].z0).toBeCloseTo(-1.5, 9);
    expect(segs[0].z1).toBeCloseTo(1.0, 9);
    const last = segs[segs.length - 1];
    expect(last).toMatchObject({ diameter: 0.5, boreDiameter: 0.25 });
    expect(last.z1).toBeCloseTo(1.5, 9);
  });

  it('produces a closed outline from the back, along the outside and back along the bore', () => {
    let wp = createStock({ material: 'aluminum', diameter: 1, length: 1, stickOut: 1 });
    wp = removeMaterial(wp, { kind: 'rect', xMin: 0.25, xMax: Infinity, zMin: 0.5, zMax: 2 }).wp;
    const pts = latheGeometryPoints(wp);
    expect(pts[0]).toEqual({ x: 0, y: 0 });
    const ys = pts.map((p) => p.y);
    expect(Math.max(...ys)).toBeCloseTo(1, 9);
    expect(Math.max(...pts.map((p) => p.x))).toBe(0.5);
    // the step at z=0.5
    expect(pts.some((p) => p.x === 0.25 && Math.abs(p.y - 0.5) < 1e-9)).toBe(true);
    expect(pts[pts.length - 1]).toEqual({ x: 0, y: 0 });
    // simplified: a stepped bar needs only a handful of points
    expect(pts.length).toBeLessThan(10);
  });

  it('collapses gaps to the axis', () => {
    const wp = removeMaterial(stock(), { kind: 'rect', xMin: 0, xMax: Infinity, zMin: 0.5, zMax: 0.55 }).wp;
    const pts = latheGeometryPoints(wp);
    expect(pts.some((p) => p.x === 0 && p.y > 0.4 && p.y < 0.6)).toBe(true);
  });
});
