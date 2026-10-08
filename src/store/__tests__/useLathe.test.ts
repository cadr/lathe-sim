import { beforeEach, describe, expect, it } from 'vitest';
import { useLathe, selectControlsLocked, selectState, TOAST_LIFETIME } from '../useLathe';
import { getLesson } from '../../content';
import { toastText } from '../toastText';
import type { LatheEvent } from '../../engine';

const get = () => useLathe.getState();

function runUntilDone(dt = 1 / 30, maxSteps = 200000): void {
  for (let i = 0; i < maxSteps; i++) {
    const st = get().playerStatus;
    if (st?.done) return;
    get().tick(dt);
  }
  throw new Error('player did not finish');
}

describe('useLathe store', () => {
  beforeEach(() => get().reset());

  it('starts in free mode with a default engine snapshot', () => {
    expect(get().mode).toEqual({ kind: 'free' });
    expect(selectState(get())).toBe(get().engine.getState());
    expect(get().player).toBeNull();
  });

  it('mirrors engine state on dispatch and bumps version only on workpiece change', () => {
    const v0 = get().version;
    get().dispatch({ type: 'selectTool', tool: 'turning' });
    expect(get().state.tool).toBe('turning');
    expect(get().version).toBe(v0);
    get().dispatch({ type: 'loadStock', stock: { material: 'brass', diameter: 1, length: 3, stickOut: 1.5 } });
    expect(get().version).toBe(v0 + 1);
    get().turn('z', 0.5);
    expect(get().version).toBe(v0 + 1);
    get().tick(0.1);
    expect(get().version).toBe(v0 + 1);
    expect(get().state.time).toBeCloseTo(0.1);
  });

  it('turn moves the axis and ignores zero revolutions', () => {
    const z0 = get().state.z;
    get().turn('z', 1, 0.5);
    expect(get().state.z).toBeCloseTo(z0 + 0.1);
    const n = get().state.actions.length;
    get().turn('z', 0);
    expect(get().state.actions.length).toBe(n);
  });

  it('switches modes and reset returns to free mode', () => {
    get().startChallenge('pin');
    expect(get().mode).toEqual({ kind: 'challenge', id: 'pin' });
    expect(get().state.workpiece).toBeNull();
    get().startLesson('tour', true);
    expect(get().mode).toEqual({ kind: 'lesson', id: 'tour', doItYourself: true });
    expect(get().player).not.toBeNull();
    expect(get().playerStatus?.playing).toBe(false);
    get().reset();
    expect(get().mode).toEqual({ kind: 'free' });
    expect(get().player).toBeNull();
  });

  it('throws for unknown lessons and challenges', () => {
    expect(() => get().startLesson('nope')).toThrow();
    expect(() => get().startChallenge('nope')).toThrow();
  });

  it('plays a lesson to completion via tick, at speed', () => {
    get().setSpeed(8);
    get().startLesson('facing');
    expect(get().playerStatus?.playing).toBe(true);
    const engineBefore = get().engine;
    runUntilDone();
    expect(get().engine).toBe(engineBefore);
    expect(get().playerStatus?.done).toBe(true);
    expect(get().state.workpiece).not.toBeNull();
    expect(get().state.damage.crashed).toBe(false);
  });

  it('applies step cameras from the script', () => {
    get().startLesson('facing', true);
    expect(get().camera).toBe('chuck');
    get().stepForward();
    expect(get().camera).toBe('tool');
    get().setCamera('overview');
    expect(get().camera).toBe('overview');
  });

  it('playPause toggles, stepForward and jumpTo move the player', () => {
    get().startLesson('facing', true);
    get().playPause();
    expect(get().playerStatus?.playing).toBe(true);
    get().playPause();
    expect(get().playerStatus?.playing).toBe(false);
    get().stepForward();
    expect(get().playerStatus?.stepIndex).toBe(1);
    get().jumpTo(3);
    expect(get().playerStatus?.stepIndex).toBe(3);
    get().jumpTo(0);
    expect(get().playerStatus?.stepIndex).toBe(0);
    expect(get().state.workpiece).toBeNull();
    expect(get().toasts).toEqual([]);
  });

  it('player controls are no-ops without a player', () => {
    get().playPause();
    get().stepForward();
    get().jumpTo(2);
    get().playSolution();
    get().requestHint();
    get().checkPart();
    expect(get().player).toBeNull();
    expect(get().hint).toBeNull();
    expect(get().grade).toBeNull();
  });

  it('playSolution runs the challenge solution, and checkPart grades it as passing', () => {
    get().startChallenge('pin');
    get().setSpeed(8);
    get().playSolution();
    expect(get().mode).toEqual({ kind: 'challenge', id: 'pin' });
    runUntilDone();
    get().checkPart();
    expect(get().grade?.passed).toBe(true);
    expect(get().mistakes.length).toBeGreaterThan(0);
  });

  it('checkPart fails an untouched challenge and lists mistakes', () => {
    get().startChallenge('pin');
    get().checkPart();
    expect(get().grade?.passed).toBe(false);
    expect(get().mistakes.length).toBeGreaterThan(0);
  });

  it('requestHint escalates from level 1 to level 2 for the same step', () => {
    get().startChallenge('pin');
    get().requestHint();
    const h1 = get().hint;
    expect(h1?.level).toBe(1);
    get().requestHint();
    expect(get().hint?.level).toBe(2);
    expect(get().hint?.stepId).toBe(h1?.stepId);
  });

  it('raises toasts for notable events, expires and dismisses them', () => {
    get().dispatch({ type: 'loadStock', stock: { material: 'brass', diameter: 1, length: 3, stickOut: 1.5 } });
    get().dispatch({ type: 'selectTool', tool: 'turning' });
    // move the tool into the stock with the spindle off: rubbing
    get().turn('z', -6, 1);
    get().turn('x', 6, 1);
    const toasts = get().toasts;
    expect(toasts.some((t) => t.kind === 'rubbing')).toBe(true);
    expect(toasts.every((t) => t.kind !== 'stockLoaded' && t.kind !== 'toolChanged')).toBe(true);
    const id = toasts[0].id;
    get().dismissToast(id);
    expect(get().toasts.find((t) => t.id === id)).toBeUndefined();

    // crash into the jaws
    get().turn('x', -20, 1);
    get().turn('z', -30, 3);
    expect(get().toasts.some((t) => t.kind === 'crash')).toBe(true);
    get().tick(TOAST_LIFETIME / 2);
    expect(get().toasts.length).toBeGreaterThan(0);
    get().tick(TOAST_LIFETIME);
    expect(get().toasts).toEqual([]);
  });

  it('tick ignores non-positive dt', () => {
    const t = get().state.time;
    get().tick(0);
    get().tick(-1);
    expect(get().state.time).toBe(t);
  });

  it('describes every event kind', () => {
    const events: LatheEvent[] = [
      { t: 0, kind: 'cut', depth: 0.01, sfm: 100, feed: 0.1 },
      { t: 0, kind: 'rubbing', tool: 'turning' },
      { t: 0, kind: 'crash', what: 'chuck' },
      { t: 0, kind: 'crash', what: 'tailstock' },
      { t: 0, kind: 'heavyCut', depth: 0.1, max: 0.06 },
      { t: 0, kind: 'toolBroken' },
      { t: 0, kind: 'chatter', sfm: 400, rpm: 2000 },
      { t: 0, kind: 'chatter', sfm: 400 },
      { t: 0, kind: 'poorFinish', feedRate: 1 },
      { t: 0, kind: 'wrongDirection' },
      { t: 0, kind: 'parted', pieceIndex: 0 },
      { t: 0, kind: 'toolChangeWhileRunning' },
      { t: 0, kind: 'stockLoaded' },
      { t: 0, kind: 'spindleOn' },
      { t: 0, kind: 'spindleOff' },
      { t: 0, kind: 'toolChanged', tool: 'parting' },
    ];
    for (const e of events) expect(toastText(e).length).toBeGreaterThan(3);
    expect(toastText(events[6])).toContain('2000 rpm');
  });
});

describe('demos, take over and camera', () => {
  beforeEach(() => get().reset());

  it('showMe plays one step on the current machine, locks the controls, then restores the lesson player', () => {
    get().startLesson('facing', true);
    const lesson = get().player;
    const step = getLesson('facing')!.steps[0];
    get().showMe(step);
    expect(get().demo).toEqual({ kind: 'showMe', stepId: step.id });
    expect(get().player).not.toBe(lesson);
    expect(get().playerStatus?.playing).toBe(true);
    expect(selectControlsLocked(get())).toBe(true);
    for (let i = 0; i < 100 && get().demo; i++) get().tick(0.1);
    expect(get().demo).toBeNull();
    expect(get().player).toBe(lesson);
    expect(get().state.workpiece).not.toBeNull();
    expect(selectControlsLocked(get())).toBe(false);
  });

  it('stopDemo ends a demo early and leaves the machine where it is', () => {
    get().startLesson('facing', true);
    get().dispatch({ type: 'loadStock', stock: { material: 'brass', diameter: 1, length: 3, stickOut: 1.5 } });
    get().dispatch({ type: 'selectTool', tool: 'turning' });
    const step = getLesson('facing')!.steps.find((s) => s.actions.some((a) => a.type === 'moveTo' || a.type === 'turnHandwheel'))!;
    get().showMe(step);
    get().tick(0.3);
    const { x, z } = get().state;
    get().stopDemo();
    expect(get().demo).toBeNull();
    get().tick(1);
    // left where it stopped, give or take the snap onto the nearest dial division (QA2 P2-1)
    expect(Math.abs(get().state.x - x)).toBeLessThanOrEqual(0.0005 + 1e-9);
    expect(Math.abs(get().state.z - z)).toBeLessThanOrEqual(0.0005 + 1e-9);
    expect(get().state.x * 1000).toBeCloseTo(Math.round(get().state.x * 1000), 6);
    expect(get().state.z * 1000).toBeCloseTo(Math.round(get().state.z * 1000), 6);
  });

  it('takeOver drops a challenge solution, but only pauses a watched lesson', () => {
    get().startChallenge('pin');
    get().playSolution();
    expect(get().solutionPlayed).toBe(true);
    expect(selectControlsLocked(get())).toBe(true);
    get().tick(0.5);
    get().takeOver();
    expect(get().player).toBeNull();
    expect(get().playerStatus).toBeNull();
    expect(selectControlsLocked(get())).toBe(false);
    get().startChallenge('pin');
    expect(get().solutionPlayed).toBe(false);

    get().startLesson('facing');
    get().takeOver();
    expect(get().player).not.toBeNull();
    expect(get().playerStatus?.playing).toBe(false);
  });

  it('startLesson can start from a later step, with the machine fast-forwarded', () => {
    get().startLesson('facing', true, 3);
    expect(get().playerStatus?.stepIndex).toBe(3);
    expect(get().state.tool).toBe('turning');
    expect(get().toasts).toEqual([]);
    get().startLesson('facing', false, 2);
    expect(get().playerStatus?.stepIndex).toBe(2);
    expect(get().playerStatus?.playing).toBe(true);
  });

  it('choosing the current camera again bumps the nonce so the view glides back', () => {
    get().setCamera('tool');
    const n = get().cameraNonce;
    get().setCamera('tool');
    expect(get().camera).toBe('tool');
    expect(get().cameraNonce).toBe(n + 1);
  });
});

describe('fix round 2: take-over, resume and toasts', () => {
  beforeEach(() => {
    get().reset();
    get().setSpeed(1);
  });

  it('stopping Show me part-way puts every slide on a dial division (QA2 P2-1)', () => {
    get().startLesson('facing', true, 5);
    const step = getLesson('facing')!.steps[5];
    get().showMe(step);
    for (let i = 0; i < 7; i++) get().tick(0.137);
    get().stopDemo();
    for (const axis of ['x', 'z', 'quill'] as const) {
      const v = get().state[axis] * 1000;
      expect(Math.abs(v - Math.round(v))).toBeLessThan(1e-6);
    }
  });

  it('pausing a watched lesson snaps it too, and resuming after a move says so (QA P1-10)', () => {
    get().startLesson('facing');
    for (let i = 0; i < 40; i++) get().tick(0.1);
    get().playPause(); // pause
    expect(get().playerStatus?.playing).toBe(false);
    const z = get().state.z * 1000;
    expect(Math.abs(z - Math.round(z))).toBeLessThan(1e-6);
    get().turn('z', -0.3, 1.5); // 30 thou toward the chuck while paused
    get().playPause(); // resume
    expect(get().playerStatus?.playing).toBe(true);
    const notice = get().toasts.find((t) => t.kind === 'notice');
    expect(notice?.text).toMatch(/^You moved the carriage while the demo was paused\. It carries on from here: the carriage is at Z \d\.\d{3}/);
  });

  it('resuming without touching anything says nothing', () => {
    get().startLesson('facing');
    for (let i = 0; i < 20; i++) get().tick(0.1);
    get().playPause();
    get().playPause();
    expect(get().toasts.filter((t) => t.kind === 'notice')).toEqual([]);
  });

  it('take over, change the work, then play: the notice gives the new face', () => {
    get().startLesson('facing');
    for (let i = 0; i < 40; i++) get().tick(0.1);
    get().takeOver();
    const st = get().state;
    expect(st.workpiece).not.toBeNull();
    // face another 20 thou by hand
    get().dispatch({ type: 'setSpindle', on: true });
    get().turn('x', -(0.7 - st.x) / 0.05, 2); // out to x 0.7
    const zTarget = 1.46;
    get().turn('z', (zTarget - get().state.z) / 0.1, 10);
    get().turn('x', (0.7 + 0.02) / 0.05, 20); // across the face
    get().playPause();
    const notice = get().toasts.find((t) => t.kind === 'notice');
    expect(notice?.text).toMatch(/changed the work/);
    expect(notice?.text).toMatch(/the face is now at Z 1\.46/);
  });

  it('a boring bar in solid metal raises the reason, not the generic broken-tool toast (QA2 P2-4)', () => {
    get().dispatch({ type: 'loadStock', stock: { material: 'brass', diameter: 1, length: 3, stickOut: 1.5 } });
    get().dispatch({ type: 'selectTool', tool: 'boring' });
    get().dispatch({ type: 'setSpindle', on: true });
    get().turn('x', (0.75 - 0.06) / 0.05, 1); // bar tip on center
    get().turn('z', (1.0 - get().state.z) / 0.1, 10); // into the face
    const kinds = get().toasts.map((t) => t.kind);
    expect(kinds).toContain('boringSolid');
    expect(kinds).not.toContain('toolBroken');
    expect(get().toasts.find((t) => t.kind === 'boringSolid')!.text).toMatch(/needs a drilled hole/);
  });

  it('an empty toolpost crash blames the carriage (QA2 P2-13)', () => {
    expect(toastText({ t: 0, kind: 'crash', what: 'tailstock', tool: 'none' } as LatheEvent)).toBe('CRASH! The carriage hit the tailstock.');
    expect(toastText({ t: 0, kind: 'crash', what: 'chuck', tool: 'turning' } as LatheEvent)).toBe('CRASH! The tool hit the chuck.');
  });

  it('a watched lesson run clean reports no deviations; a disturbed one does', () => {
    get().startLesson('facing');
    runUntilDone(0.25);
    expect(get().playerStatus?.deviations).toEqual([]);
    get().jumpTo(0);
    get().playPause();
    // run to the last step, then move the cross slide in while paused so its check fails
    const steps = getLesson('facing')!.steps;
    for (let i = 0; i < 200000 && (get().playerStatus?.stepIndex ?? 0) < steps.length - 1; i++) get().tick(0.25);
    get().playPause();
    get().dispatch({ type: 'removeStock' }); // so the last step's "faced to 1.480" can't hold
    get().playPause();
    expect(get().toasts.find((t) => t.kind === 'notice')?.text).toMatch(/changed the work/);
    runUntilDone(0.25);
    expect(get().playerStatus?.deviations).toEqual([steps.length - 1]);
  });
});

