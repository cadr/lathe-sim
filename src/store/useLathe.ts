// Zustand store wrapping the LatheEngine and the active ScriptPlayer.
import { create } from 'zustand';
import {
  LatheEngine,
  ScriptPlayer,
  analyze,
  grade,
  nextHint,
  revolutionsFor,
  type Action,
  type Axis,
  type CameraPreset,
  type GradeResult,
  type Hint,
  type LatheEvent,
  type LatheEventKind,
  type LatheState,
  type Mistake,
  type PlayerStatus,
  type Script,
  type ScriptStep,
} from '../engine';
import { getChallenge, getLesson } from '../content';
import { toastText } from './toastText';
import { pauseSnapshot, resumeNotice, type PauseSnapshot } from './resumeNotice';

export type Mode = { kind: 'free' } | { kind: 'lesson'; id: string; doItYourself: boolean } | { kind: 'challenge'; id: string };
export type Speed = 0.5 | 1 | 2 | 4 | 8;
export const SPEEDS: readonly Speed[] = [0.5, 1, 2, 4, 8];

/** A short demo that borrows the machine: "Show me" in a do-it-yourself lesson. */
export type Demo = { kind: 'showMe'; stepId: string } | null;

/** A toast's kind: an engine event, or 'notice' for a message from the app itself. */
export type ToastKind = LatheEventKind | 'notice';

export interface Toast {
  id: number;
  kind: ToastKind;
  text: string;
  /** store clock (seconds of real time ticked) when the toast was raised */
  t: number;
}

/** Event kinds that raise a toast. */
export const TOAST_KINDS: ReadonlySet<LatheEventKind> = new Set<LatheEventKind>([
  'crash',
  'chatter',
  'rubbing',
  'heavyCut',
  'toolBroken',
  'boringSolid',
  'poorFinish',
  'wrongDirection',
  'parted',
  'toolChangeWhileRunning',
]);
/** seconds a toast stays up */
export const TOAST_LIFETIME = 5;
/** at most this many toasts are kept */
export const MAX_TOASTS = 5;

export interface LatheStore {
  engine: LatheEngine;
  state: LatheState;
  version: number;
  mode: Mode;
  player: ScriptPlayer | null;
  playerStatus: PlayerStatus | null;
  speed: Speed;
  camera: CameraPreset;
  /** bumps whenever a camera preset is chosen, even the current one, so the view glides back to it */
  cameraNonce: number;
  hint: Hint | null;
  grade: GradeResult | null;
  mistakes: Mistake[];
  toasts: Toast[];
  /** real seconds accumulated by tick (used for toast expiry) */
  clock: number;
  /** a "Show me" demo is driving the machine (controls are locked until it ends) */
  demo: Demo;
  /** the reference solution was played since the challenge started (its part is the solution's) */
  solutionPlayed: boolean;
  dispatch(action: Action): void;
  turn(axis: Axis, revolutions: number, dt?: number): void;
  tick(dt: number): void;
  reset(): void;
  /** Starts a lesson. `fromStep` fast-forwards the machine to the start of that step. */
  startLesson(id: string, doItYourself?: boolean, fromStep?: number): void;
  startChallenge(id: string): void;
  playSolution(): void;
  playPause(): void;
  stepForward(): void;
  jumpTo(i: number): void;
  setSpeed(s: Speed): void;
  /** Plays one script step on the current machine as a demo, then gives the controls back. */
  showMe(step: ScriptStep): void;
  /** Ends a "Show me" demo early, leaving the machine where it is. */
  stopDemo(): void;
  /**
   * Hands the machine to the user: ends a Show me demo, or stops a challenge solution (the
   * player is dropped), or pauses a watched lesson.
   */
  takeOver(): void;
  requestHint(): void;
  checkPart(): void;
  setCamera(c: CameraPreset): void;
  dismissToast(id: number): void;
}

// --------------------------------------------------------------- wiring
// Module-level bookkeeping for the engine/player subscriptions (kept out of the
// reactive state so components never re-render on it).
let engineUnsub: (() => void) | null = null;
let playerUnsub: (() => void) | null = null;
let seenEvents = 0;
let nextToastId = 1;
let lastStepIndex = -1;
// Show me: the player it replaced (put back when the demo ends) and its status subscription
let demoSaved: ScriptPlayer | null = null;
let demoUnsub: (() => void) | null = null;
// the machine as it was when a watched lesson or solution was paused (to explain a resume)
let pausedAt: PauseSnapshot | null = null;

/** Dial divisions are 0.001": a handwheel only ever lands on one, so a stopped demo should too. */
const DIAL_STEP = 0.001;

/**
 * Moves each axis to the nearest dial division (absolute 0.001) with a slow handwheel nudge. A
 * demo stopped part-way through a move leaves the slide between divisions, where the DRO can read
 * inside a step's window while the check, which sees the true position, still fails.
 */
export function snapToDial(engine: LatheEngine): void {
  for (const axis of ['x', 'z', 'quill'] as const) {
    const pos = engine.getState()[axis];
    const delta = Math.round(pos / DIAL_STEP) * DIAL_STEP - pos;
    if (Math.abs(delta) < 1e-7) continue;
    // at the steady hand-feed rate, so the nudge is never a fast feed
    engine.dispatch({ type: 'turnHandwheel', axis, revolutions: revolutionsFor(axis, delta), dt: Math.max(0.05, Math.abs(delta) / 0.02) });
  }
}

type SetFn = (partial: Partial<LatheStore> | ((s: LatheStore) => Partial<LatheStore>)) => void;
type GetFn = () => LatheStore;

function newToasts(events: LatheEvent[], clock: number): Toast[] {
  const out: Toast[] = [];
  // a boring bar that breaks in solid metal gets its own toast with the reason, not the generic one
  const boringAt = new Set(events.filter((e) => e.kind === 'boringSolid').map((e) => e.actionIndex));
  for (const e of events) {
    if (!TOAST_KINDS.has(e.kind)) continue;
    if (e.kind === 'toolBroken' && boringAt.has(e.actionIndex)) continue;
    out.push({ id: nextToastId++, kind: e.kind, text: toastText(e), t: clock });
  }
  return out;
}

function attachEngine(engine: LatheEngine, set: SetFn, get: GetFn): void {
  engineUnsub?.();
  seenEvents = engine.getState().events.length;
  engineUnsub = engine.subscribe((state) => {
    const prev = get().state;
    const patch: Partial<LatheStore> = { state };
    // collecting a part only empties partedPieces: no stock geometry change, so no version bump
    if (state.workpiece !== prev.workpiece || state.partedPieces.length > prev.partedPieces.length) {
      patch.version = get().version + 1;
    }
    if (state.events.length < seenEvents) seenEvents = 0; // engine was reset (player rewind)
    if (state.events.length > seenEvents) {
      const fresh = newToasts(state.events.slice(seenEvents), get().clock);
      seenEvents = state.events.length;
      if (fresh.length) patch.toasts = [...get().toasts, ...fresh].slice(-MAX_TOASTS);
    }
    set(patch);
  });
}

function detachPlayer(): void {
  playerUnsub?.();
  playerUnsub = null;
  lastStepIndex = -1;
}

function attachPlayer(player: ScriptPlayer, set: SetFn, get: GetFn, { syncCamera = true }: { syncCamera?: boolean } = {}): void {
  detachPlayer();
  // without syncCamera the current step's camera is not re-applied (re-attaching a paused player)
  if (!syncCamera) lastStepIndex = player.getStatus().stepIndex;
  const onStatus = (status: PlayerStatus) => {
    const patch: Partial<LatheStore> = { playerStatus: status };
    if (status.stepIndex !== lastStepIndex) {
      lastStepIndex = status.stepIndex;
      const cam = status.done ? undefined : player.script.steps[status.stepIndex]?.camera;
      if (cam) {
        patch.camera = cam;
        patch.cameraNonce = get().cameraNonce + 1;
      }
    }
    set(patch);
  };
  playerUnsub = player.subscribe(onStatus);
  onStatus(player.getStatus());
}

function noticeToast(text: string, clock: number): Toast {
  return { id: nextToastId++, kind: 'notice', text, t: clock };
}

/** Drops a Show me demo's bookkeeping (the caller replaces the player). */
function clearDemo(): void {
  demoUnsub?.();
  demoUnsub = null;
  demoSaved = null;
}

/** Everything reset() puts back to defaults, plus a fresh engine attached. */
function freshEngine(set: SetFn, get: GetFn): Pick<LatheStore, 'engine' | 'state'> {
  clearDemo();
  pausedAt = null;
  detachPlayer();
  const engine = new LatheEngine();
  attachEngine(engine, set, get);
  return { engine, state: engine.getState() };
}

function startPlayer(set: SetFn, get: GetFn, mode: Mode, script: Script, play: boolean, pauseAtStepEnd = false): void {
  const fresh = freshEngine(set, get);
  const player = new ScriptPlayer(fresh.engine, script, { pauseAtStepEnd });
  set((s) => ({
    ...fresh,
    version: s.version + 1,
    mode,
    player,
    playerStatus: null,
    camera: 'overview',
    hint: null,
    grade: null,
    mistakes: [],
    toasts: [],
    demo: null,
  }));
  attachPlayer(player, set, get);
  if (play) player.play();
}

function activeChallenge(mode: Mode) {
  return mode.kind === 'challenge' ? getChallenge(mode.id) : undefined;
}

export const useLathe = create<LatheStore>()((set, get) => {
  // the initial engine is attached right after create() (see below)
  const engine = new LatheEngine();
  return {
    engine,
    state: engine.getState(),
    version: 0,
    mode: { kind: 'free' },
    player: null,
    playerStatus: null,
    speed: 1,
    camera: 'overview',
    cameraNonce: 0,
    hint: null,
    grade: null,
    mistakes: [],
    toasts: [],
    clock: 0,
    demo: null,
    solutionPlayed: false,

    dispatch(action) {
      get().engine.dispatch(action);
    },

    turn(axis, revolutions, dt) {
      if (revolutions === 0) return;
      get().engine.dispatch({ type: 'turnHandwheel', axis, revolutions, dt });
    },

    tick(dt) {
      if (!(dt > 0)) return;
      const { engine, player, speed } = get();
      const scaled = player && player.isPlaying ? dt * speed : dt;
      engine.tick(scaled);
      if (player) player.tick(scaled);
      const clock = get().clock + dt;
      const toasts = get().toasts;
      const alive = toasts.length ? toasts.filter((t) => clock - t.t < TOAST_LIFETIME) : toasts;
      set(alive.length !== toasts.length ? { clock, toasts: alive } : { clock });
    },

    reset() {
      const fresh = freshEngine(set, get);
      set((s) => ({
        ...fresh,
        version: s.version + 1,
        mode: { kind: 'free' },
        player: null,
        playerStatus: null,
        camera: 'overview',
        hint: null,
        grade: null,
        mistakes: [],
        toasts: [],
        demo: null,
        solutionPlayed: false,
      }));
    },

    startLesson(id, doItYourself = false, fromStep = 0) {
      const script = getLesson(id);
      if (!script) throw new Error(`Unknown lesson: ${id}`);
      const from = Math.max(0, Math.min(Math.floor(fromStep), script.steps.length - 1));
      startPlayer(set, get, { kind: 'lesson', id, doItYourself }, script, false, doItYourself);
      if (from > 0) get().jumpTo(from);
      if (!doItYourself) get().player?.play();
    },

    startChallenge(id) {
      if (!getChallenge(id)) throw new Error(`Unknown challenge: ${id}`);
      get().reset();
      set({ mode: { kind: 'challenge', id } });
    },

    playSolution() {
      const { mode } = get();
      const challenge = activeChallenge(mode);
      if (!challenge) return;
      startPlayer(set, get, mode, challenge.solution, true);
      set({ solutionPlayed: true });
    },

    playPause() {
      const { player, engine } = get();
      if (!player) return;
      if (player.isPlaying) {
        player.pause();
        if (!get().demo) {
          snapToDial(engine);
          pausedAt = pauseSnapshot(engine.getState());
        }
        return;
      }
      // resuming: if the user changed the machine while it was paused, say how the demo goes on
      const before = pausedAt;
      pausedAt = null;
      const text = before ? resumeNotice(before, engine.getState(), player.currentStep) : null;
      if (text) set((s) => ({ toasts: [...s.toasts, noticeToast(text, s.clock)].slice(-MAX_TOASTS) }));
      player.play();
    },

    stepForward() {
      get().player?.stepForward();
    },

    jumpTo(i) {
      get().stopDemo();
      const { player, engine } = get();
      if (!player) return;
      player.jumpTo(i);
      pausedAt = player.isPlaying ? null : pauseSnapshot(engine.getState());
      // replayed events are not news: don't toast them
      seenEvents = engine.getState().events.length;
      set({ toasts: [] });
    },

    setSpeed(s) {
      set({ speed: s });
    },

    showMe(step) {
      get().stopDemo();
      const { engine, player: saved } = get();
      saved?.pause();
      const show = new ScriptPlayer(engine, { id: `show-me-${step.id}`, steps: [step] }, { pauseAtStepEnd: true });
      demoSaved = saved;
      attachPlayer(show, set, get);
      set({ player: show, demo: { kind: 'showMe', stepId: step.id } });
      // the one-step player pauses itself at the end of the step: that ends the demo
      demoUnsub = show.subscribe((st) => {
        if (!st.playing) get().stopDemo();
      });
      show.play();
    },

    stopDemo() {
      if (!get().demo) return;
      const show = get().player;
      const restore = demoSaved;
      clearDemo();
      if (show?.isPlaying) show.pause();
      // a demo stopped mid-move leaves the slide between divisions: put it on the nearest one
      snapToDial(get().engine);
      if (restore) attachPlayer(restore, set, get, { syncCamera: false });
      else detachPlayer();
      set({ player: restore, playerStatus: restore ? restore.getStatus() : null, demo: null });
    },

    takeOver() {
      const { demo, mode, player } = get();
      if (demo) {
        get().stopDemo();
        return;
      }
      if (!player) return;
      player.pause();
      snapToDial(get().engine);
      pausedAt = pauseSnapshot(get().engine.getState());
      if (mode.kind === 'challenge') {
        detachPlayer();
        set({ player: null, playerStatus: null });
      }
    },

    requestHint() {
      const { mode, state, hint } = get();
      const challenge = activeChallenge(mode);
      if (!challenge) return;
      set({ hint: nextHint(challenge, state, hint) });
    },

    checkPart() {
      const { mode, state } = get();
      const challenge = activeChallenge(mode);
      if (!challenge) return;
      const result = grade(challenge, state);
      set({ grade: result, mistakes: analyze(challenge, state, result) });
    },

    setCamera(c) {
      set((s) => ({ camera: c, cameraNonce: s.cameraNonce + 1 }));
    },

    dismissToast(id) {
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
    },
  };
});

attachEngine(useLathe.getState().engine, useLathe.setState, useLathe.getState);

// ------------------------------------------------------------- selectors
/**
 * Controls are locked while a demo drives the machine: a watched lesson or a challenge solution
 * that is playing, or a Show me demo.
 */
export function selectControlsLocked(s: Pick<LatheStore, 'demo' | 'mode' | 'playerStatus'>): boolean {
  if (s.demo) return true;
  if (!(s.playerStatus?.playing ?? false)) return false;
  if (s.mode.kind === 'lesson') return !s.mode.doItYourself;
  return s.mode.kind === 'challenge';
}
export const selectState = (s: LatheStore) => s.state;
export const selectMode = (s: LatheStore) => s.mode;
export const selectVersion = (s: LatheStore) => s.version;
export const selectWorkpiece = (s: LatheStore) => s.state.workpiece;
export const selectSpindle = (s: LatheStore) => s.state.spindle;
export const selectTool = (s: LatheStore) => s.state.tool;
export const selectTailstockTool = (s: LatheStore) => s.state.tailstockTool;
export const selectX = (s: LatheStore) => s.state.x;
export const selectZ = (s: LatheStore) => s.state.z;
export const selectQuill = (s: LatheStore) => s.state.quill;
export const selectCamera = (s: LatheStore) => s.camera;
export const selectToasts = (s: LatheStore) => s.toasts;
export const selectPlayerStatus = (s: LatheStore) => s.playerStatus;
export const selectEvents = (s: LatheStore) => s.state.events;
