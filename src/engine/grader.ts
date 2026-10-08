// Grading: compare the finished part to the challenge target.
import type { Challenge, GradeCheck, GradeResult, LatheEvent, LatheState, TargetSegment, Workpiece } from './types';
import { backPosition, facePosition, isGone, profileSegments, sampleRange } from './workpiece';

const EPS = 1e-6;
/** How far a shoulder may sit from its drawing position (matches the grader's 0.010 edge margin). */
export const SHOULDER_TOL = 0.01;
/** Points off for each heavy cut that did not break the tool, and the most they can cost. */
export const HEAVY_CUT_POINTS = 5;
export const HEAVY_CUT_CAP = 15;
/** Chatter while parting is how blades snap: it costs more than chatter while turning. */
export const PARTING_CHATTER_POINTS = 10;
export const PARTING_CHATTER_CAP = 20;

export interface PieceRef {
  wp: Workpiece;
  /** machine Z of the part's front (faced) end: local z = front - machineZ */
  front: number;
  /** machine Z of the back end of the measured portion */
  back: number;
  parted: boolean;
}

/** The piece grade() measures: last parted (or collected) piece, or the protruding stock. */
export function selectPiece(challenge: Challenge, state: LatheState): PieceRef | null {
  if (challenge.requireParted) {
    const wp = state.partedPieces[state.partedPieces.length - 1] ?? state.inventory[state.inventory.length - 1];
    if (!wp) return null;
    const front = facePosition(wp);
    const back = backPosition(wp);
    if (front === null || back === null) return null;
    return { wp, front, back, parted: true };
  }
  const wp = state.workpiece;
  if (!wp) return null;
  const front = facePosition(wp);
  const back = backPosition(wp);
  if (front === null || back === null || front <= 0) return null;
  return { wp, front, back: Math.max(0, back), parted: false };
}

export interface SpanMeasurement {
  /** smallest and largest diameter found (outer or bore), null if no samples */
  min: number | null;
  max: number | null;
}

/**
 * Diameters (outer, or bore with bore=true) of samples whose local z lies in [z0, z1], shrunk by
 * a small margin at each end to ignore shoulder edges. The span is clipped to the piece: a part
 * that is too short is a length problem, not a missing diameter. No samples gives min = max = null.
 */
export function measureSpan(piece: PieceRef, z0: number, z1: number, bore = false): SpanMeasurement {
  const { wp, front, back } = piece;
  const len = Math.max(0, Math.min(z1, front - back) - z0);
  const margin = Math.min(0.01, len / 4);
  const zLo = Math.max(front - z1, back) + margin;
  const zHi = front - z0 - margin;
  let min: number | null = null;
  let max: number | null = null;
  if (zHi < zLo - EPS) return { min, max };
  const [a, b] = sampleRange(wp, zLo, zHi);
  for (let i = a; i <= b; i++) {
    const d = isGone(wp, i) ? 0 : 2 * (bore ? wp.inner[i] : wp.outer[i]);
    min = min === null ? d : Math.min(min, d);
    max = max === null ? d : Math.max(max, d);
  }
  return { min, max };
}

export interface ShoulderResult {
  /** index of the segment in front of the shoulder (the shoulder is between it and the next) */
  index: number;
  /** local z the drawing puts the shoulder at */
  expected: number;
  /** local z where the diameter actually steps, or null if no step was found */
  actual: number | null;
  ok: boolean;
}

/**
 * Finds where the diameter steps from segment A's size to segment B's, in local z, by choosing
 * the split of the columns between them that best separates "nearer A" from "nearer B".
 * Returns null when every column is nearer one size (there is no step).
 */
export function findShoulder(piece: PieceRef, a: TargetSegment, b: TargetSegment): number | null {
  const { wp, front, back } = piece;
  const [i0, i1] = sampleRange(wp, Math.max(front - b.z1, back), front - a.z0);
  // columns from the face (local z = 0) backward
  const cls: boolean[] = []; // true = nearer B
  const z0s: number[] = [];
  for (let i = i1; i >= i0; i--) {
    if (isGone(wp, i)) continue;
    const d = 2 * wp.outer[i];
    cls.push(Math.abs(d - b.diameter) < Math.abs(d - a.diameter));
    z0s.push(front - (wp.zStart + (i + 1) * wp.dz));
  }
  const m = cls.length;
  if (m === 0 || cls.every((c) => c) || cls.every((c) => !c)) return null;
  // cost(k) = B columns before k + A columns from k on
  let cost = cls.filter((c) => !c).length; // k = 0
  let best = cost;
  let bestK = 0;
  for (let k = 1; k <= m; k++) {
    cost += cls[k - 1] ? 1 : -1;
    if (cost < best) {
      best = cost;
      bestK = k;
    }
  }
  if (bestK === 0 || bestK === m) return null;
  return Math.max(0, Math.round(z0s[bestK] * 1e6) / 1e6);
}

export interface SegmentResult {
  target: TargetSegment;
  measured: SpanMeasurement;
  ok: boolean;
}

export interface Measurement {
  piece: PieceRef | null;
  segments: SegmentResult[];
  /** one per step between target segments of different diameters */
  shoulders: ShoulderResult[];
  length: { actual: number | null; ok: boolean };
  bore: { measured: SpanMeasurement; ok: boolean } | null;
}

function within(m: SpanMeasurement, target: number, tol: number): boolean {
  return m.min !== null && m.max !== null && m.min >= target - tol - EPS && m.max <= target + tol + EPS;
}

export function measure(challenge: Challenge, state: LatheState): Measurement {
  const piece = selectPiece(challenge, state);
  const t = challenge.target;
  const segs = t.segments;
  const shoulders: ShoulderResult[] = [];
  const actualAt: (number | null)[] = segs.map(() => null); // shoulder behind segment i
  for (let i = 0; i + 1 < segs.length; i++) {
    const a = segs[i];
    const b = segs[i + 1];
    if (Math.abs(a.diameter - b.diameter) <= a.tol + b.tol) continue;
    const actual = piece ? findShoulder(piece, a, b) : null;
    actualAt[i] = actual;
    shoulders.push({
      index: i,
      expected: a.z1,
      actual,
      ok: actual !== null && Math.abs(actual - a.z1) <= SHOULDER_TOL + EPS,
    });
  }
  // measure each diameter between the shoulders where they really are, so a misplaced shoulder
  // shows up as a shoulder problem and not as a wrong diameter
  const segments = segs.map((target, i) => {
    const lo = i > 0 ? (actualAt[i - 1] ?? target.z0) : target.z0;
    const hi = actualAt[i] ?? target.z1;
    const measured = piece ? measureSpan(piece, lo, Math.max(lo, hi)) : { min: null, max: null };
    return { target, measured, ok: within(measured, target.diameter, target.tol) };
  });
  const actual = piece ? piece.front - piece.back : null;
  const length = { actual, ok: actual !== null && Math.abs(actual - t.overallLength) <= t.lengthTol + EPS };
  let bore: Measurement['bore'] = null;
  if (t.bore) {
    const measured = piece ? measureSpan(piece, 0, t.bore.depth, true) : { min: null, max: null };
    bore = { measured, ok: within(measured, t.bore.diameter, t.bore.tol) };
  }
  return { piece, segments, shoulders, length, bore };
}

export const fmtIn = (v: number) => v.toFixed(3);

/** What a dimension row says when there is no part to measure because it is still on the bar. */
export const STILL_ON_BAR = 'not measured: still on the bar';

function fmtSpan(m: SpanMeasurement, unparted = false): string {
  if (m.min === null || m.max === null) return unparted ? STILL_ON_BAR : 'no material';
  if (m.max - m.min < 0.0005) return `Ø${fmtIn((m.min + m.max) / 2)}`;
  return `Ø${fmtIn(m.min)}–${fmtIn(m.max)}`;
}

/** Partial credit for a failed dimension: half credit within 3x tolerance. */
function credit(ok: boolean, error: number | null, tol: number): number {
  if (ok) return 1;
  if (error === null) return 0;
  return error <= 3 * tol + EPS ? 0.5 : 0;
}

function spanError(m: SpanMeasurement, target: number): number | null {
  if (m.min === null || m.max === null) return null;
  return Math.max(Math.abs(m.min - target), Math.abs(m.max - target));
}

export function countEvents(events: LatheEvent[], kind: LatheEvent['kind']): number {
  return events.reduce((n, e) => (e.kind === kind ? n + 1 : n), 0);
}

export function grade(challenge: Challenge, state: LatheState): GradeResult {
  const m = measure(challenge, state);
  const t = challenge.target;
  const checks: GradeCheck[] = [];
  const credits: number[] = [];
  // a part that must be parted off but is still on the bar has nothing to measure yet
  const unparted = challenge.requireParted && !m.piece && state.workpiece !== null;

  if (challenge.requireParted) {
    checks.push({ label: 'Parted off', ok: m.piece !== null, actual: m.piece ? 'yes' : 'no', expected: 'yes' });
    credits.push(m.piece ? 1 : 0);
  }
  for (const s of m.segments) {
    const tg = s.target;
    checks.push({
      label: `Diameter Ø${fmtIn(tg.diameter)} from ${fmtIn(tg.z0)} to ${fmtIn(tg.z1)}`,
      ok: s.ok,
      actual: fmtSpan(s.measured, unparted),
      expected: `Ø${fmtIn(tg.diameter)} ±${fmtIn(tg.tol)}`,
    });
    credits.push(credit(s.ok, spanError(s.measured, tg.diameter), tg.tol));
  }
  for (const sh of m.shoulders) {
    const a = t.segments[sh.index];
    const b = t.segments[sh.index + 1];
    checks.push({
      label: `Shoulder Ø${fmtIn(a.diameter)}/Ø${fmtIn(b.diameter)} at ${fmtIn(sh.expected)} from the face`,
      ok: sh.ok,
      actual: sh.actual === null ? (unparted ? STILL_ON_BAR : 'no step') : fmtIn(sh.actual),
      expected: `${fmtIn(sh.expected)} ±${fmtIn(SHOULDER_TOL)}`,
    });
    credits.push(credit(sh.ok, sh.actual === null ? null : Math.abs(sh.actual - sh.expected), SHOULDER_TOL));
  }
  checks.push({
    label: 'Overall length',
    ok: m.length.ok,
    actual: m.length.actual === null ? (unparted ? 'not parted yet' : 'no part') : fmtIn(m.length.actual),
    expected: `${fmtIn(t.overallLength)} ±${fmtIn(t.lengthTol)}`,
  });
  credits.push(
    credit(m.length.ok, m.length.actual === null ? null : Math.abs(m.length.actual - t.overallLength), t.lengthTol),
  );
  if (t.bore && m.bore) {
    checks.push({
      label: `Bore Ø${fmtIn(t.bore.diameter)} × ${fmtIn(t.bore.depth)} deep`,
      ok: m.bore.ok,
      actual: fmtSpan(m.bore.measured, unparted),
      expected: `Ø${fmtIn(t.bore.diameter)} ±${fmtIn(t.bore.tol)}`,
    });
    credits.push(credit(m.bore.ok, spanError(m.bore.measured, t.bore.diameter), t.bore.tol));
  }

  // safety
  const ev = state.events;
  const crashes = countEvents(ev, 'crash');
  const broken = countEvents(ev, 'toolBroken');
  const rubbing = countEvents(ev, 'rubbing');
  const partingChatter = ev.reduce((n, e) => (e.kind === 'chatter' && e.tool === 'parting' ? n + 1 : n), 0);
  const chatter = countEvents(ev, 'chatter') - partingChatter;
  const poor = countEvents(ev, 'poorFinish');
  // a heavy cut that broke the tool is already paid for by the broken tool
  const brokenAt = new Set(ev.filter((e) => e.kind === 'toolBroken').map((e) => e.actionIndex));
  const heavy = ev.reduce((n, e) => (e.kind === 'heavyCut' && !(e.actionIndex !== undefined && brokenAt.has(e.actionIndex)) ? n + 1 : n), 0);
  const deductions: GradeResult['deductions'] = [];
  if (broken) deductions.push({ label: `Broke the tool${broken > 1 ? ` ${broken}×` : ''}`, points: 30 * broken });
  if (heavy) deductions.push({ label: `Heavy cut ×${heavy}`, points: Math.min(HEAVY_CUT_CAP, HEAVY_CUT_POINTS * heavy) });
  if (rubbing) deductions.push({ label: `Rubbing ×${rubbing}`, points: Math.min(20, 5 * rubbing) });
  if (partingChatter) {
    deductions.push({ label: `Parting chatter ×${partingChatter}`, points: Math.min(PARTING_CHATTER_CAP, PARTING_CHATTER_POINTS * partingChatter) });
  }
  if (chatter) deductions.push({ label: `Chatter ×${chatter}`, points: Math.min(10, 2 * chatter) });
  if (poor) deductions.push({ label: `Poor finish ×${poor}`, points: Math.min(10, 2 * poor) });
  const crashed = crashes > 0 || state.damage.crashed;
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  const allChatter = chatter + partingChatter;
  const summary = [
    crashes ? plural(crashes, 'crash', 'crashes') : '',
    broken ? plural(broken, 'broken tool', 'broken tools') : '',
    heavy ? plural(heavy, 'heavy cut', 'heavy cuts') : '',
    rubbing ? `${rubbing} rubbing` : '',
    allChatter ? `${allChatter} chatter` : '',
    poor ? `${poor} poor finish` : '',
  ].filter(Boolean);
  checks.push({
    label: 'Safety',
    ok: !crashed,
    actual: summary.length ? summary.join(', ') : 'clean',
    expected: 'no crash',
  });

  const dimScore = credits.length ? (100 * credits.reduce((a, b) => a + b, 0)) / credits.length : 0;
  let score = Math.round(dimScore - deductions.reduce((a, d) => a + d.points, 0));
  score = Math.max(0, Math.min(100, score));
  if (crashed) score = Math.min(score, 20);

  const dimsOk = checks.filter((c) => c.label !== 'Safety').every((c) => c.ok);
  const passed = dimsOk && !crashed && score >= 60;

  let measuredSegments: GradeResult['measured']['segments'] = [];
  if (m.piece) {
    const { front, back } = m.piece;
    measuredSegments = profileSegments(m.piece.wp)
      .filter((s) => s.z1 > back + EPS)
      .map((s) => ({ z0: front - s.z1, z1: front - Math.max(s.z0, back), diameter: s.diameter }))
      .map((s) => ({ z0: Math.max(0, round6(s.z0)), z1: round6(s.z1), diameter: round6(s.diameter) }))
      .sort((a, b) => a.z0 - b.z0);
  }
  return {
    passed,
    score,
    checks,
    measured: { segments: measuredSegments, length: m.length.actual === null ? 0 : round6(m.length.actual) },
    deductions,
  };
}

function round6(v: number): number {
  return Math.round(v * 1e6) / 1e6;
}
