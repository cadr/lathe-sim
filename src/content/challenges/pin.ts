import type { Challenge, StockSpec } from '../../engine';
import { makeSolution } from '../solution';

const stock: StockSpec = { material: 'brass', diameter: 1.0, length: 3.0, stickOut: 1.5 };

/**
 * Solution: face two passes (end face at z = 1.480), turn 1.000 -> 0.500 with
 * passes stepping the tool radius 0.500 -> .46 .42 .38 .34 .30 .275 .255 .250
 * from the end back to z = 0.350, then part with the blade tip at z = 0.418.
 * Blade covers [0.418, 0.4805], so the pin runs z = 0.4805 .. 1.480 = 0.9995 long.
 */
export const pinChallenge: Challenge = {
  id: 'pin',
  title: 'Pin',
  difficulty: 1,
  description:
    'Make a 1/2" diameter brass pin, 1" long. Face the end, turn the diameter down, then part the pin off the bar. A good first part: three operations and every one has to be right.',
  stock,
  target: {
    segments: [{ z0: 0, z1: 1.0, diameter: 0.5, tol: 0.005 }],
    overallLength: 1.0,
    lengthTol: 0.01,
  },
  solution: makeSolution({
    id: 'pin-solution',
    stock,
    faceZs: [1.49, 1.48],
    turns: [{ diameter: 0.5, endZ: 0.35 }],
    partLength: 1.0,
  }),
  hints: [
    'Start by facing the end so you have a flat reference to measure from.',
    'Turn the whole 1" length of pin down to 0.500 diameter, and keep going a little past the length so the parting blade has room.',
    'Take roughing passes of 0.040 or less. Remember the dial is radius, so a 0.040 cut on the dial takes 0.080 off the diameter.',
    'Leave about 0.005 on the radius for a finishing pass, then sneak up to exactly 0.500.',
    'To part, swap to the parting blade and drop to about 300 rpm. Place the blade 1.062 back from the face: 1" of pin plus the 0.0625 blade width, to the nearest division.',
    'Stay at least 0.1" away from the chuck jaws. Feed the blade in steadily until the pin drops off.',
  ],
  requireParted: true,
  concepts: ['facing', 'turning to diameter', 'parting'],
};
