// Shared engine types and machine constants. Pure TypeScript: no React, no three.
// Units are inches and seconds throughout.

export type Material = 'brass' | 'aluminum' | 'steel' | 'delrin';
export type Axis = 'x' | 'z' | 'quill';
export type ToolId = 'none' | 'turning' | 'parting' | 'boring';
export type TailstockToolId = 'none' | 'center-drill' | 'drill-1/8' | 'drill-1/4' | 'live-center';

export const MACHINE = {
  /** inches of cross-slide travel per handwheel revolution (50 divisions x 0.001") */
  xHandwheelPitch: 0.05,
  /** inches of carriage travel per handwheel revolution (100 divisions x 0.001") */
  zHandwheelPitch: 0.1,
  /** inches of quill travel per tailstock handwheel revolution */
  quillPitch: 0.1,
  dialDivisions: { x: 50, z: 100, quill: 100 } as Record<Axis, number>,
  /** radius range of the tool tip */
  xRange: [-0.05, 1.25] as readonly [number, number],
  zRange: [-0.75, 5.0] as readonly [number, number],
  quillRange: [0, 2.0] as readonly [number, number],
  chuckJawOuterRadius: 1.0,
  chuckJawLength: 0.6,
  /** radius of the chuck body behind the jaws (z < -chuckJawLength) */
  chuckBodyRadius: 1.6,
  rpmOptions: [0, 150, 300, 600, 1200, 2000] as readonly number[],
  /** max radial (or axial for facing) depth of cut per pass before a heavyCut event */
  maxDepthOfCut: { brass: 0.06, aluminum: 0.08, steel: 0.04, delrin: 0.1 } as Record<Material, number>,
  /** in/s of tool motion while cutting before "poor finish" (secondary bound: handwheel spun too fast) */
  maxFeedRate: 0.25,
  /** inches of feed per spindle revolution while cutting before "poor finish", by tool */
  maxFeedPerRev: {
    turning: 0.01,
    boring: 0.006,
    parting: 0.004,
    'center-drill': 0.004,
    'drill-1/8': 0.005,
    'drill-1/4': 0.008,
  } as Record<string, number>,
  /** surface feet per minute limits before chatter */
  sfmLimit: { brass: 300, aluminum: 500, steel: 100, delrin: 600 } as Record<Material, number>,
  /** parting tools chatter at this fraction of the material's sfm limit */
  partingSfmFactor: 0.5,
  /** the recommended parting speed never goes above this (rpm), whatever the diameter */
  partingMaxRpm: 300,
  /** fixed Z of the tailstock quill face when the quill is retracted */
  tailstockZ: 4.0,
  /** radius of the tailstock quill body (for crash checks) */
  quillRadius: 0.5,
  /** radius of the tailstock body (barrel and casting) around the quill */
  tailstockBodyRadius: 1.0,
  /** the tailstock body starts this far toward the tailstock from tailstockZ (0: at the retracted quill face) */
  tailstockBodyOffset: 0,
  /** maximum motion per sub-step when applying a handwheel move */
  substep: 0.002,
  /** workpiece sample spacing */
  sampleDz: 0.005,
  /** default dt (s) for a turnHandwheel dispatch without dt */
  defaultMoveDt: 0.1,
  /** cut events are throttled to one per this many seconds of continuous cutting */
  cutEventInterval: 0.25,
} as const;

export interface StockSpec {
  material: Material;
  diameter: number;
  length: number;
  /** length protruding past the jaw face (z in [0, stickOut]) */
  stickOut: number;
}

export interface Workpiece {
  material: Material;
  /** back end of stock (inside chuck), negative for chucked stock */
  zStart: number;
  /** original front end */
  zEnd: number;
  /** sample spacing */
  dz: number;
  /** outer radius per sample; 0 => column removed */
  outer: Float64Array;
  /** inner (bore) radius per sample; 0 => solid */
  inner: Float64Array;
}

export interface RectFootprint {
  kind: 'rect';
  /** cuts only from the inside (boring bar): never removes material from the outside */
  internal?: boolean;
  xMin: number;
  xMax: number;
  zMin: number;
  zMax: number;
}
export interface DrillFootprint {
  kind: 'drill';
  radius: number;
  tipZ: number;
  tipAngleDeg: 118;
}
export type Footprint = RectFootprint | DrillFootprint;

export interface ProfileSegment {
  z0: number;
  z1: number;
  diameter: number;
  boreDiameter: number;
}

/** Fields every event may carry in addition to its kind-specific data. */
interface EventBase {
  t: number;
  /** index into LatheState.actions of the action that produced the event (when known) */
  actionIndex?: number;
}

export type LatheEvent = EventBase &
  (
    | { kind: 'cut'; depth: number; sfm: number; feed: number }
    | { kind: 'rubbing'; tool: string }
    | { kind: 'crash'; what: 'chuck' | 'tailstock'; tool?: string; x?: number; z?: number; quill?: number }
    | { kind: 'heavyCut'; depth: number; max: number }
    | { kind: 'toolBroken' }
    | { kind: 'chatter'; sfm: number; rpm?: number; diameter?: number; tool?: string }
    | { kind: 'poorFinish'; feedRate: number; feedPerRev?: number; limit?: number }
    /** the boring bar was pushed into material without a big enough hole to work in */
    | { kind: 'boringSolid'; x: number; z: number }
    | { kind: 'wrongDirection' }
    | { kind: 'parted'; pieceIndex: number }
    | { kind: 'toolChangeWhileRunning' }
    | { kind: 'stockLoaded' }
    | { kind: 'spindleOn' }
    | { kind: 'spindleOff' }
    | { kind: 'toolChanged'; tool: string }
  );

export type LatheEventKind = LatheEvent['kind'];

export type Action =
  | { type: 'loadStock'; stock: StockSpec }
  | { type: 'removeStock' }
  | { type: 'selectTool'; tool: ToolId }
  | { type: 'selectTailstockTool'; tool: TailstockToolId }
  | { type: 'setSpindle'; on: boolean; reverse?: boolean }
  | { type: 'setRpm'; rpm: number }
  /** revolutions: positive = clockwise. dt: seconds the motion took (default 0.1), used for feed rate. */
  | { type: 'turnHandwheel'; axis: Axis; revolutions: number; dt?: number }
  | { type: 'zeroDial'; axis: Axis }
  | { type: 'collectPart' };

export interface TimedAction {
  t: number;
  action: Action;
}

export interface LatheState {
  /** seconds simulated */
  time: number;
  workpiece: Workpiece | null;
  /** finished parts that fell off, most recent last */
  partedPieces: Workpiece[];
  /** parts taken off the machine with collectPart, oldest first */
  inventory: Workpiece[];
  tool: ToolId;
  tailstockTool: TailstockToolId;
  x: number;
  z: number;
  quill: number;
  /** Z of the quill face when the quill is retracted (fixed) */
  tailstockZ: number;
  /** positions at last zero */
  dialZero: { x: number; z: number; quill: number };
  spindle: { on: boolean; rpm: number; reverse: boolean; angle: number };
  /** append-only log */
  events: LatheEvent[];
  /**
   * Append-only log of user actions. For speed the engine appends to ONE array that successive
   * states share (it is not copied per dispatch), and consecutive same-axis, same-direction
   * turnHandwheel actions are coalesced into one entry. Use .slice() for a frozen copy.
   */
  actions: TimedAction[];
  /** true during last tick if material was removed */
  cutting: boolean;
  lastCut: { depthRadial: number; feedRate: number; sfm: number } | null;
  /** toolBroken: the currently mounted toolpost tool is broken (cleared by selectTool). crashed: sticky. */
  damage: { toolBroken: boolean; crashed: boolean };
}

// ---------------------------------------------------------------- scripts

export type CameraPreset = 'overview' | 'tool' | 'chuck' | 'tailstock';

/**
 * Absolute move: the ScriptPlayer converts it into handwheel revolutions from the engine's
 * position when the action starts (or resumes), so it lands on `position` from anywhere.
 * Duration: `feed` (in/s) gives dist / feed; otherwise max(duration, dist / 0.2 in/s). Min 0.2 s.
 */
export interface MoveToAction {
  type: 'moveTo';
  axis: Axis;
  position: number;
  duration?: number;
  feed?: number;
}

export type ScriptAction =
  | (Action & { duration?: number })
  | MoveToAction
  | { type: 'wait'; duration: number }
  | { type: 'say'; text: string; duration?: number };

export type StateCheck =
  | { kind: 'toolIs'; tool: ToolId }
  | { kind: 'tailstockToolIs'; tool: TailstockToolId }
  | { kind: 'spindle'; on: boolean }
  | { kind: 'rpmAtMost'; rpm: number }
  | { kind: 'rpmAtLeast'; rpm: number }
  | { kind: 'stockLoaded' }
  | { kind: 'xBetween'; min: number; max: number }
  | { kind: 'zBetween'; min: number; max: number }
  /** facePosition(wp) <= zMax */
  | { kind: 'facedTo'; zMax: number }
  /** all samples in [z0,z1] have diameter within [min,max] */
  | { kind: 'diameterBetween'; z0: number; z1: number; min: number; max: number }
  | { kind: 'boreAtLeast'; z0: number; z1: number; minDiameter: number }
  | { kind: 'parted' }
  /** the axis dial was last zeroed with the axis between min and max */
  | { kind: 'dialZeroBetween'; axis: Axis; min: number; max: number }
  | { kind: 'all'; checks: StateCheck[] };

export interface ScriptStep {
  id: string;
  title: string;
  narration: string;
  why?: string;
  actions: ScriptAction[];
  camera?: CameraPreset;
  check?: StateCheck;
}

export interface Script {
  id: string;
  steps: ScriptStep[];
}

// ---------------------------------------------------------------- challenges

export interface TargetSegment {
  z0: number;
  z1: number;
  diameter: number;
  tol: number;
}

export interface TargetSpec {
  /** z measured from the finished part's front face (z=0), increasing toward the parted end */
  segments: TargetSegment[];
  overallLength: number;
  lengthTol: number;
  bore?: { diameter: number; depth: number; tol: number };
}

export interface Challenge {
  id: string;
  title: string;
  difficulty: 1 | 2 | 3;
  description: string;
  stock: StockSpec;
  target: TargetSpec;
  solution: Script;
  hints: string[];
  requireParted: boolean;
  concepts: string[];
}

export interface GradeCheck {
  label: string;
  ok: boolean;
  actual: string;
  expected: string;
}

export interface GradeResult {
  passed: boolean;
  /** 0..100 */
  score: number;
  checks: GradeCheck[];
  measured: { segments: { z0: number; z1: number; diameter: number }[]; length: number };
  /** safety deductions applied to the score */
  deductions: { label: string; points: number }[];
}

export interface Mistake {
  severity: 'error' | 'warning' | 'tip';
  title: string;
  detail: string;
  t?: number;
  stepId?: string;
}

export interface Hint {
  stepId: string;
  title: string;
  text: string;
  level: 1 | 2;
  /** level 2: the step as a list of instructions (text is these joined) */
  lines?: string[];
  /**
   * Set when an earlier step of the plan can no longer be done (e.g. the bar is already under
   * size): what happened and how to finish anyway. `text` starts with it too.
   */
  notice?: string;
}
