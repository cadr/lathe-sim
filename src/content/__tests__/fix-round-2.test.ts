// Regression tests for the second QA fix round (second QA pass) that need real content.
import { describe, expect, it } from 'vitest';
import { LatheEngine, ScriptPlayer, analyze, grade, nextHint, revolutionsFor, scriptProgress } from '../../engine';
import type { Axis, Hint } from '../../engine';
import { getChallenge } from '../index';

function moveTo(e: LatheEngine, axis: Axis, target: number, feed = 0.05): void {
  const delta = target - e.getState()[axis];
  if (Math.abs(delta) < 1e-12) return;
  e.dispatch({ type: 'turnHandwheel', axis, revolutions: revolutionsFor(axis, delta), dt: Math.abs(delta) / feed });
}

/** The Pin made by following the plan, with the last turning pass taken to `finalRadius`. */
function pinTurnedTo(finalRadius: number): LatheEngine {
  const pin = getChallenge('pin')!;
  const e = new LatheEngine();
  const player = new ScriptPlayer(e, pin.solution);
  player.jumpTo(pin.solution.steps.findIndex((s) => s.id === 'turn-1')); // loaded and faced
  for (const r of [0.46, 0.42, 0.38, 0.34, 0.3, 0.275, 0.255, finalRadius]) {
    moveTo(e, 'z', 1.53, 0.4);
    moveTo(e, 'x', r, 0.4);
    moveTo(e, 'z', 0.35, 0.03);
    moveTo(e, 'x', 0.6, 0.4);
  }
  moveTo(e, 'z', 1.53, 0.4);
  return e;
}

describe('hints after a mistake that cannot be undone (P1-A)', () => {
  const pin = getChallenge('pin')!;

  it('says the bar is under size and moves on to parting off', () => {
    const e = pinTurnedTo(0.245); // Ø0.490
    const h1 = nextHint(pin, e.getState());
    expect(h1.stepId).toBe('part-off');
    expect(h1.notice).toMatch(/already under 0\.498/);
    expect(h1.notice).toMatch(/Ø0\.490/);
    expect(h1.notice).toMatch(/part it off with the blade at Z 0\.418/);
    expect(h1.notice).toMatch(/Try again/);
    expect(h1.text.startsWith(h1.notice!)).toBe(true);
    // level 2 is the parting step, not 34 lines of roughing passes that cut air
    const h2 = nextHint(pin, e.getState(), h1);
    expect(h2.level).toBe(2);
    expect(h2.stepId).toBe('part-off');
    expect(h2.lines!.join(' ')).toMatch(/parting/);
    expect(h2.lines!.join(' ')).not.toMatch(/Pass \d of/);
    expect(h2.lines!.length).toBeLessThan(10);
  });

  it('marks the step impossible in the progress, and the analyzer explains it before parting', () => {
    const e = pinTurnedTo(0.245);
    const p = scriptProgress(pin.solution, e.getState(), pin.stock);
    const turn = pin.solution.steps.findIndex((s) => s.id === 'turn-1');
    expect(p.impossible[turn]).toBe(true);
    expect(p.skipped).toEqual([turn]);
    const g = grade(pin, e.getState());
    const m = analyze(pin, e.getState(), g);
    expect(m.map((x) => x.title)).toContain("This part can't come out to size");
    expect(m.find((x) => x.title === "This part can't come out to size")!.detail).toMatch(/Ø0\.490/);
    expect(g.checks.find((c) => c.label.startsWith('Diameter'))!.actual).toBe('not measured: still on the bar');
  });

  it('after parting the undersize pin, the grade and the analyzer report the diameter', () => {
    const e = pinTurnedTo(0.245);
    const player = new ScriptPlayer(e, pin.solution);
    const part = pin.solution.steps.find((s) => s.id === 'part-off')!;
    const one = new ScriptPlayer(e, { id: 'p', steps: [part] });
    one.play();
    for (let i = 0; i < 60 * 600 && !one.isDone; i++) {
      e.tick(1 / 30);
      one.tick(1 / 30);
    }
    expect(player).toBeTruthy();
    expect(e.getState().partedPieces.length).toBe(1);
    const g = grade(pin, e.getState());
    expect(g.passed).toBe(false);
    const titles = analyze(pin, e.getState(), g).map((x) => x.title);
    expect(titles.some((t) => t.startsWith('Undersize'))).toBe(true);
    expect(titles).not.toContain("This part can't come out to size");
    // and the hint now says to check the part
    const h: Hint = nextHint(pin, e.getState());
    expect(['stop', 'done']).toContain(h.stepId);
  });

  it('a level-2 turning hint is one line per pass and leaves out passes that would cut air', () => {
    const e = new LatheEngine();
    const player = new ScriptPlayer(e, pin.solution);
    const turn = pin.solution.steps.findIndex((s) => s.id === 'turn-1');
    player.jumpTo(turn);
    const h1 = nextHint(pin, e.getState());
    const fresh = nextHint(pin, e.getState(), h1);
    expect(fresh.lines!.filter((l) => /^Pass \d of 8:/.test(l))).toHaveLength(8);
    expect(fresh.lines!.length).toBeLessThanOrEqual(10);
    // rough three passes by hand, then ask again
    for (const r of [0.46, 0.42, 0.38]) {
      moveTo(e, 'z', 1.53, 0.4);
      moveTo(e, 'x', r, 0.4);
      moveTo(e, 'z', 0.35, 0.05);
      moveTo(e, 'x', 0.6, 0.4);
    }
    const later = nextHint(pin, e.getState(), h1);
    expect(later.lines![0]).toMatch(/Passes 1 to 3 would cut nothing now/);
    expect(later.lines![1]).toMatch(/^Pass 4 of 8: Run the carriage toward the tailstock to Z 1\.530/);
    expect(later.lines![1]).toMatch(/X dia 0\.680/);
  });
});

describe('targets on dial divisions (P2-9)', () => {
  it('every scripted cross-slide and carriage position is a whole thousandth', async () => {
    const { lessons, challenges } = await import('../index');
    const scripts = [...lessons, ...challenges.map((c) => c.solution)];
    const off: string[] = [];
    for (const s of scripts)
      for (const st of s.steps)
        for (const a of st.actions)
          if (a.type === 'moveTo' && a.axis !== 'quill' && Math.abs(a.position * 1000 - Math.round(a.position * 1000)) > 1e-6) {
            off.push(`${s.id}/${st.id}: ${a.axis} ${a.position}`);
          }
    expect(off).toEqual([]);
  });

  it('no hint asks for half a division', async () => {
    const { challenges } = await import('../index');
    for (const c of challenges) for (const h of c.hints) expect(h).not.toMatch(/and a half divisions|\d\.\d{3}5 back/);
  });
});
