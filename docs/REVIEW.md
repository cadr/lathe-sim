# Review: engine, content, code quality (commit 81705c1)

Reviewed with a machinist's and a senior engineer's eye. Nothing was changed in `src/`. Items
marked **verified** were reproduced with throwaway vitest scripts, which have since been deleted.
Priorities:

- **P0**: user-facing wrong behavior or a crash, likely to hit normal users.
- **P1**: a likely bug, misleading output, or a safety or teaching error.
- **P2**: quality, robustness, polish.

## Top items

| # | Pri | Area | Finding |
|---|---|---|---|
| 1 | P0 | engine | A 0.010" cross-slide infeed with the turning tool over the work reports a 0.250" cut and **breaks the tool** |
| 2 | P0 | analyzer | A shoulder that is 0.020" off gives harmful advice: "Undersize, material can't be added back" or "take another 125 thou pass" |
| 3 | P1 | lessons/hints | Script moves are *relative*. "Show me", resuming a paused demo, and level-2 hints go wrong (and break tools) when the machine isn't where the script expects |
| 4 | P1 | engine/perf | The action log copies O(n) on every dispatch, and each hint or check replays the whole log. At 41k actions, `nextHint` takes 3.6 s and `analyze` 2.9 s, which freezes the UI |
| 5 | P1 | hints | On a fresh challenge with no stock loaded, the first hint skips "Load the stock" and says "Face the end" |
| 6 | P1 | UI | "Show solution" can't be paused or sped up, yet the lock banner says "Pause it to take over". The Pin solution runs 118 s at 1× |
| 7 | P1 | content | Unsafe teaching: the turning lesson measures with the spindle running and the tool in contact. The parting lesson says to catch the part by hand with the spindle turning |
| 8 | P1 | content | Numbers that don't match: "turn back 0.6 from the face" (it's 0.880), and "stop the cut at 0.750 on the dial" (the dial is 0–99 and reads 50) |
| 9 | P1 | engine | The toolpost tool drives straight through the tailstock body when X > 0.5 (radius) |
| 10 | P1 | scene | The "Tool" camera stops following the tool once it settles, and lesson steps that keep the same preset never re-arm it |

---

## 1. Engine (`src/engine`)

### P0-1 A plunge with the turning tool over the work breaks the tool (verified)
- **Where:** `src/engine/lathe.ts:306` sets the x-feed depth to `stats.axialExtent`. `src/engine/tools.ts:94` gives the turning footprint a 0.25" flat width.
- **What:** The case is mid-pass, at z = 1.0 on a 1" bar, with the tool at radius 0.47. Ten +1 clicks on the cross slide (0.010" radial) give `heavyCut {depth: 0.250, max: 0.060}` and then `toolBroken`. Every column under the 0.25" footprint counts as "depth". The same applies to any infeed where the tool body overlaps the work by more than 0.12". The boring bar is worse: a radial move inside a bore engages up to 1.5".
- **Why it matters:** Beginners often stop partway along a pass, dial in a bit more and carry on. Some also infeed without first running the carriage past the end. The sim calls that a broken tool. Then the analyzer says "A cut of about 250 thou was far more than this brass can take", which is false and can't be acted on.
- **Fix:** Separate *facing* from *plunging* on x moves.
  - **Facing:** the engaged columns are the frontmost material. Depth is the axial engagement, as now.
  - **Plunging:** the engaged columns are interior. The chip load is the radial infeed per substep, and the width is the engagement width. Emit a distinct warning such as "plunging with the full width of the tool" above some width, and break only on large radial infeeds. A cheaper alternative is to model the turning tool's plunge edge as a narrow nose, about 0.03", for x moves, and keep the 0.25" footprint for z moves.
  - Add a regression test: mid-pass infeed of 0.010" gives no heavyCut.

### P1-1 The boring bar bores solid stock silently and turns the OD from outside (verified)
- **Where:** `src/engine/workpiece.ts:107-110` and `src/engine/tools.ts:97`.
- **What:** Feeding the bar at x = 0.06 along z into solid brass leaves a Ø0.120 hole and emits no event. With the bar above a 1" bar at x = 0.55, a z feed turns the OD down to Ø0.850, because the `xMax >= outer` branch cuts from the outside.
- **Why:** A boring bar needs an existing hole bigger than the bar. Plunging into solid metal is a crash.
- **Fix:** For `boring`, treat any column with `inner < x - BORING_BAR_WIDTH` (the bar body inside solid material) as a crash or broken tool. Never take the "cut from outside" branch for an internal tool.

### P1-2 Tailstock crash checks ignore the tailstock body (verified)
- **Where:** `src/engine/physics.ts:57-62`.
- **What:** Only the quill (x < 0.5, z ≥ quill face) and the mounted tool are checked. The turning tool at x = 0.7 traverses to z = 4.9, past `tailstockZ` = 4.0, with no crash. At x = 0.45 it crashes as expected. The section view even draws a 1.0" radius tailstock body (`src/ui/SectionView.tsx:88`).
- **Fix:** Add a body rect, for example x < 1.0 and z ≥ `tailstockZ`, or clamp carriage travel to the tailstock. Also crash when the toolpost reaches the quill barrel above 0.5.

### P1-3 The feed limit is in in/s, not inches per revolution
- **Where:** `src/engine/types.ts:29` and `src/engine/lathe.ts:356`.
- **What:** `poorFinish` fires above 0.25 in/s at any rpm. At 150 rpm that allows 0.096 in/rev, which was verified as no event. At 2000 rpm it flags 0.0075 in/rev.
- **Why:** Finish is set by feed per revolution, so the limit teaches the wrong mental model.
- **Fix:** `ipr = feed / (rpm / 60)`. Give limits per operation, for example turning about 0.010, finishing about 0.004, parting about 0.003, and drilling 1/4" about 0.005. Keep the in/s limit only as a "handwheel spun too fast" guard.

### P1-4 Hold-to-repeat under-reports feed rate
- **Where:** `src/ui/Handwheel.tsx:33-45` and `src/ui/useHoldRepeat.ts:33-35`.
- **What:** Each repeat reports a fixed dt, for example 0.5 s for a full rev. Repeats actually fire every 60 ms. Holding "+1 rev" on the carriage while cutting really feeds about 1.67 in/s but reports 0.2 in/s, so `poorFinish` never fires.
- **Fix:** Have the repeat pass the real elapsed time since the last fire, which is `REPEAT_MS` for repeats.

### P1-5 The action log grows with O(n) copies, and hints and grading replay all of it (verified)
- **Where:** `src/engine/lathe.ts:159` copies `[...prev.actions, …]` every dispatch. `src/engine/hints.ts:92-95` replays every action and evaluates every step check after each one. `analyze` calls it again.
- **Measured:**

| Measurement | Result |
|---|---|
| Per-dispatch cost at 40k actions | 0.125 ms |
| `nextHint` at 41k actions | 3.6 s |
| `analyze` at 41k actions | 2.9 s |

- **Why it gets there:** Drag and clicks log one action per division. The ScriptPlayer dispatches every frame, so the Pin solution alone is about 7k actions. At 120 Hz that doubles. A by-hand stepped shaft easily passes 15k actions. "Check my part" then blocks the main thread for seconds.
- **Fix:**
  - Append to a mutable array and hand out a length or version, since the log is append-only anyway.
  - Merge consecutive same-axis `turnHandwheel` actions in the log.
  - Make `scriptProgress` incremental by caching the replay engine and the last index, or only re-evaluate checks after actions that can change them.
  - Add a perf test, for example 50k actions with `nextHint` under 50 ms.

### P1-6 The first hint skips "Load the stock" (verified)
- **Where:** `src/engine/hints.ts:78-79`.
- **What:** When the log has no `loadStock`, the replay preloads the challenge stock. That makes the `stockLoaded` check true. On a fresh challenge, every challenge's first hint is "Face the end". The level-2 text also starts "Mount the turning tool…" while there is no bar in the chuck.
- **Fix:** Preload only when the *live* state has a workpiece but the log has no `loadStock`. Otherwise start the replay empty. Add a test.

### P1-7 A short part also fails the diameter check (verified)
- **Where:** `src/engine/grader.ts:56` and `src/engine/analyzer.ts:50-55`.
- **What:** A Pin parted 0.980 long, with a perfect Ø0.500, scores 50. The diameter check shows "Ø0.000–0.500 ✖" and the analyzer adds "Section missing … There's no full-diameter material" next to "Too short".
- **Fix:** Clip the span to the material that exists and report the diameter there. Leave the length to the length check.

### P2 engine items
- **DRO dial can show "50" or "100" (verified).** `src/ui/DRO.tsx:27` rounds `dialReadingFor` without a modulo. For example, z = −0.0004 reads 99.6, which displays as "◷100". The handwheel's `formatReading` is correct.
- **Piece selection ignores recency.** `selectPiece` prefers `partedPieces` over `inventory` (`src/engine/grader.ts:19`). Parting a good part, collecting it, then parting a scrap slice grades the scrap.
- **"Chatter" for excess surface speed is a misnomer for turning.** Too much sfm burns and wears the tool, which is the steel failure mode. Chatter comes from rigidity: stick-out, depth and width of cut. It is right for parting. Consider "Too fast: tool wear / heat" for turning and keep chatter for parting and wide plunges.
- **The live center never touches anything.** `src/engine/lathe.ts:282` and `src/engine/tools.ts:83`. The quill can push a live center through solid work, running or not, with no event. It should stop at the face, or rub and crash.
- **Stock can be loaded with nothing in the jaws.** The stick-out may equal the length (`src/ui/StockPanel.tsx:40`), so a 3" bar can sit with 3" stick-out. Require at least about 0.375" in the jaws, or `length − stickOut ≥ chuckJawLength/2`.
- **Drag ignores `disabled` after pointerdown.** `src/ui/Handwheel.tsx:136-151` and `useHoldRepeat`'s interval keep running if the control becomes disabled mid-gesture. A disabled button doesn't get `pointerup`, so the interval can resume dispatching when it is re-enabled.

### Verified correct (no action)
- Turning to x = 0.250 gives exactly Ø0.500 in `profileSegments` and in the grader.
- Faces and shoulders snap to the 0.005" sample grid by the sample-center rule. A tool at z 1.488 faces to 1.490, and at 1.487 to 1.485. The worst-case error is ±0.0025", which is inside every tolerance.
- Parting a drilled bar frees the part when the blade reaches the bore radius: none at x = 0.130, freed at 0.124.
- Two successive partings give two pieces with the right extents. Parting at the face makes no spurious piece.
- A move clamped at the X range limit still cuts and parts correctly.
- Dial modulo math is right for negative positions.
- Every lesson and solution runs with zero heavyCut, chatter, poorFinish, wrongDirection or tool-change warnings. Every solution grades 100.

---

## 2. Content (`src/content`)

### P1-8 Unsafe practice in the turning lesson
- **Where:** `src/content/lessons/turning.ts:96-106` (zero-dial) and `:148-157` (measure).
- **What:** "Leave the tool where it is… Measure the skimmed ring with a micrometer". The spindle is still running and the tool sits against the end of the skim. Later, "Stop and measure" never stops the spindle either. The only `setSpindle off` is in the last step.
- **Fix:** After the skim, run the carriage clear toward the tailstock without touching the cross slide. Then stop the spindle, measure, zero, and restart. Do the same before the finishing pass. This is what the narration's own logic, "don't move the cross slide", wants.

### P1-9 Catching the part by hand
- **Where:** `src/content/lessons/parting.ts:110`.
- **What:** "On a real lathe you catch the piece in your hand or a cup as it comes off, with the spindle still turning."
- **Fix:** Let it drop into the chip tray, or use a part catcher or a wire hook. Never put a hand near a turning chuck.

### P1-10 Numbers that don't match the actions
- **Turn length.** `src/content/lessons/full-project.ts:71` says "We turn back 0.6 from the face, a little past the 0.75 length". The cut goes to Z 0.600, which is 0.880 from the face, and 0.6 < 0.75 anyway. It should say "back to Z 0.600, about 0.88 from the face".
- **Carriage dial.** `src/content/challenges/stepped-shaft.ts:47` says "zero it with the tool tip at the face, then stop the cut at 0.750 on the dial." The carriage dial reads 0–99 thou, and 0.750 toward the chuck reads **50** after 7½ turns (verified). The hint should say "seven and a half turns, or watch Z on the DRO".
- **Spacer hint.** `src/content/challenges/spacer-set.ts:33` has the same problem: 0.3125 is 3 turns plus 12.5 divisions, and the dial reads 87 or 88.
- **Cross-slide dial wrap.** The turning lesson says "Dial in forty thousandths from your zero" and then "Another forty thou deeper" (`src/content/lessons/turning.ts:123,132,141`). On the 50-division cross-slide dial, the readings after zeroing are 40, then **30**, **15**, **20**. Explain counting turns, or have the lesson re-zero before each pass.

### P1-11 Feeds in the solutions and lessons are 2–5× heavy per revolution
- **Where:** `src/content/helpers.ts:26-31`.

| Constant | Feed | At rpm | Per revolution |
|---|---|---|---|
| `CUT_SPEED` | 0.18 in/s | 600 | 0.018" |
| `FINISH_SPEED` | 0.12 in/s | 600 | 0.012" |
| `FACE_SPEED` | 0.16 in/s | 600 | 0.016" |
| `PART_SPEED` | 0.05 in/s | 300 | **0.010"** |
| `DRILL_SPEED` | 0.08 in/s, 1/4" drill | 600 | 0.008" |

- **Typical values:** For HSS in brass on a mini lathe, typical feeds are 0.004–0.008 roughing, 0.001–0.003 finishing, and 0.001–0.002 parting. A 1/16" blade at 0.010" per rev will dig in and jam. The "finishing" pass is coarser than a normal roughing pass, so "a slower feed gives a smoother finish" is taught with numbers that contradict it.
- **Fix:** Either slow the feeds, since the 8× speed exists for watching, or say clearly that time is compressed. Pair this with P1-3 so the engine judges in/rev.
- **Speeds are fine.** Turning 1" brass at 600 rpm is 157 sfm and parting at 300 rpm is 78 sfm. Drilling 1/4" at 600 rpm is only 39 sfm, conservative for brass but believable on a mini lathe.

### P2 content items
- **Contradictory parting advice.** `src/content/lessons/parting.ts:86` says "Ease off as you reach the center", then the caption at `:90` says "Keep the same feed".
- **Title contradicts narration.** `src/content/lessons/facing.ts:55-57` is titled "Carriage to just past the end", but the narration says "ten thou in from the end".
- **Changing speed while running.** `src/content/lessons/tour.ts:102` says "Speed is set with the spindle stopped or running steadily". The rpm steps look like belt or gear ranges, which you change stopped, and every script does stop first. Say that.
- **Park position.** `src/content/lessons/full-project.ts:80` says "Back the tool out to the end of its travel", but it parks at Ø1.400, and the travel ends at Ø2.500.
- **Hole depth.** The drilling lesson calls a 0.500 tip depth "half an inch deep" (`src/content/lessons/drilling.ts:121-122`). Drawings give hole depth to full diameter, which here is about 0.425. Worth one sentence in the "why".
- **Blade width rounding.** The analyzer prints the blade as "0.063 wide" because `fmtIn(0.0625)` rounds. Also "The part is 35 thou long" should say "35 thou too long" (`src/engine/analyzer.ts:78`).
- **Parting advice on a part with no parting (verified).** For Faced Slug, which has no parting, "Too long" says "remember the parting blade is 0.063 wide" (`src/engine/analyzer.ts:74-79`). Branch on `requireParted` and say "face off more".
- **Self-contradicting poor-finish advice.** It says "about 2½ turns of the handwheel per second, slow and steady" (`src/engine/analyzer.ts:172`). 2½ rev/s is fast. Quote a target, about 1 rev/s, instead of the limit.
- **Wrong-direction "bore" advice.** A bore that is too big gets "Center drill first… drill deep enough" (`src/engine/analyzer.ts:88-95`). Branch on under or oversize.
- **"Skipped step" on an untouched part (verified).** The final "spindle off" check is true from the start, so every earlier step counts as skipped (`src/engine/analyzer.ts:200-216`). Base `lastTrue` on persistent checks only.
- **Do-it-yourself setup accepts any stock.** The setup steps (turning, drilling, parting) check only `stockLoaded`. A 0.750 bar passes, and later checks then fail with no explanation.
- **Zeroing isn't checked.** The turning "zero-dial" step's check doesn't verify the dial was zeroed, because no StateCheck exists for it.
- **Level-2 hint is a wall of text.** For "face", it is about twelve relative moves in one paragraph. Summarize per pass, using absolute targets (see P1-12).

---

## 3. Store, UI, projects, scene

### P1-12 Relative script moves break Show me, resume, and hints (verified)
- **Where:** `src/content/helpers.ts:58-76` bakes in revolutions computed from an assumed start position. `src/projects/LessonPanel.tsx:201-224` (Show me), `src/engine/script.ts:223-238`, and `src/engine/hints.ts:129-146` (level-2 text).
- **What:** In the do-it-yourself turning lesson, a user skipped "back off" and stayed at x = 0.495. "Show me" on rough-1 drove the tool to x = 0.350, a 0.145" cut, which gave `heavyCut` and `toolBroken`. The same happens when a user pauses a watched lesson, "takes over" as the banner invites, and presses Play. Level-2 hints say "Turn the carriage handwheel 5.1 rev counter-clockwise", which is only right from z = 2.000.
- **Fix:** Add an absolute script action, for example `{type:'moveTo', axis, to, duration}`, that the player resolves into revolutions when it starts. Phrase hints as targets: "until Z reads 1.490 / X dia 0.910". As a stopgap, Show me can rewind to a snapshot of the canonical state at the step's start.

### P1-13 "Show solution" has no transport
- **Where:** `src/projects/ChallengePanel.tsx:122-131` and `src/App.tsx:187-196`.
- **What:** In challenge mode there is no play, pause or speed control. The controls stay locked behind "Pause it to take over".

| Solution | Length at 1× |
|---|---|
| Pin | 118 s |
| Stepped Shaft | 118 s |
| Bushing | 90 s |

- **After it plays:** "Check my part" grades the solution's part as a Pass, 100.
- **Fix:** Reuse the WatchView transport, or at least Pause and speed, in the challenge panel. Mark grades taken after a solution playback as "solution".

### P1-14 The Tool camera stops tracking
- **Where:** `src/scene/CameraRig.tsx:19-38`.
- **What:** `animating` goes false once the camera converges, and only a preset *change* re-arms it. With `tool` selected, the view follows the tip until it settles, then stays put while the tool moves away. Consecutive lesson steps with `camera: 'tool'` don't change the store value, so they never re-arm it.
- **Fix:** For `tool`, keep gliding while the tip moves, by re-arming when the target moves more than about 1e-3. Also have re-selecting a preset re-arm it, which the user guide already promises.

### P2 store, UI and scene items
- **Do-it-yourself view re-renders every frame.** `src/projects/LessonPanel.tsx:236` selects the whole `state`, so the view, step list and illustration re-render at 60 Hz. Select `evaluateCheck(step.check, s.state)` as a boolean instead.
- **Show me bypasses the store's player wiring.** `src/projects/LessonPanel.tsx:203-221` swaps `player` without `attachPlayer`. `playerStatus` doesn't reflect the demo, so the controls aren't locked and the user can fight it.
- **Possible double tick.** `src/App.tsx:205-209`: `sceneDown` never resets. After a Canvas error, toggling 3D off and on again remounts a working Canvas while the fallback ticker still runs, so the sim runs at 2×. Reset `sceneDown` when the 3D setting changes, or make the store ignore a second tick in the same animation frame.
- **No app-level error boundary.** `src/main.tsx` has none. A render error in any panel, such as a bad drawing or a NaN in the section view, blanks the whole app.
- **Version bump on collect.** `version` bumps when `partedPieces` changes (`src/store/useLathe.ts:112`), so Collect part rebuilds the stock geometry for nothing.
- **Dev-mode geometry churn.** Under StrictMode, `useLatheGeometry` (`src/scene/Workpiece.tsx:42-46`) disposes the memoized geometry in the double-invoked effect cleanup, then keeps rendering it. It works because three re-uploads, but it churns in dev.
- **No confirm on Try again.** "Try again" (`src/projects/ChallengePanel.tsx:51-58`) wipes the work, while Show solution asks first.
- **Accessibility.**
  - Toasts use `aria-live="polite"` even for crashes.
  - The spindle and rpm radiogroups have no arrow-key roving.
  - The handwheel slider's `aria-valuenow` is the dial collar, not the position, and only ←/→ work.
  - Alt+← is browser Back on Windows and Linux. Confirm `preventDefault` beats it, and offer PageUp/PageDown.
- **Help points at the repository.** "See docs/USER_GUIDE.md in the repository" (`src/app/HeaderMenus.tsx:45`) means nothing to app users. Link the guide or inline it.
- **Untoleranced shoulder lengths.** The drawing shows segment lengths with no tolerance (`src/ui/PartDrawing.tsx:82-83`). The grader effectively enforces about ±0.010 on shoulders through the 0.010 measuring margin. Put the tolerance on the drawing, or a general-tolerance note.
- **Cramped bottom panel at 1100 px.** The bottom tab is about 300 px tall on a 900 px screen, so the challenge grade card and mistakes need scrolling in a small box. Consider letting the grade card open in a popover or the side panel.

---

## 4. Analyzer: shoulders (P0-2, verified)
- **Where:** `src/engine/grader.ts:41-58` (measureSpan) and `src/engine/analyzer.ts:56-69`.
- **What:** This is the Stepped Shaft with both diameters perfect but the shoulder misplaced by 0.020".
  - **Shoulder at Z 0.960 (0.5 section too long):** the 0.750 window picks up 0.5" material, giving "**Undersize: Ø0.500** … 250 thou under on diameter. Material can't be added back."
  - **Shoulder at Z 1.000 (0.5 section too short):** the 0.500 window picks up the shoulder, giving "**Oversize: Ø0.750** … Take another pass of about **125 thou** on the cross-slide dial." Following that advice cuts the good 0.500 tip down to Ø0.250.
  - Both cases score 75 and fail.
- **Fix:** Measure shoulder positions from `profileSegments` and add an explicit "Shoulder at X from the face" check with a tolerance. Show that tolerance on the drawing. When a span's out-of-tolerance samples sit at one end and match the neighbouring segment's diameter, report "shoulder 0.020 too far toward the chuck" instead of under or oversize.

---

## 5. Tests

### Missing tests, each of which would have caught a finding above
- Mid-pass radial infeed of 0.010" gives no heavyCut (P0-1).
- A misplaced shoulder gives a shoulder message, not under or oversize (P0-2).
- `nextHint` on a fresh challenge returns `load-stock` (P1-6).
- Show me, and resume after manual moves, from an off-script position (P1-12).
- Action-log scaling: 50k actions, with `nextHint` and `analyze` under a budget (P1-5).
- The tailstock body crash, and the boring bar into solid stock.
- DRO dial wrap at x.5 thou.
- A short part fails only the length check.
- The challenge solution transport.

### Content test is too lenient
`src/content/__tests__/content.test.ts:55-60` only asserts that crash, rubbing and toolBroken are absent. Add heavyCut, chatter, poorFinish, wrongDirection and toolChangeWhileRunning. They are all zero today, so it costs nothing to lock in. Also consider a narration-consistency test. For example, every "z = N" or "N rpm" in `makeSolution` narration should match the actions, and lesson numbers like "0.6 from the face" should be checked against the tracked Machine positions.

### Weak tests
- `src/store/__tests__/useLathe.test.ts:174-195` asserts only that each `toastText(...)` is longer than 3 characters.
- `src/scene/__tests__/LatheScene.test.tsx:63` ("jsdom has no WebGL") tests the environment, not the code.

### End-to-end console guard is only partly effective
- Most specs run with `?no3d=1`, so only three tests execute the 3D code under the guard.
- `SceneErrorBoundary` reports through `console.warn` (`src/scene/SceneErrorBoundary.tsx:28`). A Canvas crash therefore only adds an attachment, and the WebGL test asserts the fallback count is 0 right after the canvas appears, before frames run. Treat "3D view unavailable" as an error when `no3d` is false, and wait a few frames before asserting.
- `reuseExistingServer: !CI` (`playwright.config.ts`) can run local tests against a stale `vite preview` on :4173.
- `traverse()` drives the store directly, so drag and mouse-wheel input are never exercised end to end. Neither is hold-to-repeat.

---

## 6. Docs
- **Camera glide.** `docs/USER_GUIDE.md` says "Choosing a camera preset glides back to it". Re-selecting the active preset does nothing (see DECISIONS), and the Tool preset stops following (P1-14).
- **Level-2 hints.** The guide says "Ask again for the specific numbers: dial readings, RPM and tool". Level 2 gives handwheel revolutions relative to where the solution assumes the tool is, not dial readings.
- **Heavy cuts.** The guide says "A cut that is too deep chatters". It actually raises a *heavy cut* warning and can break the tool. Chatter comes from surface speed.
- **Show solution.** The challenge section should say that "Show solution" can't be paused yet, or the UI should be fixed (P1-13).
- **Stepped Shaft row.** "0.750" × 0.500" long, then 0.500" × 0.750" long" reads as the reverse of the drawing, which has the 0.500 tip at the faced end. Say "0.500 tip, 0.750 long, at the faced end; 0.750 body, 0.500 long".
- **README** matches the UI and scripts.
