// Regression tests for the second QA fix round (second QA pass).
import { describe, expect, it } from 'vitest';
import { analyze } from '../analyzer';
import { HEAVY_CUT_CAP, grade } from '../grader';
import { checkImpossible, impossibleReason, nextHint, scriptProgress, stepInstructions } from '../hints';
import { CRASH_CLEAR_DISTANCE, LatheEngine } from '../lathe';
import { recommendedRpm } from '../physics';
import { ScriptPlayer, runScript } from '../script';
import type { LatheEvent, LatheEventKind, LatheState, Script, StateCheck } from '../types';
import { BRASS_1x3, makePinDirect, moveTo, pinChallenge, setup } from './fixtures';

const kinds = (e: LatheEngine): LatheEventKind[] => e.getState().events.map((ev) => ev.kind);
/** One click of the cross-slide "+1 rev" button: 0.050 in, reported at the UI's steady feed. */
const plusOneRev = (e: LatheEngine) => e.dispatch({ type: 'turnHandwheel', axis: 'x', revolutions: 1, dt: 2.5 });

describe('deep plunges accumulate (P1-B)', () => {
  it('six one-turn clicks into the side of the bar are a heavy cut, then a broken tool', () => {
    const e = setup();
    moveTo(e, 'z', 1.0);
    moveTo(e, 'x', 0.51); // X dia 1.020, just clear of the bar
    plusOneRev(e); // 0.040 into the bar: fine
    expect(kinds(e)).not.toContain('heavyCut');
    plusOneRev(e); // 0.090 deep in total
    const heavy = e.getState().events.find((ev) => ev.kind === 'heavyCut');
    expect(heavy && heavy.kind === 'heavyCut' && heavy.depth).toBeCloseTo(0.09, 2);
    expect(kinds(e)).not.toContain('toolBroken');
    plusOneRev(e); // 0.140: more than twice the 0.060 limit
    expect(kinds(e)).toContain('toolBroken');
    expect(e.getState().damage.toolBroken).toBe(true);
    for (let i = 0; i < 3; i++) plusOneRev(e);
    expect(kinds(e).filter((k) => k === 'heavyCut')).toHaveLength(1);
    expect(kinds(e).filter((k) => k === 'toolBroken')).toHaveLength(1);
  });

  it('counts a groove dug in tiny steps, even with retracts in between, at the same carriage position', () => {
    const e = setup();
    moveTo(e, 'z', 1.0);
    moveTo(e, 'x', 0.5);
    for (let i = 0; i < 4; i++) {
      moveTo(e, 'x', e.getState().x - 0.02, 0.01); // 20 thou in
      moveTo(e, 'x', e.getState().x + 0.005, 0.1); // back off a little
    }
    // net 0.060 + the last bite: the deepest point is 0.080 below the bar
    expect(kinds(e)).toContain('heavyCut');
  });

  it('successive turning passes are measured per pass, not added up', () => {
    const e = setup();
    for (const r of [0.47, 0.44, 0.41, 0.38, 0.35]) {
      moveTo(e, 'z', 2.1);
      moveTo(e, 'x', r);
      moveTo(e, 'z', 1.2, 0.05);
      moveTo(e, 'x', 0.6);
    }
    expect(kinds(e)).not.toContain('heavyCut');
  });

  it('an infeed at the shoulder after a pass, then feeding on, is a fresh plunge', () => {
    const e = setup();
    moveTo(e, 'z', 2.1);
    moveTo(e, 'x', 0.47);
    moveTo(e, 'z', 1.2, 0.05);
    moveTo(e, 'x', 0.44, 0.01); // 30 thou deeper at the shoulder: under the limit
    moveTo(e, 'z', 1.0, 0.05);
    moveTo(e, 'x', 0.41, 0.01); // another 30, at a new carriage position
    expect(kinds(e)).not.toContain('heavyCut');
  });

  it('facing across the whole face with a small axial step is never a deep plunge', () => {
    const e = setup();
    for (const z of [1.99, 1.98, 1.97]) {
      moveTo(e, 'z', z);
      moveTo(e, 'x', 0.55);
      for (let i = 0; i < 56; i++) e.dispatch({ type: 'turnHandwheel', axis: 'x', revolutions: 0.2, dt: 0.1 });
      moveTo(e, 'x', 0.7);
    }
    expect(kinds(e)).not.toContain('heavyCut');
    expect(kinds(e)).not.toContain('toolBroken');
  });

  it('a tool change or new stock starts a new plunge', () => {
    const e = setup();
    moveTo(e, 'z', 1.0);
    moveTo(e, 'x', 0.51);
    moveTo(e, 'x', 0.47, 0.01); // 30 thou
    e.dispatch({ type: 'setSpindle', on: false });
    e.dispatch({ type: 'selectTool', tool: 'turning' }); // fresh insert
    e.dispatch({ type: 'setSpindle', on: true });
    moveTo(e, 'x', 0.44, 0.01); // 30 more, measured from the new start
    expect(kinds(e)).not.toContain('heavyCut');
  });
});

describe('repeated crashes into the same thing (P2-10)', () => {
  it('extra clicks into the jaws, or small moves around them, are one crash', () => {
    const e = setup();
    moveTo(e, 'x', 0.9);
    moveTo(e, 'z', 0.05);
    for (let i = 0; i < 5; i++) e.dispatch({ type: 'turnHandwheel', axis: 'z', revolutions: -0.1, dt: 0.5 });
    e.dispatch({ type: 'turnHandwheel', axis: 'x', revolutions: -0.1, dt: 0.5 }); // 5 thou out
    e.dispatch({ type: 'turnHandwheel', axis: 'z', revolutions: -0.1, dt: 0.5 });
    expect(kinds(e).filter((k) => k === 'crash')).toHaveLength(1);
    // backing well away and crashing again is a second crash
    moveTo(e, 'z', 0.05 + CRASH_CLEAR_DISTANCE * 3);
    moveTo(e, 'z', -0.05);
    expect(kinds(e).filter((k) => k === 'crash')).toHaveLength(2);
    expect(grade(pinChallenge(), e.getState()).checks.find((c) => c.label === 'Safety')!.actual).toMatch(/^2 crashes/);
  });
});

describe('grading weights (P2-3, P2-7)', () => {
  const withEvents = (extra: Partial<LatheEvent>[]): LatheState => {
    const s = makePinDirect().getState();
    return { ...s, events: [...s.events, ...(extra as LatheEvent[])] };
  };

  it('a heavy cut costs 5 points, capped at 15, and not again when it broke the tool', () => {
    const c = pinChallenge();
    const clean = grade(c, makePinDirect().getState()).score;
    const one = grade(c, withEvents([{ t: 1, kind: 'heavyCut', depth: 0.07, max: 0.06, actionIndex: 5 }]));
    expect(one.deductions).toContainEqual({ label: 'Heavy cut ×1', points: 5 });
    expect(one.score).toBe(clean - 5);
    const many = grade(c, withEvents([1, 2, 3, 4, 5].map((i) => ({ t: i, kind: 'heavyCut', depth: 0.07, max: 0.06, actionIndex: i }))));
    expect(many.deductions.find((d) => d.label.startsWith('Heavy cut'))!.points).toBe(HEAVY_CUT_CAP);
    const broke = grade(c, withEvents([
      { t: 1, kind: 'heavyCut', depth: 0.14, max: 0.06, actionIndex: 7 },
      { t: 1, kind: 'toolBroken', actionIndex: 7 },
    ]));
    expect(broke.deductions.map((d) => d.label)).toEqual(['Broke the tool']);
    expect(broke.checks.find((c) => c.label === 'Safety')!.actual).toBe('1 broken tool');
  });

  it('chatter while parting costs 10, turning chatter still 2', () => {
    const c = pinChallenge();
    const g = grade(c, withEvents([
      { t: 1, kind: 'chatter', sfm: 200, tool: 'parting', rpm: 1200, diameter: 0.5 },
      { t: 2, kind: 'chatter', sfm: 400, tool: 'turning', rpm: 2000, diameter: 1 },
    ]));
    expect(g.deductions).toContainEqual({ label: 'Parting chatter ×1', points: 10 });
    expect(g.deductions).toContainEqual({ label: 'Chatter ×1', points: 2 });
    expect(g.checks.find((x) => x.label === 'Safety')!.actual).toBe('2 chatter');
  });
});

describe('recommended parting speed (P2-6)', () => {
  it('never recommends more than 300 rpm for parting, and less for steel', () => {
    for (const d of [0.5, 0.75, 0.875, 1.0]) expect(recommendedRpm('brass', d, 'parting')).toBe(300);
    expect(recommendedRpm('brass', 0.25, 'parting')).toBe(300);
    expect(recommendedRpm('steel', 1.0, 'parting')).toBe(150);
    expect(recommendedRpm('brass', 0.5, 'turning')).toBe(2000); // turning is unchanged
  });

  it('the parting-chatter advice matches the hints', () => {
    const c = pinChallenge();
    const e = makePinDirect();
    const s = e.getState();
    const st: LatheState = { ...s, events: [...s.events, { t: 1, kind: 'chatter', sfm: 160, rpm: 1200, diameter: 0.5, tool: 'parting' }] };
    const m = analyze(c, st, grade(c, st)).find((x) => x.title.startsWith('Chatter'))!;
    expect(m.detail).toContain('Try 300 rpm');
  });
});

describe('impossible checks (P1-A)', () => {
  const check: StateCheck = { kind: 'diameterBetween', z0: 1.2, z1: 1.8, min: 0.498, max: 0.502 };

  it('a diameter under the window, or a section that is gone, can never be met', () => {
    const e = setup();
    expect(checkImpossible(check, e.getState())).toBe(false); // oversize: still possible
    moveTo(e, 'z', 2.1);
    moveTo(e, 'x', 0.47);
    moveTo(e, 'z', 1.1, 0.05);
    moveTo(e, 'x', 0.6);
    expect(checkImpossible(check, e.getState())).toBe(false);
    for (const r of [0.43, 0.39, 0.35, 0.31, 0.27, 0.245]) {
      moveTo(e, 'z', 2.1);
      moveTo(e, 'x', r);
      moveTo(e, 'z', 1.1, 0.05);
      moveTo(e, 'x', 0.6);
    }
    expect(impossibleReason(check, e.getState())).toMatch(/already under 0\.498: it measures Ø0\.490/);
    expect(checkImpossible({ kind: 'all', checks: [{ kind: 'spindle', on: true }, check] }, e.getState())).toBe(true);
    expect(checkImpossible({ kind: 'spindle', on: false }, e.getState())).toBe(false);
    expect(checkImpossible({ kind: 'facedTo', zMax: 0.5 }, e.getState())).toBe(false);
    expect(checkImpossible(check, new LatheEngine().getState())).toBe(false); // nothing loaded yet

    const faced = setup();
    for (const z of [1.95, 1.9, 1.85, 1.8, 1.75]) {
      // face back past the end of the region, 50 thou a pass
      moveTo(faced, 'x', 0.6);
      moveTo(faced, 'z', z);
      moveTo(faced, 'x', -0.02, 0.03);
    }
    expect(faced.getState().damage.toolBroken).toBe(false);
    expect(impossibleReason(check, faced.getState())).toMatch(/no metal left from Z 1\.200 to 1\.800/);
    expect(impossibleReason({ kind: 'boreAtLeast', z0: 1.75, z1: 1.9, minDiameter: 0.25 }, faced.getState())).toMatch(/where the hole should be/);
  });

  it('the hint passes over an undersize step to parting, then to checking the part', () => {
    const c = pinChallenge();
    const e = setup();
    moveTo(e, 'z', 1.99);
    moveTo(e, 'x', -0.02, 0.05);
    moveTo(e, 'x', 0.6);
    for (const r of [0.45, 0.4, 0.35, 0.3, 0.24]) {
      moveTo(e, 'z', 2.1);
      moveTo(e, 'x', r);
      moveTo(e, 'z', 0.85, 0.05);
      moveTo(e, 'x', 0.6);
    }
    const p = scriptProgress(c.solution, e.getState(), c.stock);
    const ids = c.solution.steps.map((s) => s.id);
    expect(p.skipped.map((i) => ids[i])).toEqual(['rough', 'finish']);
    const h = nextHint(c, e.getState(), { stepId: 'finish', level: 1 });
    expect(h.stepId).toBe('part');
    expect(h.level).toBe(1);
    expect(h.notice).toMatch(/already under 0\.515: it measures Ø0\.480/);
    expect(h.notice).toMatch(/Finish the part anyway: part it off, then press Check my part/);
  });
});

describe('level-2 instructions by pass (P2-15)', () => {
  it('turns each in-cut-out-back run into one numbered pass line', () => {
    const c = pinChallenge();
    const e = new LatheEngine();
    const p = new ScriptPlayer(e, c.solution);
    p.jumpTo(4); // at the start of "Rough turn"
    const lines = stepInstructions(c.solution.steps[4], e.getState());
    // the fixture's passes start with the carriage move, so the return joins the next pass
    expect(lines.filter((l) => /^Pass \d of \d:/.test(l)).length).toBeGreaterThanOrEqual(4);
    expect(lines.length).toBeLessThanOrEqual(6);
  });

  it('describes drilling pecks as pecks', () => {
    const steps: Script = {
      id: 'pecks',
      steps: [
        {
          id: 'drill',
          title: 'Drill',
          narration: 'Peck.',
          actions: [
            { type: 'selectTailstockTool', tool: 'drill-1/4' },
            { type: 'moveTo', axis: 'quill', position: 0.25 },
            { type: 'moveTo', axis: 'quill', position: 0 },
            { type: 'moveTo', axis: 'quill', position: 0.23 },
            { type: 'moveTo', axis: 'quill', position: 0.5 },
            { type: 'moveTo', axis: 'quill', position: 0 },
          ],
        },
      ],
    };
    const lines = stepInstructions(steps.steps[0], new LatheEngine().getState());
    expect(lines[0]).toMatch(/1\/4" drill/);
    expect(lines[1]).toMatch(/^Peck 1 of 2: Advance the quill to 0\.250 out/);
    expect(lines[2]).toMatch(/^Peck 2 of 2:/);
  });
});

describe('the last hint names the real button (P2-12)', () => {
  it('says "Check my part"', () => {
    const c = pinChallenge();
    const e = new LatheEngine();
    runScript(e, c.solution);
    expect(nextHint(c, e.getState()).text).toContain('Check my part');
  });
});

describe('player deviations (P1-10)', () => {
  const script: Script = {
    id: 'dev',
    steps: [
      { id: 'a', title: 'Load', narration: '', actions: [{ type: 'loadStock', stock: BRASS_1x3 }], check: { kind: 'stockLoaded' } },
      { id: 'b', title: 'Carriage to 1.5', narration: '', actions: [{ type: 'moveTo', axis: 'z', position: 1.5 }], check: { kind: 'zBetween', min: 1.49, max: 1.51 } },
      { id: 'c', title: 'Wait', narration: '', actions: [{ type: 'wait', duration: 0.5 }], check: { kind: 'zBetween', min: 1.49, max: 1.51 } },
    ],
  };

  it('lists the steps whose check failed at their end, and forgets them on restart', () => {
    const e = new LatheEngine();
    const p = new ScriptPlayer(e, script);
    p.stepForward();
    p.stepForward();
    expect(p.getStatus().deviations).toEqual([]);
    e.dispatch({ type: 'turnHandwheel', axis: 'z', revolutions: -1 }); // the user moves it while paused
    p.stepForward();
    expect(p.getStatus().done).toBe(true);
    expect(p.getStatus().deviations).toEqual([2]);
    p.jumpTo(0);
    expect(p.getStatus().deviations).toEqual([]);
  });

  it('a clean run of a real lesson-style script has none', () => {
    const e = new LatheEngine();
    const p = new ScriptPlayer(e, script);
    p.play();
    for (let i = 0; i < 600 && !p.isDone; i++) {
      e.tick(1 / 60);
      p.tick(1 / 60);
    }
    expect(p.getStatus().deviations).toEqual([]);
  });
});
