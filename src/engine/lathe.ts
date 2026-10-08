// LatheEngine: machine state, actions, cutting evaluation, events.
import { MACHINE, type Action, type Axis, type LatheEvent, type LatheState, type ToolId, type Workpiece } from './types';
import {
  carriageHitsTailstock,
  feedPerRev,
  hitsChuck,
  hitsTailstock,
  maxDepthOfCut,
  maxFeedPerRev,
  sfm,
  sfmLimit,
  snapRpm,
} from './physics';
import { BORING_MIN_BORE_RADIUS, crashEnvelope, tailstockFootprint, tailstockTipZ, toolFootprint } from './tools';
import {
  cloneWorkpiece,
  createStock,
  internalToolBlocked,
  intersectsMaterial,
  isGone,
  removeMaterialInPlace,
  splitIfParted,
} from './workpiece';

const EPS = 1e-6;
/**
 * After a crash, the tool must move this far (inches, any axis) from where it was stopped before
 * another crash is reported. Extra clicks into the same jaw are one crash, not one per click.
 */
export const CRASH_CLEAR_DISTANCE = 0.01;

export const DEFAULT_POSITION = { x: 0.75, z: 2.0, quill: 0 } as const;
export const DEFAULT_RPM = 600;

export function createInitialState(initial?: Partial<LatheState>): LatheState {
  const x = initial?.x ?? DEFAULT_POSITION.x;
  const z = initial?.z ?? DEFAULT_POSITION.z;
  const quill = initial?.quill ?? DEFAULT_POSITION.quill;
  return {
    time: 0,
    workpiece: null,
    partedPieces: [],
    inventory: [],
    tool: 'none',
    tailstockTool: 'none',
    tailstockZ: MACHINE.tailstockZ,
    dialZero: { x, z, quill },
    spindle: { on: false, rpm: DEFAULT_RPM, reverse: false, angle: 0 },
    events: [],
    cutting: false,
    lastCut: null,
    damage: { toolBroken: false, crashed: false },
    ...initial,
    // the action log is appended in place, so never share a caller's array
    actions: initial?.actions ? initial.actions.slice() : [],
    x,
    z,
    quill,
  };
}

function clamp(v: number, [lo, hi]: readonly [number, number]): number {
  return Math.min(hi, Math.max(lo, v));
}

/** Signed change in position for a handwheel turn (positive revolutions = clockwise). */
export function handwheelDelta(axis: Axis, revolutions: number): number {
  switch (axis) {
    case 'x':
      return -revolutions * MACHINE.xHandwheelPitch;
    case 'z':
      return revolutions * MACHINE.zHandwheelPitch;
    case 'quill':
      return revolutions * MACHINE.quillPitch;
  }
}

/** Revolutions (positive = clockwise) needed to move an axis by delta inches. */
export function revolutionsFor(axis: Axis, delta: number): number {
  switch (axis) {
    case 'x':
      return -delta / MACHINE.xHandwheelPitch;
    case 'z':
      return delta / MACHINE.zHandwheelPitch;
    case 'quill':
      return delta / MACHINE.quillPitch;
  }
}

const RANGES: Record<Axis, readonly [number, number]> = {
  x: MACHINE.xRange,
  z: MACHINE.zRange,
  quill: MACHINE.quillRange,
};

/**
 * Dial reading in thousandths for a position relative to its zero, modulo the dial size.
 * The result lies in [-0.5, n - 0.5) so that Math.round() always gives a graduation 0..n-1
 * (a reading of 49.7 on a 50-division dial is returned as -0.3 and displays as 0, not 50).
 */
export function dialReadingFor(axis: Axis, position: number, zero: number): number {
  const n = MACHINE.dialDivisions[axis];
  // the x dial counts up as the handwheel turns clockwise, i.e. as x decreases
  const raw = (axis === 'x' ? zero - position : position - zero) / 0.001;
  let r = (((raw + 0.5) % n) + n) % n;
  r = Math.round(r * 1e6) / 1e6;
  if (r >= n) r -= n;
  return r - 0.5 === 0 ? 0 : r - 0.5;
}

/** Whole graduation under the index mark (0..n-1) for a position. */
export function dialGraduationFor(axis: Axis, position: number, zero: number): number {
  const n = MACHINE.dialDivisions[axis];
  const g = ((Math.round(dialReadingFor(axis, position, zero)) % n) + n) % n;
  return g === 0 ? 0 : g; // never -0
}

type Listener = (s: LatheState) => void;
type EventBody = LatheEvent extends infer E ? (E extends LatheEvent ? Omit<E, 't'> : never) : never;

export class LatheEngine {
  private state: LatheState;
  private listeners = new Set<Listener>();
  // transient bookkeeping (not part of the observable state)
  private rubbingContact = false;
  private crashContact = false;
  private boringContact = false;
  private episode = {
    active: false,
    sinceCutEvent: 0,
    warned: new Set<string>(),
    /** workpiece as it was when the cutting episode began */
    base: null as Workpiece | null,
  };
  private cutSinceTick = false;
  /**
   * The current plunge with a toolpost tool: the profile as it was when the tool first cut into
   * the work at this carriage position. Cross-slide cuts at the same Z, with the same tool, are
   * measured against it, so a groove dug in several small moves counts at its full depth. Any
   * carriage move, tool change or new stock ends the plunge.
   */
  private plunge: { base: Workpiece; z: number; tool: ToolId } | null = null;
  /** where the tool was stopped by the last crash (cleared once it moves well away) */
  private crashStop: { x: number; z: number; quill: number } | null = null;

  constructor(initial?: Partial<LatheState>) {
    this.state = createInitialState(initial);
  }

  getState(): LatheState {
    return this.state;
  }

  /** Replaces the whole state (e.g. ScriptPlayer rewinding to a snapshot). */
  reset(state?: Partial<LatheState>): void {
    this.state = createInitialState(state);
    this.rubbingContact = false;
    this.crashContact = false;
    this.crashStop = null;
    this.boringContact = false;
    this.plunge = null;
    this.endEpisode();
    this.cutSinceTick = false;
    this.notify();
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  dialReading(axis: Axis): number {
    const s = this.state;
    return dialReadingFor(axis, s[axis], s.dialZero[axis]);
  }

  diameter(): number {
    return 2 * this.state.x;
  }

  tailstockTipZ(): number {
    const s = this.state;
    return tailstockTipZ(s.tailstockTool, s.tailstockZ, s.quill);
  }

  tick(dt: number): void {
    if (!(dt > 0)) return;
    const s = this.state;
    const running = s.spindle.on && s.spindle.rpm > 0;
    const omega = running ? ((s.spindle.rpm * 2 * Math.PI) / 60) * (s.spindle.reverse ? -1 : 1) : 0;
    let angle = s.spindle.angle + omega * dt;
    angle = ((angle % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    this.state = {
      ...s,
      time: s.time + dt,
      spindle: { ...s.spindle, angle },
      cutting: this.cutSinceTick,
    };
    this.cutSinceTick = false;
    this.notify();
  }

  dispatch(action: Action): void {
    const prev = this.state;
    const actionIndex = this.log(prev.actions, prev.time, action);
    const draft: LatheState = { ...prev };
    const events: LatheEvent[] = [];
    const emit = (e: EventBody): LatheEvent => {
      const ev = { ...e, t: prev.time, actionIndex } as LatheEvent;
      events.push(ev);
      return ev;
    };
    const running = prev.spindle.on && prev.spindle.rpm > 0;

    switch (action.type) {
      case 'loadStock':
        if (running) emit({ kind: 'toolChangeWhileRunning' });
        draft.workpiece = createStock(action.stock);
        emit({ kind: 'stockLoaded' });
        this.plunge = null;
        this.endEpisode();
        break;
      case 'removeStock':
        if (running && prev.workpiece) emit({ kind: 'toolChangeWhileRunning' });
        draft.workpiece = null;
        this.plunge = null;
        this.endEpisode();
        break;
      case 'selectTool':
        if (running && action.tool !== prev.tool) emit({ kind: 'toolChangeWhileRunning' });
        draft.tool = action.tool;
        draft.damage = { ...prev.damage, toolBroken: false };
        emit({ kind: 'toolChanged', tool: action.tool });
        this.rubbingContact = false;
        this.plunge = null;
        this.endEpisode();
        break;
      case 'selectTailstockTool':
        draft.tailstockTool = action.tool;
        this.endEpisode();
        break;
      case 'setSpindle': {
        const reverse = action.reverse ?? false;
        draft.spindle = { ...prev.spindle, on: action.on, reverse };
        if (action.on && !prev.spindle.on) emit({ kind: 'spindleOn' });
        if (!action.on && prev.spindle.on) emit({ kind: 'spindleOff' });
        this.endEpisode();
        break;
      }
      case 'setRpm':
        draft.spindle = { ...prev.spindle, rpm: snapRpm(action.rpm) };
        this.endEpisode();
        break;
      case 'zeroDial':
        draft.dialZero = { ...prev.dialZero, [action.axis]: prev[action.axis] };
        break;
      case 'collectPart':
        draft.inventory = [...prev.inventory, ...prev.partedPieces];
        draft.partedPieces = [];
        break;
      case 'turnHandwheel':
        this.move(draft, action.axis, action.revolutions, action.dt, emit);
        break;
    }

    if (events.length) draft.events = [...prev.events, ...events];
    this.state = draft;
    this.notify();
  }

  /**
   * Appends an action to the shared log (amortised O(1)) and returns its index. A handwheel turn
   * that continues the previous entry (same axis, same direction) is merged into it, summing
   * revolutions and dt, which replays to the same cut.
   */
  private log(actions: LatheState['actions'], t: number, action: Action): number {
    const n = actions.length;
    const last = n > 0 ? actions[n - 1].action : null;
    if (
      action.type === 'turnHandwheel' &&
      last?.type === 'turnHandwheel' &&
      last.axis === action.axis &&
      Math.sign(last.revolutions) === Math.sign(action.revolutions)
    ) {
      actions[n - 1] = {
        t: actions[n - 1].t,
        action: {
          type: 'turnHandwheel',
          axis: action.axis,
          revolutions: last.revolutions + action.revolutions,
          dt: (last.dt ?? MACHINE.defaultMoveDt) + (action.dt ?? MACHINE.defaultMoveDt),
        },
      };
      return n - 1;
    }
    actions.push({ t, action });
    return n;
  }

  private endEpisode(): void {
    this.episode.active = false;
    this.episode.base = null;
    this.episode.sinceCutEvent = 0;
    this.episode.warned.clear();
  }

  private warnOnce(key: string, fn: () => void): void {
    if (this.episode.warned.has(key)) return;
    this.episode.warned.add(key);
    fn();
  }

  private move(draft: LatheState, axis: Axis, revolutions: number, dtIn: number | undefined, emit: (e: EventBody) => LatheEvent) {
    const start = draft[axis];
    const target = clamp(start + handwheelDelta(axis, revolutions), RANGES[axis]);
    const dist = Math.abs(target - start);
    if (dist < 1e-12) return;
    const dt = dtIn !== undefined && dtIn > 0 ? dtIn : MACHINE.defaultMoveDt;
    const feed = dist / dt;
    const n = Math.max(1, Math.ceil(dist / MACHINE.substep - 1e-9));
    const running = draft.spindle.on && draft.spindle.rpm > 0;
    const material = draft.workpiece?.material;
    const maxDepth = material ? maxDepthOfCut(material) : Infinity;

    const pre: Workpiece | null = draft.workpiece; // profile before this move (never mutated)
    const episodeBase = this.episode.active && this.episode.base ? this.episode.base : pre;
    // a carriage move ends a plunge; a cross-slide move at the same Z continues it
    if (axis === 'z') this.plunge = null;
    const pl = this.plunge;
    const plungeBase = axis === 'x' && pl && pl.tool === draft.tool && Math.abs(pl.z - draft.z) < 1e-9 ? pl.base : pre;
    let wp: Workpiece | null = draft.workpiece;
    let copied = false;
    let blocked = false;
    let anyCut = false;
    let anyContact = false;
    let endContact = false;
    let crashed = false;
    let depthMax = 0;
    let sfmMax = 0;
    let chatterInfo: { sfm: number; diameter: number; tool: string } | null = null;
    let toolBroken = draft.damage.toolBroken;
    // the heavyCut event emitted during this move, so it can report the deepest point of the move
    const heavy: { ev: Extract<LatheEvent, { kind: 'heavyCut' }> | null } = { ev: null };
    const parted: Workpiece[] = [];

    for (let k = 1; k <= n; k++) {
      const pos = k === n ? target : start + ((target - start) * k) / n;
      const x = axis === 'x' ? pos : draft.x;
      const z = axis === 'z' ? pos : draft.z;
      const quill = axis === 'quill' ? pos : draft.quill;

      // crash checks against the chuck and the tailstock (the carriage itself can't pass the tailstock)
      const env = crashEnvelope(draft.tool, x, z);
      {
        const what =
          env && hitsChuck(env)
            ? 'chuck'
            : carriageHitsTailstock(z, draft.tailstockZ) ||
                (env && hitsTailstock(env, draft.tailstockTool, draft.tailstockZ, quill))
              ? 'tailstock'
              : null;
        if (what) {
          crashed = true;
          if (!this.crashContact) emit({ kind: 'crash', what, tool: draft.tool, x, z, quill });
          draft.damage = { ...draft.damage, crashed: true };
          this.crashStop = { x: draft.x, z: draft.z, quill: draft.quill };
          break;
        }
      }
      // a boring bar can't be pushed into metal that has no hole for it
      if (running && !toolBroken && wp && axis !== 'quill' && draft.tool === 'boring') {
        const bar = toolFootprint('boring', x, z);
        if (bar && internalToolBlocked(wp, bar, BORING_MIN_BORE_RADIUS)) {
          blocked = true;
          if (!this.boringContact) {
            emit({ kind: 'boringSolid', x, z });
            emit({ kind: 'toolBroken' });
          }
          draft.damage = { ...draft.damage, toolBroken: true };
          break;
        }
      }
      draft.x = x;
      draft.z = z;
      draft.quill = quill;

      endContact = false;
      if (!wp) continue;
      const usingTailstock = axis === 'quill';
      const fp = usingTailstock
        ? tailstockFootprint(draft.tailstockTool, tailstockTipZ(draft.tailstockTool, draft.tailstockZ, quill))
        : toolFootprint(draft.tool, x, z);
      if (!fp) continue;
      if (!running) {
        if (intersectsMaterial(wp, fp)) anyContact = endContact = true;
        continue;
      }
      if (!usingTailstock && toolBroken) continue;
      if (!copied) {
        if (!intersectsMaterial(wp, fp)) continue; // cutting air: no copy needed
        wp = cloneWorkpiece(wp);
        copied = true;
      }
      const stats = removeMaterialInPlace(wp, fp);
      if (stats.columnsChanged === 0) continue;
      anyCut = true;

      const toolName = usingTailstock ? draft.tailstockTool : draft.tool;
      const diameter = usingTailstock && fp.kind === 'drill' ? 2 * fp.radius : 2 * stats.maxRadiusEngaged;
      const speed = sfm(diameter, draft.spindle.rpm);
      sfmMax = Math.max(sfmMax, speed);
      if (material && speed > sfmLimit(material, toolName) + EPS && (!chatterInfo || speed > chatterInfo.sfm)) {
        chatterInfo = { sfm: speed, diameter, tool: toolName };
      }

      if (!usingTailstock) {
        // depth of cut measured perpendicular to the feed direction
        const depth =
          axis === 'z' ? stats.maxRadialDepth : draft.tool === 'parting' ? 0 : crossFeedDepth(pre, plungeBase, episodeBase, wp, fp.kind === 'rect' && !!fp.internal, stats, maxDepth);
        depthMax = Math.max(depthMax, depth);
        if (depth > maxDepth + EPS) {
          if (heavy.ev) heavy.ev.depth = Math.max(heavy.ev.depth, depth);
          this.warnOnce('heavyCut', () => {
            heavy.ev = emit({ kind: 'heavyCut', depth, max: maxDepth }) as Extract<LatheEvent, { kind: 'heavyCut' }>;
          });
          if (depth > 2 * maxDepth + EPS) {
            toolBroken = true;
            draft.damage = { ...draft.damage, toolBroken: true };
            emit({ kind: 'toolBroken' });
          }
        }
      }

      const split = splitIfParted(wp);
      if (split.parted) {
        wp = split.remaining;
        parted.push(split.parted);
      }
    }

    if (crashed) this.crashContact = true;
    else if (this.crashContact) {
      // still touching the same crash until the tool has moved clearly away from it
      const c = this.crashStop;
      const away = !c || Math.max(Math.abs(draft.x - c.x), Math.abs(draft.z - c.z), Math.abs(draft.quill - c.quill)) > CRASH_CLEAR_DISTANCE - 1e-9;
      if (away) {
        this.crashContact = false;
        this.crashStop = null;
      }
    }
    this.boringContact = blocked;
    if (parted.length) this.plunge = null;
    else if (anyCut && axis === 'x' && plungeBase === pre && pre && draft.tool !== 'none') {
      // the first cut of a plunge at this Z: remember the profile it started from
      this.plunge = { base: pre, z: draft.z, tool: draft.tool };
    }
    if (copied) draft.workpiece = wp;
    for (const p of parted) {
      draft.partedPieces = [...draft.partedPieces, p];
      emit({ kind: 'parted', pieceIndex: draft.partedPieces.length - 1 });
    }

    if (anyContact && !this.rubbingContact) {
      emit({ kind: 'rubbing', tool: axis === 'quill' ? draft.tailstockTool : draft.tool });
    }
    this.rubbingContact = endContact || (anyContact && crashed);

    if (anyCut) {
      const ep = this.episode;
      if (!ep.active) {
        ep.active = true;
        ep.base = pre;
        ep.sinceCutEvent = 0;
        emit({ kind: 'cut', depth: depthMax, sfm: sfmMax, feed });
      } else {
        ep.sinceCutEvent += dt;
        if (ep.sinceCutEvent >= MACHINE.cutEventInterval - 1e-9) {
          ep.sinceCutEvent = 0;
          emit({ kind: 'cut', depth: depthMax, sfm: sfmMax, feed });
        }
      }
      if (chatterInfo) {
        const info = chatterInfo;
        this.warnOnce('chatter', () =>
          emit({ kind: 'chatter', sfm: info.sfm, rpm: draft.spindle.rpm, diameter: info.diameter, tool: info.tool }),
        );
      }
      const feedTool = axis === 'quill' ? draft.tailstockTool : draft.tool;
      const ipr = feedPerRev(feed, draft.spindle.rpm);
      const iprLimit = maxFeedPerRev(feedTool);
      if (ipr > iprLimit + EPS || feed > MACHINE.maxFeedRate + EPS) {
        this.warnOnce('poorFinish', () => emit({ kind: 'poorFinish', feedRate: feed, feedPerRev: ipr, limit: iprLimit }));
      }
      if (draft.spindle.reverse) this.warnOnce('wrongDirection', () => emit({ kind: 'wrongDirection' }));
      draft.cutting = true;
      draft.lastCut = { depthRadial: depthMax, feedRate: feed, sfm: sfmMax };
      this.cutSinceTick = true;
    } else {
      this.endEpisode();
    }
  }

  private notify(): void {
    for (const fn of this.listeners) fn(this.state);
  }
}

/**
 * Depth of cut for a cross-slide (x) move of a toolpost tool, from one sub-step's removal.
 *  - Facing: the material ends inside the tool's width (the changed columns stop short of the
 *    footprint's tailstock-side edge), so the depth is the axial engagement: how much of the end
 *    face the tool is taking.
 *  - Plunging: the tool's full width is in the work, so the depth is how far the tool is past the
 *    profile as it was when this plunge began (`plungeBase`: the first cut at this carriage Z
 *    since the carriage last moved). A single 0.010 infeed is 0.010 deep, and six one-turn clicks
 *    into the side of the bar are one 0.29 groove.
 * The boring bar is always measured radially, as bore growth since the move began.
 */
function crossFeedDepth(
  pre: Workpiece | null,
  plungeBase: Workpiece | null,
  episodeBase: Workpiece | null,
  wp: Workpiece,
  internal: boolean,
  stats: { axialExtent: number; iMin: number; iMax: number; rangeEnd: number },
  maxDepth: number,
): number {
  const radial = (base: Workpiece | null): number => {
    if (!base) return 0;
    let d = 0;
    for (let i = stats.iMin; i <= stats.iMax; i++) {
      if (isGone(base, i)) continue;
      const after = isGone(wp, i) ? (internal ? base.outer[i] : base.inner[i]) : internal ? wp.inner[i] : wp.outer[i];
      const loss = internal ? after - base.inner[i] : base.outer[i] - after;
      if (loss > d) d = loss;
    }
    return d;
  };
  if (internal) return radial(pre);
  // facing: the chip is as wide as the face being taken, but never more than the tool has gone in
  // since this run of cutting began (an infeed near the end of the bar is not a facing cut)
  if (stats.iMax < stats.rangeEnd) {
    const r = radial(episodeBase);
    // once it is clearly a facing cut, report the real (axial) depth
    return r > maxDepth ? stats.axialExtent : Math.min(stats.axialExtent, r);
  }
  return radial(plungeBase);
}
