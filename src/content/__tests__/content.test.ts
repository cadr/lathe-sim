import { describe, expect, it } from 'vitest';
import { LatheEngine, ScriptPlayer, evaluateCheck, grade, revolutionsFor } from '../../engine';
import type { Axis, LatheEventKind, Script, StateCheck } from '../../engine';
import { challenges, getChallenge, getLesson, lessonMeta, lessons } from '../index';

const DT = 1 / 60;
/** Content assumes the machine starts with the tool clear of a 1" bar. */
const START = { x: 0.75, z: 2.0, quill: 0 };
const MAX_TICKS = 60 * 60 * 15; // 15 simulated minutes

interface RunResult {
  engine: LatheEngine;
  /** For each step index: did its check hold when the step finished? */
  stepChecks: { stepId: string; ok: boolean }[];
  finished: boolean;
}

/** Something to do to the machine right after a step finishes (a DIY user being slightly off). */
type Nudge = { afterStep: number; axis: Axis; to: number };

function runScript(script: Script, nudge?: Nudge, dt = DT): RunResult {
  const engine = new LatheEngine({ x: START.x, z: START.z, quill: START.quill });
  // pause at every step end so each check is judged exactly where its step left the machine
  const player = new ScriptPlayer(engine, script, { pauseAtStepEnd: true });
  const stepChecks: { stepId: string; ok: boolean }[] = [];
  let ticks = 0;
  for (let index = 0; index < script.steps.length && ticks < MAX_TICKS; index++) {
    player.play();
    while (player.isPlaying && ticks < MAX_TICKS) {
      engine.tick(dt);
      player.tick(dt);
      ticks++;
    }
    const step = script.steps[index];
    stepChecks.push({ stepId: step.id, ok: step.check ? evaluateCheck(step.check, engine.getState()) : true });
    if (nudge && nudge.afterStep === index) {
      // a slow hand move to somewhere else inside the step's position window
      const delta = nudge.to - engine.getState()[nudge.axis];
      if (Math.abs(delta) > 1e-9) {
        engine.dispatch({ type: 'turnHandwheel', axis: nudge.axis, revolutions: revolutionsFor(nudge.axis, delta), dt: Math.abs(delta) / 0.01 });
      }
    }
  }
  return { engine, stepChecks, finished: player.isDone };
}

/** Every event kind that means something went wrong or was done badly. */
const WARNING_KINDS = new Set<LatheEventKind>([
  'crash',
  'rubbing',
  'toolBroken',
  'heavyCut',
  'chatter',
  'poorFinish',
  'wrongDirection',
  'toolChangeWhileRunning',
  'boringSolid',
]);

function badEvents(engine: LatheEngine): string[] {
  return engine
    .getState()
    .events.filter((e) => WARNING_KINDS.has(e.kind))
    .map((e) => JSON.stringify(e));
}

/** Position windows (xBetween / zBetween) in a check, at the top level or inside 'all'. */
function positionWindows(c: StateCheck | undefined): { axis: Axis; min: number; max: number }[] {
  if (!c) return [];
  if (c.kind === 'all') return c.checks.flatMap(positionWindows);
  if (c.kind === 'xBetween') return [{ axis: 'x', min: c.min, max: c.max }];
  if (c.kind === 'zBetween') return [{ axis: 'z', min: c.min, max: c.max }];
  return [];
}

const doesSomething = (s: Script['steps'][number]) => s.actions.some((a) => a.type !== 'say' && a.type !== 'wait');

describe('content index', () => {
  it('lists lessons in the documented order', () => {
    expect(lessons.map((l) => l.id)).toEqual(['tour', 'facing', 'turning', 'drilling', 'parting', 'full-project']);
    expect(lessonMeta.map((l) => l.id)).toEqual(lessons.map((l) => l.id));
  });

  it('lists challenges in the documented order', () => {
    expect(challenges.map((c) => c.id)).toEqual(['faced-slug', 'pin', 'stepped-shaft', 'bushing', 'spacer-set']);
  });

  it('looks things up by id', () => {
    expect(getLesson('facing')?.id).toBe('facing');
    expect(getChallenge('pin')?.id).toBe('pin');
    expect(getLesson('nope')).toBeUndefined();
    expect(getChallenge('nope')).toBeUndefined();
  });

  it('gives every step an id, title, narration, camera and check, with unique ids', () => {
    const scripts: Script[] = [...lessons, ...challenges.map((c) => c.solution)];
    for (const script of scripts) {
      const ids = new Set<string>();
      for (const step of script.steps) {
        expect(ids.has(step.id), `${script.id}: duplicate step id ${step.id}`).toBe(false);
        ids.add(step.id);
        expect(step.title.length, `${script.id}/${step.id} title`).toBeGreaterThan(0);
        expect(step.narration.length, `${script.id}/${step.id} narration`).toBeGreaterThan(0);
        expect(step.camera, `${script.id}/${step.id} camera`).toBeDefined();
        expect(step.check, `${script.id}/${step.id} check`).toBeDefined();
        expect(step.actions.length, `${script.id}/${step.id} actions`).toBeGreaterThan(0);
      }
    }
  });

  it('gives every challenge hints, concepts and a solution that loads its own stock', () => {
    for (const c of challenges) {
      expect(c.hints.length, c.id).toBeGreaterThanOrEqual(4);
      expect(c.concepts.length, c.id).toBeGreaterThan(0);
      const first = c.solution.steps[0].actions[0];
      expect(first).toEqual({ type: 'loadStock', stock: c.stock });
    }
  });
});

describe('lessons', () => {
  for (const lesson of lessons) {
    it(`${lesson.id}: runs without any warning event, and every step check passes`, () => {
      const { engine, stepChecks, finished } = runScript(lesson);
      expect(finished, 'script did not finish within the tick cap').toBe(true);
      expect(badEvents(engine)).toEqual([]);
      expect(engine.getState().damage).toEqual({ toolBroken: false, crashed: false });
      expect(stepChecks.length).toBe(lesson.steps.length);
      const failed = stepChecks.filter((s) => !s.ok).map((s) => s.stepId);
      expect(failed, `steps whose check failed on completion: ${failed.join(', ')}`).toEqual([]);
    });
  }
});

describe('lessons in do-it-yourself mode', () => {
  for (const lesson of lessons) {
    it(`${lesson.id}: a step that asks you to do something is never "already done" when you reach it`, () => {
      const engine = new LatheEngine({ x: START.x, z: START.z, quill: START.quill });
      const player = new ScriptPlayer(engine, lesson);
      const already: string[] = [];
      for (let i = 0; i < lesson.steps.length; i++) {
        const step = lesson.steps[i];
        if (doesSomething(step) && step.check && evaluateCheck(step.check, engine.getState())) already.push(step.id);
        player.jumpTo(i + 1);
      }
      expect(already).toEqual([]);
    });

    // A DIY user who ends a step anywhere inside its position window must still be able to do
    // every later step exactly as shown (Show me / the absolute instructions), with no warnings.
    lesson.steps.forEach((step, k) => {
      if (k >= lesson.steps.length - 1) return;
      for (const w of positionWindows(step.check)) {
        for (const edge of [w.min, w.max]) {
          it(`${lesson.id}: carries on cleanly with ${w.axis} at ${edge} after "${step.id}"`, () => {
            const { engine, stepChecks, finished } = runScript(lesson, { afterStep: k, axis: w.axis, to: edge }, 1 / 20);
            expect(finished).toBe(true);
            expect(badEvents(engine)).toEqual([]);
            const failed = stepChecks.filter((s) => !s.ok).map((s) => s.stepId);
            expect(failed).toEqual([]);
          });
        }
      }
    });
  }
});

describe('challenge solutions', () => {
  for (const challenge of challenges) {
    it(`${challenge.id}: solution passes grading`, () => {
      const { engine, stepChecks, finished } = runScript(challenge.solution);
      expect(finished, 'solution did not finish within the tick cap').toBe(true);
      const result = grade(challenge, engine.getState());
      const detail = JSON.stringify({ checks: result.checks, measured: result.measured, score: result.score }, null, 2);
      expect(result.passed, detail).toBe(true);
      expect(badEvents(engine), 'safety events in solution').toEqual([]);
      const failed = stepChecks.filter((s) => !s.ok).map((s) => s.stepId);
      expect(failed, `solution steps whose check failed on completion: ${failed.join(', ')}`).toEqual([]);
    });
  }
});
