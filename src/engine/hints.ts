// State checks, solution-progress tracking and hint derivation.
import { LatheEngine, dialGraduationFor, handwheelDelta, revolutionsFor } from './lathe';
import { MACHINE, type Action, type Axis, type Challenge, type Hint, type LatheState, type Script, type ScriptAction, type ScriptStep, type StateCheck, type StockSpec, type TimedAction } from './types';
import { TAILSTOCK_TOOLS, TOOLS } from './tools';
import { createStock, facePosition, isGone, sampleRange } from './workpiece';

const EPS = 1e-6;

function allColumns(state: LatheState, z0: number, z1: number, pred: (o: number, i: number) => boolean): boolean {
  const wp = state.workpiece;
  if (!wp) return false;
  const [a, b] = sampleRange(wp, Math.min(z0, z1), Math.max(z0, z1));
  if (a > b) return false;
  for (let i = a; i <= b; i++) {
    const gone = isGone(wp, i);
    if (!pred(gone ? 0 : wp.outer[i], gone ? 0 : wp.inner[i])) return false;
  }
  return true;
}

export function evaluateCheck(check: StateCheck, state: LatheState): boolean {
  switch (check.kind) {
    case 'toolIs':
      return state.tool === check.tool;
    case 'tailstockToolIs':
      return state.tailstockTool === check.tool;
    case 'spindle':
      return state.spindle.on === check.on;
    case 'rpmAtMost':
      return state.spindle.rpm <= check.rpm;
    case 'rpmAtLeast':
      return state.spindle.rpm >= check.rpm;
    case 'stockLoaded':
      return state.workpiece !== null;
    case 'xBetween':
      return state.x >= check.min - EPS && state.x <= check.max + EPS;
    case 'zBetween':
      return state.z >= check.min - EPS && state.z <= check.max + EPS;
    case 'facedTo': {
      const f = state.workpiece ? facePosition(state.workpiece) : null;
      return f !== null && f <= check.zMax + EPS;
    }
    case 'diameterBetween':
      return allColumns(state, check.z0, check.z1, (o) => 2 * o >= check.min - EPS && 2 * o <= check.max + EPS);
    case 'boreAtLeast':
      return allColumns(state, check.z0, check.z1, (o, inn) => o > 0 && 2 * inn >= check.minDiameter - EPS);
    case 'parted':
      return state.partedPieces.length > 0 || state.inventory.length > 0;
    case 'dialZeroBetween': {
      const zero = state.dialZero[check.axis];
      return zero >= check.min - EPS && zero <= check.max + EPS;
    }
    case 'all':
      return check.checks.every((c) => evaluateCheck(c, state));
  }
}

const PERSISTENT_KINDS = new Set<StateCheck['kind']>(['facedTo', 'diameterBetween', 'boreAtLeast', 'parted']);

/** A check is persistent if it describes the work itself (not a transient machine setting). */
export function isPersistentCheck(check: StateCheck): boolean {
  if (check.kind === 'all') return check.checks.length > 0 && check.checks.every(isPersistentCheck);
  return PERSISTENT_KINDS.has(check.kind);
}

/**
 * For a persistent check: has the work been touched where the check looks (some material cut in
 * the region, a hole started, the face moved)? Used to tell "skipped" apart from "done but wrong".
 * Non-persistent checks count as attempted only when they hold.
 */
export function checkAttempted(check: StateCheck, state: LatheState, stockDiameter?: number): boolean {
  const wp = state.workpiece;
  switch (check.kind) {
    case 'facedTo': {
      const f = wp ? facePosition(wp) : null;
      return f !== null && f < wp!.zEnd - 0.001;
    }
    case 'diameterBetween': {
      if (!wp) return false;
      let full = stockDiameter ?? 0;
      if (!full) for (let i = 0; i < wp.outer.length; i++) full = Math.max(full, 2 * wp.outer[i]);
      const [a, b] = sampleRange(wp, Math.min(check.z0, check.z1), Math.max(check.z0, check.z1));
      for (let i = a; i <= b; i++) if (isGone(wp, i) || 2 * wp.outer[i] < full - 0.001) return true;
      return false;
    }
    case 'boreAtLeast': {
      if (!wp) return false;
      const [a, b] = sampleRange(wp, Math.min(check.z0, check.z1), Math.max(check.z0, check.z1));
      for (let i = a; i <= b; i++) if (!isGone(wp, i) && wp.inner[i] > 0) return true;
      return false;
    }
    case 'all':
      return check.checks.some((c) => checkAttempted(c, state, stockDiameter));
    default:
      return evaluateCheck(check, state);
  }
}

/**
 * For a check about the work: can it no longer become true, whatever the user does next?
 * Material only ever comes off, so a diameter already under the window (or a section that is no
 * longer there at all, e.g. faced away) can't be fixed, and neither can a hole where the metal is
 * gone. Settings, positions, facing and parting can always still happen, so they are never
 * impossible. With no stock loaded nothing is impossible yet (fresh stock can be loaded).
 */
export function checkImpossible(check: StateCheck, state: LatheState): boolean {
  return impossibleReason(check, state) !== null;
}

/** Why a check can't be met any more (one or two sentences), or null if it still can be. */
export function impossibleReason(check: StateCheck, state: LatheState): string | null {
  const wp = state.workpiece;
  switch (check.kind) {
    case 'diameterBetween': {
      if (!wp) return null;
      const [a, b] = sampleRange(wp, Math.min(check.z0, check.z1), Math.max(check.z0, check.z1));
      if (a > b) return null;
      let gone = false;
      let min = Infinity;
      for (let i = a; i <= b; i++) {
        if (isGone(wp, i)) gone = true;
        else min = Math.min(min, 2 * wp.outer[i]);
      }
      if (gone) {
        const f = facePosition(wp);
        return `There is no metal left from Z ${fmt3(check.z0)} to ${fmt3(check.z1)}${f !== null ? `: the end of the bar is now at Z ${fmt3(f)}` : ''}, and metal can't be put back.`;
      }
      if (min < check.min - EPS) {
        return `The bar is already under ${fmt3(check.min)}: it measures Ø${fmt3(min)} here, and metal can't be put back.`;
      }
      return null;
    }
    case 'boreAtLeast': {
      if (!wp) return null;
      const [a, b] = sampleRange(wp, Math.min(check.z0, check.z1), Math.max(check.z0, check.z1));
      for (let i = a; i <= b; i++) {
        if (isGone(wp, i)) {
          return `There is no metal left where the hole should be (Z ${fmt3(check.z0)} to ${fmt3(check.z1)}).`;
        }
      }
      return null;
    }
    case 'all':
      for (const c of check.checks) {
        const r = impossibleReason(c, state);
        if (r) return r;
      }
      return null;
    default:
      return null;
  }
}

export interface ScriptProgress {
  /** index of the first step not yet completed (steps.length when all are done) */
  nextStep: number;
  /** per step: was its check true at any point in the replayed history */
  everTrue: boolean[];
  /** per step: was the work ever touched where its (persistent) check looks */
  everAttempted: boolean[];
  /** per step: its check can no longer be met on the live state (checkImpossible) */
  impossible: boolean[];
  /**
   * Steps passed over to reach nextStep because their check can no longer be met (in order).
   * Empty when the plan is on track.
   */
  skipped: number[];
}

/** Replay state for one action log and one script, advanced incrementally as the log grows. */
interface Tracker {
  engine: LatheEngine;
  /** log entries applied so far, and the last one as it was when applied (to spot coalescing) */
  processed: number;
  lastEntry: TimedAction | null;
  everTrue: boolean[];
  everAttempted: boolean[];
  next: number;
  /** cached results of persistent checks, valid while the work is unchanged */
  workKey: { wp: unknown; parted: unknown; inv: unknown } | null;
  persistentValue: (boolean | null)[];
}

const trackers = new WeakMap<TimedAction[], Map<string, Tracker>>();
let scriptIds = new WeakMap<Script, number>();
let nextScriptId = 1;

function scriptKey(script: Script): number {
  let id = scriptIds.get(script);
  if (id === undefined) {
    id = nextScriptId++;
    scriptIds.set(script, id);
  }
  return id;
}

/** Drops cached replays (tests use this to measure a cold start). */
export function clearProgressCache(): void {
  scriptIds = new WeakMap();
}

function newTracker(script: Script, preload: StockSpec | null, stockDiameter?: number): Tracker {
  const engine = new LatheEngine(preload ? { workpiece: createStock(preload) } : undefined);
  const n = script.steps.length;
  const t: Tracker = {
    engine,
    processed: 0,
    lastEntry: null,
    everTrue: new Array<boolean>(n).fill(false),
    everAttempted: new Array<boolean>(n).fill(false),
    next: 0,
    workKey: null,
    persistentValue: new Array<boolean | null>(n).fill(null),
  };
  observe(t, script, engine.getState(), stockDiameter);
  return t;
}

function observe(t: Tracker, script: Script, s: LatheState, stockDiameter?: number): void {
  const steps = script.steps;
  const key = t.workKey;
  const workChanged = !key || key.wp !== s.workpiece || key.parted !== s.partedPieces || key.inv !== s.inventory;
  if (workChanged) {
    t.workKey = { wp: s.workpiece, parted: s.partedPieces, inv: s.inventory };
    t.persistentValue.fill(null);
  }
  const value = (i: number): boolean => {
    const c = steps[i].check;
    if (!c) return true;
    if (!isPersistentCheck(c)) return evaluateCheck(c, s);
    const cached = t.persistentValue[i];
    if (cached !== null) return cached;
    const v = evaluateCheck(c, s);
    t.persistentValue[i] = v;
    return v;
  };
  for (let i = 0; i < steps.length; i++) {
    const c = steps[i].check;
    if (!c) continue;
    const persistent = isPersistentCheck(c);
    if (persistent && !workChanged) continue; // nothing about the work changed
    if (!t.everTrue[i] && value(i)) t.everTrue[i] = true;
    if (!t.everAttempted[i] && (t.everTrue[i] || (persistent && checkAttempted(c, s, stockDiameter)))) {
      t.everAttempted[i] = true;
    }
  }
  while (t.next < steps.length && value(t.next)) t.next++;
}

/** Applies log entries the tracker hasn't seen yet (including growth of a coalesced last entry). */
function advance(t: Tracker, script: Script, log: TimedAction[], stockDiameter?: number): void {
  if (t.processed > 0 && log[t.processed - 1] !== t.lastEntry) {
    const was = t.lastEntry!.action;
    const now = log[t.processed - 1].action;
    if (was.type === 'turnHandwheel' && now.type === 'turnHandwheel' && now.axis === was.axis) {
      t.engine.dispatch({
        type: 'turnHandwheel',
        axis: now.axis,
        revolutions: now.revolutions - was.revolutions,
        dt: Math.max(1e-6, (now.dt ?? MACHINE.defaultMoveDt) - (was.dt ?? MACHINE.defaultMoveDt)),
      });
      observe(t, script, t.engine.getState(), stockDiameter);
    }
    t.lastEntry = log[t.processed - 1];
  }
  for (let i = t.processed; i < log.length; i++) {
    t.engine.dispatch(log[i].action);
    observe(t, script, t.engine.getState(), stockDiameter);
  }
  t.processed = log.length;
  t.lastEntry = log.length ? log[log.length - 1] : null;
}

/**
 * Replays the state's action log through a fresh engine and tracks the solution steps.
 * Steps are completed in order: a step completes once its check holds (steps without a check
 * complete immediately). If the current state satisfies a later persistent check, progress jumps past it.
 * The challenge `stock` is preloaded only when the live state has a workpiece that the log never
 * loaded (an engine constructed with stock); a fresh machine starts empty, so the first step is
 * "load the stock".
 *
 * The replay is cached per action log and script and only the new entries are applied on later
 * calls, so asking for hints or grading stays cheap however long the session runs.
 */
export function scriptProgress(script: Script, state: LatheState, stock?: StockSpec): ScriptProgress {
  const steps = script.steps;
  const log = state.actions;
  const hasLoad = log.some((a) => a.action.type === 'loadStock');
  const preload = !hasLoad && stock && state.workpiece ? stock : null;
  const key = `${scriptKey(script)}:${preload ? JSON.stringify(preload) : '-'}`;
  let perLog = trackers.get(log);
  if (!perLog) {
    perLog = new Map();
    trackers.set(log, perLog);
  }
  let t = perLog.get(key);
  if (!t || t.processed > log.length) {
    t = newTracker(script, preload, stock?.diameter);
    perLog.set(key, t);
  }
  advance(t, script, log, stock?.diameter);

  let next = t.next;
  // the live state is authoritative for persistent checks
  for (let i = steps.length - 1; i >= next; i--) {
    const c = steps[i].check;
    if (c && isPersistentCheck(c) && evaluateCheck(c, state)) {
      next = i + 1;
      break;
    }
  }
  const everTrue = t.everTrue.slice();
  const everAttempted = t.everAttempted.slice();
  steps.forEach((step, i) => {
    if (!everTrue[i] && step.check && evaluateCheck(step.check, state)) everTrue[i] = true;
    if (everTrue[i]) everAttempted[i] = true;
  });
  const impossible = steps.map((step) => !!step.check && checkImpossible(step.check, state));
  // a step whose check can never become true would hold the plan up for ever: pass over it (and
  // any work steps after it that already hold) to the next step that can still be done
  const skipped: number[] = [];
  while (next < steps.length) {
    const c = steps[next].check;
    if (c && impossible[next]) {
      skipped.push(next++);
      continue;
    }
    if (skipped.length && c && isPersistentCheck(c) && evaluateCheck(c, state)) {
      next++;
      continue;
    }
    break;
  }
  return { nextStep: next, everTrue, everAttempted, impossible, skipped };
}

// ------------------------------------------------------------- descriptions

const fmt3 = (v: number) => v.toFixed(3);
const AXIS_NAMES: Record<Axis, string> = { x: 'cross-slide', z: 'carriage', quill: 'tailstock' };

/** Where the machine is, for describing absolute moves (dial readings, direction, turns). */
export interface DescribeContext {
  x: number;
  z: number;
  quill: number;
  dialZero: { x: number; z: number; quill: number };
}

export function describeContext(state: LatheState): DescribeContext {
  return { x: state.x, z: state.z, quill: state.quill, dialZero: { ...state.dialZero } };
}

function turnsText(revolutions: number, axis: Axis): string {
  const r = Math.abs(revolutions);
  const dir = revolutions >= 0 ? 'clockwise' : 'counter-clockwise';
  if (r < 0.995) {
    const divs = Math.round(r * MACHINE.dialDivisions[axis]);
    return `${divs} division${divs === 1 ? '' : 's'} ${dir}`;
  }
  const t = Math.round(r * 10) / 10;
  return `${t} turn${t === 1 ? '' : 's'} ${dir}`;
}

function where(axis: Axis, pos: number): string {
  if (axis === 'x') return `X dia ${fmt3(2 * pos)}`;
  if (axis === 'z') return `Z ${fmt3(pos)}`;
  return `${fmt3(pos)} out`;
}

function describeMoveTo(axis: Axis, position: number, ctx?: DescribeContext): string {
  const target = where(axis, position);
  if (!ctx) {
    return axis === 'x'
      ? `Move the cross slide to ${target}.`
      : axis === 'z'
        ? `Move the carriage to ${target}.`
        : `Set the tailstock quill to ${target}.`;
  }
  const from = ctx[axis];
  const delta = position - from;
  const dial = dialGraduationFor(axis, position, ctx.dialZero[axis]);
  if (Math.abs(delta) < 5e-4) {
    const name = axis === 'x' ? 'cross slide' : axis === 'z' ? 'carriage' : 'quill';
    return `Leave the ${name} at ${target} (dial ${dial}).`;
  }
  const verb =
    axis === 'x'
      ? delta < 0
        ? `Bring the cross slide in to ${target}`
        : `Back the cross slide out to ${target}`
      : axis === 'z'
        ? delta < 0
          ? `Run the carriage toward the chuck to ${target}`
          : `Run the carriage toward the tailstock to ${target}`
        : delta > 0
          ? `Advance the quill to ${target}`
          : `Back the quill out to ${target}`;
  return `${verb} (dial ${dial}): ${turnsText(revolutionsFor(axis, delta), axis)}.`;
}

/**
 * One instruction for an action in machinist terms. With a context (where the machine is before
 * this action), absolute moves also say which way to go, how many turns, and what the dial
 * collar will read at the target.
 */
export function describeAction(a: Action | ScriptAction, ctx?: DescribeContext): string | null {
  switch (a.type) {
    case 'loadStock':
      return `Load ${fmt3(a.stock.diameter)}" ${a.stock.material} stock, ${fmt3(a.stock.length)}" long with ${fmt3(a.stock.stickOut)}" sticking out of the jaws.`;
    case 'removeStock':
      return 'Take the stock out of the chuck.';
    case 'selectTool':
      return `Mount the ${TOOLS[a.tool].name.toLowerCase()} in the toolpost.`;
    case 'selectTailstockTool':
      return `Put the ${TAILSTOCK_TOOLS[a.tool].name.toLowerCase()} in the tailstock.`;
    case 'setSpindle':
      return a.on ? `Start the spindle${a.reverse ? ' in reverse' : ' (forward)'}.` : 'Stop the spindle.';
    case 'setRpm':
      return `Set the speed to ${a.rpm} rpm.`;
    case 'moveTo':
      return describeMoveTo(a.axis, a.position, ctx);
    case 'turnHandwheel': {
      const pitch = a.axis === 'x' ? MACHINE.xHandwheelPitch : a.axis === 'z' ? MACHINE.zHandwheelPitch : MACHINE.quillPitch;
      const thou = Math.round(Math.abs(a.revolutions) * pitch * 1000);
      const dir = a.revolutions >= 0 ? 'clockwise' : 'counter-clockwise';
      const revs = Math.round(Math.abs(a.revolutions) * 100) / 100;
      const what =
        a.axis === 'x'
          ? a.revolutions >= 0
            ? 'in toward center'
            : 'out away from center'
          : a.axis === 'z'
            ? a.revolutions >= 0
              ? 'toward the tailstock'
              : 'toward the chuck'
            : a.revolutions >= 0
              ? 'advancing the quill'
              : 'backing the quill out';
      return `Turn the ${AXIS_NAMES[a.axis]} handwheel ${revs} rev ${dir} (${thou} thou, ${what}).`;
    }
    case 'zeroDial':
      return ctx
        ? `Zero the ${AXIS_NAMES[a.axis]} dial here, at ${where(a.axis, ctx[a.axis])}.`
        : `Zero the ${AXIS_NAMES[a.axis]} dial.`;
    case 'collectPart':
      return 'Collect the finished part.';
    case 'wait':
      return null;
    case 'say':
      return null;
  }
}

const RANGES: Record<Axis, readonly [number, number]> = { x: MACHINE.xRange, z: MACHINE.zRange, quill: MACHINE.quillRange };
const clampTo = (axis: Axis, v: number) => Math.min(RANGES[axis][1], Math.max(RANGES[axis][0], v));

/** Advances a context past one action (positions and dial zeros). */
function applyToContext(ctx: DescribeContext, a: Action | ScriptAction): void {
  if (a.type === 'moveTo') ctx[a.axis] = clampTo(a.axis, a.position);
  else if (a.type === 'turnHandwheel') ctx[a.axis] = clampTo(a.axis, ctx[a.axis] + handwheelDelta(a.axis, a.revolutions));
  else if (a.type === 'zeroDial') ctx.dialZero[a.axis] = ctx[a.axis];
}

/** Instructions for a list of actions, tracking where the machine will be as it goes. */
export function describeActions(actions: (Action | ScriptAction)[], ctx?: DescribeContext): string[] {
  const c = ctx ? { ...ctx, dialZero: { ...ctx.dialZero } } : undefined;
  const out: string[] = [];
  for (const a of actions) {
    const d = describeAction(a, c);
    if (d) out.push(d);
    if (c) applyToContext(c, a);
  }
  return out;
}

/**
 * Net tool motion of a list of actions starting from `from`, in inches:
 * x positive = in toward center, z positive = toward the tailstock, quill positive = advancing.
 */
export function netMotion(
  actions: (Action | ScriptAction)[],
  from: { x: number; z: number; quill: number },
): { x: number; z: number; quill: number } {
  const c: DescribeContext = { x: from.x, z: from.z, quill: from.quill, dialZero: { x: 0, z: 0, quill: 0 } };
  for (const a of actions) applyToContext(c, a);
  return { x: from.x - c.x, z: c.z - from.z, quill: c.quill - from.quill };
}

export function describeCheck(c: StateCheck): string {
  switch (c.kind) {
    case 'toolIs':
      return `the ${TOOLS[c.tool].name.toLowerCase()} is mounted`;
    case 'tailstockToolIs':
      return `the tailstock holds the ${TAILSTOCK_TOOLS[c.tool].name.toLowerCase()}`;
    case 'spindle':
      return c.on ? 'the spindle is running' : 'the spindle is stopped';
    case 'rpmAtMost':
      return `the speed is ${c.rpm} rpm or less`;
    case 'rpmAtLeast':
      return `the speed is at least ${c.rpm} rpm`;
    case 'stockLoaded':
      return 'stock is in the chuck';
    case 'xBetween':
      return `the tool is at X dia ${fmt3(2 * c.min)}–${fmt3(2 * c.max)} (radius ${fmt3(c.min)}–${fmt3(c.max)})`;
    case 'zBetween':
      return `the carriage is at Z ${fmt3(c.min)}–${fmt3(c.max)}`;
    case 'facedTo':
      return `the end is faced back to Z ${fmt3(c.zMax)} or less`;
    case 'diameterBetween':
      return `the diameter from Z ${fmt3(c.z0)} to ${fmt3(c.z1)} is between ${fmt3(c.min)} and ${fmt3(c.max)}`;
    case 'boreAtLeast':
      return `there is a hole at least ${fmt3(c.minDiameter)}" across from Z ${fmt3(c.z0)} to ${fmt3(c.z1)}`;
    case 'parted':
      return 'the part has been parted off';
    case 'dialZeroBetween':
      return c.axis === 'x'
        ? `the cross-slide dial has been zeroed with the tool at X dia ${fmt3(2 * c.min)}–${fmt3(2 * c.max)}`
        : `the ${AXIS_NAMES[c.axis]} dial has been zeroed at ${fmt3(c.min)}–${fmt3(c.max)}`;
    case 'all':
      return c.checks.map(describeCheck).join(', and ');
  }
}

/** The step's first carriage target, e.g. where the parting blade goes. */
function firstZTarget(step: ScriptStep): number | null {
  for (const a of step.actions) if (a.type === 'moveTo' && a.axis === 'z') return a.position;
  return null;
}

/** What to tell the user when a step of the plan can no longer be done, and what to do instead. */
function impossibleNotice(challenge: Challenge, state: LatheState, skipped: number, next: number): string {
  const steps = challenge.solution.steps;
  const step = steps[skipped];
  const reason = (step.check && impossibleReason(step.check, state)) ?? `"${step.title}" can no longer be done as planned.`;
  const nextStep = steps[next];
  let what: string;
  if (!nextStep) what = 'stop the spindle and press Check my part to see your grade';
  else if (nextStep.id === 'part-off' || nextStep.check?.kind === 'parted') {
    const z = firstZTarget(nextStep);
    what = `part it off${z !== null ? ` with the blade at Z ${fmt3(z)}` : ''}, then press Check my part to see your grade`;
  } else what = `carry on with "${nextStep.title}", then press Check my part to see your grade`;
  return `${reason} Finish the part anyway: ${what}. Then press Try again for a fresh bar.`;
}

const isMove = (a: Action | ScriptAction) => a.type === 'moveTo' || a.type === 'turnHandwheel';

/** Where a move action ends, given the position before it. */
function moveEnd(a: Action | ScriptAction, from: number): number {
  if (a.type === 'moveTo') return clampTo(a.axis, a.position);
  if (a.type === 'turnHandwheel') return clampTo(a.axis, from + handwheelDelta(a.axis, a.revolutions));
  return from;
}

interface ActionGroup {
  actions: (Action | ScriptAction)[];
  /** a run of two or more moves ending in a retract: one turning/facing pass or one drill peck */
  pass: boolean;
  peck: boolean;
}

/**
 * Splits a step's actions into passes: a run of moves ends with a retract (cross slide out, or
 * quill back), plus the carriage's return toward the tailstock if that comes next. Other actions
 * stand alone.
 */
function groupActions(actions: (Action | ScriptAction)[], from: DescribeContext): ActionGroup[] {
  const groups: ActionGroup[] = [];
  const pos = { x: from.x, z: from.z, quill: from.quill };
  let cur: (Action | ScriptAction)[] = [];
  let closed = false;
  const flush = () => {
    if (cur.length) {
      const moves = cur.filter(isMove).length;
      const peck = cur.some((a) => isMove(a) && (a as { axis: Axis }).axis === 'quill');
      groups.push({ actions: cur, pass: moves >= 2, peck });
    }
    cur = [];
    closed = false;
  };
  for (const a of actions) {
    if (!isMove(a)) {
      flush();
      if (describeAction(a)) groups.push({ actions: [a], pass: false, peck: false });
      continue;
    }
    const axis = (a as { axis: Axis }).axis;
    const end = moveEnd(a, pos[axis]);
    const delta = end - pos[axis];
    if (closed) {
      // the return stroke toward the tailstock belongs to the pass it ends
      if (axis === 'z' && delta > 0) {
        cur.push(a);
        pos[axis] = end;
        flush();
        continue;
      }
      flush();
    }
    cur.push(a);
    pos[axis] = end;
    if ((axis === 'x' && delta > 0) || (axis === 'quill' && delta < 0)) closed = true;
  }
  flush();
  return groups;
}

/**
 * Would this pass cut nothing on the work as it is now? Each feed in the pass is checked against
 * the profile: a carriage feed toward the chuck sweeps the tool's width along the bar at the
 * cross-slide radius, and a cross-slide feed inward sweeps the tool's width at that Z. Only the
 * turning tool's 0.25 width is modelled; drilling pecks are never treated as air.
 */
function passCutsAir(group: ActionGroup, from: { x: number; z: number; quill: number }, state: LatheState): boolean {
  const wp = state.workpiece;
  if (!wp || group.peck) return false;
  const width = 0.25;
  const above = (zLo: number, zHi: number, r: number) => {
    const [i0, i1] = sampleRange(wp, zLo, zHi);
    for (let i = i0; i <= i1; i++) if (!isGone(wp, i) && wp.outer[i] > r + 5e-4) return true;
    return false;
  };
  const pos = { ...from };
  for (const a of group.actions) {
    if (!isMove(a)) continue;
    const axis = (a as { axis: Axis }).axis;
    const end = moveEnd(a, pos[axis]);
    if (axis === 'z' && end < pos.z - 1e-9 && above(end, pos.z + width, pos.x)) return false;
    if (axis === 'x' && end < pos.x - 1e-9 && above(pos.z, pos.z + width, end)) return false;
    pos[axis] = end;
  }
  return true;
}

const lowerFirst = (t: string) => t.charAt(0).toLowerCase() + t.slice(1);
const noStop = (t: string) => t.replace(/\.$/, '');

/**
 * Level-2 instructions for a step from where the machine is now: one line per setting change,
 * one line per pass ("Pass 3 of 8: ..."), passes that would only cut air left out.
 */
export function stepInstructions(step: ScriptStep, state: LatheState): string[] {
  const live = describeContext(state);
  const groups = groupActions(step.actions, live);
  const passes = groups.filter((g) => g.pass);
  const counted = passes.length >= 2;
  const lines: string[] = [];
  // scripted position (where the plan has the machine) and the live one used for the wording
  const plan = { x: live.x, z: live.z, quill: live.quill };
  const ctx: DescribeContext = { ...live, dialZero: { ...live.dialZero } };
  let passNo = 0;
  let skippedAir = 0;
  let passDescribed = false;
  for (const g of groups) {
    const before = { ...plan };
    for (const a of g.actions) if (isMove(a)) plan[(a as { axis: Axis }).axis] = moveEnd(a, plan[(a as { axis: Axis }).axis]);
    if (g.pass) passNo++;
    if (g.pass && !g.peck && !passDescribed && passCutsAir(g, before, state)) {
      skippedAir++;
      continue;
    }
    let acts = g.actions;
    // starting part-way through: put the carriage where the plan has it before the first cross-slide move
    if (!passDescribed && g.pass && isMove(acts[0]) && (acts[0] as { axis: Axis }).axis === 'x' && Math.abs(ctx.z - before.z) > 5e-4) {
      acts = [{ type: 'moveTo', axis: 'z', position: before.z }, ...acts];
    }
    const parts: string[] = [];
    for (const a of acts) {
      const d = describeAction(a, ctx);
      if (d) parts.push(d);
      applyToContext(ctx, a);
    }
    if (!parts.length) continue;
    if (g.pass) passDescribed = true;
    if (g.pass && counted) {
      const label = g.peck ? 'Peck' : 'Pass';
      lines.push(`${label} ${passNo} of ${passes.length}: ${parts.map((p, i) => (i ? lowerFirst(noStop(p)) : noStop(p))).join('; ')}.`);
    } else lines.push(...parts);
  }
  if (skippedAir > 0) {
    const first = skippedAir + 1;
    lines.unshift(
      skippedAir === 1
        ? `Pass 1 would cut nothing now: the bar is already smaller. Start with pass ${first}.`
        : `Passes 1 to ${skippedAir} would cut nothing now: the bar is already smaller. Start with pass ${first}.`,
    );
  }
  return lines;
}

/**
 * Next hint for a challenge: the first solution step not yet done.
 * Level 1 gives the step title and narration; asking again for the same step
 * (pass the previous hint) gives level 2: the step as numbered instructions with absolute
 * targets worked out from where the machine is now (DRO values, dial readings, turns), one line
 * per pass. When a step can no longer be done (the bar is already under size, say), the hint
 * says so in `notice` and moves on to the next step that can still be done.
 */
export function nextHint(challenge: Challenge, state: LatheState, previous?: Pick<Hint, 'stepId' | 'level'> | null): Hint {
  const steps = challenge.solution.steps;
  if (steps.length === 0) {
    return { stepId: 'generic', title: 'Hint', text: challenge.hints[0] ?? 'Follow the drawing.', level: 1 };
  }
  const { nextStep, skipped } = scriptProgress(challenge.solution, state, challenge.stock);
  const notice = skipped.length ? impossibleNotice(challenge, state, skipped[0], nextStep) : undefined;
  const withNotice = (text: string) => (notice ? `${notice}\n\n${text}` : text);
  if (nextStep >= steps.length) {
    return {
      stepId: 'done',
      title: 'Check your part',
      text: notice ?? 'Every step of the plan looks done. Stop the spindle and press Check my part to measure it.',
      level: 1,
      ...(notice ? { notice } : {}),
    };
  }
  const step = steps[nextStep];
  const level: 1 | 2 = previous && previous.stepId === step.id ? 2 : 1;
  const extra = notice ? { notice } : {};
  if (level === 1) return { stepId: step.id, title: step.title, text: withNotice(step.narration), level, ...extra };
  const lines = stepInstructions(step, state);
  if (step.check) lines.push(`You're done with this step when ${describeCheck(step.check)}.`);
  if (lines.length === 0) {
    const generic = challenge.hints[Math.min(nextStep, challenge.hints.length - 1)];
    return { stepId: step.id, title: step.title, text: withNotice(generic ?? step.narration), level, ...extra };
  }
  const text = withNotice(lines.map((l, i) => `${i + 1}. ${l}`).join('\n'));
  return { stepId: step.id, title: step.title, text, level, lines, ...extra };
}
