# src/art

Art assets for the lathe simulator. All SVGs are hand-written, small (under 4 KB icons, under 10 KB logo) and well-formed XML.

## Icons (`icons/`, 64x64 viewBox)

Single-color line icons: `stroke="currentColor"`, 2.5 px stroke, round joins and caps, so they inherit CSS `color` and stay legible at 24 px. Tools are drawn in side view with the headstock on the left.

| Group | Files |
|---|---|
| Toolpost tools | `tool-none`, `tool-turning` (RH tool, shank with angled tip), `tool-parting` (thin blade), `tool-boring` (boring bar) |
| Tailstock tools | `ts-none`, `ts-center-drill`, `ts-drill-small` (1/8), `ts-drill-large` (1/4), `ts-live-center` |
| Spindle | `spindle-fwd` (clockwise arrow), `spindle-rev` (counter-clockwise), `spindle-off` (power symbol) |
| Feedback | `zero` (dial zero), `hint` (lightbulb), `check`, `warning`, `crash` (starburst) |
| Machine parts (tour) | `chuck` (end view, 3 jaws), `carriage`, `tailstock`, `headstock`, `bed`, `handwheel` |
| Transport | `play`, `pause`, `step-forward`, `restart` |
| Stock | `collect-part`, `load-stock` |
| Material swatches | `material-brass`, `material-aluminum`, `material-steel`, `material-delrin` (fixed fill colors, not `currentColor`) |

## Other SVGs

- `logo.svg` (260x72): chuck mark plus "Lathe SIM" wordmark. Light text and amber accent, designed for dark backgrounds. The wordmark uses `<text>` with a system sans-serif stack.
- `handwheel-wheel.svg` (200x200): decorative handwheel with rim, three spokes, hub and a handle knob at the lower right, in neutral grey gradients. The graduated dial is drawn in code on top.

## `textures.ts`

Procedural canvas textures returning `THREE.CanvasTexture | null`: `brushedMetalTexture(size = 512, baseColor)`, `castIronTexture(size)`, `brassTexture(size)`, `aluminumTexture(size)`, `steelTexture(size)`, `delrinTexture(size)`, `materialTextureFor(material)`.

- Lazy and memoized by name and arguments. `clearTextureCache()` disposes and resets.
- Return `null` when `document` is undefined or the canvas has no 2D context (node tests, jsdom without `canvas`). Callers must handle `null` and fall back to plain colors.
- Deterministic (seeded PRNG) and tileable (`RepeatWrapping`, sRGB color space).

## `index.ts`

Exports `toolIcons`, `tailstockToolIcons`, `materialIcons`, `uiIcons`, `logo` and `handwheelWheel` as URL strings (Vite default `.svg` import), plus `ToolId`, `TailstockToolId` and `MaterialId` unions and everything from `textures.ts`. The ID unions are local copies of DESIGN.md section 6; swap them for `import type ... from '../engine'` once the engine exports them. Requires `vite/client` types for the `*.svg` module declaration.

To use an icon inline with `currentColor`, load it with `?raw` or vite-plugin-svgr; as an `<img>` URL, `currentColor` resolves to black.

## Tests

`__tests__/textures.test.ts` (vitest, jsdom) covers the no-document guard, the no-2D-context guard, memoization and cache clearing using a fake 2D context.
