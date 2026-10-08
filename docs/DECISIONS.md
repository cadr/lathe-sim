# Implementation decisions

Interpretation choices made where DESIGN.md was ambiguous or silent. Other phases may append their own sections.

## Engine (Phase 1)

### Machine defaults
- The default state is x = 0.75 (radius, so DRO X dia 1.500), z = 2.0, quill = 0, tool `none`, tailstock `none`, rpm 600, spindle off, `tailstockZ` 4.0. Dials start zeroed at those positions. `new LatheEngine(partial)` overrides any field.
- `setRpm` snaps to the nearest entry in `MACHINE.rpmOptions`. A spindle that is "on" at 0 rpm counts as stopped, so contact produces rubbing.
- Positions are clamped to `xRange`, `zRange` and `quillRange`. A clamped move still logs its action.

### Workpiece sampling
- A column is cut when its **sample center** lies inside the footprint's z-range (inclusive, with a 1e-9 tolerance). With dz = 0.005 and tool positions on a 0.001" grid there are effectively no ties.
- Gone columns are normalised to `outer = inner = 0`.
- `facePosition` returns the front **edge** of the frontmost material column, or `null` if there is no material. `backPosition` is the matching back edge.
- `profileSegments` omits gone columns. Gaps show up as discontinuities in z0/z1.
- `latheGeometryPoints` traces from the back end along the outside to the front, down the face, then back along the bore (or the axis). Gaps collapse to radius 0, and collinear points are removed.
- Rect footprints remove material from the outside when `xMax >= outer`, and otherwise enlarge the bore (`inner = max(inner, xMax)`). This makes the optional boring bar work: x in [x - 0.125, x], z in [z, z + 1.5].
- Drill footprints are a 118 degree cone from `tipZ`, then a cylinder of the drill radius toward +z.

### Footprints and crashes
- The turning tool covers x >= tip and z in [z, z + 0.25]. The parting blade covers x >= tip and z in [z, z + 0.0625], exactly as DESIGN.md §6 says. A part parted with the tip at z therefore has its back face at about z + 0.0625.
- DESIGN.md also says "parting at z = 0.05 is a crash", which that footprint alone would not produce. To reconcile the two, crash checks use a separate **crash envelope**. For the parting tool, the envelope adds 0.0625 of holder width on the chuck side, giving z in [z - 0.0625, z + 0.0625]. Parting with the tip below z = 0.0625 crashes. The other tools use their footprint as their envelope.
- Chuck crash: the envelope overlaps z in [-0.6, 0) with x < 1.0 (the jaws), or z < -0.6 with x < 1.6 (the chuck body).
- Tailstock crash: the envelope overlaps the quill (x < 0.5, z >= tailstockZ - quill) or the mounted tool (x < tool radius, z between the tip and the quill face). Tool radii are center drill 0.0625, 1/8 drill 0.0625, 1/4 drill 0.125, and live center 0.2 (crash only).
- On a crash, the move stops at the last safe sub-step and the rest of that dispatch is discarded. `damage.crashed` is sticky. Further pushes into the same obstacle do not emit new crash events. Moving clear and crashing again does.
- Drills are not crash-checked against the chuck. The chuck has a through-bore.
- The center drill is modelled as a 0.0625 radius 118 degree drill. There is no separate countersink.

### Depth of cut (heavyCut / toolBroken)
- Depth is measured **perpendicular to the feed** in each sub-step (≤ 0.002") of a toolpost move.
  - **Carriage (z) feed:** the largest radial wall-thickness change of any column. For turning, that is old radius minus tool x.
  - **Cross-slide (x) feed:** the axial extent of the columns changed, which is the facing depth. For the parting tool this is exempt, because the blade is designed to plunge. Parting heavy cuts only come from side-loading it with z moves.
- Drills never produce heavyCut.
- Limits are `MACHINE.maxDepthOfCut` (brass 0.060, aluminum 0.080, steel 0.040, delrin 0.100, which DESIGN.md left unspecified). All comparisons have a 1e-6 tolerance.
- Depth above 2× the limit emits `toolBroken`, and the rest of that move removes nothing. `damage.toolBroken` means *the currently mounted tool is broken*. It is cleared by `selectTool`, a fresh insert. Grading counts `toolBroken` events, not the flag.

### Feed rate, surface speed, throttling
- Feed rate is the distance moved divided by the dispatch's `dt`. `dt` defaults to `MACHINE.defaultMoveDt` = 0.1 s. Above 0.25 in/s while cutting gives `poorFinish`.
- Surface speed uses the largest pre-cut radius engaged in the sub-step (for drills, the drill diameter): sfm = π·D·rpm/12.
- Chatter limits come from `MACHINE.sfmLimit` (brass 300, aluminum 500, steel 100, delrin 600). The parting tool's limit is **half** of that (`partingSfmFactor`, so 150 for brass). That makes the lesson's "drop to 300 rpm for parting" meaningful: 1" brass at 600 rpm chatters when parting but not when turning. DESIGN.md's parenthetical "warn chatter above 400 for parting" read as contradictory and was not used. `partingMaxRpmAtDiameter()` and `recommendedRpm()` expose the limits.
- A **cutting episode** is a run of consecutive `turnHandwheel` dispatches that remove material. It ends on a non-cutting move or on any spindle, rpm, tool or stock change.
  - `cut` events are emitted at the start of an episode, then once per 0.25 s of accumulated dispatch `dt`.
  - `chatter`, `poorFinish`, `heavyCut` and `wrongDirection` are emitted at most once per episode.
  - The engine's `time` only advances in `tick`, so throttling is based on dispatch `dt`, not engine time.
- `rubbing` is emitted when contact begins with the spindle stopped. The tool is not blocked. It passes through, removing nothing. It re-arms once a move ends out of contact. A live center never rubs or cuts.
- `wrongDirection`: cutting with the spindle in reverse still removes material, but emits the event once per episode.
- `toolChangeWhileRunning` is emitted for `selectTool` (to a different tool), `loadStock` and `removeStock` (with stock present) while the spindle runs. Tailstock tool changes are not flagged.

### Parting
- `splitIfParted` follows DESIGN.md: the first gone column at z ≥ 0 with material on both sides. Everything in front becomes the parted piece, **cropped** to its own material. Its `zStart` is its back edge and its `zEnd` is its front. The remaining stub keeps its full array length, with the columns in front zeroed.
- A parted piece that itself contains a gap is kept as one piece. This is rare and not split further.
- `parted.pieceIndex` is the index in `partedPieces` at the moment of parting.

### State additions (additive to DESIGN.md §7)
- `LatheState.inventory: Workpiece[]` holds pieces moved off the machine by `collectPart`.
- `LatheState.tailstockZ: number` is the fixed tailstock position (default 4.0).
- Events may carry `actionIndex`, the index into `actions` of the action that produced them. `crash` also carries `tool`, `x`, `z` and `quill`. `chatter` also carries `rpm`, `diameter` and `tool`.
- `turnHandwheel` accepts an optional `dt`.
- `LatheEngine.reset(state?)` replaces the whole state. ScriptPlayer uses it to rewind.
- `GradeResult.deductions` lists the safety deductions applied.

### ScriptPlayer
- `ScriptPlayer.tick(dt)` advances **only the script**. The caller ticks the engine too, for example in the store's frame loop: `engine.tick(dt); player.tick(dt)`. `runScript(engine, script, dt)` does both, for tests.
- Durations:
  - `turnHandwheel` takes `max(0.2, duration ?? 1.0)`. It is metered out per tick as `revolutions × used/duration` with `dt = used`, and the last slice lands exactly on the total.
  - `wait` takes its duration.
  - `say` defaults to 2.0 s and sets the status `caption` while it plays.
  - Every other action dispatches instantly when reached, then holds for `duration ?? 0.3`.
- Leftover time in a tick carries into the next action, so results depend only on the dt sequence. Results are deterministic.
- `stepForward()` completes the rest of the current step instantly, applying the remaining handwheel revolutions with their remaining duration as `dt`, so feed rates match normal play. It then moves to the next step.
- `jumpTo(i)` fast-forwards when jumping forward. Jumping backward, or restarting a step already in progress, resets the engine to the snapshot taken when the player was constructed and fast-forwards from there.
- `pauseAtStepEnd: true` stops playing at each step boundary, with the pointer moved to the next step.
- Status: `{ stepIndex, actionIndex, progress (0..1 through the step by time), narration, title, stepId, caption, playing, done }`.

### Hints and solution progress
- `nextHint(challenge, state, previous?)`: "asking again" is expressed by passing the previously returned hint. If `previous.stepId` matches the current step, level 2 is returned.
  - Level 2 text lists the step's actions in machinist terms, with consecutive same-direction handwheel turns merged and given in revolutions and thou. It ends with the step's check described in words.
  - When every step is complete the hint is `{ stepId: 'done', title: 'Check your part' }`.
  - A challenge without solution steps falls back to `hints[0]`.
- Progress comes from **replaying the action log** through a fresh default engine (`scriptProgress`). If the log never loads stock, the challenge stock is preloaded.
  - Steps complete in order once their check holds. Steps without a check complete immediately.
  - The live state can also jump progress past a later step whose check is *persistent*, meaning it describes the work (`facedTo`, `diameterBetween`, `boreAtLeast`, `parted`).
  - Limitation: an engine constructed with non-default initial positions will not replay exactly.
- `xBetween` compares the **radius** `x`. `diameterBetween` and `boreAtLeast` use diameters over the sample centers in [z0, z1], and are false if no samples fall in range.

### Grading
- Piece selection: when `requireParted` is set, the last `partedPieces` entry is used, else the last `inventory` entry. Otherwise the workpiece's portion at z ≥ 0 is used, with the jaw face counting as the back end.
- Local coordinates: local z = (machine Z of the part's front face) - machine z. That gives z = 0 at the faced end, increasing toward the parted end, as TargetSpec states. DESIGN.md's "min-z material column" wording is read in these local coordinates.
- Each target segment is measured over its span shrunk by min(0.010, length/4) at each end, to ignore shoulder edges. All samples must be within diameter ± tol. A span that runs past the end of the piece reads as missing material.
- Length is front minus back. Samples are 0.005 apart, so lengths quantise to 0.005.
- A bore is checked over local [0, depth] against diameter ± tol.
- Score: each dimensional check (parted, segments, length, bore) earns 1 if in tolerance, 0.5 if within 3× tolerance, and 0 otherwise. The mean is scaled to 100.
  - Then deductions apply: toolBroken -30 each, rubbing -5 each (cap -20), chatter -2 each (cap -10), poorFinish -2 each (cap -10).
  - A crash caps the score at 20.
- `passed` = every dimensional check ok, no crash, and score ≥ 60. The `Safety` check row is ok when there was no crash, and lists the other incidents.

### Analyzer
- `analyze` reports:
  - parting and dimension problems: not parted, undersize (error), oversize (warning, with the radial thou for one more pass), section missing, too long or too short, bore wrong;
  - the first crash, with the action that caused it from `actionIndex` and the position;
  - a broken tool (error) or heavy cuts (warning);
  - rubbing, chatter (with `recommendedRpm` for the diameter and tool), poor finish, reverse cutting, and tool changes while running;
  - up to three skipped solution steps (tips). A step counts as skipped when its check was never true during the replay, yet a later step's check was.
- A passing part with nothing to report gets a single "Clean job" tip.

## Store & UI (Phase 2)

### Store (`src/store/useLathe.ts`)
- One engine subscription at a time, held at module level. `reset`, `startLesson` and `playSolution` build a fresh engine and move the subscription to it.
- `version` bumps only when `state.workpiece` or `state.partedPieces` changes reference, and on every engine swap. The engine copies the workpiece only when material is removed, so ticks and plain moves never bump it.
- `tick(dt)`: when a player is active and playing, both the engine and the player get `dt × speed`. Otherwise the engine gets plain `dt`. The store also keeps `clock`, the unscaled seconds ticked. Toasts expire on that clock after `TOAST_LIFETIME` = 5 s, so tests stay deterministic. At most 5 toasts are kept.
- Toasts come from new events of kinds crash, chatter, rubbing, heavyCut, toolBroken, poorFinish, wrongDirection, parted and toolChangeWhileRunning. Their text comes from `toastText`, which the event log reuses. Events replayed by `jumpTo` (an engine rewind and fast-forward) do not raise toasts.
- The camera follows `step.camera` whenever the player's step index changes. UI buttons can override it with `setCamera`.
- `startLesson(id, true)` (do it yourself) creates the player with `pauseAtStepEnd`, and does not start it. Pressing play then demonstrates one step and stops.
- `startChallenge` resets the store and sets the mode. The user loads the challenge stock themselves. In challenge mode the stock panel offers a "Challenge stock" preset.
- `requestHint` and `checkPart` are no-ops outside challenge mode.

### UI (`src/ui`)
- Icons are URL imports drawn with `currentColor`. They are rendered as a CSS mask (`Icon`), so they take the text color on the dark theme.
- Handwheel input:
  - **Drag:** dispatches whole divisions only, one `turnHandwheel` per division. The dt is the pointer-event time split across those divisions, or 0.05 s when timestamps are missing. Positions stay on the 0.001" grid.
  - **Buttons, keys and mouse wheel:** report dt = 0.05 s for 1 division, 0.1 s for 10 and 0.5 s for a revolution. Normal use therefore never trips the 0.25 in/s feed check.
  - **Mouse wheel direction:** scrolling down is clockwise.
- The collar graduations increase counter-clockwise, and the collar rotates clockwise with the reading. The graduation under the index mark therefore equals the dial reading on every axis.
- Hold-to-repeat fires on pointerdown, then every 60 ms after a 350 ms hold. A click with `detail === 0` (keyboard or programmatic) fires once. A mouse click does not fire a second time.
- The toolpost offers all four tools, including the boring bar, because the engine implements it.
- The SFM readout uses the diameter at the tool's Z, or the largest protruding diameter when the tool is clear of the work. It reads "warn" above 85% of the limit and "over" above it. The parting limit applies when the parting tool is mounted.
- Stock validation: diameter 0.125–2.000", length 0.25–6", stick-out greater than 0 and no more than the length, and under 3.5" to clear the tailstock.
- Section view: the window runs from z = −0.85 to past the work, tool and tailstock, and is scaled to the given width. The height follows from that scale. Gridlines are every 0.25", with labels every 0.5".
- The part drawing puts the faced end (local z = 0) on the right, as the part sits on the lathe. A bore whose depth is at least the overall length is labelled THRU.
- `theme.css` defines the CSS variables. The app root must import it (Phase 3).

## 3D scene (Phase 2)

### Coordinates and scale
- 1 scene unit = 1 inch. Scene +X is machine +Z (headstock on the left, tailstock on the right). Scene +Y is up, with the spindle axis at y = 0. Scene +Z is machine +x (radius) on the operator's side, so the toolpost tool sits between the work and the camera. `toScene(x, z)` in `src/scene/helpers.ts` does the mapping.
- Centre height is 3.5" above the ways (7" swing). The bed runs from x = −10.5 to 13 and is 3.5" wide. The chuck body is 3.2" in diameter (`MACHINE.chuckBodyRadius`), and the jaws fill z ∈ [−0.6, 0].
- LatheGeometry revolves about +Y. The workpiece mesh is rotated −90° about Z so the profile's y (machine z) lies along scene +X. The parent group spins about X by `spindle.angle`.

### Workpiece geometry
- `latheGeometryFromPoints` still returns a `THREE.LatheGeometry`, but every profile corner is duplicated and the normals are rewritten per segment. Plain LatheGeometry averages normals across the 90° shoulders, which smears the shading of whole faces. Each band is flat in profile and smooth around the axis. UVs follow arc length (2 repeats per inch) and wrap 3 times around, so textures never stretch.
- The stock geometry is rebuilt only when the store's `version` changes. Parted pieces get their own geometry, centred on the piece.

### Toolpost and tools
- Each tool's mesh origin is its cutting tip. `toolTipOffset(tool)` is the tip's offset from the toolpost slot floor. The carriage, cross slide and toolpost are placed so the tip lands exactly on the machine (x, z). That means the toolpost sits in a slightly different place for each tool, as on a real lathe.
- Tools sit in the chuck-side slot of the 4-way post. The parting blade holder is on the chuck side of the blade, which matches the engine's crash envelope.

### Handwheels
- `handwheelAngle(position, pitch)` is the clockwise angle in radians. Per-axis signs follow DESIGN.md §4. Cross slide clockwise is −x. Carriage clockwise is +z. Tailstock clockwise is +quill. Each wheel applies "clockwise as seen by the operator" as a negative rotation about the axis that points at the viewer.

### Environment and lighting
- Reflections come from drei's `<Environment>` built from local `<Lightformer>` panels, not an HDR preset. Presets such as 'warehouse' download an HDR file from a CDN at runtime, which fails offline and in CI. The environment still sits inside `Suspense` plus a silent error boundary, so a failure only loses reflections.
- Shadows use `PCFShadowMap` (`shadows="percentage"`). three 0.186 removed PCFSoftShadowMap and warns when it is requested.

### Camera
- `CAMERA_PRESETS` holds overview, tool, chuck and tailstock. The camera and the OrbitControls target glide exponentially toward the store's `camera` preset. The 'tool' preset follows the current tool tip (`cameraPresetFor('tool', tip)`).
- Dragging the view stops the glide (free orbit). Choosing a *different* preset resumes it. Re-selecting the preset that is already active does not, because the store value does not change.

### Simulation tick
- `LatheScene` contains the app's only `useFrame` that calls `useLathe.getState().tick(dt)`, with dt clamped to 0.05 s. Do not tick elsewhere. Parts read continuous values (x, z, quill, spindle angle) from `useLathe.getState()` inside `useFrame` and mutate refs, so React does not re-render every frame. Only tool, tailstock tool, `version`, `partedPieces` and `camera` are subscribed.

### WebGL failure
- `LatheScene` checks for WebGL once on mount (it is never available under jsdom). Without it, the scene renders `<div data-testid="scene-fallback">` directly. Errors thrown inside the Canvas reach `SceneErrorBoundary` through R3F's own boundary and produce the same fallback. The wrapper always has `data-testid="lathe-canvas"`.

### Chips and parted pieces
- Chips are one `InstancedMesh` of 200 flakes in a ring buffer. They are thrown from the tool tip, or out of the hole when a drill is in the work, and they come to rest on the chip tray until reused.
- A newly parted piece falls into the tray over 0.6 s with gravity-style easing, tumbling a quarter turn. It then rests at `partedPieceRestPose(index)`. Pieces are keyed by object identity, so every new piece animates. Inventory pieces are not drawn.

### Dev preview
- `scene-preview.html` and `src/scene/__dev__/ScenePreview.tsx` mount only the scene with brass stock and a turning tool. They are dev-only: `vite build` builds `index.html` alone, and `tsc` still type-checks the preview.
- Open `http://localhost:<port>/scene-preview.html` under `npm run dev`. The query parameters are `camera`, `tool`, `ts` (the tailstock tool), `material`, `quill`, `cut=1` (face, turn a step and keep a light pass going) and `part=1` (part off a piece).
- `window.__lathe` exposes the store for poking at it.

## App shell and e2e (Phase 3)

### Layout
- The header holds the logo, the mode badge, the camera presets (`cam-{name}`), Reset / Home
  (`app-home`, which calls `reset()`), Help (`app-help`) and Settings (`app-settings`). The camera
  buttons used to live in the lesson panel too. They were removed there so each test id is unique
  and the camera is always reachable.
- The bottom tabs are `tab-project`, `tab-section` and `tab-log`. The project panel stays mounted
  while hidden, because do-it-yourself lessons keep their step index in component state. The
  section view and the log mount only while their tab is shown. Any mode change, such as starting
  a lesson or challenge or going home, brings the Project tab to the front.
- The section view is sized to fit the tab in both directions. Its height follows its width, so
  the width is the smaller of the tab width and the tab height divided by the diagram's aspect.
- Below 1100px wide, the control panel stacks under the viewport and the page scrolls.

### Locked controls
- The control panel is disabled while a demo drives the machine. That covers a watched lesson
  that is playing, and also a challenge's "Show solution" playback, which DESIGN.md did not
  mention. A banner (`controls-locked`) explains why. Pausing unlocks the controls.

### Simulation tick without the 3D scene
- `useFallbackTicker(active)` runs a `requestAnimationFrame` loop that calls `tick(dt)`, with dt
  clamped to 0.05 s like the scene. It falls back to `setInterval` when rAF is missing. It is
  active when the 3D view is turned off, or when `LatheScene` reports that it can't run.
- `LatheScene` has an `onUnavailable` callback. It fires when WebGL is missing, or when the Canvas
  throws, via the new `SceneErrorBoundary.onError`. Only one ticker ever runs.
- "Reduce motion / disable 3D" is stored in `localStorage` under `lathe-sim.no3d`. `?no3d=1`
  forces it on for that visit and greys out the toggle. Storage errors read as "off".

### Bundle
- `LatheScene` is loaded with `React.lazy`. The app shell imports only `SceneErrorBoundary`,
  `SceneFallback` and the `webglAvailable` probe, which moved to `scene/webgl.ts`, so three.js
  stays out of the main chunk.
- Rolldown `codeSplitting` groups produce vendor chunks: `react` (React, ReactDOM, scheduler and
  zustand, which load eagerly), `three-core` (`three.core.js`), `three` (the rest of three), and
  `r3f` (R3F, drei and their helpers). React needs its own group. Without it, React gets pulled
  into the r3f group and drags every 3D chunk onto the first page load. Each chunk is under the
  500 kB warning, with no change to the warning limit.

### Console
- R3F 8.18.0 is the newest 8.x. It still creates a `THREE.Clock`, and three r183+ warns that the
  class is deprecated. `scene/threeConsole.ts` installs a filter through three's own
  `setConsoleFunction` hook. The filter drops exactly that warning and passes everything else on.
  It loads with the scene chunk.
- `index.html` links `public/favicon.svg`, so no 404 is logged.
- The WebGL probe releases its context with `WEBGL_lose_context` right away.

### E2E
- Playwright tests the production build through `vite preview` on port 4173. `?e2e=1` exposes
  `window.__lathe` in production builds. Tests use it only to make long traverses, through the
  `traverse()` helper. That helper moves in whole divisions and reports a dt that keeps the feed at
  0.2 in/s, so it never trips the poor-finish check. Tool changes, the spindle, the final handwheel
  clicks and "Check my part" all go through the UI.
- An auto fixture fails any test that logs a console error or a page error. The ignore list is
  empty. Warnings are attached to the test report. Under SwiftShader, Chrome's GL driver logs
  "GPU stall due to ReadPixels" as a performance warning on 3D tests. It comes from the software
  renderer, not the app.
- Under Vitest (Node), the scene tests log three's `THREE_CJS_DEPRECATED` warning, because
  dependencies of the R3F stack `require('three')`. Inlining `@react-three/*` and `three-stdlib`
  did not silence it. It is a Node test-time warning only, and never reaches the browser.

## Fix round 1: engine and content

These decisions answer docs/REVIEW.md and the first QA pass. Where they conflict with the
Phase 1 notes above, this section wins.

### Depth of cut on cross-slide moves
- A cross-slide move used to count every column under the 0.25" turning footprint as depth, so a
  0.010" infeed over the bar broke the tool. Depth is now worked out per sub-step:
  - **Facing.** The material ends inside the tool's width, so the changed columns stop short of the
    footprint's tailstock-side edge. Depth is the axial engagement, the width of face being taken.
    It is capped by how far the tool has gone in since the cutting run began. An infeed near the
    end of a turned bar is therefore not called a 0.08" facing cut. Once the radial travel passes
    the limit, the event reports the full axial depth.
  - **Plunging.** The tool's full width is in the work. Depth is how far the tool is now past the
    profile as it was before this dispatch. A 0.010" infeed is 0.010" deep, and plunging ten thou
    at a time never breaks the tool. One big plunge, such as 0.070" in a single move, is still a
    heavy cut.
  - **Boring bar.** Depth is the bore growth since the move began. Parting stays exempt for x
    moves.
- A `heavyCut` event reports the deepest point of the move that raised it, not the first sub-step
  over the limit.

### Feed per revolution
- `poorFinish` now judges feed per spindle revolution: in/rev = (in/s) / (rpm / 60). The limits
  are in `MACHINE.maxFeedPerRev`:

  | Tool | Limit (in/rev) |
  |---|---|
  | turning (and facing) | 0.010 |
  | boring | 0.006 |
  | parting | 0.004 |
  | center drill | 0.004 |
  | 1/8" drill | 0.005 |
  | 1/4" drill | 0.008 |

- The old 0.25 in/s limit stays as a secondary bound for a handwheel spun too fast. The event
  carries `feedPerRev` and `limit`.
- Content feeds were cut to believable values, documented in `src/content/helpers.ts`. Roughing
  is 0.008"/rev, finishing 0.003, facing 0.006, parting 0.003 at 300 rpm, and the 1/4" drill
  0.005. Run times grew. At 1× the Pin solution takes about 229 s, the Stepped Shaft 250 s, the
  Bushing 162 s and the full-project lesson 166 s. The player's speed control is the answer.
- A cut traverse faster than about 0.1 in/s at 600 rpm now flags poor finish. That includes the
  UI's "+1 rev" carriage button while cutting (0.1" in 0.5 s) and the e2e `traverse()` at
  0.2 in/s.

### Tailstock body and carriage travel
- The tailstock body is a rect at x < `MACHINE.tailstockBodyRadius` (1.0) and z ≥ tailstockZ +
  `tailstockBodyOffset` (0). That matches the section view's drawing. Any toolpost tool envelope
  that reaches it crashes (`what: 'tailstock'`).
- The carriage itself, with or without a tool, can't put the tip past the front of the tailstock
  body. Trying is a tailstock crash. So the z range end (5.0) is only reachable with the
  tailstock moved further back.

### Boring bar
- The bar is an internal tool (`RectFootprint.internal`). It only enlarges a bore and never
  takes the "cut from outside" branch.
- It needs a hole of at least `BORING_MIN_BORE_RADIUS` (0.09, a 3/16" hole), and it can't be
  buried more than its 0.125" body below the bore wall. Touching material without that hole,
  including the outside of the bar, emits `boringSolid` and `toolBroken`. The move stops there
  and nothing is cut. The grader's toolBroken deduction applies, and the analyzer explains it.

### Dial readings
- `dialReadingFor` now returns values in [-0.5, n - 0.5). `Math.round` of it is always a real
  graduation, so a reading of 99.6 is returned as -0.4 and shows 0, not 100. Collar angles are
  unchanged modulo a turn. `dialGraduationFor` returns the whole graduation 0..n-1.

### Action log
- `LatheState.actions` is one append-only array shared by successive states. It is no longer
  copied on every dispatch. Old state snapshots see later entries, so take `.slice()` for a frozen
  copy. `createInitialState` and `reset` copy the array they are given, and `ScriptPlayer`
  freezes its own origin copy for rewinding.
- Consecutive `turnHandwheel` actions on the same axis, in the same direction, are coalesced into
  one entry. Revolutions and dt are summed, and `t` is the first one's. Replaying the merged entry
  carves the same path, because sub-steps are ≤ 0.002" either way, and gives the same average
  feed. A direction change starts a new entry.
- `scriptProgress` keeps a replay tracker per action-log array and script, in a WeakMap. Each
  call applies only the entries added since the last call. Growth of a coalesced last entry is
  applied as a delta turn. Persistent checks are re-evaluated only when the workpiece, parted
  pieces or inventory change. A move that only cuts air no longer copies the workpiece, and a
  cached largest radius rejects contact in O(1).
- Measured on an M2 after 50k dispatches, 33k of them uncoalesced: a cold hint takes about 20 ms,
  grade plus analyze about 20 ms, and a warm hint under 1 ms. Before the fix a hint took 3.6 s.
  `src/engine/__tests__/perf.test.ts` asserts generous bounds.

### Absolute script moves (`moveTo`)
- New `ScriptAction` `{ type: 'moveTo'; axis; position; duration?; feed? }`. The player resolves it
  against the engine's position when the action starts, in `resolveMoveTo`:
  - With `feed`, the move takes dist / feed.
  - Without a feed, it takes max(duration, dist / 0.2 in/s).
  - The minimum is 0.2 s, and a move to where the machine already is takes no time.
  - The target is clamped to the travel range.
- Revolutions are metered exactly like `turnHandwheel`. `actionDuration` gives the nominal
  duration for progress estimates, and the player scales progress for the real one.
- `play()` re-aims an in-progress moveTo when the axis was moved while paused, so resuming after
  taking over lands on the scripted position. "Show me" with a one-step player on the live engine
  also lands on absolute targets.
- All lesson and solution x/z/quill moves are now moveTo, emitted by `Machine` in
  `src/content/helpers.ts`. Hand-written `turnHandwheel` script actions still work.

### Descriptions and hints
- `describeAction(a, ctx?)` takes an optional `DescribeContext` (x, z, quill, dialZero). With it,
  a moveTo reads like "Bring the cross slide in to X dia 0.910 (dial 40): 40 divisions
  clockwise." Without it, the line reads "Move the cross slide to X dia 0.910."
- `describeActions(actions, ctx?)` tracks positions and dial zeros through a list.
  `netMotion(actions, from)` gives a list's net motion. `describeContext(state)` builds a context.
- Level-2 hints are numbered instructions worked out from the live state, so they hold wherever
  the machine is. They are also returned as `Hint.lines`. The old merging of same-direction turns
  is gone.
- The challenge stock is preloaded into the replay only when the live state has a workpiece that
  the log never loaded. On a fresh challenge the first hint is "Load the stock".

### Checks and DIY robustness
- Position checks made by `xNear`/`zNear` are now ±0.003 (`POSITION_TOL`). The old ±0.010 equalled
  the 0.010 facing advance, so "take another ten thou" showed "Already done". Every in-window
  position still satisfies the next work check.
- New `StateCheck` `dialZeroBetween {axis, min, max}`. It holds when that dial was last zeroed
  with the axis in [min, max]. The turning lesson uses it, so zeroing is actually checked.
- Turning roughing checks accept any diameter from just over the finished size up to the pass
  size. A pass that went a little deep can't strand the lesson. Only going under size is a real
  mistake.
- The center-drill checks are now a spot at least 0.030 across, 0.015 to 0.030 below the face
  (`centerSpotCheck`). That is a realistic spot about 0.04" deep.
- Content tests now assert three things:
  - Every lesson and solution runs with zero warning events of any kind.
  - No step that asks you to do something is already satisfied when you reach it.
  - For every position window in every lesson step, a run nudged to each edge of the window
    finishes the rest of the lesson cleanly.
- The test harness pauses at each step end to judge checks there.

### Grading and analysis
- `measureSpan` clips a span to the material that exists. A short part fails only its length. A
  span wholly past the end has no material (null) and reads as "Section missing".
- Shoulders: for each pair of adjacent target segments whose diameters differ by more than
  their tolerances, `findShoulder` finds where the profile steps. It picks the split that best
  separates columns nearer one diameter from columns nearer the other.
  - Each diameter is then measured between the shoulders where they really are.
  - A new check, "Shoulder Ø a/Ø b at Z from the face", has tolerance `SHOULDER_TOL` = 0.010.
  - A shoulder 0.020" off is now a shoulder error, with the direction and how to measure it. It
    is no longer "undersize, can't be added back" or "take another 125 thou pass".
  - With no step found, the nominal spans are used, so an unturned tip still reads oversize.
- Analyzer wording:
  - With no stock at all, the analyzer says "Nothing made yet".
  - Oversize after parting says "next time, measure before parting off".
  - Too long and too short branch on `requireParted`, so the Faced Slug never gets parting advice.
  - The text now says "N thou too long".
  - The blade width shows as 0.0625.
  - Bore problems are "No hole", "Bore too big" or "Hole not deep enough: full size only N deep".
  - Poor-finish advice quotes the in/rev limit and a comfortable handwheel rate.
  - The crash text no longer doubles its period.
  - Skipping the center drill before drilling gets a tip.
- "Skipped step" is reported only for a step about the work (persistent check) whose region was
  never touched, while a later persistent step did happen. `scriptProgress` now returns
  `everAttempted` (from `checkAttempted`). A step that was done but came out wrong is reported
  as the dimension problem only. Transient steps such as "spindle off" no longer make earlier
  steps look skipped.

### Content
- Turning lesson:
  - After the skim, the carriage runs back out past the end with the cross slide untouched, and
    the spindle stops before the lesson measures and zeroes.
  - The spindle stops again to measure before the finishing pass.
  - The narration explains the 50-division dial wrap. The readings are 40, then 30 (one turn
    past zero), 15 (two turns) and 20.
- Parting:
  - The part drops into the chip tray. The lesson never reaches toward a turning chuck.
  - The feed is steady all the way, without "ease off".
- Full project:
  - It turns "back to Z 0.600, about 0.88 from the face".
  - It parks the tool at X dia 1.400, no longer at the end of its travel.
- Other lessons:
  - The facing step title matches its narration.
  - The tour says to change belt or gear speeds with the spindle stopped.
  - The drilling lesson explains drawing hole depth (about 0.425 here).
- The Stepped Shaft and Spacer hints explain the carriage dial wrap, or point at the DRO.

### Not done in this round
- The live center still never touches the work.
- The engine still accepts stock with almost nothing in the jaws. That is UI validation.
- "Chatter" for over-speed turning is not yet renamed.
- DIY setup steps still accept any stock.

## Fix round 1 — UI

These changes answer the first QA pass and docs/REVIEW.md for the UI, the 3D scene, the project
panels, the app shell and the e2e tests.

### Demos and locked controls
- The store has a `demo` field, set while a do-it-yourself "Show me" plays. `showMe(step)` builds
  a one-step `ScriptPlayer` on the live engine and attaches it like any player, so `playerStatus`,
  the speed and the step camera all apply. When the step ends, or on `stopDemo()`, the lesson
  player is put back without re-applying its camera.
- `selectControlsLocked` is the single rule. The controls lock while a Show me demo runs, or while
  a watched lesson or a challenge solution is playing. The App banner and the control panel both
  use it. The old `controlsLocked(mode, playing)` helper in `App.tsx` wraps it.
- The banner says what is driving the machine and has one button. "Take over" calls `takeOver()`.
  That pauses a watched lesson and drops a challenge solution's player, which leaves the machine
  where it is. During Show me the button reads "Stop the demo".
- `startLesson(id, diy, fromStep)` fast-forwards the machine to the start of `fromStep` with
  `jumpTo`. Switching between Watch and Do it yourself uses it, so you keep your place (QA P2-15).

### Solution playback
- While a solution player exists, the challenge panel shows a "Reference solution" box at the top.
  It holds the shared `Transport` (Play / Pause, Step forward, speed, progress, caption), the
  current step's title, narration and moves, and Take over. `Transport` is the same component the
  watched lesson uses, with a test-id prefix (`lesson-*` or `solution-*`).
- `solutionPlayed` is set by `playSolution` and cleared when a challenge starts. The grade card
  then notes that the solution made some of the part (REVIEW P1-13).
- Show solution and Try again ask first in an inline bar (`challenge-confirm`), not `confirm()`.
  Try again asks only once there is work to lose. The `confirm` prop still overrides it, for tests.

### Do-it-yourself layout
- The current step comes first: the position line, then an instruction box with the title, the
  narration and the "Waiting until" line, then the step buttons. The step list is a collapsible
  column on the right, which keeps its own scroll. At 1100×800 the whole "Waiting until" line is
  visible without scrolling.
- The Project tab scrolls back to the top when the mode changes. On a step change, the
  instruction box scrolls into view only if it is out of view.
- A step that is already done on arrival moves on after `ALREADY_DONE_DELAY` (2 s), with the text
  "Already done: moving on…". A step picked from the list to re-read stays put.
- The step's moves come from the engine's `describeActions`. In Do it yourself they are worked
  out from the live machine position, so the turns count down as you move. The watched lesson and
  the solution use the position at the start of the step. `stepMotion` uses `netMotion` when it
  has a starting position, so absolute `moveTo` steps draw arrows too.
- Only the boolean result of the step check is selected from the store, so the view no longer
  re-renders every frame (REVIEW P2).
- The speed buttons in Do it yourself are labelled "Show me speed" (QA P2-22).
- Level-2 hints with `lines` render as a numbered list (QA P2-8).

### Handwheel input
- A button press, key press or wheel notch reports dt = distance / `STEADY_FEED` (0.02 in/s),
  with a 0.05 s minimum. A rev on the carriage is 5 s and a rev on the cross slide is 2.5 s. This
  stays under every per-revolution finish limit at 300 rpm and up, so stepping through a cut is
  never a poor finish. The earlier fixed 0.05 / 0.1 / 0.5 s values tripped the new limits.
- Held buttons report the real time since the previous repeat, and drags report their real
  pointer time. Fast feeding is therefore policed (QA P2-16, REVIEW P1-4).
- Hold-to-repeat captures the pointer, stops on release, leave, cancel or lost capture, and stops
  as soon as the button becomes disabled. A drag on the wheel is dropped when it becomes disabled.
- Shift+wheel reads `deltaX` when `deltaY` is 0, which is what macOS and Chrome on Windows send.
  This is untested with a physical mouse (QA P2-18).
- Keys: ↑ and ↓ match → and ←, and Page Up and Page Down turn a revolution. Alt+arrow still works.
- The collar readout, the slider's `aria-valuenow` and the DRO ◷ readings all wrap to
  0..divisions−1, so the DRO never shows 100.
- The spindle direction and rpm radiogroups use roving focus. Only the checked option is in the
  tab order, and the arrow keys, Home and End move the selection.

### Scene
- The 'tool' camera sits front-right of the tip and a little above it, about 28° up. It aims a
  little above the tip, so the toolpost falls toward the bottom of the frame. A unit test checks
  that the line of sight to the tip misses the toolpost boxes (`toolpostBounds`) for the turning
  and parting tools at several positions. The boring bar is left out, because its tip is inside
  the bore.
- The tool camera keeps following. While it glides, the goal moves with the tip. Once settled,
  or after the user orbits, the view is carried along by the tip's movement. `cameraNonce` bumps
  on every `setCamera` and on every step camera, so choosing the current preset again, or a
  lesson step with the same camera, glides back (REVIEW P1-14).
- Parting tool: the blade has a bright, slightly emissive steel material, is 2.4" long and
  sticks out 1.1" from its holder. The holder is lighter blued steel, not black oxide. The tool
  sits 0.5" further out of the post (`toolTipOffset('parting')` z = −2.0), so about 1.25" of blade
  shows between the post and the work. The engine footprint and crash envelope are unchanged.
- Workpiece geometry is disposed when it is replaced, and on unmount after a microtask. That means
  StrictMode's dev remount no longer disposes a geometry that is still drawn.
- `SceneErrorBoundary` reports through `console.error`, so the e2e console guard fails on a
  broken scene. The silent boundary around the environment still only loses reflections.
- After a 2 s warm-up, the scene measures the frame rate over 4 s. Below 20 fps, the viewport
  offers "Turn off 3D" or "Keep it" (QA P2-14).

### App shell
- `AppErrorBoundary` wraps the app in `main.tsx`. It shows a message and a Reload button, and logs
  through `console.error`.
- Turning the 3D view back on clears the "scene down" flag. The fallback ticker therefore never
  runs alongside a working scene, which would tick the sim twice per frame.
- Toasts are each `role="alert"` (danger: crash, broken tool, heavy cut) or `role="status"`
  (everything else), so crashes are announced assertively.
- Help no longer points at the repository. It explains lessons, Show me and Take over instead.
  The setting reads "Turn off the 3D view".
- The stock panel needs at least 0.375" in the jaws (`MIN_GRIP`).
- The challenge stock button says "Reload this stock" only when the chucked bar is the challenge
  stock (`isStock`, QA P2-21).
- Lesson cards show watch time at 1×, in seconds when it is under a minute (QA P2-23).
- A new grade scrolls into view in the bottom panel (QA P2-20).
- The part drawing runs the outline out to the overall length. For a part that stays in the chuck
  (`!requireParted`), it draws the jaws and labels the length "FROM JAWS". "← FACE" sits beside
  the faced end, clear of the diameter callout. A stepped part gets the note "UNTOLERANCED LENGTHS
  ±0.010", which is the grader's `SHOULDER_TOL` (QA P2-11).

### E2E
- `reuseExistingServer` is off unless `E2E_REUSE_SERVER=1`, so a stale preview server is never
  tested.
- New tests:
  - Show me in Do it yourself, with the lock, the banner, the hand-back and Stop the demo;
  - the "Waiting until" line in view at three window sizes;
  - Show solution, with confirm, pause, speed and take over;
  - several seconds of cutting with the 3D view on, with no console errors and no fallback.
- The tour test waits for the "Already done" step to move on by itself instead of pressing Next.
- `traverse()` now reports a 0.015 in/s feed. That is under every per-revolution finish limit at
  300 rpm and up. The old 0.2 in/s tripped the engine's new limits. The move itself is still
  instant.
- `E2E_GPU=1` runs Playwright on the installed Chrome with the real GPU instead of SwiftShader.
  The docs screenshots are made that way:

  ```sh
  E2E_GPU=1 npx playwright test e2e/screenshot.spec.ts
  ```

  The screenshot test dismisses toasts and the slow-3D note before each shot.

### Not done
- QA P2-19: below the 1100 px minimum the layout still stacks and the page scrolls.
- QA P2-1, P2-2, P2-5 to P2-7, P2-9, P2-10 and P2-17 are engine and content items for the
  engine fix round.

## Fix round 2

These decisions answer the second QA pass. Where they conflict with earlier sections, this one
wins.

### Hints after a mistake that can't be undone (P1-A)
- `impossibleReason(check, state)` / `checkImpossible` in `src/engine/hints.ts` say when a check
  about the work can never become true, because material only comes off:
  - `diameterBetween`: some column in the region is already under `min`, or is gone (faced away,
    parted off).
  - `boreAtLeast`: some column in the region is gone.
  - `all`: any sub-check is impossible. Settings, positions, `facedTo` and `parted` are never
    impossible, and nothing is impossible with no stock loaded.
- `scriptProgress` returns `impossible[]` (per step, on the live state) and `skipped[]`. After the
  usual progress, it passes over every step whose check is impossible, and any work step after it
  that already holds. So `nextStep` is the next step that can still be done. The tracker itself
  is untouched; only the returned value moves on.
- `nextHint` puts the explanation in a new `Hint.notice` field and at the start of `text`, for
  example "The bar is already under 0.498: it measures Ø0.490 here, and metal can't be put back.
  Finish the part anyway: part it off with the blade at Z 0.418, then press Check my part to see
  your grade. Then press Try again for a fresh bar." The hint's step is the next feasible one, so
  level 2 lists the parting moves, never passes that cut air. The challenge panel shows the
  notice in its own box above the step.
- Analyzer: if the part must be parted but is still on the bar, and a work step is already
  impossible, it adds "This part can't come out to size", with the reason and the step where it
  happened. After parting, the usual Undersize mistake covers it and this one is not added.

### Level-2 hints grouped by pass (P2-15)
- `stepInstructions(step, state)` replaces the flat list. A run of moves that ends with a retract
  (cross slide out, or quill back) is one pass, together with the carriage's return toward the
  tailstock when that comes next. With two or more passes each becomes one line, "Pass 3 of 8:
  …", or "Peck 2 of 4: …" for drilling. The Pin's turning hint is 9 lines instead of 34.
- Leading passes that would cut nothing on the work as it is now are left out, with a first line
  such as "Passes 1 to 3 would cut nothing now: the bar is already smaller. Start with pass 4."
  A pass cuts air when none of its feeds (carriage toward the chuck, or cross slide inward) would
  sweep the 0.25" tool width through material. If the first pass shown starts with a cross-slide
  move and the carriage isn't where the plan has it, a carriage move is put in front, so the hint
  never plunges into the side of the bar.
- The final hint says "Check my part", the real button name (P2-12).

### Plunge depth accumulates (P1-B)
- The engine keeps a plunge record: the workpiece as it was before the first cutting cross-slide
  move at the current carriage Z, with the current tool. Later cross-slide moves at the same Z and
  with the same tool measure plunge depth against that profile, not against the profile before
  each dispatch. Retracting and plunging again at the same Z is the same groove.
- The plunge ends on any carriage move, a tool change, new or removed stock, a reset, or a part
  dropping off. So:
  - six "+1 rev" clicks into the side of a 1" brass bar from X dia 1.020 give a heavy cut at the
    second click (0.090) and a broken tool at the third (0.140);
  - successive turning passes are judged per pass, because the carriage moves between them;
  - an infeed at a shoulder followed by feeding on starts a new plunge at the new Z;
  - facing is unchanged. It uses the facing branch, axial engagement capped by the radial travel
    since the cutting run began, because the face sits inside the tool's width.
- The parting blade stays exempt on cross-slide moves, and the boring bar is still measured as
  bore growth within one move.

### Resuming a watched demo after taking over (QA P1-10, P2-2)
- Pausing a watched lesson or a solution with Play / Pause, or pressing Take over, snapshots the
  machine (positions, workpiece, tools). On Play the store compares, and if anything changed it
  raises a `notice` toast (new toast kind, info tone). For example: "You moved the carriage while
  the demo was paused. It carries on from here: the carriage is at Z 1.460, so its numbers may
  not match the narration." If the work changed it gives the new face position instead. If the
  current step's check is now impossible, it says so with the reason. The demo still carries on
  from where the machine is. Re-aiming every axis was not attempted.
- `ScriptPlayer` records `deviations`: the steps whose check did not hold when the step ended.
  They are in `PlayerStatus` and are cleared on a rewind. A watched lesson that ends with
  deviations says "Lesson completed with deviations" and lists each step with what it wanted.
- Do it yourself: steps moved past with Skip step or by jumping ahead in the list, while their
  check did not hold, are listed at the end ("You reached the end, with 3 steps skipped"). A
  skipped step that is done later drops off the list.

### Dial divisions (P2-1, P2-9)
- `snapToDial(engine)` in the store moves each axis to the nearest absolute 0.001 with a slow
  handwheel nudge (at most 0.0005, at 0.02 in/s, so never a fast feed). It runs on Stop the demo,
  when Show me ends, on Take over, and when a watched lesson or solution is paused. A stopped demo
  can no longer leave the DRO inside a window while the true position fails the check. It snaps
  to absolute thousandths rather than to the dial zero, because the checks and the DRO are
  absolute, and every content dial zero is itself on a thousandth.
- Content targets are all whole thousandths. A content test asserts it for every scripted x and z.
  `onDial(r)` in `src/content/helpers.ts` rounds a half-thou radius up: Ø0.875 is cut to 0.876,
  and Ø0.625 to 0.626. Both are inside the drawing tolerance and on the safe, oversize side.
  `passRadii` and the solution builder use it, and so does the full-project parting approach
  (0.458). The hints that asked for 1.0625, 1.3125, 0.8125 or 0.3125 back from the face now give
  the rounded division, 1.062 and so on, and say why.

### Grading (P2-3, P2-7, P2-10, P2-11)
- A heavy cut costs `HEAVY_CUT_POINTS` (5) each, capped at `HEAVY_CUT_CAP` (15). A heavy cut
  raised by the same dispatch as a toolBroken event isn't charged again, because the broken tool
  already costs 30.
- Chatter while parting (`tool === 'parting'`) costs `PARTING_CHATTER_POINTS` (10) each, capped at
  20, under its own label. Turning chatter stays at 2 each, capped at 10. Parting at 1200 rpm now
  scores 90, not 98.
- After a crash the engine only reports another crash once the tool has moved at least
  `CRASH_CLEAR_DISTANCE` (0.010") from where it was stopped. Extra clicks into the same jaw, or
  small moves around it, are one crash. The Safety row pluralises: "2 crashes", "2 heavy cuts".
- A part that must be parted but is still on the bar shows "not measured: still on the bar" for
  its diameters, shoulders and bore, and "not parted yet" for the length. The score is unchanged.

### Smaller fixes
- **Recommended rpm (P2-6).** `recommendedRpm` for the parting tool is also capped at
  `MACHINE.partingMaxRpm` (300). The readout and the chatter advice now say 300 for parting, as
  the lessons do. It is 150 in steel at 1".
- **Boring bar toast (P2-4).** `boringSolid` raises its own toast ("Boring bar broken! It needs a
  drilled hole…"). The generic toolBroken toast from the same dispatch is dropped. The QA note that
  the bar is drawn 0.04" into the face did not reproduce from the code. The engine stops the bar
  at the last free sub-step, within 0.002", and the mesh doesn't reach chuck-side of the tip. It
  is left as is.
- **Stock panel (P2-5).** The field grid uses `minmax(0, 1fr)` columns, and its inputs are 100%
  wide. A number input's intrinsic width no longer pushes the control panel 84 px wider than its
  box. An e2e test checks the panel and the four stock fields at 1100×800 and 1440×900.
- **Turning lesson narration (P2-8).** Quoted readings are framed as the demo's ("In this demo
  the micrometer reads 0.990"), and each pass names its DRO target first. The dial numbers are
  given as what you'd see from a 0.990 skim, with a pointer to the live moves list.
- **Empty toolpost crash (P2-13).** The toast reads "CRASH! The carriage hit the tailstock." The
  analyzer says "The carriage, with no tool fitted, hit…".
- **User guide (P2-14).** The guide now says a too-deep cut raises a heavy-cut warning. The
  Stepped Shaft row matches the drawing, and the guide has the deduction table and the new hint,
  resume and snap behaviour.

### Not done in this round
- QA P2-17 (no deflection) and P2-19 (stacking below 1100 px) stay deferred, as decided earlier.
- Resuming a watched demo doesn't re-aim axes other than the one in motion. The notice is the
  minimum fix: the narration can still disagree after a take-over.
