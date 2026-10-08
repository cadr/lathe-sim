import type { Challenge, StockSpec } from '../../engine';
import { makeSolution } from '../solution';

const stock: StockSpec = { material: 'brass', diameter: 0.75, length: 3.0, stickOut: 1.0 };

/**
 * Solution: face to z = 0.980; turn 0.750 -> 0.626 (tool radii .345 .318 .313: the nearest
 * dial division to 0.625)
 * back to z = 0.600; part with the blade tip at z = 0.668. The spacer runs
 * z = 0.7305 .. 0.980 = 0.2495 thick. Blade tip is 0.668 >= 0.1 clear of the jaws.
 */
export const spacerSetChallenge: Challenge = {
  id: 'spacer-set',
  title: 'Spacer',
  difficulty: 2,
  description:
    'A thin brass spacer: 5/8" outside diameter and just 1/4" thick. Parting to a short length leaves very little room for error, so measure the blade position carefully. Make one, then you could make a set.',
  stock,
  target: {
    segments: [{ z0: 0, z1: 0.25, diameter: 0.625, tol: 0.005 }],
    overallLength: 0.25,
    lengthTol: 0.01,
  },
  solution: makeSolution({
    id: 'spacer-set-solution',
    stock,
    faceZs: [0.99, 0.98],
    turns: [{ diameter: 0.625, endZ: 0.6 }],
    partLength: 0.25,
  }),
  hints: [
    'Face the end, then turn the bar down to 0.625 diameter.',
    'Turn the diameter back a little further than 1/4", enough to cover the parting blade, so the blade cuts only in the turned section.',
    'Measure the blade position from the faced end: touch the blade to the face, then move toward the chuck. Watching Z on the DRO is easiest.',
    'The blade is 0.0625 wide, and the spacer is on the tailstock side of the cut. Set the blade tip 0.312 back from the face (0.3125, to the nearest division): that is three full turns of the carriage handwheel plus twelve divisions, or Z = face - 0.312 on the DRO.',
    'Slow down to 300 rpm for parting and feed steadily. If the blade chatters or squeals, back off and slow the spindle down rather than pushing harder.',
  ],
  requireParted: true,
  concepts: ['facing', 'turning to diameter', 'parting to length', 'measuring from the face'],
};
