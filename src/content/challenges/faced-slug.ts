import type { Challenge, StockSpec } from '../../engine';
import { makeSolution } from '../solution';

const stock: StockSpec = { material: 'brass', diameter: 1.0, length: 3.0, stickOut: 1.5 };

/**
 * Solution: three 0.010 facing passes. The end face goes from z = 1.500 to 1.470,
 * so the protruding part is 1.470 long (target 1.465 +/- 0.025 means "at least
 * 0.010 off the end", i.e. a face at z <= 1.490).
 */
export const facedSlugChallenge: Challenge = {
  id: 'faced-slug',
  title: 'Faced Slug',
  difficulty: 1,
  description:
    'Take a 1" brass bar and face the end flat and square. Leave the diameter alone. This is the first cut on nearly every job: it gives you a clean reference face to measure from.',
  stock,
  target: {
    segments: [{ z0: 0, z1: 1.4, diameter: 1.0, tol: 0.01 }],
    overallLength: 1.465,
    lengthTol: 0.025,
  },
  solution: makeSolution({
    id: 'faced-slug-solution',
    stock,
    faceZs: [1.49, 1.48, 1.47],
    turns: [],
  }),
  hints: [
    'Mount the turning tool and start the spindle before you touch the work. Brass likes about 600 rpm at this size.',
    'With the tool outside the bar, bring the carriage in until the tool tip is level with the end of the bar, then move it another ten thou (ten divisions) toward the chuck.',
    'Keep the cross slide outside the bar, then wind it toward the center. Go a hair past center so no nub is left.',
    'Back the tool out along the face, move the carriage another ten thou toward the chuck, and face again. Two or three light passes is plenty.',
    'You only need to take off about ten to thirty thou. Do not touch the diameter, and stop the spindle when you are done.',
  ],
  requireParted: false,
  concepts: ['facing', 'approach from outside', 'going past center'],
};
