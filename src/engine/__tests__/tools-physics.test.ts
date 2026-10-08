import { describe, expect, it } from 'vitest';
import {
  crashEnvelope,
  PARTING_BLADE_WIDTH,
  TAILSTOCK_TOOL_IDS,
  TAILSTOCK_TOOLS,
  tailstockFootprint,
  tailstockTipZ,
  TOOL_IDS,
  TOOLS,
  toolFootprint,
} from '../tools';
import {
  hitsChuck,
  hitsTailstock,
  maxDepthOfCut,
  maxRpmAtDiameter,
  partingMaxRpmAtDiameter,
  recommendedRpm,
  sfm,
  sfmLimit,
  snapRpm,
} from '../physics';
import { MACHINE } from '../types';

describe('tool catalog', () => {
  it('lists every toolpost and tailstock tool; boring is optional', () => {
    expect(TOOL_IDS).toEqual(['none', 'turning', 'parting', 'boring']);
    expect(TOOLS.boring.optional).toBe(true);
    expect(TAILSTOCK_TOOL_IDS).toHaveLength(5);
    expect(TAILSTOCK_TOOLS['center-drill'].length).toBe(1.5);
    expect(TAILSTOCK_TOOLS['drill-1/4'].length).toBe(2.5);
    expect(TAILSTOCK_TOOLS['live-center'].length).toBe(2.0);
    expect(TAILSTOCK_TOOLS['live-center'].cuts).toBe(false);
  });

  it('builds footprints per the design', () => {
    expect(toolFootprint('turning', 0.3, 1)).toEqual({ kind: 'rect', xMin: 0.3, xMax: Infinity, zMin: 1, zMax: 1.25 });
    expect(toolFootprint('parting', 0.3, 1)).toEqual({ kind: 'rect', xMin: 0.3, xMax: Infinity, zMin: 1, zMax: 1 + PARTING_BLADE_WIDTH });
    expect(toolFootprint('boring', 0.2, 1)).toMatchObject({ xMin: 0.2 - 0.125, xMax: 0.2, zMin: 1 });
    expect(toolFootprint('none', 0, 0)).toBeNull();
    expect(crashEnvelope('none', 0, 0)).toBeNull();
    expect(crashEnvelope('parting', 0.3, 1)!.zMin).toBeCloseTo(1 - 0.0625, 9);
    expect(crashEnvelope('turning', 0.3, 1)!.zMin).toBe(1);
  });

  it('computes the tailstock tip and drill footprints', () => {
    expect(tailstockTipZ('drill-1/4', 4, 0.5)).toBeCloseTo(1.0, 9);
    expect(tailstockTipZ('none', 4, 0.5)).toBeCloseTo(3.5, 9);
    expect(tailstockFootprint('drill-1/4', 1)).toEqual({ kind: 'drill', radius: 0.125, tipZ: 1, tipAngleDeg: 118 });
    expect(tailstockFootprint('live-center', 1)).toBeNull();
    expect(tailstockFootprint('none', 1)).toBeNull();
  });
});

describe('physics', () => {
  it('computes surface speed and limits', () => {
    expect(sfm(1, 600)).toBeCloseTo(157.08, 2);
    expect(sfmLimit('brass')).toBe(300);
    expect(sfmLimit('brass', 'parting')).toBe(150);
    expect(sfmLimit('steel', 'drill-1/4')).toBe(100);
    expect(maxDepthOfCut('aluminum')).toBe(0.08);
    expect(maxRpmAtDiameter('brass', 0)).toBe(Infinity);
    expect(partingMaxRpmAtDiameter('brass', 1)).toBeCloseTo((150 * 12) / Math.PI, 6);
  });

  it('recommends the fastest selectable rpm under the limit', () => {
    expect(recommendedRpm('brass', 1)).toBe(600);
    expect(recommendedRpm('brass', 1, 'parting')).toBe(300);
    expect(recommendedRpm('brass', 0.25)).toBe(2000);
    expect(recommendedRpm('steel', 6)).toBe(MACHINE.rpmOptions[1]);
  });

  it('snaps rpm to the nearest option', () => {
    expect(snapRpm(610)).toBe(600);
    expect(snapRpm(1700)).toBe(2000);
    expect(snapRpm(-5)).toBe(0);
  });

  it('detects chuck crashes, including the chuck body behind the jaws', () => {
    expect(hitsChuck({ kind: 'rect', xMin: 0.5, xMax: Infinity, zMin: -0.01, zMax: 0.24 })).toBe(true);
    expect(hitsChuck({ kind: 'rect', xMin: 0.5, xMax: Infinity, zMin: 0.0, zMax: 0.25 })).toBe(false);
    expect(hitsChuck({ kind: 'rect', xMin: 1.1, xMax: Infinity, zMin: -0.3, zMax: -0.05 })).toBe(false);
    expect(hitsChuck({ kind: 'rect', xMin: 1.1, xMax: Infinity, zMin: -0.75, zMax: -0.7 })).toBe(true);
  });

  it('detects tailstock crashes with the quill and the mounted tool', () => {
    const env = { kind: 'rect' as const, xMin: 0.1, xMax: Infinity, zMin: 1.4, zMax: 1.65 };
    expect(hitsTailstock(env, 'drill-1/4', 4, 0)).toBe(true); // drill tip at 1.5, radius .125
    expect(hitsTailstock(env, 'drill-1/8', 4, 0)).toBe(false); // radius .0625
    expect(hitsTailstock(env, 'none', 4, 0)).toBe(false);
    expect(hitsTailstock({ ...env, zMin: 3.9, zMax: 4.15 }, 'none', 4, 0)).toBe(true); // quill body
  });
});
