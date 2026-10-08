// ScriptPlayer: plays a Script (lesson or solution) against a LatheEngine over time.
import { revolutionsFor, type LatheEngine } from './lathe';
import { MACHINE, type Action, type Axis, type LatheState, type MoveToAction, type Script, type ScriptAction, type ScriptStep } from './types';
import { evaluateCheck } from './hints';

export const HANDWHEEL_DEFAULT_DURATION = 1.0;
export const HANDWHEEL_MIN_DURATION = 0.2;
export const INSTANT_DEFAULT_DURATION = 0.3;
export const SAY_DEFAULT_DURATION = 2.0;
/** default speed of a moveTo without its own feed (in/s) */
export const MOVE_DEFAULT_FEED = 0.2;

const RANGES: Record<Axis, readonly [number, number]> = { x: MACHINE.xRange, z: MACHINE.zRange, quill: MACHINE.quillRange };

/** A moveTo resolved against a position: the revolutions to turn and how long to take. */
export function resolveMoveTo(a: MoveToAction, from: number): { revolutions: number; duration: number; target: number } {
  const [lo, hi] = RANGES[a.axis];
  const target = Math.min(hi, Math.max(lo, a.position));
  const dist = Math.abs(target - from);
  if (dist < 1e-9) return { revolutions: 0, duration: 0, target };
  const t = a.feed && a.feed > 0 ? dist / a.feed : Math.max(a.duration ?? 0, dist / MOVE_DEFAULT_FEED);
  return { revolutions: revolutionsFor(a.axis, target - from), duration: Math.max(HANDWHEEL_MIN_DURATION, t), target };
}

export interface PlayerStatus {
  stepIndex: number;
  actionIndex: number;
  /** 0..1 progress through the current step (by time) */
  progress: number;
  narration: string;
  title: string;
  stepId: string | null;
  /** text of the active 'say' action, if any */
  caption: string | null;
  playing: boolean;
  done: boolean;
  /**
   * Indexes of the steps whose check did not hold when the step ended (e.g. the user moved the
   * machine while a watched lesson was paused). Empty for a clean run. The same array is returned
   * until it changes.
   */
  deviations: readonly number[];
}

export interface ScriptPlayerOptions {
  /** stop playing at the end of each step (the pointer moves to the next step) */
  pauseAtStepEnd?: boolean;
}

/** Seconds an action takes to play (for moveTo, its nominal duration: the real one depends on where the machine is). */
export function actionDuration(a: ScriptAction): number {
  switch (a.type) {
    case 'moveTo':
      return Math.max(HANDWHEEL_MIN_DURATION, a.duration ?? HANDWHEEL_DEFAULT_DURATION);
    case 'turnHandwheel':
      return Math.max(HANDWHEEL_MIN_DURATION, a.duration ?? HANDWHEEL_DEFAULT_DURATION);
    case 'wait':
      return Math.max(0, a.duration);
    case 'say':
      return Math.max(0, a.duration ?? SAY_DEFAULT_DURATION);
    default:
      return Math.max(0, a.duration ?? INSTANT_DEFAULT_DURATION);
  }
}

export function stepDuration(step: ScriptStep): number {
  return step.actions.reduce((sum, a) => sum + actionDuration(a), 0);
}

export function scriptDuration(script: Script): number {
  return script.steps.reduce((sum, s) => sum + stepDuration(s), 0);
}

/** Strips script-only fields so the engine logs a clean Action. */
function toAction(a: ScriptAction): Action | null {
  if (a.type === 'wait' || a.type === 'say' || a.type === 'moveTo') return null;
  const { duration: _duration, ...rest } = a;
  return rest as Action;
}

const TIME_EPS = 1e-9;

export class ScriptPlayer {
  readonly script: Script;
  private engine: LatheEngine;
  private origin: LatheState;
  private options: ScriptPlayerOptions;
  private listeners = new Set<(s: PlayerStatus) => void>();
  private si = 0;
  private ai = 0;
  private elapsed = 0;
  private started = false;
  private sentRevs = 0;
  /** the current handwheel action's total revolutions and duration (moveTo: resolved at start) */
  private curRevs = 0;
  private curDuration = 0;
  /** engine position of the current moveTo's axis after our last dispatch */
  private lastPos: number | null = null;
  private playing = false;
  private done: boolean;
  private caption: string | null = null;
  private deviations: number[] = [];

  constructor(engine: LatheEngine, script: Script, options: ScriptPlayerOptions = {}) {
    this.engine = engine;
    this.script = script;
    this.options = options;
    // the engine appends to its action log in place, so freeze a copy for rewinding
    const s = engine.getState();
    this.origin = { ...s, actions: s.actions.slice() };
    this.done = script.steps.length === 0;
  }

  play(): void {
    if (this.done) return;
    // someone moved the machine while we were paused mid-move: re-aim the move from where it is now
    const a = this.script.steps[this.si]?.actions[this.ai];
    if (this.started && a?.type === 'moveTo' && this.lastPos !== null) {
      if (Math.abs(this.engine.getState()[a.axis] - this.lastPos) > 1e-9) {
        this.started = false;
        this.elapsed = 0;
        this.sentRevs = 0;
      }
    }
    this.playing = true;
    this.emit();
  }

  pause(): void {
    this.playing = false;
    this.emit();
  }

  get isPlaying(): boolean {
    return this.playing;
  }

  get isDone(): boolean {
    return this.done;
  }

  get currentStep(): ScriptStep | null {
    return this.script.steps[this.si] ?? null;
  }

  /** Whether the current step's check (if any) holds for the engine's state. */
  currentStepSatisfied(): boolean {
    const step = this.currentStep;
    return !step?.check || evaluateCheck(step.check, this.engine.getState());
  }

  /** Advances the script by dt seconds. Does NOT tick the engine; callers tick it themselves. */
  tick(dt: number): void {
    if (!this.playing || this.done || !(dt > 0)) return;
    let remaining = dt;
    while (this.playing && !this.done) {
      const step = this.script.steps[this.si];
      if (this.ai >= step.actions.length) {
        this.finishStep();
        if (this.options.pauseAtStepEnd) this.playing = false;
        continue;
      }
      const a = step.actions[this.ai];
      const d = this.durationOf(a);
      const left = d - this.elapsed;
      if (left > TIME_EPS && remaining <= TIME_EPS) break;
      this.startAction(a);
      const use = Math.min(remaining, Math.max(0, left));
      if (use > 0) this.advanceAction(a, d, use);
      remaining -= use;
      if (this.elapsed >= d - TIME_EPS) this.completeAction(a, d);
    }
    this.emit();
  }

  /** Completes the current step instantly (remaining actions applied with their natural timing) and moves to the next. */
  stepForward(): void {
    if (this.done) return;
    const step = this.script.steps[this.si];
    while (this.ai < step.actions.length) {
      const a = step.actions[this.ai];
      this.startAction(a);
      this.completeAction(a, this.durationOf(a));
    }
    this.finishStep();
    this.emit();
  }

  /**
   * Moves to the start of a step. Jumping forward fast-forwards through the steps in between;
   * jumping backward (or restarting the current step) resets the engine to the state it had
   * when the player was created and fast-forwards from there.
   */
  jumpTo(stepIndex: number): void {
    const target = Math.max(0, Math.min(stepIndex, this.script.steps.length));
    const atStepStart = this.ai === 0 && !this.started && this.elapsed === 0;
    if (target < this.si || (target === this.si && !atStepStart) || (this.done && target < this.script.steps.length)) {
      this.engine.reset(this.origin);
      this.deviations = [];
      this.si = 0;
      this.resetActionCursor();
      this.done = this.script.steps.length === 0;
    }
    while (!this.done && this.si < target) this.stepForward();
    this.emit();
  }

  getStatus(): PlayerStatus {
    const step = this.script.steps[Math.min(this.si, this.script.steps.length - 1)];
    let progress = 0;
    if (this.done) progress = 1;
    else if (step) {
      const total = stepDuration(step);
      let t = 0;
      for (let i = 0; i < this.ai; i++) t += actionDuration(step.actions[i]);
      const cur = step.actions[this.ai];
      // a moveTo's real duration can differ from its nominal one: scale its elapsed time
      if (cur?.type === 'moveTo' && this.started && this.curDuration > 0) {
        t += (this.elapsed / this.curDuration) * actionDuration(cur);
      } else t += this.elapsed;
      progress = total > 0 ? Math.min(1, t / total) : 0;
    }
    return {
      stepIndex: Math.min(this.si, Math.max(0, this.script.steps.length - 1)),
      actionIndex: this.ai,
      progress,
      narration: step?.narration ?? '',
      title: step?.title ?? '',
      stepId: step?.id ?? null,
      caption: this.caption,
      playing: this.playing,
      done: this.done,
      deviations: this.deviations,
    };
  }

  subscribe(fn: (s: PlayerStatus) => void): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  // ------------------------------------------------------------- internals

  private resetActionCursor(): void {
    this.ai = 0;
    this.elapsed = 0;
    this.started = false;
    this.sentRevs = 0;
    this.lastPos = null;
    this.caption = null;
  }

  /** Duration of an action: the resolved one once a handwheel action has started. */
  private durationOf(a: ScriptAction): number {
    if (a.type === 'moveTo') {
      return this.started ? this.curDuration : resolveMoveTo(a, this.engine.getState()[a.axis]).duration;
    }
    return actionDuration(a);
  }

  private startAction(a: ScriptAction): void {
    if (this.started) return;
    this.started = true;
    this.sentRevs = 0;
    if (a.type === 'say') {
      this.caption = a.text;
      return;
    }
    if (a.type === 'moveTo') {
      const from = this.engine.getState()[a.axis];
      const r = resolveMoveTo(a, from);
      this.curRevs = r.revolutions;
      this.curDuration = r.duration;
      this.lastPos = from;
      return;
    }
    if (a.type === 'turnHandwheel') {
      this.curRevs = a.revolutions;
      this.curDuration = actionDuration(a);
      return;
    }
    const action = toAction(a);
    if (action) this.engine.dispatch(action);
  }

  private turn(axis: Axis, revolutions: number, dt: number): void {
    this.engine.dispatch({ type: 'turnHandwheel', axis, revolutions, dt });
    this.lastPos = this.engine.getState()[axis];
  }

  private advanceAction(a: ScriptAction, d: number, use: number): void {
    this.elapsed += use;
    if (a.type !== 'turnHandwheel' && a.type !== 'moveTo') return;
    const finishing = this.elapsed >= d - TIME_EPS;
    const revs = finishing ? this.curRevs - this.sentRevs : (this.curRevs * use) / d;
    this.sentRevs += revs;
    if (revs !== 0) this.turn(a.axis, revs, use);
  }

  private completeAction(a: ScriptAction, d: number): void {
    if (a.type === 'turnHandwheel' || a.type === 'moveTo') {
      const left = this.curRevs - this.sentRevs;
      if (Math.abs(left) > 1e-12) {
        const dtLeft = Math.max(d - this.elapsed, TIME_EPS);
        this.turn(a.axis, left, dtLeft);
      }
    }
    if (a.type === 'say') this.caption = null;
    this.ai++;
    this.elapsed = 0;
    this.started = false;
    this.sentRevs = 0;
    this.lastPos = null;
  }

  private finishStep(): void {
    const step = this.script.steps[this.si];
    if (step?.check && !evaluateCheck(step.check, this.engine.getState())) {
      // a new array so subscribers can tell it changed
      this.deviations = [...this.deviations.filter((i) => i !== this.si), this.si];
    } else if (this.deviations.includes(this.si)) {
      this.deviations = this.deviations.filter((i) => i !== this.si);
    }
    this.si++;
    this.resetActionCursor();
    if (this.si >= this.script.steps.length) {
      this.si = this.script.steps.length;
      this.done = true;
      this.playing = false;
    }
  }

  private emit(): void {
    const status = this.getStatus();
    for (const fn of this.listeners) fn(status);
  }
}

/**
 * Runs a whole script against an engine at a fixed dt, ticking both the engine and the player.
 * Returns the final engine state. Throws if the script does not finish within maxSeconds.
 */
export function runScript(engine: LatheEngine, script: Script, dt = 1 / 60, maxSeconds = 3600): LatheState {
  const player = new ScriptPlayer(engine, script);
  player.play();
  let t = 0;
  while (!player.isDone) {
    if (t > maxSeconds) throw new Error(`Script ${script.id} did not finish within ${maxSeconds}s`);
    engine.tick(dt);
    player.tick(dt);
    t += dt;
  }
  return engine.getState();
}
