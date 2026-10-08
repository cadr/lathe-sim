/**
 * Shared helpers for lesson and challenge scripts.
 *
 * The `Machine` class tracks where the tool, carriage and quill will be once the
 * actions built so far have played (for checks and comments) and emits ABSOLUTE
 * `moveTo` actions. The ScriptPlayer turns each moveTo into handwheel revolutions
 * from wherever the machine really is when it runs, so "Show me", resuming a demo
 * after taking over, and hints all land on the right place.
 *
 * Conventions (DESIGN.md section 4):
 *  - positive revolutions = clockwise
 *  - cross-slide clockwise  => x decreases (toward center), 0.050 in/rev
 *  - carriage clockwise     => z increases (toward tailstock), 0.100 in/rev
 *  - quill clockwise        => quill extends, 0.100 in/rev
 *
 * Scripts are built at module load, in play order, so the tracked positions are
 * always the positions at that point of the script.
 */
import type { ScriptAction, StateCheck } from '../engine';

export const X_PITCH = 0.05;
export const Z_PITCH = 0.1;
export const Q_PITCH = 0.1;
export const BLADE_WIDTH = 0.0625;
export const TURNING_FOOTPRINT = 0.25;

/**
 * Tool speeds in inches per second of tool motion. What matters for the cut is the feed per
 * spindle revolution (the engine flags poor finish above 0.010"/rev turning, 0.004"/rev
 * parting, 0.008"/rev for the 1/4" drill):
 *   CUT    0.080 in/s at 600 rpm = 0.008"/rev  (roughing)
 *   FINISH 0.030 in/s at 600 rpm = 0.003"/rev  (finishing)
 *   FACE   0.060 in/s at 600 rpm = 0.006"/rev
 *   PART   0.015 in/s at 300 rpm = 0.003"/rev
 *   DRILL  0.050 in/s at 600 rpm = 0.005"/rev  (1/4" drill)
 *   CENTER 0.040 in/s at 1200 rpm = 0.002"/rev (center drill)
 * Rapids only move the tool through air.
 */
export const RAPID_SPEED = 0.4;
export const CUT_SPEED = 0.08;
export const FINISH_SPEED = 0.03;
export const FACE_SPEED = 0.06;
export const PART_SPEED = 0.015;
export const DRILL_SPEED = 0.05;
export const CENTER_DRILL_SPEED = 0.04;

/** Default +/- window (inches) for a "the tool is at ..." position check. Smaller than any taught move. */
export const POSITION_TOL = 0.003;

/** Where the tool parks when it must be out of the way of the work. */
export const PARK_X = 0.7;
export const RETRACT_X = 0.6;

export function round(n: number, places = 6): number {
  const f = 10 ** places;
  return Math.round(n * f) / f;
}

/**
 * A radius on a whole dial division (0.001), rounding a half-thou size up: 0.4375 (Ø0.875)
 * becomes 0.438 (Ø0.876). Every position the content teaches is one the DRO can show and the
 * collar can land on. Rounding up keeps a part on the safe, oversize side of its drawing size.
 */
export function onDial(r: number): number {
  return Math.ceil(round(r, 6) * 1000 - 1e-6) / 1000;
}

export function timeFor(dist: number, speed: number, min = 0.5): number {
  return Math.max(min, round(Math.abs(dist) / speed, 2));
}

export class Machine {
  x: number;
  z: number;
  q: number;

  constructor(x = 0.75, z = 2.0, q = 0) {
    this.x = x;
    this.z = z;
    this.q = q;
  }

  /**
   * Cross slide to absolute radius `to`. With `feed` (in/s) the move always runs at that speed;
   * without it, `duration` is a minimum for the nominal move (DESIGN: moveTo).
   */
  moveX(to: number, duration: number, feed?: number): ScriptAction {
    this.x = to;
    return { type: 'moveTo', axis: 'x', position: to, duration, ...(feed ? { feed } : {}) };
  }

  /** Carriage to absolute z. */
  moveZ(to: number, duration: number, feed?: number): ScriptAction {
    this.z = to;
    return { type: 'moveTo', axis: 'z', position: to, duration, ...(feed ? { feed } : {}) };
  }

  /** Quill to absolute extension. */
  moveQ(to: number, duration: number, feed?: number): ScriptAction {
    this.q = to;
    return { type: 'moveTo', axis: 'quill', position: to, duration, ...(feed ? { feed } : {}) };
  }

  rapidX(to: number): ScriptAction {
    return this.moveX(to, timeFor(this.x - to, RAPID_SPEED), RAPID_SPEED);
  }
  rapidZ(to: number): ScriptAction {
    return this.moveZ(to, timeFor(this.z - to, RAPID_SPEED), RAPID_SPEED);
  }
  rapidQ(to: number): ScriptAction {
    return this.moveQ(to, timeFor(this.q - to, RAPID_SPEED), RAPID_SPEED);
  }
  feedX(to: number, speed: number): ScriptAction {
    return this.moveX(to, timeFor(this.x - to, speed), speed);
  }
  feedZ(to: number, speed: number): ScriptAction {
    return this.moveZ(to, timeFor(this.z - to, speed), speed);
  }
  feedQ(to: number, speed: number): ScriptAction {
    return this.moveQ(to, timeFor(this.q - to, speed), speed);
  }
}

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

export function xNear(m: Machine, tol = POSITION_TOL): StateCheck {
  return { kind: 'xBetween', min: round(m.x - tol, 6), max: round(m.x + tol, 6) };
}

export function zNear(m: Machine, tol = POSITION_TOL): StateCheck {
  return { kind: 'zBetween', min: round(m.z - tol, 6), max: round(m.z + tol, 6) };
}

/** Face is at or in front of (zFace + margin). Margin covers 0.005 sample spacing. */
export function facedTo(zFace: number, margin = 0.005): StateCheck {
  return { kind: 'facedTo', zMax: round(zFace + margin, 6) };
}

/** Diameter over [z0, z1] is anywhere in [min, max] (e.g. a roughing pass: at most its size, not below the finish). */
export function diaRange(z0: number, z1: number, min: number, max: number): StateCheck {
  return { kind: 'diameterBetween', z0: round(z0, 6), z1: round(z1, 6), min: round(min, 6), max: round(max, 6) };
}

/** A small center-drilled cone in a face at faceZ: at least 0.030 across, 0.015-0.030 below the face. */
export function centerSpotCheck(faceZ: number): StateCheck {
  return { kind: 'boreAtLeast', z0: round(faceZ - 0.03, 6), z1: round(faceZ - 0.015, 6), minDiameter: 0.03 };
}

export function diaCheck(z0: number, z1: number, diameter: number, tol: number): StateCheck {
  return {
    kind: 'diameterBetween',
    z0: round(z0, 6),
    z1: round(z1, 6),
    min: round(diameter - tol, 6),
    max: round(diameter + tol, 6),
  };
}

// ---------------------------------------------------------------------------
// Pass planning and common move sequences
// ---------------------------------------------------------------------------

/**
 * Radii (not diameters) for a series of turning passes from `start` radius down to
 * `target` radius: roughing passes of at most `maxDepth`, then a final finishing
 * pass of `finish` (default 0.005 radial). Values land on whole dial divisions: a half-thou
 * target is rounded up to the next division first (see onDial).
 */
export function passRadii(start: number, targetIn: number, maxDepth = 0.04, finish = 0.005): number[] {
  const radii: number[] = [];
  const target = onDial(targetIn);
  const roughTarget = round(target + finish, 4);
  let r = round(start, 4);
  while (round(r - roughTarget, 4) > round(2 * maxDepth, 4)) {
    r = round(r - maxDepth, 4);
    radii.push(r);
  }
  const rem = round(r - roughTarget, 4);
  if (rem > maxDepth + 1e-9) {
    // split what is left into two roughing passes, each <= maxDepth
    r = round(r - Math.ceil(rem / 2 / 0.005 - 1e-9) * 0.005, 4);
    radii.push(r);
  }
  if (round(r - roughTarget, 4) > 1e-9) {
    radii.push(roughTarget);
  }
  radii.push(round(target, 4));
  return radii;
}

/** Face the end: one pass per entry in `faceZs`, tool left parked at PARK_X. */
export function faceActions(m: Machine, faceZs: number[], stockRadius: number): ScriptAction[] {
  const out: ScriptAction[] = [];
  const approach = round(stockRadius + 0.05, 4);
  for (const zf of faceZs) {
    out.push(m.rapidZ(zf)); // carriage so the tool tip sits at the new face
    out.push(m.rapidX(approach)); // still outside the work
    out.push(m.feedX(-0.01, FACE_SPEED)); // across, past center
    out.push(m.rapidX(PARK_X)); // back out along the new face
  }
  return out;
}

export interface TurnOptions {
  /** Z of the finished end face. */
  faceZ: number;
  /** Tool-tip z at the end of each cutting pass (shoulder position). */
  endZ: number;
  /** Tool radius for each pass in order; the last one is the finishing pass. */
  radii: number[];
}

/**
 * Turning passes. For each radius: drop in at the start (tool clear of the end of
 * the work), cut toward the chuck, back the tool out, return to the start.
 */
export function turnActions(m: Machine, o: TurnOptions): ScriptAction[] {
  const out: ScriptAction[] = [];
  const startZ = round(o.faceZ + 0.05, 6);
  if (Math.abs(m.z - startZ) > 1e-9) out.push(m.rapidZ(startZ));
  o.radii.forEach((r, i) => {
    const last = i === o.radii.length - 1;
    out.push(m.rapidX(r)); // in to depth, beyond the end of the work
    out.push(m.feedZ(o.endZ, last ? FINISH_SPEED : CUT_SPEED)); // cut
    out.push(m.rapidX(RETRACT_X)); // out, clear of the work
    out.push(m.rapidZ(startZ)); // back to the start
  });
  return out;
}

/**
 * Peck drilling with the quill. `qs` are cumulative quill extensions for each peck.
 * Each peck: feed to depth, withdraw fully to clear chips, rapid back to just above
 * the bottom of the hole.
 */
export function peckActions(m: Machine, qs: number[]): ScriptAction[] {
  const out: ScriptAction[] = [];
  let prev = 0;
  for (const q of qs) {
    if (prev > 0) out.push(m.rapidQ(round(prev - 0.02, 6)));
    out.push(m.feedQ(q, DRILL_SPEED));
    out.push(m.rapidQ(0));
    prev = q;
  }
  return out;
}

/** Z of the parting-blade tip so the piece in front of the cut is `length` long. */
export function bladeZFor(faceZ: number, length: number): number {
  // piece occupies [bladeZ + BLADE_WIDTH, faceZ]; round up to a whole thousandth
  return Math.ceil(round(faceZ - length - BLADE_WIDTH, 6) * 1000 - 1e-6) / 1000;
}

/** Tip z of a tailstock drill for a given quill extension. */
export function drillTipZ(toolLength: number, quill: number, tailstockZ = 4.0): number {
  return round(tailstockZ - quill - toolLength, 6);
}
