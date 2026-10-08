import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { LatheEngine, MACHINE, createStock, latheGeometryPoints, tailstockTipZ } from '../../engine';
import {
  CAMERA_PRESETS,
  CAMERA_PRESET_NAMES,
  CHIP_TRAY_Y,
  EMPTY_JAW_RADIUS,
  LATHE_SEGMENTS,
  MATERIAL_LOOKS,
  TOOL_PRESET_TIP,
  cameraPresetFor,
  chipSpawnCount,
  fallProgress,
  fromScene,
  gripRadius,
  handwheelAngle,
  handwheelAngles,
  jawRadius,
  latheGeometryFromPoints,
  lerpPose,
  materialLookFor,
  partedPieceRestPose,
  segmentHitsBox,
  quillFaceX,
  tailstockToolTipX,
  toScene,
  toolTipOffset,
  toolpostPosition,
  toolpostBounds,
  workpieceExtent,
  type Pose,
} from '../helpers';

const brass = { material: 'brass' as const, diameter: 1, length: 3, stickOut: 1.5 };

describe('coordinate mapping', () => {
  it('maps machine z to scene x and machine x (radius) to scene z', () => {
    expect(toScene(0.5, 2)).toEqual([2, 0, 0.5]);
    expect(toScene(0.5, 2, -1)).toEqual([2, -1, 0.5]);
  });
  it('round-trips', () => {
    expect(fromScene(toScene(0.37, -0.4))).toEqual({ x: 0.37, z: -0.4 });
  });
});

describe('handwheelAngle', () => {
  it('is one full turn per pitch', () => {
    expect(handwheelAngle(0.1, 0.1)).toBeCloseTo(Math.PI * 2);
    expect(handwheelAngle(0.025, 0.05)).toBeCloseTo(Math.PI);
    expect(handwheelAngle(-0.05, 0.05)).toBeCloseTo(-Math.PI * 2);
  });
  it('is 0 for a zero pitch', () => {
    expect(handwheelAngle(1, 0)).toBe(0);
  });
  it('follows the DESIGN sign conventions per axis', () => {
    const a = handwheelAngles({ x: 0.05, z: 0.1, quill: 0.2 });
    // +x is counter-clockwise on the cross slide
    expect(a.x).toBeCloseTo(-Math.PI * 2);
    expect(a.z).toBeCloseTo(Math.PI * 2);
    expect(a.quill).toBeCloseTo(Math.PI * 4);
  });
  it('matches the engine: one clockwise revolution of z moves one pitch', () => {
    const e = new LatheEngine();
    const before = handwheelAngles(e.getState()).z;
    e.dispatch({ type: 'turnHandwheel', axis: 'z', revolutions: 1 });
    expect(handwheelAngles(e.getState()).z - before).toBeCloseTo(Math.PI * 2);
    const bx = handwheelAngles(e.getState()).x;
    e.dispatch({ type: 'turnHandwheel', axis: 'x', revolutions: 1 });
    expect(handwheelAngles(e.getState()).x - bx).toBeCloseTo(Math.PI * 2);
  });
});

describe('jawRadius', () => {
  it('is 0.25 with no stock', () => {
    expect(jawRadius({ workpiece: null })).toBe(EMPTY_JAW_RADIUS);
  });
  it('grips the stock radius', () => {
    expect(jawRadius({ workpiece: createStock(brass) })).toBeCloseTo(0.5);
    expect(jawRadius({ workpiece: createStock({ ...brass, diameter: 0.625 }) })).toBeCloseTo(0.3125);
  });
  it('ignores material outside the jaws', () => {
    const wp = createStock(brass);
    for (let i = 0; i < wp.outer.length; i++) {
      const zc = wp.zStart + (i + 0.5) * wp.dz;
      if (zc > 0) wp.outer[i] = 0.9; // pretend the stick-out is bigger
    }
    expect(gripRadius(wp)).toBeCloseTo(0.5);
  });
  it('falls back to 0.25 when nothing is in the jaws', () => {
    const wp = createStock({ ...brass, length: 1, stickOut: 1 });
    expect(gripRadius(wp)).toBe(0);
    expect(jawRadius({ workpiece: wp })).toBe(EMPTY_JAW_RADIUS);
  });
  it('fits inside the jaw envelope', () => {
    expect(jawRadius({ workpiece: createStock(brass) })).toBeLessThan(MACHINE.chuckJawOuterRadius);
  });
});

describe('toolTipOffset / toolpostPosition', () => {
  it('has an offset for every tool, with the tool reaching toward the axis (−Z)', () => {
    for (const t of ['none', 'turning', 'parting', 'boring'] as const) {
      const off = toolTipOffset(t);
      expect(off).toHaveLength(3);
      expect(off[2]).toBeLessThan(0);
    }
  });
  it('places the toolpost so the tip lands on the machine position', () => {
    for (const t of ['turning', 'parting', 'boring'] as const) {
      const post = toolpostPosition(t, 0.4, 1.2);
      const off = toolTipOffset(t);
      expect(post[0] + off[0]).toBeCloseTo(1.2);
      expect(post[1] + off[1]).toBeCloseTo(0);
      expect(post[2] + off[2]).toBeCloseTo(0.4);
    }
  });
  it('the boring bar reaches toward the tailstock past the tip', () => {
    expect(toolTipOffset('boring')[0]).toBeLessThan(-1);
  });
});

describe('tailstock positions', () => {
  it('quill face and tool tip match the engine', () => {
    expect(quillFaceX(4, 0.5)).toBeCloseTo(3.5);
    for (const t of ['center-drill', 'drill-1/8', 'drill-1/4', 'live-center', 'none'] as const) {
      expect(tailstockToolTipX(t, 4, 0.7)).toBeCloseTo(tailstockTipZ(t, 4, 0.7));
    }
  });
});

describe('camera presets', () => {
  it('has the four presets', () => {
    expect(CAMERA_PRESET_NAMES.sort()).toEqual(['chuck', 'overview', 'tailstock', 'tool']);
  });
  it('returns copies so callers cannot mutate the table', () => {
    const p = cameraPresetFor('tool');
    p.position[0] = 999;
    expect(CAMERA_PRESETS.tool.position[0]).not.toBe(999);
  });
  it('the tool preset follows the tool tip', () => {
    const base = cameraPresetFor('tool');
    expect(cameraPresetFor('tool', TOOL_PRESET_TIP)).toEqual(base);
    const moved = cameraPresetFor('tool', { x: 0.8, z: 2.5 });
    expect(moved.target[0] - base.target[0]).toBeCloseTo(1.5);
    expect(moved.position[0] - base.position[0]).toBeCloseTo(1.5);
    expect(moved.target[2] - base.target[2]).toBeCloseTo(0.3);
    expect(cameraPresetFor('tool', { x: -0.05, z: 1 }).target[2]).toBeCloseTo(base.target[2] - 0.5);
    // other presets ignore the tip
    expect(cameraPresetFor('chuck', { x: 0.8, z: 2.5 })).toEqual(CAMERA_PRESETS.chuck);
  });
  it('the tool camera sees the tip past the toolpost for every tool and position', () => {
    const tips = [
      { x: 0.5, z: 1 },
      { x: 0.25, z: 0.4 },
      { x: 0.75, z: 2 },
      { x: 0.05, z: 1.5 },
    ];
    // (the boring bar's tip is inside the bore, out of sight from any outside camera)
    for (const tool of ['turning', 'parting'] as const) {
      for (const tip of tips) {
        const cam = cameraPresetFor('tool', tip).position;
        // stop just short of the tip: the tool itself starts there
        const t = toScene(tip.x, tip.z);
        const near: [number, number, number] = [0, 1, 2].map((k) => t[k] + (cam[k] - t[k]) * 0.02) as [number, number, number];
        for (const box of toolpostBounds(tool, tip.x, tip.z)) {
          expect(segmentHitsBox(cam, near, box), `${tool} at ${JSON.stringify(tip)}`).toBe(false);
        }
      }
    }
    // the slab test itself
    const box = { min: [0, 0, 0] as [number, number, number], max: [1, 1, 1] as [number, number, number] };
    expect(segmentHitsBox([-1, 0.5, 0.5], [2, 0.5, 0.5], box)).toBe(true);
    expect(segmentHitsBox([-1, 2, 0.5], [2, 2, 0.5], box)).toBe(false);
  });
  it('the tool camera looks down at the tip from the front right, a little above', () => {
    const p = cameraPresetFor('tool', TOOL_PRESET_TIP);
    const tip = toScene(TOOL_PRESET_TIP.x, TOOL_PRESET_TIP.z);
    const d = [p.position[0] - tip[0], p.position[1] - tip[1], p.position[2] - tip[2]];
    expect(d[0]).toBeGreaterThan(0); // tailstock side
    expect(d[2]).toBeGreaterThan(0); // operator side
    const elevation = Math.atan2(d[1], Math.hypot(d[0], d[2]));
    expect(elevation).toBeGreaterThan(0.15);
    expect(elevation).toBeLessThan(0.6);
  });
  it('falls back to overview', () => {
    expect(cameraPresetFor('nope')).toEqual(CAMERA_PRESETS.overview);
  });
  it('every preset looks at its target from a distance', () => {
    for (const name of CAMERA_PRESET_NAMES) {
      const { position, target } = cameraPresetFor(name);
      const d = Math.hypot(position[0] - target[0], position[1] - target[1], position[2] - target[2]);
      expect(d).toBeGreaterThan(2);
      expect(position[2]).toBeGreaterThan(0); // operator side
    }
  });
});

describe('parted pieces', () => {
  it('rest in the tray on their side', () => {
    const p = partedPieceRestPose(0, 0.5);
    expect(p.position[1]).toBeCloseTo(CHIP_TRAY_Y + 0.5);
    expect(p.position[2]).toBeGreaterThan(0);
  });
  it('different pieces rest in different places', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 12; i++) seen.add(partedPieceRestPose(i).position.join(','));
    expect(seen.size).toBe(12);
  });
  it('handles odd indices', () => {
    expect(partedPieceRestPose(-3)).toEqual(partedPieceRestPose(0));
    expect(partedPieceRestPose(2.7)).toEqual(partedPieceRestPose(2));
  });
  it('fall progress eases in and clamps', () => {
    expect(fallProgress(0)).toBe(0);
    expect(fallProgress(0.3)).toBeCloseTo(0.25);
    expect(fallProgress(0.6)).toBe(1);
    expect(fallProgress(5)).toBe(1);
    expect(fallProgress(-1)).toBe(0);
    expect(fallProgress(1, 0)).toBe(1);
  });
  it('lerpPose interpolates in place', () => {
    const a: Pose = { position: [0, 0, 0], rotation: [0, 0, 0] };
    const b: Pose = { position: [2, 4, 6], rotation: [1, 1, 1] };
    const out: Pose = { position: [0, 0, 0], rotation: [0, 0, 0] };
    expect(lerpPose(a, b, 0.5, out)).toBe(out);
    expect(out.position).toEqual([1, 2, 3]);
    expect(out.rotation).toEqual([0.5, 0.5, 0.5]);
  });
});

describe('workpieceExtent', () => {
  it('measures stock', () => {
    const ext = workpieceExtent(createStock(brass));
    expect(ext).not.toBeNull();
    expect(ext!.zMin).toBeCloseTo(-1.5);
    expect(ext!.zMax).toBeCloseTo(1.5);
    expect(ext!.center).toBeCloseTo(0);
    expect(ext!.radius).toBeCloseTo(0.5);
  });
  it('is null for an empty workpiece', () => {
    const wp = createStock(brass);
    wp.outer.fill(0);
    expect(workpieceExtent(wp)).toBeNull();
  });
});

describe('latheGeometryFromPoints', () => {
  it('builds a LatheGeometry with (segments+1) × 2(n−1) vertices', () => {
    const pts = latheGeometryPoints(createStock(brass));
    const geo = latheGeometryFromPoints(pts);
    expect(geo).toBeInstanceOf(THREE.LatheGeometry);
    const pos = geo.getAttribute('position');
    expect(pos.count).toBe((LATHE_SEGMENTS + 1) * 2 * (pts.length - 1));
    expect(geo.getIndex()!.count).toBe(LATHE_SEGMENTS * (2 * (pts.length - 1) - 1) * 6);
  });
  it('keeps the profile on the first meridian, in order (phi = 0 → +z)', () => {
    const pts = [
      { x: 0, y: -1 },
      { x: 0.5, y: -1 },
      { x: 0.5, y: 1 },
      { x: 0, y: 1 },
    ];
    const geo = latheGeometryFromPoints(pts, 8);
    const pos = geo.getAttribute('position');
    const expectedY = [-1, -1, -1, 1, 1, 1];
    const expectedR = [0, 0.5, 0.5, 0.5, 0.5, 0];
    for (let j = 0; j < 6; j++) {
      expect(pos.getX(j)).toBeCloseTo(0);
      expect(pos.getY(j)).toBeCloseTo(expectedY[j]);
      expect(pos.getZ(j)).toBeCloseTo(expectedR[j]);
    }
  });
  it('gives flat, outward normals per profile segment', () => {
    const pts = [
      { x: 0, y: -1 },
      { x: 0.5, y: -1 },
      { x: 0.5, y: 1 },
      { x: 0, y: 1 },
    ];
    const geo = latheGeometryFromPoints(pts, 4);
    const nrm = geo.getAttribute('normal');
    // back face points −y, cylinder points radially out (+z on meridian 0), front face +y
    expect([nrm.getX(0), nrm.getY(0), nrm.getZ(0)].map((v) => Math.round(v) || 0)).toEqual([0, -1, 0]);
    expect([nrm.getX(2), nrm.getY(2), nrm.getZ(2)].map((v) => Math.round(v) || 0)).toEqual([0, 0, 1]);
    expect([nrm.getX(3), nrm.getY(3), nrm.getZ(3)].map((v) => Math.round(v) || 0)).toEqual([0, 0, 1]);
    expect([nrm.getX(4), nrm.getY(4), nrm.getZ(4)].map((v) => Math.round(v) || 0)).toEqual([0, 1, 0]);
    // meridian 1 (phi = 90°) points radially along +x
    const n = 6;
    expect(nrm.getX(n + 2)).toBeCloseTo(1);
    for (let i = 0; i < nrm.count; i++) {
      expect(Math.hypot(nrm.getX(i), nrm.getY(i), nrm.getZ(i))).toBeCloseTo(1);
    }
  });
  it('bore normals point toward the axis', () => {
    const e = new LatheEngine();
    e.dispatch({ type: 'loadStock', stock: brass });
    e.dispatch({ type: 'selectTailstockTool', tool: 'drill-1/4' });
    e.dispatch({ type: 'setSpindle', on: true });
    // drill 0.5" into the face: tip starts at 4 - 2.5 = 1.5 = the face
    for (let k = 0; k < 50; k++) e.dispatch({ type: 'turnHandwheel', axis: 'quill', revolutions: 0.1, dt: 0.5 });
    const pts = latheGeometryPoints(e.getState().workpiece!);
    expect(pts.some((p) => p.x > 0.1 && p.x < 0.2)).toBe(true);
    const geo = latheGeometryFromPoints(pts, 4);
    const pos = geo.getAttribute('position');
    const nrm = geo.getAttribute('normal');
    let found = false;
    for (let j = 0; j < pos.count / 5; j++) {
      const r = pos.getZ(j);
      if (Math.abs(r - 0.125) < 1e-3 && Math.abs(nrm.getY(j)) < 1e-6 && pos.getY(j) > 1.1) {
        expect(nrm.getZ(j)).toBeCloseTo(-1);
        found = true;
      }
    }
    expect(found).toBe(true);
  });
  it('applies a y offset and clamps negative radii', () => {
    const geo = latheGeometryFromPoints(
      [
        { x: -0.1, y: 0 },
        { x: 0.5, y: 0 },
        { x: 0.5, y: 2 },
      ],
      4,
      -1,
    );
    const pos = geo.getAttribute('position');
    expect(pos.getZ(0)).toBe(0);
    expect(pos.getY(0)).toBeCloseTo(-1);
    expect(pos.getY(3)).toBeCloseTo(1);
  });
  it('tolerates degenerate input', () => {
    expect(latheGeometryFromPoints([]).getAttribute('position').count).toBe(0);
    const geo = latheGeometryFromPoints([
      { x: 0.5, y: 0 },
      { x: 0.5, y: 0 },
    ]);
    expect(geo.getAttribute('position').count).toBe((LATHE_SEGMENTS + 1) * 2);
  });
  it('lays uv v along the profile arc length', () => {
    const geo = latheGeometryFromPoints(
      [
        { x: 0.5, y: 0 },
        { x: 0.5, y: 1 },
      ],
      4,
    );
    const uv = geo.getAttribute('uv');
    expect(uv.getY(0)).toBeCloseTo(0);
    expect(uv.getY(1)).toBeCloseTo(2);
    expect(uv.getX(2 * 4)).toBeCloseTo(3);
  });
});

describe('materials and chips', () => {
  it('has a look for every material', () => {
    for (const m of ['brass', 'aluminum', 'steel', 'delrin'] as const) {
      expect(materialLookFor(m)).toBe(MATERIAL_LOOKS[m]);
    }
    expect(MATERIAL_LOOKS.delrin.metalness).toBe(0);
  });
  it('spawns chips at a rate with a carried remainder', () => {
    const carry = { value: 0 };
    let total = 0;
    for (let i = 0; i < 60; i++) total += chipSpawnCount(1 / 60, 600, carry);
    expect(total).toBeGreaterThanOrEqual(87);
    expect(total).toBeLessThanOrEqual(88);
    expect(chipSpawnCount(-1, 600, { value: 0 })).toBe(0);
    expect(chipSpawnCount(1, 1e6, { value: 0 })).toBe(200);
  });
});
