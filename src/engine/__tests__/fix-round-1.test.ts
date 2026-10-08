// Regression tests for the first review / QA fix round (docs/REVIEW.md and the first QA pass).
import { describe, expect, it } from 'vitest';
import { analyze } from '../analyzer';
import { grade } from '../grader';
import { describeActions, describeContext, netMotion, nextHint } from '../hints';
import { LatheEngine, dialGraduationFor, dialReadingFor } from '../lathe';
import { ScriptPlayer, resolveMoveTo, runScript } from '../script';
import { MACHINE, type Challenge, type LatheEventKind, type Script, type StockSpec } from '../types';
import { diameterAt, facePosition } from '../workpiece';
import { BRASS_1x3, moveTo, pinChallenge, setup } from './fixtures';

const kinds = (e: LatheEngine): LatheEventKind[] => e.getState().events.map((ev) => ev.kind);

describe('depth of cut on cross-slide moves', () => {
  it('a 0.010 infeed mid-pass is a 0.010 cut, not the tool width (P0)', () => {
    const e = setup();
    moveTo(e, 'z', 2.1);
    moveTo(e, 'x', 0.47);
    moveTo(e, 'z', 1.0, 0.05); // stop mid-pass
    for (let i = 0; i < 10; i++) e.dispatch({ type: 'turnHandwheel', axis: 'x', revolutions: 0.02, dt: 0.05 });
    expect(kinds(e)).not.toContain('heavyCut');
    expect(kinds(e)).not.toContain('toolBroken');
    expect(e.getState().x).toBeCloseTo(0.46, 9);
    expect(diameterAt(e.getState().workpiece!, 1.1)).toBeCloseTo(0.92, 6);
  });

  it('plunging over the bar from outside, ten thou at a time, never breaks the tool', () => {
    const e = setup();
    moveTo(e, 'z', 1.0);
    moveTo(e, 'x', 0.51);
    for (let i = 0; i < 20; i++) e.dispatch({ type: 'turnHandwheel', axis: 'x', revolutions: 0.02, dt: 0.05 });
    expect(kinds(e)).not.toContain('heavyCut');
    expect(e.getState().damage.toolBroken).toBe(false);
  });

  it('a single big plunge is still a heavy cut, measured radially', () => {
    const e = setup();
    moveTo(e, 'z', 1.0);
    moveTo(e, 'x', 0.51);
    moveTo(e, 'x', 0.43, 0.05); // 0.070 radial in one move
    const heavy = e.getState().events.find((ev) => ev.kind === 'heavyCut');
    expect(heavy && heavy.kind === 'heavyCut' && heavy.depth).toBeCloseTo(0.07, 2);
    expect(kinds(e)).not.toContain('toolBroken');
  });

  it('facing depth is the axial engagement, even fed one division at a time', () => {
    const e = setup();
    moveTo(e, 'z', 1.9); // 0.100 of the face under the tool
    moveTo(e, 'x', 0.55);
    for (let i = 0; i < 200; i++) e.dispatch({ type: 'turnHandwheel', axis: 'x', revolutions: 0.02, dt: 0.02 });
    const heavy = e.getState().events.find((ev) => ev.kind === 'heavyCut');
    expect(heavy && heavy.kind === 'heavyCut' && heavy.depth).toBeCloseTo(0.1, 2);
    expect(kinds(e)).not.toContain('toolBroken'); // 0.100 < 2 x 0.060
  });

  it('an infeed on a turned diameter near the end is not mistaken for a facing cut', () => {
    const e = setup();
    moveTo(e, 'z', 2.1);
    moveTo(e, 'x', 0.47);
    moveTo(e, 'z', 1.92, 0.05); // footprint reaches past the end of the bar
    e.dispatch({ type: 'setRpm', rpm: 600 }); // ends the cutting run
    for (let i = 0; i < 10; i++) e.dispatch({ type: 'turnHandwheel', axis: 'x', revolutions: 0.02, dt: 0.05 });
    expect(kinds(e)).not.toContain('heavyCut');
  });
});

describe('feed per revolution', () => {
  it('judges the feed per revolution, not per second', () => {
    const fast = setup(BRASS_1x3, 'turning', 600);
    moveTo(fast, 'z', 2.1);
    moveTo(fast, 'x', 0.48);
    moveTo(fast, 'z', 1.5, 0.15); // 0.015"/rev at 600 rpm
    const ev = fast.getState().events.find((x) => x.kind === 'poorFinish');
    expect(ev && ev.kind === 'poorFinish' && ev.feedPerRev).toBeCloseTo(0.015, 6);
    expect(ev && ev.kind === 'poorFinish' && ev.limit).toBe(0.01);

    const quick = setup(BRASS_1x3, 'turning', 1200);
    moveTo(quick, 'z', 2.1);
    moveTo(quick, 'x', 0.48);
    moveTo(quick, 'z', 1.5, 0.15); // 0.0075"/rev at 1200 rpm: fine
    expect(kinds(quick)).not.toContain('poorFinish');

    const slow = setup(BRASS_1x3, 'turning', 150);
    moveTo(slow, 'z', 2.1);
    moveTo(slow, 'x', 0.48);
    moveTo(slow, 'z', 1.5, 0.05); // 0.020"/rev at 150 rpm: poor even though only 0.05 in/s
    expect(kinds(slow)).toContain('poorFinish');
  });

  it('parting has a tighter limit than turning', () => {
    const e = setup(BRASS_1x3, 'parting', 300);
    moveTo(e, 'z', 1.0);
    moveTo(e, 'x', 0.52);
    moveTo(e, 'x', 0.4, 0.03); // 0.006"/rev
    expect(kinds(e)).toContain('poorFinish');
    const ok = setup(BRASS_1x3, 'parting', 300);
    moveTo(ok, 'z', 1.0);
    moveTo(ok, 'x', 0.52);
    moveTo(ok, 'x', 0.4, 0.015); // 0.003"/rev
    expect(kinds(ok)).not.toContain('poorFinish');
  });

  it('keeps the in/s cap as a secondary bound', () => {
    const e = setup(BRASS_1x3, 'turning', 2000);
    moveTo(e, 'z', 2.1);
    moveTo(e, 'x', 0.48);
    moveTo(e, 'z', 1.5, 0.3); // 0.009"/rev but 0.3 in/s
    expect(kinds(e)).toContain('poorFinish');
  });
});

describe('tailstock body', () => {
  it('a tool outside the quill radius still crashes into the tailstock body', () => {
    const e = new LatheEngine();
    e.dispatch({ type: 'selectTool', tool: 'turning' });
    moveTo(e, 'x', 0.7);
    moveTo(e, 'z', 4.9);
    expect(kinds(e)).toContain('crash');
    expect(e.getState().z).toBeLessThan(MACHINE.tailstockZ);
    expect(e.getState().z).toBeGreaterThan(3.7);
  });

  it('the carriage cannot pass the tailstock even with no tool', () => {
    const e = new LatheEngine();
    moveTo(e, 'z', 5.0);
    const crash = e.getState().events.find((ev) => ev.kind === 'crash');
    expect(crash && crash.kind === 'crash' && crash.what).toBe('tailstock');
    expect(e.getState().z).toBeLessThanOrEqual(MACHINE.tailstockZ + 1e-9);
  });

  it('a tool well above the tailstock body is clear', () => {
    const e = new LatheEngine({ tailstockZ: 4.5 });
    e.dispatch({ type: 'selectTool', tool: 'turning' });
    moveTo(e, 'x', 1.1);
    moveTo(e, 'z', 4.3);
    expect(kinds(e)).not.toContain('crash');
  });
});

describe('boring bar', () => {
  const drilled = () => {
    const e = setup();
    e.dispatch({ type: 'selectTailstockTool', tool: 'drill-1/4' });
    moveTo(e, 'x', 0.75);
    moveTo(e, 'z', 0.5);
    moveTo(e, 'quill', 0.9, 0.05); // tip at 0.6: hole full size well behind the face at 2.0
    moveTo(e, 'quill', 0, 0.4);
    e.dispatch({ type: 'selectTailstockTool', tool: 'none' });
    e.dispatch({ type: 'setSpindle', on: false });
    e.dispatch({ type: 'selectTool', tool: 'boring' });
    e.dispatch({ type: 'setSpindle', on: true });
    return e;
  };

  it('cannot be pushed into solid stock', () => {
    const e = setup();
    e.dispatch({ type: 'setSpindle', on: false });
    e.dispatch({ type: 'selectTool', tool: 'boring' });
    e.dispatch({ type: 'setSpindle', on: true });
    moveTo(e, 'z', 2.1);
    moveTo(e, 'x', 0.06);
    moveTo(e, 'z', 1.5, 0.02);
    expect(kinds(e)).toContain('boringSolid');
    expect(kinds(e)).toContain('toolBroken');
    expect(facePosition(e.getState().workpiece!)).toBeCloseTo(2.0, 6);
    expect(e.getState().workpiece!.inner.every((r) => r === 0)).toBe(true);
  });

  it('never turns the outside of the bar', () => {
    const e = setup();
    e.dispatch({ type: 'setSpindle', on: false });
    e.dispatch({ type: 'selectTool', tool: 'boring' });
    e.dispatch({ type: 'setSpindle', on: true });
    moveTo(e, 'z', 2.1);
    moveTo(e, 'x', 0.55);
    moveTo(e, 'z', 1.5, 0.02);
    expect(kinds(e)).toContain('boringSolid');
    expect(diameterAt(e.getState().workpiece!, 1.8)).toBe(1);
  });

  it('opens up a drilled hole from the inside', () => {
    const e = drilled();
    moveTo(e, 'z', 2.1);
    moveTo(e, 'x', 0.14);
    moveTo(e, 'z', 1.5, 0.02);
    expect(kinds(e)).not.toContain('boringSolid');
    const wp = e.getState().workpiece!;
    expect(wp.inner[Math.floor((1.8 - wp.zStart) / wp.dz)]).toBeCloseTo(0.14, 6);
    expect(diameterAt(wp, 1.8)).toBe(1);
  });

  it('the analyzer explains it', () => {
    const e = setup();
    e.dispatch({ type: 'setSpindle', on: false });
    e.dispatch({ type: 'selectTool', tool: 'boring' });
    e.dispatch({ type: 'setSpindle', on: true });
    moveTo(e, 'z', 2.1);
    moveTo(e, 'x', 0.06);
    moveTo(e, 'z', 1.5, 0.02);
    const c = pinChallenge();
    const ms = analyze(c, e.getState(), grade(c, e.getState()));
    expect(ms.find((m) => m.title === 'Boring bar pushed into solid metal')).toBeDefined();
  });
});

describe('dial readings', () => {
  it('never rounds to 50 or 100', () => {
    expect(Math.round(dialReadingFor('z', -0.0004, 0)) + 0).toBe(0);
    expect(Math.round(dialReadingFor('x', 0.0004, 0)) + 0).toBe(0);
    expect(dialGraduationFor('z', -0.0004, 0)).toBe(0);
    expect(dialGraduationFor('z', -0.0006, 0)).toBe(99);
    expect(dialGraduationFor('x', 0.495 - 0.08, 0.495)).toBe(30);
    expect(dialReadingFor('z', 0.0123, 0)).toBeCloseTo(12.3, 9);
    for (let p = -0.2; p < 0.2; p += 0.00013) {
      for (const axis of ['x', 'z', 'quill'] as const) {
        const r = Math.round(dialReadingFor(axis, p, 0));
        expect(r).toBeGreaterThanOrEqual(0);
        expect(r).toBeLessThan(MACHINE.dialDivisions[axis]);
      }
    }
  });
});

describe('action log', () => {
  it('coalesces a run of same-axis, same-direction turns and keeps their timing', () => {
    const e = new LatheEngine();
    for (let i = 0; i < 10; i++) e.dispatch({ type: 'turnHandwheel', axis: 'x', revolutions: 0.02, dt: 0.05 });
    e.dispatch({ type: 'turnHandwheel', axis: 'x', revolutions: -0.02, dt: 0.05 });
    e.dispatch({ type: 'turnHandwheel', axis: 'z', revolutions: 0.1 });
    const log = e.getState().actions;
    expect(log).toHaveLength(3);
    expect(log[0].action).toMatchObject({ type: 'turnHandwheel', axis: 'x', dt: expect.closeTo(0.5, 9) });
    expect(log[0].action.type === 'turnHandwheel' && log[0].action.revolutions).toBeCloseTo(0.2, 9);
    expect(log[2].action).toEqual({ type: 'turnHandwheel', axis: 'z', revolutions: 0.1 });
  });

  it('replaying the coalesced log reproduces the part', () => {
    const e = setup();
    moveTo(e, 'z', 1.99);
    for (let i = 0; i < 300; i++) e.dispatch({ type: 'turnHandwheel', axis: 'x', revolutions: 0.05, dt: 0.02 });
    for (let i = 0; i < 50; i++) e.dispatch({ type: 'turnHandwheel', axis: 'z', revolutions: 0.1, dt: 0.02 });
    const replay = new LatheEngine();
    for (const { action } of e.getState().actions) replay.dispatch(action);
    expect(Array.from(replay.getState().workpiece!.outer)).toEqual(Array.from(e.getState().workpiece!.outer));
    expect(replay.getState().x).toBeCloseTo(e.getState().x, 9);
  });

  it('ScriptPlayer rewinds to its own frozen copy of the log', () => {
    const e = new LatheEngine();
    e.dispatch({ type: 'setRpm', rpm: 300 });
    const script: Script = { id: 's', steps: [{ id: 'a', title: 'a', narration: '', actions: [{ type: 'setRpm', rpm: 600 }] }] };
    const p = new ScriptPlayer(e, script);
    p.stepForward();
    expect(e.getState().actions).toHaveLength(2);
    p.jumpTo(0);
    expect(e.getState().actions).toHaveLength(1);
  });
});

describe('moveTo script actions', () => {
  const step = (actions: Script['steps'][number]['actions']): Script => ({
    id: 'm',
    steps: [{ id: 's', title: 's', narration: '', actions }],
  });

  it('lands on the absolute target from wherever the machine is', () => {
    for (const startX of [0.75, 0.3, 1.0]) {
      const e = new LatheEngine({ x: startX });
      runScript(e, step([{ type: 'moveTo', axis: 'x', position: 0.55, feed: 0.4 }]));
      expect(e.getState().x).toBeCloseTo(0.55, 9);
    }
  });

  it('takes dist / feed, at least 0.2 s, and no time when already there', () => {
    expect(resolveMoveTo({ type: 'moveTo', axis: 'z', position: 1.5, feed: 0.1 }, 2.0)).toMatchObject({ duration: 5, revolutions: -5 });
    expect(resolveMoveTo({ type: 'moveTo', axis: 'z', position: 1.99, feed: 0.4 }, 2.0).duration).toBe(0.2);
    expect(resolveMoveTo({ type: 'moveTo', axis: 'z', position: 2.0, feed: 0.4 }, 2.0)).toMatchObject({ duration: 0, revolutions: 0 });
    // without a feed: the given duration, but never faster than 0.2 in/s
    expect(resolveMoveTo({ type: 'moveTo', axis: 'x', position: 0.5, duration: 3 }, 0.75).duration).toBe(3);
    expect(resolveMoveTo({ type: 'moveTo', axis: 'x', position: 0.25, duration: 1 }, 0.75).duration).toBeCloseTo(2.5, 9);
    // clamps to the travel range
    expect(resolveMoveTo({ type: 'moveTo', axis: 'x', position: -1 }, 0).target).toBe(MACHINE.xRange[0]);
  });

  it('re-aims a move that was interrupted and moved by hand (resume after taking over)', () => {
    const e = new LatheEngine();
    const p = new ScriptPlayer(e, step([{ type: 'moveTo', axis: 'z', position: 1.0, feed: 0.2 }]));
    p.play();
    for (let i = 0; i < 30; i++) p.tick(0.05); // 1.5 s: z 2.0 -> 1.7
    p.pause();
    expect(e.getState().z).toBeCloseTo(1.7, 6);
    e.dispatch({ type: 'turnHandwheel', axis: 'z', revolutions: 3 }); // user winds it to 2.0
    p.play();
    while (!p.isDone) p.tick(0.05);
    expect(e.getState().z).toBeCloseTo(1.0, 9);
  });

  it('is deterministic for a dt sequence and keeps feed below 0.2 in/s by default', () => {
    const run = () => {
      const e = new LatheEngine();
      runScript(e, step([{ type: 'moveTo', axis: 'z', position: 1.0 }]), 1 / 60);
      return e.getState();
    };
    const a = run();
    const b = run();
    expect(b.z).toBe(a.z);
    expect(b.actions).toEqual(a.actions);
    const mv = a.actions[0].action;
    expect(mv.type === 'turnHandwheel' && Math.abs(mv.revolutions * MACHINE.zHandwheelPitch) / mv.dt!).toBeLessThanOrEqual(0.2 + 1e-9);
  });
});

describe('describing absolute moves', () => {
  it('says which way, how many turns and what the dial reads', () => {
    const e = new LatheEngine({ x: 0.6 });
    e.dispatch({ type: 'turnHandwheel', axis: 'x', revolutions: 2.1 }); // x = 0.495
    e.dispatch({ type: 'zeroDial', axis: 'x' });
    const lines = describeActions(
      [
        { type: 'moveTo', axis: 'x', position: 0.455 },
        { type: 'moveTo', axis: 'z', position: 0.48 },
        { type: 'moveTo', axis: 'x', position: 0.6 },
        { type: 'moveTo', axis: 'x', position: 0.415 },
      ],
      describeContext(e.getState()),
    );
    expect(lines[0]).toBe('Bring the cross slide in to X dia 0.910 (dial 40): 40 divisions clockwise.');
    expect(lines[1]).toBe('Run the carriage toward the chuck to Z 0.480 (dial 80): 15.2 turns counter-clockwise.');
    expect(lines[2]).toMatch(/^Back the cross slide out to X dia 1.200 \(dial 45\): 2.9 turns counter-clockwise/);
    expect(lines[3]).toMatch(/^Bring the cross slide in to X dia 0.830 \(dial 30\): 3.7 turns clockwise/);
    expect(describeActions([{ type: 'moveTo', axis: 'quill', position: 0.5 }])[0]).toBe('Set the tailstock quill to 0.500 out.');
  });

  it('netMotion reports the step motion from a start position', () => {
    expect(
      netMotion(
        [
          { type: 'moveTo', axis: 'x', position: 0.55 },
          { type: 'moveTo', axis: 'x', position: -0.01 },
          { type: 'moveTo', axis: 'z', position: 1.49 },
        ],
        { x: 0.7, z: 2.0, quill: 0 },
      ),
    ).toEqual({ x: expect.closeTo(0.71, 9), z: expect.closeTo(-0.51, 9), quill: 0 });
  });
});

describe('grading shoulders (P0)', () => {
  const stock: StockSpec = { material: 'brass', diameter: 1.0, length: 3.0, stickOut: 1.75 };
  const stepped: Challenge = {
    id: 'stepped',
    title: 'Stepped',
    difficulty: 2,
    description: '',
    stock,
    target: {
      segments: [
        { z0: 0, z1: 0.75, diameter: 0.5, tol: 0.005 },
        { z0: 0.75, z1: 1.25, diameter: 0.75, tol: 0.005 },
      ],
      overallLength: 1.25,
      lengthTol: 0.01,
    },
    solution: { id: 'none', steps: [] },
    hints: ['x'],
    requireParted: true,
    concepts: [],
  };

  /** Face to 1.73, turn 0.750 to z 0.35, turn 0.500 back to `shoulderZ`, part at 0.418. */
  const make = (shoulderZ: number) => {
    const e = setup(stock);
    moveTo(e, 'z', 1.73);
    moveTo(e, 'x', -0.02, 0.06);
    moveTo(e, 'x', 0.6);
    const turn = (radii: number[], endZ: number) => {
      for (const r of radii) {
        moveTo(e, 'z', 1.8);
        moveTo(e, 'x', r);
        moveTo(e, 'z', endZ, 0.08);
        moveTo(e, 'x', 0.6);
      }
    };
    turn([0.46, 0.42, 0.38, 0.375], 0.35);
    turn([0.335, 0.295, 0.255, 0.25], shoulderZ);
    moveTo(e, 'z', 1.8);
    e.dispatch({ type: 'setSpindle', on: false });
    e.dispatch({ type: 'selectTool', tool: 'parting' });
    e.dispatch({ type: 'setRpm', rpm: 300 });
    e.dispatch({ type: 'setSpindle', on: true });
    moveTo(e, 'z', 0.418);
    moveTo(e, 'x', -0.02, 0.015);
    moveTo(e, 'x', 0.7);
    return e.getState();
  };

  it('a well-made part passes, with the shoulder in place', () => {
    const s = make(0.98);
    const g = grade(stepped, s);
    expect(g.passed).toBe(true);
    expect(g.checks.find((c) => c.label.startsWith('Shoulder'))).toMatchObject({ ok: true, actual: '0.750' });
  });

  for (const [shoulderZ, actual, dir] of [
    [0.96, '0.770', 'toward the chuck'],
    [1.0, '0.730', 'toward the face'],
  ] as const) {
    it(`a shoulder 0.020 off (${actual}) is a shoulder error with right diameters`, () => {
      const s = make(shoulderZ);
      const g = grade(stepped, s);
      expect(g.passed).toBe(false);
      expect(g.checks.find((c) => c.label.startsWith('Shoulder'))).toMatchObject({ ok: false, actual });
      expect(g.checks.filter((c) => c.label.startsWith('Diameter')).every((c) => c.ok)).toBe(true);
      const ms = analyze(stepped, s, g);
      const titles = ms.map((m) => m.title);
      expect(titles.some((t) => t.startsWith('Shoulder in the wrong place'))).toBe(true);
      expect(titles.some((t) => /Undersize|Oversize/.test(t))).toBe(false);
      expect(ms.find((m) => m.title.startsWith('Shoulder'))!.detail).toContain(`20 thou too far ${dir}`);
    });
  }
});

describe('length advice without parting', () => {
  const slug: Challenge = {
    ...pinChallenge(),
    requireParted: false,
    target: { segments: [{ z0: 0, z1: 1.9, diameter: 1, tol: 0.01 }], overallLength: 1.985, lengthTol: 0.005 },
  };
  it('a faced slug that is short or long never mentions the parting blade', () => {
    for (const faceZ of [1.95, 1.999]) {
      const e = setup();
      moveTo(e, 'z', faceZ);
      moveTo(e, 'x', -0.02, 0.06);
      moveTo(e, 'x', 0.75);
      const s = e.getState();
      const g = grade(slug, s);
      const ms = analyze(slug, s, g);
      expect(g.checks.find((c) => c.label.startsWith('Diameter'))!.ok).toBe(true);
      expect(ms.some((m) => m.title.startsWith('Section missing'))).toBe(false);
      const len = ms.find((m) => /Too (long|short)/.test(m.title))!;
      expect(len.detail).not.toMatch(/blade|parting/);
      expect(len.detail).toMatch(/thou too (long|short)/);
    }
  });
});

describe('hints on a fresh challenge', () => {
  it('the first hint is to load the stock, with a level 2 that loads it', () => {
    const c = pinChallenge();
    const s = new LatheEngine().getState();
    const h = nextHint(c, s);
    expect(h.stepId).toBe('load');
    const h2 = nextHint(c, s, h);
    expect(h2.lines?.[0]).toMatch(/^Load 1.000" brass stock/);
  });
});
