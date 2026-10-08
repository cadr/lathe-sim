// Action-log scaling: a long hand-made session must not make hints or grading slow (REVIEW P1-5).
import { describe, expect, it } from 'vitest';
import { analyze } from '../analyzer';
import { grade } from '../grader';
import { clearProgressCache, nextHint } from '../hints';
import { LatheEngine } from '../lathe';
import { pinChallenge } from './fixtures';

/** 50k dispatches the way the UI sends them: one division per click/drag step, plus jiggling. */
function longSession(): { engine: LatheEngine; dispatches: number } {
  const e = new LatheEngine();
  let n = 0;
  const d = (a: Parameters<LatheEngine['dispatch']>[0]) => {
    e.dispatch(a);
    n++;
  };
  const click = (axis: 'x' | 'z', divs: number, dt = 0.05) => {
    const per = axis === 'x' ? 0.02 : 0.01; // one division
    for (let i = 0; i < Math.abs(divs); i++) d({ type: 'turnHandwheel', axis, revolutions: Math.sign(divs) * per, dt });
  };
  d({ type: 'loadStock', stock: { material: 'brass', diameter: 1, length: 3, stickOut: 2 } });
  d({ type: 'selectTool', tool: 'turning' });
  d({ type: 'setSpindle', on: true });
  click('z', -10); // z 1.99
  click('x', 770, 0.02); // face across, x 0.75 -> -0.02
  click('x', -770, 0.02);
  // turning passes, one division at a time, with a pause (rpm tap) between moves
  for (const r of [0.46, 0.42, 0.38, 0.34, 0.3, 0.26, 0.25]) {
    click('z', 110); // to z 2.1
    click('x', Math.round((0.75 - r) * 1000));
    click('z', -1250); // cut to 0.85
    click('x', -Math.round((0.75 - r) * 1000));
    d({ type: 'setRpm', rpm: 600 });
  }
  // fidgeting in the air: direction changes every click, nothing coalesces
  while (n < 50_000) {
    click('x', 1);
    click('x', -1);
  }
  return { engine: e, dispatches: n };
}

describe('performance', () => {
  it('hints, grading and analysis stay fast after 50k dispatches', () => {
    const t0 = performance.now();
    const { engine, dispatches } = longSession();
    const tSession = performance.now() - t0;
    expect(dispatches).toBeGreaterThanOrEqual(50_000);
    const state = engine.getState();
    // per-dispatch cost stays flat: the whole session is far below O(n^2) copying
    expect(tSession).toBeLessThan(5000);

    const c = pinChallenge();
    // best of three cold runs: measures the algorithm, not JIT warm-up or GC pauses
    const best = (fn: () => void) => {
      let ms = Infinity;
      for (let k = 0; k < 3; k++) {
        clearProgressCache();
        const t = performance.now();
        fn();
        ms = Math.min(ms, performance.now() - t);
      }
      return ms;
    };
    const hintMs = best(() => nextHint(c, state));
    const gradeMs = best(() => analyze(c, state, grade(c, state)));
    const hint = nextHint(c, state);
    // a second hint after more work only replays the new entries
    engine.dispatch({ type: 'turnHandwheel', axis: 'z', revolutions: 1, dt: 0.5 });
    const w0 = performance.now();
    nextHint(c, engine.getState(), hint);
    const warmMs = performance.now() - w0;

    // target is < 50 ms (about 25 ms measured on an M2); the bounds are generous for slow CI
    // machines and coverage instrumentation. Before the fix this took about 3.6 s.
    expect(hintMs, `cold nextHint took ${hintMs.toFixed(1)} ms`).toBeLessThan(250);
    expect(gradeMs, `grade + analyze took ${gradeMs.toFixed(1)} ms`).toBeLessThan(250);
    expect(warmMs, `warm nextHint took ${warmMs.toFixed(1)} ms`).toBeLessThan(50);
    void `perf: ${dispatches} dispatches in ${tSession.toFixed(0)} ms, log ${state.actions.length} entries; cold hint ${hintMs.toFixed(1)} ms, grade+analyze ${gradeMs.toFixed(1)} ms, warm hint ${warmMs.toFixed(2)} ms`;
  });
});
