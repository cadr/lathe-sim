import { describe, expect, it, vi } from 'vitest';
import { LatheEngine } from '../lathe';
import { actionDuration, runScript, scriptDuration, ScriptPlayer, stepDuration, type PlayerStatus } from '../script';
import type { Script } from '../types';
import { pinChallenge } from './fixtures';

const simple: Script = {
  id: 'simple',
  steps: [
    {
      id: 'a',
      title: 'Move in',
      narration: 'Turn the cross-slide two turns.',
      actions: [
        { type: 'say', text: 'Watch the dial.', duration: 0.5 },
        { type: 'turnHandwheel', axis: 'x', revolutions: 2, duration: 1 },
      ],
      check: { kind: 'xBetween', min: 0.649, max: 0.651 },
    },
    {
      id: 'b',
      title: 'Spindle',
      narration: 'Start it.',
      actions: [{ type: 'setSpindle', on: true }, { type: 'wait', duration: 0.5 }],
      check: { kind: 'spindle', on: true },
    },
    {
      id: 'c',
      title: 'Carriage',
      narration: 'Back off.',
      actions: [{ type: 'turnHandwheel', axis: 'z', revolutions: 3, duration: 0.05 }],
    },
  ],
};

function run(dts: number[], script = simple) {
  const e = new LatheEngine();
  const p = new ScriptPlayer(e, script);
  p.play();
  for (const dt of dts) {
    e.tick(dt);
    p.tick(dt);
  }
  return { e, p };
}

describe('durations', () => {
  it('applies defaults and minimums', () => {
    expect(actionDuration({ type: 'turnHandwheel', axis: 'x', revolutions: 1 })).toBe(1);
    expect(actionDuration({ type: 'turnHandwheel', axis: 'x', revolutions: 1, duration: 0.05 })).toBe(0.2);
    expect(actionDuration({ type: 'wait', duration: -1 })).toBe(0);
    expect(actionDuration({ type: 'say', text: 'hi' })).toBe(2);
    expect(actionDuration({ type: 'setRpm', rpm: 300 })).toBe(0.3);
    expect(actionDuration({ type: 'setRpm', rpm: 300, duration: 0 })).toBe(0);
    expect(stepDuration(simple.steps[0])).toBe(1.5);
    expect(scriptDuration(simple)).toBeCloseTo(1.5 + 0.8 + 0.2, 9);
  });
});

describe('ScriptPlayer', () => {
  it('meters handwheel revolutions over the duration and lands exactly', () => {
    const { e, p } = run([0.5, 0.25]);
    expect(e.getState().x).toBeCloseTo(0.75 - 0.025, 9);
    expect(p.getStatus()).toMatchObject({ stepIndex: 0, actionIndex: 1 });
    expect(p.getStatus().progress).toBeCloseTo(0.75 / 1.5, 9);
    const { e: e2 } = run([0.3, 0.3, 0.3, 0.3, 0.3]);
    expect(e2.getState().x).toBeCloseTo(0.65, 12);
    const moves = e2.getState().actions.filter((a) => a.action.type === 'turnHandwheel');
    expect(moves.every((a) => a.action.type === 'turnHandwheel' && a.action.dt! > 0)).toBe(true);
  });

  it('shows say captions while they play', () => {
    const { p } = run([0.25]);
    expect(p.getStatus()).toMatchObject({ caption: 'Watch the dial.', narration: 'Turn the cross-slide two turns.', title: 'Move in', stepId: 'a' });
    const { p: p2 } = run([0.6]);
    expect(p2.getStatus().caption).toBeNull();
  });

  it('plays to the end and reports done', () => {
    const { e, p } = run(Array(200).fill(1 / 60));
    expect(p.isDone).toBe(true);
    expect(p.isPlaying).toBe(false);
    expect(p.getStatus()).toMatchObject({ done: true, progress: 1, stepIndex: 2 });
    expect(e.getState().x).toBeCloseTo(0.65, 12);
    expect(e.getState().z).toBeCloseTo(2.3, 12);
    expect(e.getState().spindle.on).toBe(true);
    p.play();
    expect(p.isPlaying).toBe(false);
    p.tick(1);
    p.stepForward();
    expect(e.getState().z).toBeCloseTo(2.3, 12);
  });

  it('is deterministic for the same dt sequence', () => {
    const dts = Array.from({ length: 400 }, (_, i) => (i % 3 === 0 ? 0.013 : 0.021));
    const a = run(dts).e.getState();
    const b = run(dts).e.getState();
    expect(b.actions).toEqual(a.actions);
    expect(b.events).toEqual(a.events);
    expect([b.x, b.z]).toEqual([a.x, a.z]);
  });

  it('a full solution run is deterministic and the same regardless of frame rate for the final part', () => {
    const c = pinChallenge();
    const s60 = runScript(new LatheEngine(), c.solution, 1 / 60);
    const s60b = runScript(new LatheEngine(), c.solution, 1 / 60);
    expect(Array.from(s60b.partedPieces[0].outer)).toEqual(Array.from(s60.partedPieces[0].outer));
    expect(s60b.events).toEqual(s60.events);
    const s30 = runScript(new LatheEngine(), c.solution, 1 / 30);
    expect(s30.partedPieces[0].outer.length).toBe(s60.partedPieces[0].outer.length);
  });

  it('pause stops progress; play resumes', () => {
    const e = new LatheEngine();
    const p = new ScriptPlayer(e, simple);
    p.tick(1);
    expect(e.getState().actions).toHaveLength(0);
    p.play();
    p.tick(0.75);
    p.pause();
    p.tick(5);
    expect(e.getState().x).toBeCloseTo(0.725, 9);
    p.play();
    p.tick(0.75);
    expect(e.getState().x).toBeCloseTo(0.65, 9);
  });

  it('stepForward finishes the current step instantly', () => {
    const e = new LatheEngine();
    const p = new ScriptPlayer(e, simple);
    p.play();
    p.tick(0.75);
    p.stepForward();
    expect(e.getState().x).toBeCloseTo(0.65, 9);
    expect(p.getStatus()).toMatchObject({ stepIndex: 1, actionIndex: 0 });
    p.stepForward();
    expect(e.getState().spindle.on).toBe(true);
    p.stepForward();
    expect(p.isDone).toBe(true);
  });

  it('jumpTo fast-forwards, and rewinds by resetting the engine', () => {
    const e = new LatheEngine();
    const p = new ScriptPlayer(e, simple);
    p.jumpTo(2);
    expect(p.getStatus().stepIndex).toBe(2);
    expect(e.getState().x).toBeCloseTo(0.65, 12);
    expect(e.getState().spindle.on).toBe(true);
    p.jumpTo(1);
    expect(p.getStatus().stepIndex).toBe(1);
    expect(e.getState().x).toBeCloseTo(0.65, 12);
    expect(e.getState().spindle.on).toBe(false);
    p.jumpTo(0);
    expect(e.getState().x).toBe(0.75);
    p.jumpTo(0); // already at the start of step 0: no-op
    expect(e.getState().actions).toHaveLength(0);
    p.jumpTo(99);
    expect(p.isDone).toBe(true);
    p.jumpTo(1);
    expect(p.isDone).toBe(false);
    expect(e.getState().spindle.on).toBe(false);
  });

  it('pauseAtStepEnd stops at each step boundary', () => {
    const e = new LatheEngine();
    const p = new ScriptPlayer(e, simple, { pauseAtStepEnd: true });
    p.play();
    p.tick(10);
    expect(p.isPlaying).toBe(false);
    expect(p.getStatus().stepIndex).toBe(1);
    expect(e.getState().spindle.on).toBe(false);
    p.play();
    p.tick(10);
    expect(p.getStatus().stepIndex).toBe(2);
    expect(e.getState().spindle.on).toBe(true);
  });

  it('reports whether the current step check is satisfied', () => {
    const e = new LatheEngine();
    const p = new ScriptPlayer(e, simple);
    expect(p.currentStep?.id).toBe('a');
    expect(p.currentStepSatisfied()).toBe(false);
    e.dispatch({ type: 'turnHandwheel', axis: 'x', revolutions: 2 });
    expect(p.currentStepSatisfied()).toBe(true);
    p.jumpTo(3);
    expect(p.currentStep).toBeNull();
    expect(p.currentStepSatisfied()).toBe(true);
  });

  it('emits status to subscribers', () => {
    const e = new LatheEngine();
    const p = new ScriptPlayer(e, simple);
    const seen: PlayerStatus[] = [];
    const fn = vi.fn((s: PlayerStatus) => seen.push(s));
    const off = p.subscribe(fn);
    p.play();
    p.tick(0.1);
    expect(seen[seen.length - 1]).toMatchObject({ playing: true, stepIndex: 0 });
    off();
    p.pause();
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('handles an empty script', () => {
    const p = new ScriptPlayer(new LatheEngine(), { id: 'empty', steps: [] });
    expect(p.isDone).toBe(true);
    expect(p.getStatus()).toMatchObject({ done: true, stepId: null, narration: '' });
    p.play();
    expect(p.isPlaying).toBe(false);
  });

  it('handles steps with no actions and zero-duration actions', () => {
    const script: Script = {
      id: 'z',
      steps: [
        { id: 'empty', title: 'Nothing', narration: '', actions: [] },
        { id: 'instant', title: 'Instant', narration: '', actions: [{ type: 'setRpm', rpm: 300, duration: 0 }, { type: 'zeroDial', axis: 'x', duration: 0 }] },
      ],
    };
    const e = new LatheEngine();
    const p = new ScriptPlayer(e, script);
    p.play();
    p.tick(0.01);
    expect(p.isDone).toBe(true);
    expect(e.getState().spindle.rpm).toBe(300);
  });

  it('runScript throws when a script cannot finish', () => {
    const long: Script = { id: 'long', steps: [{ id: 'w', title: 'w', narration: '', actions: [{ type: 'wait', duration: 100 }] }] };
    expect(() => runScript(new LatheEngine(), long, 1, 10)).toThrow(/did not finish/);
  });
});
