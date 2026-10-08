import { LatheEngine, revolutionsFor } from '../lathe';
import type { Axis, Challenge, ScriptAction, ScriptStep, StockSpec } from '../types';

export const BRASS_1x3: StockSpec = { material: 'brass', diameter: 1.0, length: 3.0, stickOut: 2.0 };

/** Moves an axis to an absolute position in a single dispatch at the given feed (in/s). */
export function moveTo(engine: LatheEngine, axis: Axis, target: number, feed = 0.1): void {
  const s = engine.getState();
  const delta = target - s[axis];
  if (Math.abs(delta) < 1e-12) return;
  engine.dispatch({ type: 'turnHandwheel', axis, revolutions: revolutionsFor(axis, delta), dt: Math.abs(delta) / feed });
}

export function setup(stock: StockSpec = BRASS_1x3, tool: 'turning' | 'parting' = 'turning', rpm = 600): LatheEngine {
  const e = new LatheEngine();
  e.dispatch({ type: 'loadStock', stock });
  e.dispatch({ type: 'selectTool', tool });
  e.dispatch({ type: 'setRpm', rpm });
  e.dispatch({ type: 'setSpindle', on: true });
  return e;
}

/** Builds handwheel script actions from absolute targets, tracking position from the default start. */
export class ScriptBuilder {
  pos: Record<Axis, number> = { x: 0.75, z: 2.0, quill: 0 };
  to(axis: Axis, target: number, feed = 0.1): ScriptAction {
    const delta = target - this.pos[axis];
    this.pos[axis] = target;
    return {
      type: 'turnHandwheel',
      axis,
      revolutions: revolutionsFor(axis, delta),
      duration: Math.max(0.2, Math.abs(delta) / feed),
    };
  }
}

/** Faced and turned to 0.500 x 1.000, parted at z = 0.9275 (back face at 0.990). */
export function pinSteps(): ScriptStep[] {
  const b = new ScriptBuilder();
  const faceMoves = [b.to('z', 1.99), b.to('x', -0.02), b.to('x', 0.6)];
  const roughPasses: ScriptAction[] = [];
  for (const x of [0.45, 0.4, 0.35, 0.3, 0.26]) {
    roughPasses.push(b.to('z', 2.1), b.to('x', x), b.to('z', 0.85, 0.08), b.to('x', 0.6));
  }
  return [
    {
      id: 'load',
      title: 'Load the stock',
      narration: 'Chuck the brass with two inches sticking out.',
      actions: [{ type: 'loadStock', stock: BRASS_1x3 }],
      check: { kind: 'stockLoaded' },
    },
    {
      id: 'setup',
      title: 'Mount the turning tool',
      narration: 'Turning tool in the toolpost, 600 rpm.',
      actions: [
        { type: 'selectTool', tool: 'turning' },
        { type: 'setRpm', rpm: 600 },
      ],
      check: { kind: 'all', checks: [{ kind: 'toolIs', tool: 'turning' }, { kind: 'rpmAtLeast', rpm: 600 }] },
    },
    {
      id: 'spindle',
      title: 'Start the spindle',
      narration: 'Forward.',
      actions: [{ type: 'setSpindle', on: true }],
      check: { kind: 'spindle', on: true },
    },
    {
      id: 'face',
      title: 'Face the end',
      narration: 'Take ten thou off the end, feeding past center.',
      actions: faceMoves,
      check: { kind: 'facedTo', zMax: 1.995 },
    },
    {
      id: 'rough',
      title: 'Rough turn',
      narration: 'Rough down to about 0.520.',
      why: 'Leave a little for a finishing pass.',
      actions: roughPasses,
      check: { kind: 'diameterBetween', z0: 0.9, z1: 1.98, min: 0.515, max: 0.53 },
    },
    {
      id: 'finish',
      title: 'Finish pass',
      narration: 'Ten thou on the diameter to size.',
      actions: [b.to('z', 2.1), b.to('x', 0.25), b.to('z', 0.85, 0.08), b.to('x', 0.6), b.to('z', 2.1)],
      check: { kind: 'diameterBetween', z0: 0.9, z1: 1.98, min: 0.495, max: 0.505 },
    },
    {
      id: 'part',
      title: 'Part off',
      narration: 'Parting tool, 300 rpm, feed in steadily.',
      actions: [
        { type: 'setSpindle', on: false },
        { type: 'selectTool', tool: 'parting' },
        { type: 'setRpm', rpm: 300 },
        { type: 'setSpindle', on: true },
        b.to('z', 0.9275),
        b.to('x', -0.02, 0.015),
        b.to('x', 0.75),
      ],
      check: { kind: 'parted' },
    },
    {
      id: 'stop',
      title: 'Stop the spindle',
      narration: 'All done.',
      actions: [{ type: 'setSpindle', on: false }],
      check: { kind: 'spindle', on: false },
    },
  ];
}

export function pinChallenge(): Challenge {
  return {
    id: 'test-pin',
    title: 'Test pin',
    difficulty: 1,
    description: 'A 0.500 x 1.000 pin.',
    stock: BRASS_1x3,
    target: { segments: [{ z0: 0, z1: 1.0, diameter: 0.5, tol: 0.005 }], overallLength: 1.0, lengthTol: 0.01 },
    solution: { id: 'test-pin-solution', steps: pinSteps() },
    hints: ['Face first.', 'Turn to size.', 'Part off.'],
    requireParted: true,
    concepts: ['facing', 'turning', 'parting'],
  };
}

/** Makes the pin by direct dispatches (5 roughing passes straight to 0.250 radius, no 0.520 stop). */
export function makePinDirect(): LatheEngine {
  const e = setup();
  moveTo(e, 'z', 1.99);
  moveTo(e, 'x', -0.02);
  moveTo(e, 'x', 0.6);
  for (const x of [0.45, 0.4, 0.35, 0.3, 0.25]) {
    moveTo(e, 'z', 2.1);
    moveTo(e, 'x', x);
    moveTo(e, 'z', 0.85, 0.08);
    moveTo(e, 'x', 0.6);
  }
  moveTo(e, 'z', 2.1);
  e.dispatch({ type: 'setSpindle', on: false });
  e.dispatch({ type: 'selectTool', tool: 'parting' });
  e.dispatch({ type: 'setRpm', rpm: 300 });
  e.dispatch({ type: 'setSpindle', on: true });
  moveTo(e, 'z', 0.9275);
  moveTo(e, 'x', -0.02, 0.015);
  moveTo(e, 'x', 0.75);
  e.dispatch({ type: 'setSpindle', on: false });
  return e;
}
