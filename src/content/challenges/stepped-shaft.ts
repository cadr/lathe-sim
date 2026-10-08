import type { Challenge, StockSpec } from '../../engine';
import { makeSolution } from '../solution';

const stock: StockSpec = { material: 'brass', diameter: 1.0, length: 3.0, stickOut: 1.75 };

/**
 * Solution: face two passes (end face at z = 1.730). Turn 0.750 from the end back
 * to z = 0.350 (past the parting slot), then turn 0.500 from the end back to a
 * shoulder at z = 0.980, which is 0.750 from the face. Part with the blade tip at
 * z = 0.418: the piece runs z = 0.4805 .. 1.730 = 1.2495 long, the 0.750 body
 * is z = 0.4805 .. 0.980 (0.4995 long) and the 0.500 tip is z = 0.980 .. 1.730.
 *
 * Target z is measured from the FACED end (the grader's local z = front - machine z),
 * so the 0.500 tip is the first segment (0 .. 0.750) and the 0.750 body follows
 * (0.750 .. 1.250). A plain turning tool can only make the small diameter at the
 * free end, which is why DESIGN.md section 10 lists the two sections in the opposite order.
 */
export const steppedShaftChallenge: Challenge = {
  id: 'stepped-shaft',
  title: 'Stepped Shaft',
  difficulty: 2,
  description:
    'A shaft with two diameters, 1-1/4" overall, parted off: a 1/2" diameter tip 3/4" long at the faced end, and a 3/4" diameter body 1/2" long behind it. Turn the big diameter first, then step down to make the shoulder.',
  stock,
  target: {
    segments: [
      { z0: 0, z1: 0.75, diameter: 0.5, tol: 0.005 },
      { z0: 0.75, z1: 1.25, diameter: 0.75, tol: 0.005 },
    ],
    overallLength: 1.25,
    lengthTol: 0.01,
  },
  solution: makeSolution({
    id: 'stepped-shaft-solution',
    stock,
    faceZs: [1.74, 1.73],
    turns: [
      { diameter: 0.75, endZ: 0.35 },
      { diameter: 0.5, endZ: 0.98 },
    ],
    partLength: 1.25,
  }),
  hints: [
    'Face the end first. All lengths are measured from that face.',
    'Turn the 3/4" diameter first, along the whole length you need plus a little extra for the parting blade.',
    'Then turn the 1/2" diameter from the end back to the shoulder. The shoulder sits 0.750 back from the finished face.',
    'Use the carriage to measure: with the tool tip at the face, 0.750 toward the chuck is seven and a half turns of the carriage handwheel (the dial only reads 0-99, so it shows 50 at the stop). Easier: watch Z on the DRO and stop at Z = face - 0.750.',
    'Rough with passes of 0.040 or less and leave 0.005 for a finishing pass on each diameter.',
    'Part off 1.25" from the face. The blade is 0.0625 wide, so set the tool tip 1.312 back from the face (1.3125, to the nearest division). Slow down to 300 rpm and keep clear of the jaws.',
  ],
  requireParted: true,
  concepts: ['facing', 'turning to diameter', 'shoulders', 'measuring from the face', 'parting'],
};
