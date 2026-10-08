import { describe, expect, it } from 'vitest';
import { analyze } from '../analyzer';
import { grade, measureSpan, selectPiece } from '../grader';
import { LatheEngine } from '../lathe';
import { runScript } from '../script';
import type { Challenge, Mistake, StockSpec } from '../types';
import { BRASS_1x3, makePinDirect, moveTo, pinChallenge, setup } from './fixtures';

/** Pin made directly with the finish pass at the given radius and parting at the given z. */
function makePin(finishX = 0.25, partZ = 0.9275, opts: { spindleOffForParting?: boolean } = {}): LatheEngine {
  const e = setup();
  moveTo(e, 'z', 1.99);
  moveTo(e, 'x', -0.02);
  moveTo(e, 'x', 0.6);
  for (const x of [0.45, 0.4, 0.35, 0.3, finishX]) {
    moveTo(e, 'z', 2.1);
    moveTo(e, 'x', x);
    moveTo(e, 'z', 0.7, 0.08);
    moveTo(e, 'x', 0.6);
  }
  moveTo(e, 'z', 2.1);
  e.dispatch({ type: 'setSpindle', on: false });
  e.dispatch({ type: 'selectTool', tool: 'parting' });
  e.dispatch({ type: 'setRpm', rpm: 300 });
  if (!opts.spindleOffForParting) e.dispatch({ type: 'setSpindle', on: true });
  moveTo(e, 'z', partZ);
  moveTo(e, 'x', -0.02, 0.015);
  moveTo(e, 'x', 0.75);
  return e;
}

const titles = (ms: Mistake[]) => ms.map((m) => m.title);
const find = (ms: Mistake[], re: RegExp) => ms.find((m) => re.test(m.title));

describe('grade', () => {
  it('passes the reference solution run through the ScriptPlayer', () => {
    const c = pinChallenge();
    const s = runScript(new LatheEngine(), c.solution);
    const g = grade(c, s);
    expect(g.passed).toBe(true);
    expect(g.score).toBe(100);
    expect(g.checks.map((x) => x.label)).toEqual(['Parted off', 'Diameter Ø0.500 from 0.000 to 1.000', 'Overall length', 'Safety']);
    expect(g.measured.length).toBeCloseTo(1, 6);
    expect(g.measured.segments).toEqual([{ z0: 0, z1: 1, diameter: 0.5 }]);
    expect(analyze(c, s, g)).toEqual([{ severity: 'tip', title: 'Clean job', detail: expect.any(String) }]);
  });

  it('uses the collected piece after collectPart', () => {
    const e = makePinDirect();
    e.dispatch({ type: 'collectPart' });
    expect(grade(pinChallenge(), e.getState()).passed).toBe(true);
  });

  it('fails an oversize part and suggests another pass', () => {
    const c = pinChallenge();
    const s = makePin(0.255).getState();
    const g = grade(c, s);
    expect(g.passed).toBe(false);
    const seg = g.checks[1];
    expect(seg).toMatchObject({ ok: false, actual: 'Ø0.510', expected: 'Ø0.500 ±0.005' });
    expect(g.score).toBe(Math.round((100 * (1 + 0.5 + 1)) / 3));
    const m = find(analyze(c, s, g), /Oversize/)!;
    expect(m.severity).toBe('warning');
    expect(m.detail).toContain('another pass of about 5 thou');
  });

  it('fails an undersize part as unrecoverable', () => {
    const c = pinChallenge();
    const s = makePin(0.24).getState();
    const g = grade(c, s);
    expect(g.passed).toBe(false);
    const m = find(analyze(c, s, g), /Undersize/)!;
    expect(m.severity).toBe('error');
    expect(m.detail).toContain("can't be added back");
    expect(m.detail).toContain('20 thou under');
  });

  it('flags wrong length both ways', () => {
    const c = pinChallenge();
    const long = makePin(0.25, 0.8).getState();
    const gl = grade(c, long);
    expect(gl.checks[2]).toMatchObject({ label: 'Overall length', ok: false });
    expect(find(analyze(c, long, gl), /Too long/)).toBeDefined();
    const short = makePin(0.25, 1.0).getState();
    const gs = grade(c, short);
    expect(gs.passed).toBe(false);
    const ms = analyze(c, short, gs);
    expect(find(ms, /Too short/)!.severity).toBe('error');
    // a short part is a length problem only: the diameter is measured over the material there is
    expect(find(ms, /Section missing/)).toBeUndefined();
    expect(gs.checks[1]).toMatchObject({ ok: true, actual: 'Ø0.500' });
    expect(find(ms, /Too short/)!.detail).toContain('blade width (0.0625)');
  });

  it('fails when the part was never parted off', () => {
    const c = pinChallenge();
    const e = setup();
    moveTo(e, 'z', 1.99);
    moveTo(e, 'x', -0.02);
    const s = e.getState();
    expect(selectPiece(c, s)).toBeNull();
    const g = grade(c, s);
    expect(g.passed).toBe(false);
    expect(g.checks[0]).toMatchObject({ label: 'Parted off', ok: false, actual: 'no' });
    expect(g.checks[1].actual).toBe('not measured: still on the bar'); // QA2 P2-11
    expect(g.checks.find((c) => c.label === 'Overall length')!.actual).toBe('not parted yet');
    expect(g.measured).toEqual({ segments: [], length: 0 });
    expect(titles(analyze(c, s, g))).toContain('Part not parted off');
  });

  it('a crash fails the part and caps the score at 20', () => {
    const c = pinChallenge();
    const e = makePinDirect();
    moveTo(e, 'z', -0.1);
    const s = e.getState();
    const g = grade(c, s);
    expect(g.passed).toBe(false);
    expect(g.score).toBeLessThanOrEqual(20);
    expect(g.checks.find((x) => x.label === 'Safety')).toMatchObject({ ok: false, actual: '1 crash' });
    const m = find(analyze(c, s, g), /Crash into the chuck jaws/)!;
    expect(m.severity).toBe('error');
    expect(m.detail).toContain('parting tool');
    expect(m.detail).toContain('toward the chuck');
    expect(m.t).toBe(0);
  });

  it('applies safety deductions with caps', () => {
    const c = pinChallenge();
    const e = makePinDirect();
    const base = e.getState();
    const ev = (kind: 'rubbing' | 'chatter' | 'poorFinish' | 'toolBroken', n: number) =>
      Array.from({ length: n }, () => ({ t: 0, kind, ...(kind === 'rubbing' ? { tool: 'turning' } : {}), ...(kind === 'chatter' ? { sfm: 400 } : {}), ...(kind === 'poorFinish' ? { feedRate: 1 } : {}) }));
    const s = { ...base, events: [...base.events, ...ev('rubbing', 6), ...ev('chatter', 2), ...ev('poorFinish', 9)] } as typeof base;
    const g = grade(c, s);
    expect(g.deductions).toEqual([
      { label: 'Rubbing ×6', points: 20 },
      { label: 'Chatter ×2', points: 4 },
      { label: 'Poor finish ×9', points: 10 },
    ]);
    expect(g.score).toBe(66);
    expect(g.passed).toBe(true);
    const s2 = { ...s, events: [...s.events, ...ev('toolBroken', 1)] } as typeof base;
    const g2 = grade(c, s2);
    expect(g2.score).toBe(36);
    expect(g2.passed).toBe(false);
    expect(g2.checks.find((x) => x.label === 'Safety')!.actual).toContain('broken tool');
  });

  it('grades a bore', () => {
    const stock: StockSpec = { material: 'brass', diameter: 1, length: 3, stickOut: 1.5 };
    const c: Challenge = {
      ...pinChallenge(),
      stock,
      target: {
        segments: [{ z0: 0, z1: 0.75, diameter: 1, tol: 0.01 }],
        overallLength: 0.75,
        lengthTol: 0.01,
        bore: { diameter: 0.25, depth: 0.75, tol: 0.01 },
      },
      solution: { id: 'none', steps: [] },
    };
    const make = (quill: number) => {
      const e = setup(stock, 'parting', 600);
      e.dispatch({ type: 'setSpindle', on: false });
      e.dispatch({ type: 'selectTailstockTool', tool: 'drill-1/4' });
      e.dispatch({ type: 'setRpm', rpm: 300 });
      e.dispatch({ type: 'setSpindle', on: true });
      moveTo(e, 'x', 0.6);
      moveTo(e, 'z', 0.5);
      moveTo(e, 'quill', quill, 0.05);
      moveTo(e, 'quill', 0, 0.2);
      e.dispatch({ type: 'selectTailstockTool', tool: 'none' });
      moveTo(e, 'z', 0.6875);
      moveTo(e, 'x', -0.02, 0.015);
      return e.getState();
    };
    const good = make(1.0);
    const g = grade(c, good);
    expect(g.checks.find((x) => x.label.startsWith('Bore'))).toMatchObject({ ok: true, actual: 'Ø0.250' });
    expect(g.passed).toBe(true);
    const shallow = make(0.5); // tip at 1.0: hole only 0.5 deep
    const gs = grade(c, shallow);
    expect(gs.passed).toBe(false);
    expect(find(analyze(c, shallow, gs), /Hole not deep enough: full size only 0\.\d+ deep/)).toBeDefined();
  });

  it('grades the protruding stock when parting is not required', () => {
    const c: Challenge = {
      ...pinChallenge(),
      requireParted: false,
      target: { segments: [{ z0: 0, z1: 1.99, diameter: 1, tol: 0.01 }], overallLength: 1.99, lengthTol: 0.005 },
    };
    const e = setup();
    expect(grade(c, e.getState()).passed).toBe(false);
    moveTo(e, 'z', 1.99);
    moveTo(e, 'x', -0.02);
    moveTo(e, 'x', 0.75);
    const g = grade(c, e.getState());
    expect(g.passed).toBe(true);
    expect(g.measured.length).toBeCloseTo(1.99, 6);
    expect(g.measured.segments).toEqual([{ z0: 0, z1: 1.99, diameter: 1 }]);
    expect(selectPiece(c, new LatheEngine().getState())).toBeNull();
  });

  it('measureSpan reports min and max diameters', () => {
    const c = pinChallenge();
    const s = makePin(0.25, 0.8).getState();
    const piece = selectPiece(c, s)!;
    expect(measureSpan(piece, 0, 1.0)).toEqual({ min: 0.5, max: 0.5 });
    // the piece is 1.1275 long: a span running past its end is clipped to the material there is
    expect(measureSpan(piece, 1.0, 1.1)).toEqual({ min: 0.5, max: 0.5 });
    expect(measureSpan(piece, 1.0, 1.2)).toEqual({ min: 0.5, max: 0.5 });
    // a span wholly past the end has no material at all
    expect(measureSpan(piece, 1.2, 1.4)).toEqual({ min: null, max: null });
    const g = grade({ ...c, target: { ...c.target, segments: [{ z0: 0, z1: 1.3, diameter: 0.5, tol: 0.005 }] } }, s);
    expect(g.checks[1].actual).toBe('Ø0.500');
  });
});

describe('analyze', () => {
  it('explains heavy cuts, a broken tool, chatter, poor finish, reverse and unsafe tool changes', () => {
    const c = pinChallenge();
    const e = setup(BRASS_1x3, 'turning', 2000);
    moveTo(e, 'z', 2.1);
    moveTo(e, 'x', 0.42); // 80 thou
    moveTo(e, 'z', 1.8, 0.2);
    e.dispatch({ type: 'turnHandwheel', axis: 'z', revolutions: -2 }); // 2 in/s
    e.dispatch({ type: 'selectTool', tool: 'parting' }); // while running
    e.dispatch({ type: 'setSpindle', on: true, reverse: true });
    e.dispatch({ type: 'setRpm', rpm: 300 });
    moveTo(e, 'x', 0.6);
    moveTo(e, 'z', 1.2);
    moveTo(e, 'x', 0.4, 0.05);
    const s = e.getState();
    const ms = analyze(c, s, grade(c, s));
    expect(find(ms, /Heavy cut/)!.detail).toContain('80 thou');
    expect(find(ms, /Chatter/)!.detail).toContain('Try 600 rpm');
    expect(find(ms, /Poor finish/)!.detail).toContain('2.00 in/s');
    expect(find(ms, /reverse/)).toBeDefined();
    expect(find(ms, /spindle running/)).toBeDefined();

    const b = setup();
    moveTo(b, 'z', 2.1);
    moveTo(b, 'x', 0.3);
    moveTo(b, 'z', 1.8, 0.2);
    const sb = b.getState();
    const mb = analyze(c, sb, grade(c, sb));
    expect(find(mb, /Broke the tool/)!.detail).toContain('200 thou');
    expect(find(mb, /Heavy cut/)).toBeUndefined();
  });

  it('explains rubbing', () => {
    const c = pinChallenge();
    const s = makePin(0.25, 0.9275, { spindleOffForParting: true }).getState();
    const ms = analyze(c, s, grade(c, s));
    expect(find(ms, /Rubbing/)!.detail).toContain('parting tool');
    expect(titles(ms)).toContain('Part not parted off');
  });

  it('does not call a step skipped when it was done, even if it never matched the plan', () => {
    const c = pinChallenge();
    const s = makePinDirect().getState(); // went straight past the 0.520 roughing size
    const ms = analyze(c, s, grade(c, s));
    expect(ms).toEqual([expect.objectContaining({ severity: 'tip', title: 'Clean job' })]);
    // an undersize pin: the turn step was attempted, so it is "undersize", not "skipped"
    const under = makePin(0.245).getState();
    const mu = analyze(c, under, grade(c, under));
    expect(titles(mu).some((t) => t.startsWith('Undersize'))).toBe(true);
    expect(titles(mu).some((t) => t.startsWith('Skipped'))).toBe(false);
  });

  it('points out a solution step that never happened at all', () => {
    const c = pinChallenge();
    // no facing pass: straight to turning and parting
    const e = setup();
    for (const x of [0.45, 0.4, 0.35, 0.3, 0.25]) {
      moveTo(e, 'z', 2.1);
      moveTo(e, 'x', x);
      moveTo(e, 'z', 0.85, 0.08);
      moveTo(e, 'x', 0.6);
    }
    moveTo(e, 'z', 2.1);
    const s = e.getState();
    const ms = analyze(c, s, grade(c, s));
    const skipped = ms.filter((m) => m.title.startsWith('Skipped'));
    expect(skipped).toEqual([expect.objectContaining({ title: 'Skipped step: Face the end', stepId: 'face' })]);
  });

  it('explains a tailstock crash', () => {
    const c = pinChallenge();
    const e = new LatheEngine();
    e.dispatch({ type: 'selectTool', tool: 'turning' });
    moveTo(e, 'z', 1.0);
    moveTo(e, 'x', 0.1);
    e.dispatch({ type: 'selectTailstockTool', tool: 'drill-1/4' });
    moveTo(e, 'quill', 1.0);
    const s = e.getState();
    const m = find(analyze(c, s, grade(c, s)), /Crash into the tailstock/)!;
    expect(m.detail).toContain('back the quill out');
  });

  it('copes with sparse event data and repeated events', () => {
    const c = pinChallenge();
    const base = makePinDirect().getState();
    const s = {
      ...base,
      events: [
        ...base.events,
        { t: 1, kind: 'crash', what: 'chuck' },
        { t: 2, kind: 'rubbing', tool: 'drill-1/4' },
        { t: 3, kind: 'rubbing', tool: 'center-drill' },
        { t: 4, kind: 'chatter', sfm: 500 },
        { t: 5, kind: 'chatter', sfm: 600, tool: 'parting', rpm: 2000, diameter: 0.5 },
        { t: 6, kind: 'poorFinish', feedRate: 1 },
        { t: 7, kind: 'poorFinish', feedRate: 3 },
        { t: 8, kind: 'heavyCut', depth: 0.07, max: 0.06 },
        { t: 9, kind: 'heavyCut', depth: 0.09, max: 0.06 },
        { t: 10, kind: 'toolChangeWhileRunning' },
        { t: 11, kind: 'toolChangeWhileRunning' },
      ],
    } as typeof base;
    const ms = analyze(c, s, grade(c, s));
    expect(find(ms, /Crash/)!.detail).toContain('The tool hit the chuck jaws.');
    expect(find(ms, /Rubbing/)!.title).toContain('×2');
    expect(find(ms, /Rubbing/)!.detail).toContain('drill 1/4');
    expect(find(ms, /Chatter/)!.detail).toContain('when parting');
    expect(find(ms, /Chatter/)!.detail).toContain('Try 300 rpm'); // parting is held to 300 (QA2 P2-6)
    expect(find(ms, /Poor finish/)!.detail).toContain('3.00');
    expect(find(ms, /Heavy cut/)!.title).toContain('×2');
    expect(find(ms, /Heavy cut/)!.detail).toContain('90 thou');
    expect(find(ms, /spindle running/)!.title).toContain('×2');
  });
});
