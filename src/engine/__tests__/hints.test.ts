import { describe, expect, it } from 'vitest';
import { describeAction, describeCheck, evaluateCheck, isPersistentCheck, nextHint, scriptProgress } from '../hints';
import { LatheEngine } from '../lathe';
import { runScript } from '../script';
import type { Action, Challenge, StateCheck } from '../types';
import { makePinDirect, moveTo, pinChallenge, setup } from './fixtures';

describe('evaluateCheck', () => {
  it('evaluates machine-setting checks', () => {
    const e = setup();
    const s = e.getState();
    expect(evaluateCheck({ kind: 'toolIs', tool: 'turning' }, s)).toBe(true);
    expect(evaluateCheck({ kind: 'toolIs', tool: 'parting' }, s)).toBe(false);
    expect(evaluateCheck({ kind: 'tailstockToolIs', tool: 'none' }, s)).toBe(true);
    expect(evaluateCheck({ kind: 'spindle', on: true }, s)).toBe(true);
    expect(evaluateCheck({ kind: 'rpmAtMost', rpm: 600 }, s)).toBe(true);
    expect(evaluateCheck({ kind: 'rpmAtMost', rpm: 300 }, s)).toBe(false);
    expect(evaluateCheck({ kind: 'rpmAtLeast', rpm: 600 }, s)).toBe(true);
    expect(evaluateCheck({ kind: 'rpmAtLeast', rpm: 1200 }, s)).toBe(false);
    expect(evaluateCheck({ kind: 'stockLoaded' }, s)).toBe(true);
    expect(evaluateCheck({ kind: 'stockLoaded' }, new LatheEngine().getState())).toBe(false);
    expect(evaluateCheck({ kind: 'xBetween', min: 0.7, max: 0.75 }, s)).toBe(true);
    expect(evaluateCheck({ kind: 'xBetween', min: 0.1, max: 0.2 }, s)).toBe(false);
    expect(evaluateCheck({ kind: 'zBetween', min: 1.9, max: 2.1 }, s)).toBe(true);
    expect(evaluateCheck({ kind: 'zBetween', min: 0, max: 1 }, s)).toBe(false);
    expect(evaluateCheck({ kind: 'all', checks: [] }, s)).toBe(true);
    expect(evaluateCheck({ kind: 'all', checks: [{ kind: 'stockLoaded' }, { kind: 'toolIs', tool: 'parting' }] }, s)).toBe(false);
  });

  it('evaluates work checks', () => {
    const e = setup();
    moveTo(e, 'z', 1.99);
    moveTo(e, 'x', -0.02);
    moveTo(e, 'x', 0.6);
    moveTo(e, 'z', 2.1);
    moveTo(e, 'x', 0.45);
    moveTo(e, 'z', 1.0, 0.2);
    e.dispatch({ type: 'setSpindle', on: false });
    e.dispatch({ type: 'selectTool', tool: 'none' });
    e.dispatch({ type: 'selectTailstockTool', tool: 'drill-1/4' });
    e.dispatch({ type: 'setSpindle', on: true });
    moveTo(e, 'quill', 1.0, 0.05); // tip at 0.5
    const s = e.getState();
    expect(evaluateCheck({ kind: 'facedTo', zMax: 1.99 }, s)).toBe(true);
    expect(evaluateCheck({ kind: 'facedTo', zMax: 1.9 }, s)).toBe(false);
    expect(evaluateCheck({ kind: 'diameterBetween', z0: 1.05, z1: 1.95, min: 0.895, max: 0.905 }, s)).toBe(true);
    expect(evaluateCheck({ kind: 'diameterBetween', z1: 1.05, z0: 1.95, min: 0.895, max: 0.905 }, s)).toBe(true);
    expect(evaluateCheck({ kind: 'diameterBetween', z0: 0.5, z1: 1.95, min: 0.895, max: 0.905 }, s)).toBe(false);
    expect(evaluateCheck({ kind: 'diameterBetween', z0: 5, z1: 6, min: 0, max: 1 }, s)).toBe(false);
    expect(evaluateCheck({ kind: 'boreAtLeast', z0: 0.7, z1: 1.99, minDiameter: 0.25 }, s)).toBe(true);
    expect(evaluateCheck({ kind: 'boreAtLeast', z0: 0.4, z1: 1.99, minDiameter: 0.25 }, s)).toBe(false);
    expect(evaluateCheck({ kind: 'parted' }, s)).toBe(false);
    const none = new LatheEngine().getState();
    expect(evaluateCheck({ kind: 'facedTo', zMax: 9 }, none)).toBe(false);
    expect(evaluateCheck({ kind: 'diameterBetween', z0: 0, z1: 1, min: 0, max: 9 }, none)).toBe(false);
  });

  it('parted is true for parted or collected pieces', () => {
    const e = makePinDirect();
    expect(evaluateCheck({ kind: 'parted' }, e.getState())).toBe(true);
    e.dispatch({ type: 'collectPart' });
    expect(evaluateCheck({ kind: 'parted' }, e.getState())).toBe(true);
  });

  it('classifies persistent checks', () => {
    expect(isPersistentCheck({ kind: 'parted' })).toBe(true);
    expect(isPersistentCheck({ kind: 'toolIs', tool: 'turning' })).toBe(false);
    expect(isPersistentCheck({ kind: 'all', checks: [{ kind: 'parted' }, { kind: 'facedTo', zMax: 1 }] })).toBe(true);
    expect(isPersistentCheck({ kind: 'all', checks: [] })).toBe(false);
  });
});

describe('descriptions', () => {
  it('describes every action kind', () => {
    const actions: Action[] = [
      { type: 'loadStock', stock: { material: 'brass', diameter: 1, length: 3, stickOut: 1.5 } },
      { type: 'removeStock' },
      { type: 'selectTool', tool: 'parting' },
      { type: 'selectTailstockTool', tool: 'center-drill' },
      { type: 'setSpindle', on: true },
      { type: 'setSpindle', on: true, reverse: true },
      { type: 'setSpindle', on: false },
      { type: 'setRpm', rpm: 300 },
      { type: 'turnHandwheel', axis: 'x', revolutions: 1 },
      { type: 'turnHandwheel', axis: 'x', revolutions: -1 },
      { type: 'turnHandwheel', axis: 'z', revolutions: 1 },
      { type: 'turnHandwheel', axis: 'z', revolutions: -2.5 },
      { type: 'turnHandwheel', axis: 'quill', revolutions: 1 },
      { type: 'turnHandwheel', axis: 'quill', revolutions: -1 },
      { type: 'zeroDial', axis: 'z' },
      { type: 'collectPart' },
    ];
    const texts = actions.map((a) => describeAction(a));
    expect(texts.every((t) => typeof t === 'string' && t.length > 5)).toBe(true);
    expect(texts[8]).toContain('50 thou');
    expect(texts[8]).toContain('clockwise');
    expect(texts[11]).toContain('toward the chuck');
    expect(texts[11]).toContain('250 thou');
    expect(describeAction({ type: 'wait', duration: 1 })).toBeNull();
    expect(describeAction({ type: 'say', text: 'x' })).toBeNull();
  });

  it('describes every check kind', () => {
    const checks: StateCheck[] = [
      { kind: 'toolIs', tool: 'turning' },
      { kind: 'tailstockToolIs', tool: 'drill-1/4' },
      { kind: 'spindle', on: true },
      { kind: 'spindle', on: false },
      { kind: 'rpmAtMost', rpm: 300 },
      { kind: 'rpmAtLeast', rpm: 300 },
      { kind: 'stockLoaded' },
      { kind: 'xBetween', min: 0.25, max: 0.26 },
      { kind: 'zBetween', min: 0, max: 1 },
      { kind: 'facedTo', zMax: 1.49 },
      { kind: 'diameterBetween', z0: 0, z1: 1, min: 0.495, max: 0.505 },
      { kind: 'boreAtLeast', z0: 0, z1: 1, minDiameter: 0.25 },
      { kind: 'parted' },
    ];
    for (const c of checks) expect(describeCheck(c).length).toBeGreaterThan(5);
    expect(describeCheck({ kind: 'xBetween', min: 0.25, max: 0.26 })).toContain('0.500');
    expect(describeCheck({ kind: 'all', checks: checks.slice(0, 2) })).toContain(', and ');
  });
});

describe('scriptProgress and nextHint', () => {
  it('walks through the solution as the user works', () => {
    const c = pinChallenge();
    const e = new LatheEngine();
    let h = nextHint(c, e.getState());
    // a fresh machine has no stock: the first hint is to load it
    expect(h).toMatchObject({ stepId: 'load', level: 1, title: 'Load the stock' });
    e.dispatch({ type: 'loadStock', stock: c.stock });
    h = nextHint(c, e.getState());
    expect(h.stepId).toBe('setup');
    const h2 = nextHint(c, e.getState(), h);
    expect(h2.level).toBe(2);
    expect(h2.text).toContain('Mount the turning tool in the toolpost.');
    expect(h2.text).toContain('600 rpm');
    expect(h2.text).toContain("You're done with this step when");
    e.dispatch({ type: 'selectTool', tool: 'turning' });
    expect(nextHint(c, e.getState(), h2)).toMatchObject({ stepId: 'spindle', level: 1 });
    e.dispatch({ type: 'setSpindle', on: true });
    expect(nextHint(c, e.getState()).stepId).toBe('face');
    const face2 = nextHint(c, e.getState(), { stepId: 'face', level: 1 });
    expect(face2.text).toMatch(/carriage handwheel .* counter-clockwise/);
    expect(face2.lines?.length).toBeGreaterThan(1);
    expect(face2.text.startsWith('1. ')).toBe(true);
  });

  it('progress stays done for earlier transient steps once later ones complete', () => {
    const c = pinChallenge();
    const s = runScript(new LatheEngine(), c.solution);
    const p = scriptProgress(c.solution, s);
    expect(p.nextStep).toBe(c.solution.steps.length);
    expect(p.everTrue.every(Boolean)).toBe(true);
    expect(nextHint(c, s)).toMatchObject({ stepId: 'done', title: 'Check your part' });
  });

  it('a persistent later check in the live state skips ahead', () => {
    const c = pinChallenge();
    const e = makePinDirect(); // never stops at 0.520 so the rough check is never true
    const p = scriptProgress(c.solution, e.getState());
    expect(p.everTrue[c.solution.steps.findIndex((s) => s.id === 'rough')]).toBe(false);
    expect(p.nextStep).toBeGreaterThan(c.solution.steps.findIndex((s) => s.id === 'part'));
  });

  it('falls back to generic hints for a challenge without solution steps', () => {
    const c: Challenge = { ...pinChallenge(), solution: { id: 'x', steps: [] } };
    expect(nextHint(c, new LatheEngine().getState())).toMatchObject({ stepId: 'generic', text: 'Face first.' });
    const c2: Challenge = { ...c, hints: [] };
    expect(nextHint(c2, new LatheEngine().getState()).text).toBe('Follow the drawing.');
  });

  it('level 2 for a step with only waits falls back to the generic hint', () => {
    const c: Challenge = {
      ...pinChallenge(),
      solution: { id: 'w', steps: [{ id: 'think', title: 'Think', narration: 'Plan it.', actions: [{ type: 'wait', duration: 1 }], check: { kind: 'parted' } }] },
    };
    expect(nextHint(c, new LatheEngine().getState(), { stepId: 'think', level: 1 }).text).toContain('parted off');
    const c2: Challenge = { ...c, solution: { id: 'w', steps: [{ ...c.solution.steps[0], check: undefined }] } };
    // no check: the step is complete immediately
    expect(nextHint(c2, new LatheEngine().getState()).stepId).toBe('done');
  });
});
