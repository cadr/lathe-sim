# Lathe Simulator — Design & Contract

This document is the contract every implementer follows. Read it fully before writing code.
If something is ambiguous, pick the simplest option consistent with this doc and note it in `docs/DECISIONS.md`.

## 1. Goal

A browser app where a person learns to run a small bench lathe (think 7x14 mini lathe) by actually
operating it: loading stock, picking a tool, starting the spindle, turning handwheels to face,
turn to diameter, drill, and part off. Two modes:

1. **Lessons** — scripted, narrated, animated walkthroughs ("watch how it's done"), step by step,
   with the ability to pause and to do each step yourself.
2. **Challenges** — a dimensioned drawing of a part. The user must make it. Hints on demand,
   graded result, and a "where you went wrong" analysis.

Units are **inches**. Dials read in thousandths (0.001").

## 2. Tech stack (fixed)

- Vite + React 18 + TypeScript (strict). Package manager: npm.
- 3D: `three`, `@react-three/fiber`, `@react-three/drei`.
- State: `zustand` (one store wrapping the engine; UI subscribes to slices).
- Styling: plain CSS modules (no Tailwind). Dark workshop theme.
- Tests: `vitest` + `@testing-library/react` + `jsdom` for unit/component; `@playwright/test` for e2e.
- Lint: eslint (typescript-eslint, react-hooks). `npm run lint`, `npm run typecheck`, `npm test`, `npm run test:e2e`, `npm run build` must all pass.
- Coverage: `vitest --coverage` (v8). Thresholds: `src/engine/**` ≥ 90% lines/branches≥80%; whole project ≥ 75% lines (scene components excluded from coverage via config, but their pure geometry helpers are included and tested).

## 3. Directory layout

```
src/
  engine/        pure TypeScript, NO React, NO three. Fully unit tested. (Phase 1)
    types.ts      all shared types below
    workpiece.ts  profile model + material removal
    tools.ts      tool catalog & footprints
    lathe.ts      LatheEngine class: state, actions, tick, events
    physics.ts    cutting rules: crash, rubbing, heavy cut, speed
    grader.ts     compare part to target, score
    analyzer.ts   mistake analysis from action log + events
    hints.ts      next-hint derivation from a solution script
    script.ts     ScriptPlayer: runs a Script (lesson/solution) against an engine over time
    index.ts
  content/       lesson + challenge definitions (data only, typed). (Phase 1, parallel)
    lessons/*.ts, challenges/*.ts, index.ts
  art/           SVG/PNG assets + procedural texture helpers. (Phase 1, parallel)
  store/         zustand store wrapping the engine (Phase 2)
  scene/         React Three Fiber components (Phase 2)
  ui/            controls: handwheels, switches, DRO, section view, drawing, panels (Phase 2)
  projects/      lesson player UI + challenge UI (hints, grade, mistakes) (Phase 2)
  App.tsx, main.tsx (Phase 3)
e2e/             Playwright tests (Phase 3)
docs/            this file, DECISIONS.md, USER_GUIDE.md
```

## 4. Coordinate system & machine geometry

- **Z axis**: along the spindle. `z = 0` is the **front face of the chuck jaws**. Positive Z points toward the tailstock. The carriage position `z` is the Z of the **tool tip**.
- **X axis**: radial. `x` is the **radius** at which the tool tip sits (distance from spindle axis). `x = 0` is center. The DRO shows **diameter = 2·x** (labelled "X dia") because machinists think in diameter, and also shows radius.
- Tailstock quill: `q` = quill extension in inches (0 = retracted). The tailstock body sits at a fixed Z = `tailstockZ` (default 4.0). The drill tip Z = `tailstockZ - q - toolLength` is computed by the engine and exposed as `tailstockTipZ`.

Machine constants (`MACHINE` in `types.ts`):

| constant | value |
|---|---|
| `xHandwheelPitch` | 0.050 in per revolution (50 divisions × 0.001") |
| `zHandwheelPitch` | 0.100 in per revolution (100 divisions × 0.001") |
| `quillPitch` | 0.100 in per revolution |
| `xRange` | [-0.050, 1.250] (radius) |
| `zRange` | [-0.750, 5.000] |
| `quillRange` | [0, 2.000] |
| `chuckJawOuterRadius` | 1.000 |
| `chuckJawLength` | 0.600 (jaws occupy z ∈ [-0.6, 0]) |
| `rpmOptions` | [0, 150, 300, 600, 1200, 2000] |
| `maxDepthOfCut` | brass 0.060, aluminum 0.080, steel 0.040 (radial, per pass) |
| `maxFeedRate` | 0.25 in/s of tool motion while cutting before "poor finish" |
| `partingMaxRpmAtDiameter` | sfm-based, see physics |

Handwheel sign conventions (as a user would experience them):
- Turning the **cross-slide** handwheel **clockwise** moves the tool **toward the center** (−x). This is standard.
- Turning the **carriage** handwheel **clockwise** moves the carriage **toward the tailstock** (+z). Counter-clockwise moves toward the chuck (−z).
- Turning the **tailstock** handwheel clockwise **advances** the quill (+q, toward the chuck).

`turnHandwheel(axis, revolutions)` takes signed revolutions where **positive = clockwise**. The engine clamps to ranges.

Each handwheel has a **zeroable dial collar**: `dialReading(axis)` returns the reading in thousandths (0..49 for x, 0..99 for z, 0..99 for quill) relative to the last `zeroDial(axis)`.

## 5. Workpiece model

Solid of revolution sampled along Z.

```ts
interface Workpiece {
  material: Material;             // 'brass' | 'aluminum' | 'steel' | 'delrin'
  zStart: number;                 // back end of stock (inside chuck), negative
  zEnd: number;                   // original front end
  dz: number;                     // sample spacing, 0.005
  outer: Float64Array;            // outer radius per sample; 0 => column removed
  inner: Float64Array;            // inner (bore) radius per sample; 0 => solid
}
```

Sample `i` covers z ∈ [zStart + i·dz, zStart + (i+1)·dz). A column is "gone" when `outer[i] <= inner[i]`.
Helper functions (all pure, in `workpiece.ts`): `createStock(spec)`, `removeMaterial(wp, footprint) -> {wp, removedVolume, maxRadialDepth}`, `splitIfParted(wp) -> {remaining, parted?}` (parted piece = contiguous material **in front of** the first gone column that lies in z > 0... more precisely: find the first gone column with z ≥ 0 that has material on both sides; everything in front of it becomes `parted`), `profileSegments(wp)` (run-length encode into `{z0, z1, diameter, boreDiameter}[]`), `facePosition(wp)` (Z of the frontmost column with material), `diameterAt(wp, z)`, `latheGeometryPoints(wp)` (array of `{x: radius, y: z}` points for THREE.LatheGeometry — this lives in engine so it's testable).

`StockSpec = { material, diameter, length, stickOut }`. `stickOut` is the length protruding past the jaw face (z ∈ [0, stickOut]); the remaining length is inside the chuck (z < 0).

## 6. Tools & footprints

A footprint is the region the tool body occupies in the (x = radius, z) half-plane. Material inside the footprint is removed (if the spindle is running) or produces a `rubbing` event (if not).

```ts
type Footprint = { kind: 'rect', xMin: number, xMax: number, zMin: number, zMax: number }
               | { kind: 'drill', radius: number, tipZ: number, tipAngleDeg: 118 }   // cone tip + cylinder extending toward +z (toward tailstock)
```

Toolpost tools (`ToolId`): 
- `'turning'` — RH turning/facing tool. Tip at (x, z). Footprint rect: x ∈ [x, ∞), z ∈ [z, z + 0.25]. Nose radius ignored. Can face (move −x at fixed z) and turn (move −z at fixed x).
- `'parting'` — blade width 0.0625. Footprint rect: x ∈ [x, ∞), z ∈ [z, z + 0.0625]. Parting with rpm > sfm limit → `chatter`. Parting while spindle off → `rubbing`.
- `'boring'` — small boring bar, tip at (x, z), footprint rect: x ∈ [x − 0.125, x] ... (cuts on the inside: material with r ≤ x is removed... **optional/stretch**; implement only if time permits, flag `optional: true` in catalog).
- `'none'` — nothing mounted.

Tailstock tools (`TailstockToolId`): `'none' | 'center-drill' | 'drill-1/8' | 'drill-1/4' | 'live-center'`. Drill lengths: center-drill 1.5, drills 2.5, live center 2.0. Drills only remove material when spindle is on; otherwise `rubbing`. A live center never removes material.

## 7. Engine API (`LatheEngine`)

```ts
interface LatheState {
  time: number;                    // seconds simulated
  workpiece: Workpiece | null;
  partedPieces: Workpiece[];        // finished parts that fell off, most recent last
  tool: ToolId;
  tailstockTool: TailstockToolId;
  x: number; z: number; quill: number;
  dialZero: { x: number; z: number; quill: number };  // positions at last zero
  spindle: { on: boolean; rpm: number; reverse: boolean; angle: number /* radians, for rendering */ };
  events: LatheEvent[];            // append-only log
  actions: TimedAction[];          // append-only log of user actions {t, action}
  cutting: boolean;                // true during last tick if material was removed
  lastCut: { depthRadial: number; feedRate: number; sfm: number } | null;
  damage: { toolBroken: boolean; crashed: boolean };
}

type LatheEvent =
  | { t: number; kind: 'cut'; depth: number; sfm: number; feed: number }       // throttled: one per 0.25s of continuous cutting
  | { t: number; kind: 'rubbing'; tool: string }                               // tool touched work with spindle off
  | { t: number; kind: 'crash'; what: 'chuck' | 'tailstock' }                   // tool body intersected chuck jaws / tailstock
  | { t: number; kind: 'heavyCut'; depth: number; max: number }                // depth of cut exceeded → chatter, possible tool break
  | { t: number; kind: 'toolBroken' }
  | { t: number; kind: 'chatter'; sfm: number }                                 // rpm too high for parting / diameter
  | { t: number; kind: 'poorFinish'; feedRate: number }
  | { t: number; kind: 'wrongDirection' }                                       // cutting with spindle in reverse using RH tool
  | { t: number; kind: 'parted'; pieceIndex: number }
  | { t: number; kind: 'toolChangeWhileRunning' }                               // changed tool / stock with spindle on (unsafe)
  | { t: number; kind: 'stockLoaded' } | { t: number; kind: 'spindleOn' } | { t: number; kind: 'spindleOff' } | { t: number; kind: 'toolChanged'; tool: string };

type Action =
  | { type: 'loadStock'; stock: StockSpec }
  | { type: 'removeStock' }
  | { type: 'selectTool'; tool: ToolId }
  | { type: 'selectTailstockTool'; tool: TailstockToolId }
  | { type: 'setSpindle'; on: boolean; reverse?: boolean }
  | { type: 'setRpm'; rpm: number }
  | { type: 'turnHandwheel'; axis: Axis; revolutions: number }   // Axis = 'x' | 'z' | 'quill'
  | { type: 'zeroDial'; axis: Axis }
  | { type: 'collectPart' };                                     // take the parted piece off the machine (clears partedPieces into inventory)

class LatheEngine {
  constructor(initial?: Partial<LatheState>);
  getState(): LatheState;                 // returns the current state object (treat as immutable; engine replaces it on change)
  dispatch(action: Action): void;         // applies action immediately, logs it, evaluates cutting
  tick(dt: number): void;                 // advances time; rotates spindle; (handwheel moves are applied in dispatch — the UI/ScriptPlayer meter them out per frame)
  subscribe(fn: (s: LatheState) => void): () => void;
  // conveniences
  dialReading(axis: Axis): number;        // thousandths, modulo dial size
  diameter(): number;                     // 2*x
  tailstockTipZ(): number;
}
```

Cutting evaluation happens inside `dispatch` for `turnHandwheel` (and for `setSpindle` on, to catch "spindle started while tool buried" = fine, no event). Motion is applied in sub-steps of ≤ 0.002" so a long handwheel turn still carves a correct path; depth-of-cut for `heavyCut` is measured as `maxRadialDepth` of material removed in that dispatch relative to the pre-cut profile (for turning) or axial depth (for facing/parting, use the footprint's z-extent engagement — simpler: use the engine's `removedVolume / contactArea`; implementer chooses and documents). `feedRate` = distance moved / wall-clock dt reported by caller: `turnHandwheel` gets an optional `dt` (seconds the motion took) so the ScriptPlayer/UI can report it; default 0.1.

SFM = π · diameter · rpm / 12. Limits: brass 300 sfm (warn `chatter` above 400 for parting), aluminum 500, steel 100, delrin 600. Exceeding it while cutting → `chatter` event (throttled).

**Crash rule**: if the toolpost tool footprint intersects the chuck jaw region (z < 0 and x < chuckJawOuterRadius — note jaws also fill the space *inside* the stock radius, so any x works) → `crash` event and `damage.crashed = true`. The parting tool is 0.0625 wide so parting at z = 0.05 is a crash; lessons teach to leave ≥ 0.1" from the jaws. Tool footprint intersecting the drill in the tailstock when the quill is extended far enough that the drill reaches the tool z → `crash: 'tailstock'`.

**Tool break**: `heavyCut` with depth > 2 × max → `toolBroken`, `damage.toolBroken = true`; a broken tool removes no material until `selectTool` is dispatched again (fresh insert).

**Parting**: after each removal, `splitIfParted`. If a piece splits, it's pushed to `partedPieces`, `parted` event emitted. The remaining stub stays in the chuck.

## 8. Scripts (lessons & solutions)

```ts
interface Script { id: string; steps: ScriptStep[] }
interface ScriptStep {
  id: string;
  title: string;                 // "Face the end"
  narration: string;             // 1–3 sentences in plain machinist English, shown as the step plays
  why?: string;                  // optional deeper explanation ("We face first so we have a true reference surface…")
  actions: ScriptAction[];       // played in order
  camera?: 'overview' | 'tool' | 'chuck' | 'tailstock';
  check?: StateCheck;            // predicate that must hold after the step (used for hints & "do it yourself" mode)
}
type ScriptAction = Action & { duration?: number }  // seconds to animate (handwheel turns are metered out over duration; default 1.0, min 0.2)
                  | { type: 'wait'; duration: number }
                  | { type: 'say'; text: string; duration?: number };
type StateCheck =
  | { kind: 'toolIs'; tool: ToolId } | { kind: 'tailstockToolIs'; tool: TailstockToolId }
  | { kind: 'spindle'; on: boolean } | { kind: 'rpmAtMost'; rpm: number } | { kind: 'rpmAtLeast'; rpm: number }
  | { kind: 'stockLoaded' } | { kind: 'xBetween'; min: number; max: number } | { kind: 'zBetween'; min: number; max: number }
  | { kind: 'facedTo'; zMax: number }                           // facePosition(wp) <= zMax
  | { kind: 'diameterBetween'; z0: number; z1: number; min: number; max: number }  // all samples in [z0,z1] within range
  | { kind: 'boreAtLeast'; z0: number; z1: number; minDiameter: number }
  | { kind: 'parted' } | { kind: 'all'; checks: StateCheck[] };
```

`ScriptPlayer` (engine/script.ts): `new ScriptPlayer(engine, script)`, `play()`, `pause()`, `stepForward()`, `jumpTo(stepIndex)`, `tick(dt)` → advances the current action, metering handwheel revolutions over `duration` using `engine.dispatch({type:'turnHandwheel', revolutions: partial, dt})`. Emits `{ stepIndex, actionIndex, progress, narration, done }` via `subscribe`. **Deterministic** given the same dt sequence (tests rely on this).

`evaluateCheck(check, state): boolean` in `hints.ts`.

## 9. Challenges, grading, hints, mistakes

```ts
interface Challenge {
  id: string; title: string; difficulty: 1|2|3; description: string;   // what & why
  stock: StockSpec;
  target: TargetSpec;
  solution: Script;                   // reference solution (also used for hints)
  hints: string[];                    // generic hints in order (fallback when derived hint isn't available)
  requireParted: boolean;             // part must be parted off to count
  concepts: string[];                 // e.g. ['facing','turning to diameter','parting']
}
interface TargetSpec {
  segments: { z0: number; z1: number; diameter: number; tol: number }[];   // z measured from the FINISHED PART's front face (z=0 at the face after parting; increasing toward the parted end). Each segment is an outer diameter over a length.
  overallLength: number; lengthTol: number;
  bore?: { diameter: number; depth: number; tol: number };
}
interface GradeResult {
  passed: boolean; score: number /*0..100*/;
  checks: { label: string; ok: boolean; actual: string; expected: string }[];  // one per segment, length, bore, safety
  measured: { segments: {z0,z1,diameter}[]; length: number };
}
grade(challenge, state): GradeResult   // uses the last parted piece if requireParted, else the workpiece's protruding portion (z>=0). Align the piece: the part's front face = its min-z material column (the face that was cut first); measure segments relative to it. Safety deductions: crash → fail (score ≤ 20); toolBroken −30; rubbing −5 each (cap −20); chatter −2 each (cap −10); poorFinish −2 each (cap −10).

interface Mistake { severity: 'error'|'warning'|'tip'; title: string; detail: string; t?: number; stepId?: string }
analyze(challenge, state, grade): Mistake[]   // explains: undersize (unrecoverable – "material can't be added back; sneak up with light passes and measure"), oversize ("take another pass of N thou"), wrong length, not parted, crash cause (which action/time), rubbing (spindle off while in contact), heavy cuts, chatter (rpm too high for diameter — suggest rpm), poor finish (feed too fast), tool changes with spindle running, and which solution step the user skipped (derived from checks that are false while later ones are true).

nextHint(challenge, state): { stepId: string; title: string; text: string; level: 1|2 }   // first solution step whose check is false → level 1 = step title + narration; asking again → level 2 = concrete numbers (target dial readings / rpm / tool).
```

## 10. Content (Phase 1, `src/content`)

Lessons (scripts, with `why`s), in this order:
1. `tour` — Machine tour: name the parts; move each handwheel; zero a dial; start/stop spindle. (no cutting)
2. `facing` — Load 1.000" brass × 3", stick-out 1.5. Mount turning tool. 600 rpm. Face the end: set z to just past the end, feed x from outside to past center; retract; advance 0.010; repeat. Teach: approach from outside, go past center, don't rub.
3. `turning` — Turn 1.000 down to 0.750 over 1.0" length. Teach: roughing 0.040/pass, finishing 0.005, zero the cross-slide dial, measure, sneak up.
4. `drilling` — Center drill then 1/4" drill 0.5 deep with the tailstock. Teach: center drill first, peck, rpm.
5. `parting` — Part off a 1.000" long piece. Teach: parting tool, lower rpm (300), leave clearance from jaws, steady feed, catch the part.
6. `full-project` — The full brass bushing: face, turn, drill, chamfer-ish (skip), part. End to end.

Challenges (with solutions & hints):
1. `faced-slug` (difficulty 1): face the end of the stock to a clean face (no parting). requireParted=false. Target: diameter 1.000 ±0.010 for the stick-out; face at ≤ original end − 0.010.
2. `pin` (1): 0.500 ±0.005 diameter × 1.000 ±0.010 long pin, parted off.
3. `stepped-shaft` (2): two diameters: 0.750 ±0.005 × 0.500 long, then 0.500 ±0.005 × 0.750 long; overall 1.250 ±0.010; parted.
4. `bushing` (3): 0.875 ±0.005 OD × 0.750 ±0.010 long with a 0.250 ±0.010 bore through; parted.
5. `spacer-set` (2): 0.625 ±0.005 OD × 0.250 ±0.010 thick washer-like spacer, parted (teaches parting close to size; very little room for error).

Each solution script must actually pass `grade()` when run through `ScriptPlayer` (tests enforce this).

## 11. UI (Phase 2)

Layout (desktop first; min width 1100px, degrade gracefully):
```
┌──────────────────────────────────────────────┬──────────────────────┐
│  3D viewport (R3F)                           │  Control panel       │
│  camera presets; orbit                       │  ┌ spindle ─────────┐│
│                                              │  │ FWD/OFF/REV, RPM ││
│  overlay: DRO (X dia, X rad, Z, Quill, RPM)  │  ├ cross slide X ───┤│
│  overlay: event toasts (crash! chatter…)     │  │ [handwheel dial] ││
├──────────────────────────────────────────────┤  ├ carriage Z ──────┤│
│  Bottom tabs: Project | Section view | Log   │  │ [handwheel dial] ││
│  Project: lesson steps / challenge drawing,  │  ├ tailstock ───────┤│
│  hints, Check part, mistakes                 │  │ tool, [dial]     ││
│                                              │  ├ toolpost ────────┤│
│                                              │  │ tool select      ││
│                                              │  ├ stock ───────────┤│
│                                              │  │ load/remove/collect│
└──────────────────────────────────────────────┴──────────────────────┘
```
Handwheel component (`ui/Handwheel.tsx`): SVG wheel with graduated collar (50 or 100 divisions, numbered every 5/10), a pointer/index mark, and the current dial reading. Interactions: **drag** around the center (angle delta → revolutions, with the sign convention above); **mouse wheel** over it (one notch = 1 division, shift = 10); **keyboard** when focused (←/→ = 1 div, shift = 10 div, alt = 1 rev); buttons `−1 rev, −10, −1, +1, +10, +1 rev` (divisions) for precise and testable input; "Zero" button. All buttons have `data-testid` like `hw-x-plus1`, `hw-z-minus10`, `hw-x-zero`. Hold-to-repeat on buttons.
Spindle: three-position switch FWD / OFF / REV (`data-testid="spindle-fwd"` etc.) + rpm selector radio group. Toolpost: tool cards with icons (from `src/art`). Stock: material + diameter + length + stick-out inputs with presets and a Load button; Remove; Collect part (shows parted piece inventory).
DRO: `data-testid="dro-xdia"`, `dro-z`, `dro-quill`, `dro-rpm`, with the dial collar readings too.
Section view (`ui/SectionView.tsx`): 2D SVG cross-section of the workpiece + tool footprint + chuck jaws + tailstock drill, auto-scaled, with a diameter readout at the tool Z. This is both a teaching aid and a test target.
Drawing (`ui/PartDrawing.tsx`): SVG dimensioned drawing generated from a `TargetSpec` (diameters with ± tol, lengths, bore). 
Toasts for events; the Log tab lists events with times.

3D scene (`scene/`): bed, ways, headstock, chuck (3 jaws that match stock diameter), spindle rotation animated from `spindle.angle`, carriage + cross slide + compound + toolpost moving with x/z, tool meshes per `ToolId`, tailstock + quill + drill, workpiece from `latheGeometryPoints` (rebuild geometry when profile changes — memoize on a version counter), parted pieces drop to the chip tray (simple animation), chip particles while cutting, brass/aluminum/steel materials (procedural, metalness/roughness), soft shop lighting, environment from drei. Camera presets `overview|tool|chuck|tailstock` with OrbitControls. Keep it performant: ≤ 1 geometry rebuild per changed frame, instanced chips.

Store (`store/useLathe.ts`): zustand store that holds `engine`, `state` (snapshot), `player` (ScriptPlayer | null), `mode: {kind:'free'} | {kind:'lesson', id, doItYourself: boolean} | {kind:'challenge', id}`, `hintLevel`, `lastGrade`, `mistakes`. Actions mirror the engine. A `useFrame`-driven `tick` advances engine & player.

Accessibility: every control is a real button/input with a label. Keyboard reachable.

## 12. Testing requirements

- Engine: exhaustive unit tests (facing reduces facePosition; turning sets diameter; parting splits and emits event; crash on jaws; rubbing; heavy cut → chatter/break; dial zero & readings; clamping; drilling creates bore; grader passes solution scripts and fails bad parts; analyzer produces the right mistake kinds; nextHint progression; ScriptPlayer determinism).
- Content: for every challenge, run the solution via ScriptPlayer at fixed dt and assert `grade().passed`. For every lesson, run and assert no crash/rubbing/toolBroken events and that each step's `check` passes.
- UI: Testing Library tests for Handwheel (buttons/keys/wheel dispatch the right revolutions; sign conventions), spindle switch, DRO formatting, SectionView renders profile path, PartDrawing renders dimensions, challenge panel shows hint & grade.
- E2E (Playwright, chromium): app loads; free-play: load stock, select tool, spindle on, use buttons to face & turn, DRO updates, section view updates; lesson plays to completion (use a "fast" speed control); challenge `pin` completed via button presses passes grading; crash scenario shows toast and analysis. WebGL in headless chromium: launch with `--use-gl=swiftshader` or `--use-angle=swiftshader`; if the canvas fails, the app must still function (Canvas wrapped in an error boundary with a fallback message so e2e remains meaningful).

## 13. Art (Phase 1, `src/art`)

SVG, inline-importable (`?react` via vite-plugin-svgr or as URL): tool icons (turning, parting, boring, center drill, drill, live center, none), machine part icons for the tour, a logo "Lathe Sim", handwheel wheel graphic (spokes), material swatches. Procedural texture helpers in `art/textures.ts` (canvas-generated brushed metal, cast-iron bed, brass) returning `THREE.CanvasTexture` lazily (guard for no-DOM in tests). Keep assets small (< 20 KB each).

## 14. Quality bar

- No `any`. No skipped tests. No console errors in the browser.
- Readable machinist language in all narration (e.g., "ten thou", "sneak up on the size").
- Every lesson and challenge is completable with the on-screen controls alone.
