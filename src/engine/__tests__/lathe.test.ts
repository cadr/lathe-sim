import { describe, expect, it, vi } from 'vitest';
import { createInitialState, dialReadingFor, handwheelDelta, LatheEngine, revolutionsFor } from '../lathe';
import { boreDiameterAt, diameterAt, facePosition, profileSegments } from '../workpiece';
import { grade } from '../grader';
import { MACHINE, type Challenge, type LatheEvent } from '../types';
import { BRASS_1x3, makePinDirect, moveTo, setup } from './fixtures';

const kinds = (e: LatheEngine) => e.getState().events.map((ev) => ev.kind);
const count = (e: LatheEngine, k: LatheEvent['kind']) => kinds(e).filter((x) => x === k).length;

describe('initial state', () => {
  it('starts with the tool clear of the stock and dials zeroed', () => {
    const e = new LatheEngine();
    const s = e.getState();
    expect(s).toMatchObject({ x: 0.75, z: 2, quill: 0, tool: 'none', tailstockTool: 'none', tailstockZ: 4 });
    expect(s.spindle).toEqual({ on: false, rpm: 600, reverse: false, angle: 0 });
    expect(e.dialReading('x')).toBe(0);
    expect(e.diameter()).toBe(1.5);
    expect(e.tailstockTipZ()).toBe(4);
  });

  it('accepts overrides', () => {
    const e = new LatheEngine({ x: 0.5, z: 1, tool: 'turning' });
    expect(e.getState()).toMatchObject({ x: 0.5, z: 1, tool: 'turning', dialZero: { x: 0.5, z: 1, quill: 0 } });
    expect(createInitialState().partedPieces).toEqual([]);
  });
});

describe('handwheels and dials', () => {
  it('follows the sign conventions', () => {
    expect(handwheelDelta('x', 1)).toBeCloseTo(-0.05, 12);
    expect(handwheelDelta('z', 1)).toBeCloseTo(0.1, 12);
    expect(handwheelDelta('quill', 1)).toBeCloseTo(0.1, 12);
    expect(revolutionsFor('x', -0.05)).toBeCloseTo(1, 12);
    expect(revolutionsFor('z', -0.1)).toBeCloseTo(-1, 12);
    expect(revolutionsFor('quill', 0.2)).toBeCloseTo(2, 12);
    const e = new LatheEngine();
    e.dispatch({ type: 'turnHandwheel', axis: 'x', revolutions: 1 });
    e.dispatch({ type: 'turnHandwheel', axis: 'z', revolutions: -1 });
    e.dispatch({ type: 'turnHandwheel', axis: 'quill', revolutions: 1 });
    expect(e.getState()).toMatchObject({ x: 0.7, z: 1.9, quill: 0.1 });
    expect(e.tailstockTipZ()).toBeCloseTo(3.9, 9);
  });

  it('reads dials in thousandths modulo the dial size, relative to the last zero', () => {
    const e = new LatheEngine();
    e.dispatch({ type: 'turnHandwheel', axis: 'x', revolutions: 0.2 });
    expect(e.dialReading('x')).toBeCloseTo(10, 6);
    e.dispatch({ type: 'turnHandwheel', axis: 'x', revolutions: 1 });
    expect(e.dialReading('x')).toBeCloseTo(10, 6);
    e.dispatch({ type: 'turnHandwheel', axis: 'x', revolutions: -0.4 });
    expect(e.dialReading('x')).toBeCloseTo(40, 6);
    e.dispatch({ type: 'zeroDial', axis: 'x' });
    expect(e.dialReading('x')).toBe(0);
    e.dispatch({ type: 'turnHandwheel', axis: 'z', revolutions: -0.25 });
    expect(e.dialReading('z')).toBeCloseTo(75, 6);
    e.dispatch({ type: 'turnHandwheel', axis: 'quill', revolutions: 0.37 });
    expect(e.dialReading('quill')).toBeCloseTo(37, 6);
    expect(dialReadingFor('z', 1.0999999999, 1)).toBe(0);
  });

  it('clamps to the travel ranges', () => {
    const e = new LatheEngine();
    e.dispatch({ type: 'turnHandwheel', axis: 'x', revolutions: -100 });
    expect(e.getState().x).toBe(MACHINE.xRange[1]);
    e.dispatch({ type: 'turnHandwheel', axis: 'x', revolutions: 100 });
    expect(e.getState().x).toBe(MACHINE.xRange[0]);
    e.dispatch({ type: 'turnHandwheel', axis: 'z', revolutions: -100 });
    expect(e.getState().z).toBe(MACHINE.zRange[0]);
    e.dispatch({ type: 'turnHandwheel', axis: 'z', revolutions: 100 });
    // the carriage can't run past the tailstock (a crash), so the z range end is only reachable
    // with the tailstock out of the way
    expect(e.getState().z).toBeCloseTo(MACHINE.tailstockZ, 2);
    expect(e.getState().damage.crashed).toBe(true);
    const far = new LatheEngine({ tailstockZ: 6 });
    far.dispatch({ type: 'turnHandwheel', axis: 'z', revolutions: 100 });
    expect(far.getState().z).toBe(MACHINE.zRange[1]);
    e.dispatch({ type: 'turnHandwheel', axis: 'quill', revolutions: -5 });
    expect(e.getState().quill).toBe(0);
    e.dispatch({ type: 'turnHandwheel', axis: 'quill', revolutions: 50 });
    expect(e.getState().quill).toBe(2);
    const before = e.getState().actions.length;
    e.dispatch({ type: 'turnHandwheel', axis: 'z', revolutions: -1 });
    e.dispatch({ type: 'turnHandwheel', axis: 'quill', revolutions: 1 });
    expect(e.getState().quill).toBe(2);
    expect(e.getState().actions.length).toBe(before + 2);
  });
});

describe('spindle, tools and stock', () => {
  it('logs actions and spindle events, and snaps rpm', () => {
    const e = new LatheEngine();
    e.dispatch({ type: 'setRpm', rpm: 1250 });
    e.dispatch({ type: 'setSpindle', on: true });
    e.dispatch({ type: 'setSpindle', on: true });
    e.dispatch({ type: 'setSpindle', on: false });
    expect(e.getState().spindle.rpm).toBe(1200);
    expect(kinds(e)).toEqual(['spindleOn', 'spindleOff']);
    expect(e.getState().actions.map((a) => a.action.type)).toEqual(['setRpm', 'setSpindle', 'setSpindle', 'setSpindle']);
  });

  it('flags tool and stock changes with the spindle running', () => {
    const e = setup();
    expect(count(e, 'toolChangeWhileRunning')).toBe(0);
    e.dispatch({ type: 'selectTool', tool: 'parting' });
    e.dispatch({ type: 'loadStock', stock: BRASS_1x3 });
    e.dispatch({ type: 'removeStock' });
    expect(count(e, 'toolChangeWhileRunning')).toBe(3);
    expect(e.getState().workpiece).toBeNull();
    expect(kinds(e)).toContain('toolChanged');
    e.dispatch({ type: 'selectTailstockTool', tool: 'drill-1/4' });
    expect(e.getState().tailstockTool).toBe('drill-1/4');
  });

  it('ticks time and rotates the spindle only when running', () => {
    const e = new LatheEngine();
    e.tick(0.5);
    expect(e.getState().time).toBe(0.5);
    expect(e.getState().spindle.angle).toBe(0);
    e.dispatch({ type: 'setSpindle', on: true });
    e.tick(0.01);
    expect(e.getState().spindle.angle).toBeCloseTo(600 / 60 * 2 * Math.PI * 0.01, 9);
    e.dispatch({ type: 'setSpindle', on: true, reverse: true });
    e.tick(0.01);
    expect(e.getState().spindle.angle).toBeCloseTo(0, 9);
    e.tick(0);
    expect(e.getState().time).toBeCloseTo(0.52, 9);
  });

  it('notifies subscribers and replaces state on change', () => {
    const e = new LatheEngine();
    const fn = vi.fn();
    const off = e.subscribe(fn);
    const s0 = e.getState();
    e.dispatch({ type: 'setRpm', rpm: 300 });
    expect(fn).toHaveBeenCalledTimes(1);
    expect(e.getState()).not.toBe(s0);
    expect(s0.spindle.rpm).toBe(600);
    off();
    e.tick(0.1);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('does not mutate previous workpiece snapshots when cutting', () => {
    const e = setup();
    const before = e.getState().workpiece!;
    moveTo(e, 'z', 1.49);
    moveTo(e, 'x', -0.02);
    expect(facePosition(before)).toBeCloseTo(2, 9);
    expect(e.getState().workpiece).not.toBe(before);
  });

  it('reset restores a snapshot', () => {
    const e = setup();
    const snap = e.getState();
    moveTo(e, 'z', 1.49);
    e.reset(snap);
    expect(e.getState().z).toBe(2);
    e.reset();
    expect(e.getState().workpiece).toBeNull();
  });
});

describe('cutting', () => {
  it('facing moves the face back and emits a cut event', () => {
    const e = setup();
    moveTo(e, 'z', 1.99);
    moveTo(e, 'x', -0.02);
    const s = e.getState();
    expect(facePosition(s.workpiece!)).toBeCloseTo(1.99, 9);
    expect(s.cutting).toBe(true);
    expect(s.lastCut!.depthRadial).toBeCloseTo(0.01, 9);
    expect(count(e, 'cut')).toBe(1);
    e.tick(1 / 60);
    expect(e.getState().cutting).toBe(true);
    e.tick(1 / 60);
    expect(e.getState().cutting).toBe(false);
  });

  it('turning sets the diameter over the length traversed', () => {
    const e = setup();
    moveTo(e, 'z', 2.1);
    moveTo(e, 'x', 0.45);
    moveTo(e, 'z', 1.0, 0.08);
    const wp = e.getState().workpiece!;
    expect(diameterAt(wp, 1.5)).toBeCloseTo(0.9, 9);
    expect(diameterAt(wp, 1.002)).toBeCloseTo(0.9, 9);
    expect(diameterAt(wp, 0.997)).toBe(1);
    expect(e.getState().lastCut!.depthRadial).toBeCloseTo(0.05, 9);
    expect(kinds(e)).not.toContain('heavyCut');
    expect(kinds(e)).not.toContain('poorFinish');
  });

  it('throttles cut events to one per 0.25 s of continuous cutting', () => {
    const e = setup();
    moveTo(e, 'z', 2.1);
    moveTo(e, 'x', 0.45);
    // 1" at 0.1 in/s metered in 0.05 s steps = 10 s of cutting -> about 1 + 40 events
    moveTo(e, 'z', 1.95);
    for (let i = 0; i < 200; i++) e.dispatch({ type: 'turnHandwheel', axis: 'z', revolutions: -0.05, dt: 0.05 });
    expect(count(e, 'cut')).toBeGreaterThanOrEqual(39);
    expect(count(e, 'cut')).toBeLessThanOrEqual(42);
  });

  it('parting splits the piece off and emits a parted event; collectPart moves it to inventory', () => {
    const e = setup(BRASS_1x3, 'parting', 300);
    moveTo(e, 'x', 0.6);
    moveTo(e, 'z', 0.9275);
    moveTo(e, 'x', -0.02, 0.05);
    const s = e.getState();
    expect(s.partedPieces).toHaveLength(1);
    const ev = s.events.find((x) => x.kind === 'parted');
    expect(ev).toMatchObject({ kind: 'parted', pieceIndex: 0 });
    const segs = profileSegments(s.partedPieces[0]);
    expect(segs).toHaveLength(1);
    expect(segs[0].diameter).toBe(1);
    expect(segs[0].z1 - segs[0].z0).toBeCloseTo(1.01, 9);
    expect(facePosition(s.workpiece!)!).toBeLessThan(0.93);
    expect(kinds(e)).not.toContain('heavyCut');
    expect(kinds(e)).not.toContain('chatter');
    e.dispatch({ type: 'collectPart' });
    expect(e.getState().partedPieces).toHaveLength(0);
    expect(e.getState().inventory).toHaveLength(1);
  });

  it('end to end: face, turn to 0.500 over 1", part off, measure and grade', () => {
    const e = makePinDirect();
    const s = e.getState();
    expect(s.partedPieces).toHaveLength(1);
    const segs = profileSegments(s.partedPieces[0]);
    expect(segs).toHaveLength(1);
    expect(segs[0].diameter).toBeCloseTo(0.5, 9);
    expect(segs[0].z1 - segs[0].z0).toBeCloseTo(1.0, 9);
    const bad = s.events.filter((x) => ['crash', 'rubbing', 'heavyCut', 'chatter', 'poorFinish', 'toolBroken'].includes(x.kind));
    expect(bad).toEqual([]);
    const challenge: Challenge = {
      id: 'hand-pin',
      title: 'Pin',
      difficulty: 1,
      description: '',
      stock: BRASS_1x3,
      target: { segments: [{ z0: 0, z1: 1, diameter: 0.5, tol: 0.005 }], overallLength: 1, lengthTol: 0.01 },
      solution: { id: 's', steps: [] },
      hints: [],
      requireParted: true,
      concepts: [],
    };
    const g = grade(challenge, s);
    expect(g.passed).toBe(true);
    expect(g.score).toBe(100);
  });

  it('drilling with the tailstock creates a bore', () => {
    const e = setup(createShortStock(), 'turning', 1200);
    e.dispatch({ type: 'setSpindle', on: false });
    e.dispatch({ type: 'selectTool', tool: 'none' });
    e.dispatch({ type: 'selectTailstockTool', tool: 'drill-1/4' });
    e.dispatch({ type: 'setSpindle', on: true });
    expect(e.tailstockTipZ()).toBeCloseTo(1.5, 9);
    moveTo(e, 'quill', 0.6, 0.05); // tip at 0.9
    const wp = e.getState().workpiece!;
    expect(boreDiameterAt(wp, 1.4)).toBeCloseTo(0.25, 9);
    expect(boreDiameterAt(wp, 0.95)).toBeGreaterThan(0);
    expect(boreDiameterAt(wp, 0.95)).toBeLessThan(0.25);
    expect(boreDiameterAt(wp, 0.85)).toBe(0);
    expect(diameterAt(wp, 1.4)).toBe(1);
    expect(count(e, 'cut')).toBe(1);
    expect(kinds(e)).not.toContain('chatter');
    expect(kinds(e)).not.toContain('heavyCut');
  });

  it('a live center never removes material', () => {
    const e = setup(createShortStock());
    e.dispatch({ type: 'setSpindle', on: false });
    e.dispatch({ type: 'selectTool', tool: 'none' });
    e.dispatch({ type: 'selectTailstockTool', tool: 'live-center' });
    e.dispatch({ type: 'setSpindle', on: true });
    const wp = e.getState().workpiece;
    moveTo(e, 'quill', 1.0);
    expect(e.getState().workpiece).toBe(wp);
    expect(kinds(e)).not.toContain('rubbing');
  });
});

function createShortStock() {
  return { material: 'brass' as const, diameter: 1, length: 3, stickOut: 1.5 };
}

describe('safety events', () => {
  it('parting tool at z = 0.03 crashes into the chuck and stops short', () => {
    const e = setup(BRASS_1x3, 'parting', 300);
    moveTo(e, 'x', 0.6);
    moveTo(e, 'z', 0.03);
    const s = e.getState();
    const crash = s.events.find((x) => x.kind === 'crash');
    expect(crash).toMatchObject({ kind: 'crash', what: 'chuck', tool: 'parting' });
    expect(s.damage.crashed).toBe(true);
    expect(s.z).toBeGreaterThanOrEqual(0.0625 - 1e-9);
    expect(s.z).toBeLessThan(0.07);
    // pushing further does not spam crash events
    moveTo(e, 'z', 0.01);
    expect(count(e, 'crash')).toBe(1);
    moveTo(e, 'z', 0.5);
    moveTo(e, 'z', 0.0);
    expect(count(e, 'crash')).toBe(2);
  });

  it('parting at z = 0.1 is clear of the jaws', () => {
    const e = setup(BRASS_1x3, 'parting', 300);
    moveTo(e, 'x', 0.6);
    moveTo(e, 'z', 0.1);
    expect(kinds(e)).not.toContain('crash');
  });

  it('the tool hits the drill when the quill is run out into it', () => {
    const e = new LatheEngine();
    e.dispatch({ type: 'selectTool', tool: 'turning' });
    moveTo(e, 'z', 1.0);
    moveTo(e, 'x', 0.1);
    e.dispatch({ type: 'selectTailstockTool', tool: 'drill-1/4' }); // tip at 1.5
    moveTo(e, 'quill', 1.0);
    const crash = e.getState().events.find((x) => x.kind === 'crash');
    expect(crash).toMatchObject({ what: 'tailstock' });
    // the drill tip stops where it meets the tool's back edge at z = 1.25
    expect(e.getState().quill).toBeCloseTo(0.25, 2);
    expect(e.getState().quill).toBeLessThanOrEqual(0.25);
  });

  it('rubbing: tool touches the work with the spindle off, once per contact', () => {
    const e = new LatheEngine();
    e.dispatch({ type: 'loadStock', stock: BRASS_1x3 });
    e.dispatch({ type: 'selectTool', tool: 'turning' });
    moveTo(e, 'z', 1.99);
    moveTo(e, 'x', 0.4);
    moveTo(e, 'x', 0.3);
    expect(count(e, 'rubbing')).toBe(1);
    expect(facePosition(e.getState().workpiece!)).toBeCloseTo(2, 9);
    moveTo(e, 'x', 0.7);
    moveTo(e, 'x', 0.3);
    expect(count(e, 'rubbing')).toBe(2);
    expect(e.getState().events.find((x) => x.kind === 'rubbing')).toMatchObject({ tool: 'turning' });
  });

  it('drill rubbing with the spindle off', () => {
    const e = new LatheEngine();
    e.dispatch({ type: 'loadStock', stock: createShortStock() });
    e.dispatch({ type: 'selectTailstockTool', tool: 'center-drill' });
    moveTo(e, 'quill', 1.2);
    expect(e.getState().events.find((x) => x.kind === 'rubbing')).toMatchObject({ tool: 'center-drill' });
  });

  it('heavy cut emits heavyCut; more than twice the max breaks the tool', () => {
    const e = setup();
    moveTo(e, 'z', 2.1);
    moveTo(e, 'x', 0.42); // 0.080 deep in brass (max 0.060)
    moveTo(e, 'z', 1.5, 0.2);
    expect(e.getState().events.find((x) => x.kind === 'heavyCut')).toMatchObject({ max: 0.06 });
    expect(kinds(e)).not.toContain('toolBroken');

    const b = setup();
    moveTo(b, 'z', 2.1);
    moveTo(b, 'x', 0.3); // 0.200 deep
    moveTo(b, 'z', 1.5, 0.2);
    expect(kinds(b)).toContain('heavyCut');
    expect(count(b, 'toolBroken')).toBe(1);
    expect(b.getState().damage.toolBroken).toBe(true);
    const wpBroken = b.getState().workpiece;
    moveTo(b, 'z', 1.0, 0.2);
    expect(b.getState().workpiece).toBe(wpBroken); // broken tool removes nothing
    b.dispatch({ type: 'setSpindle', on: false });
    b.dispatch({ type: 'selectTool', tool: 'turning' });
    expect(b.getState().damage.toolBroken).toBe(false);
  });

  it('a wide facing bite counts as a heavy cut (axial depth)', () => {
    const e = setup();
    moveTo(e, 'z', 1.9); // 0.100 axial
    moveTo(e, 'x', 0.3);
    expect(e.getState().events.find((x) => x.kind === 'heavyCut')).toMatchObject({ kind: 'heavyCut' });
  });

  it('chatter when surface speed is too high, once per pass', () => {
    const e = setup(BRASS_1x3, 'turning', 2000);
    moveTo(e, 'z', 2.1);
    moveTo(e, 'x', 0.47);
    moveTo(e, 'z', 1.5, 0.2);
    moveTo(e, 'z', 1.0, 0.2);
    expect(count(e, 'chatter')).toBe(1);
    const ch = e.getState().events.find((x) => x.kind === 'chatter');
    expect(ch).toMatchObject({ rpm: 2000, diameter: 1, tool: 'turning' });
  });

  it('parting chatters at a speed that is fine for turning', () => {
    const e = setup(BRASS_1x3, 'parting', 600);
    moveTo(e, 'x', 0.6);
    moveTo(e, 'z', 1.0);
    moveTo(e, 'x', 0.4, 0.05);
    expect(count(e, 'chatter')).toBe(1);
  });

  it('poor finish when feeding too fast', () => {
    const e = setup();
    moveTo(e, 'z', 2.1);
    moveTo(e, 'x', 0.47);
    e.dispatch({ type: 'turnHandwheel', axis: 'z', revolutions: -5 }); // 0.5" in default 0.1 s
    expect(e.getState().events.find((x) => x.kind === 'poorFinish')).toMatchObject({ feedRate: 5 });
  });

  it('wrongDirection when cutting in reverse', () => {
    const e = setup();
    e.dispatch({ type: 'setSpindle', on: true, reverse: true });
    moveTo(e, 'z', 2.1);
    moveTo(e, 'x', 0.47);
    moveTo(e, 'z', 1.8, 0.2);
    expect(count(e, 'wrongDirection')).toBe(1);
  });

  it('no tool mounted: moving through the work does nothing', () => {
    const e = new LatheEngine();
    e.dispatch({ type: 'loadStock', stock: BRASS_1x3 });
    e.dispatch({ type: 'setSpindle', on: true });
    moveTo(e, 'x', 0.1);
    moveTo(e, 'z', 0.5);
    expect(kinds(e).filter((k) => k !== 'stockLoaded' && k !== 'spindleOn')).toEqual([]);
  });

  it('spindle at 0 rpm counts as stopped', () => {
    const e = setup(BRASS_1x3, 'turning', 0);
    moveTo(e, 'z', 1.99);
    moveTo(e, 'x', 0.3);
    expect(count(e, 'rubbing')).toBe(1);
  });
});
