import type { Challenge, StockSpec } from '../../engine';
import { makeSolution } from '../solution';

const stock: StockSpec = { material: 'brass', diameter: 1.0, length: 3.0, stickOut: 1.5 };

/**
 * Solution: face to z = 1.480; turn 1.000 -> 0.876 (tool radii .47 .443 .438: the nearest
 * dial division to 0.875)
 * back to z = 0.600; park carriage at z = 0.25; center drill (quill 1.00 -> 1.12);
 * 1/4" drill pecks to quill 0.95, so the tip reaches z = 4.0 - 0.95 - 2.5 = 0.55
 * and full-diameter hole reaches z = 0.625; part with blade tip at z = 0.668:
 * piece runs z = 0.7305 .. 1.480 = 0.7495 long, bore fully through.
 */
export const bushingChallenge: Challenge = {
  id: 'bushing',
  title: 'Bushing',
  difficulty: 3,
  description:
    'A brass bushing: 7/8" outside diameter, 3/4" long, with a 1/4" hole all the way through. It pulls together facing, turning, drilling and parting in one job.',
  stock,
  target: {
    segments: [{ z0: 0, z1: 0.75, diameter: 0.875, tol: 0.005 }],
    overallLength: 0.75,
    lengthTol: 0.01,
    bore: { diameter: 0.25, depth: 0.75, tol: 0.01 },
  },
  solution: makeSolution({
    id: 'bushing-solution',
    stock,
    faceZs: [1.49, 1.48],
    turns: [{ diameter: 0.875, endZ: 0.6 }],
    drillPecks: [0.25, 0.5, 0.75, 0.95],
    partLength: 0.75,
  }),
  hints: [
    'Face the end first, then turn the outside diameter to 0.875 while the bar is still solid and stiff.',
    'Turn the diameter a little longer than 3/4" so the parting blade has room to cut inside the turned section.',
    'Before drilling, back the toolpost off and slide the carriage toward the chuck so it is out of the way of the tailstock.',
    'Center drill first, at about 1200 rpm, then change to the 1/4" drill at about 600 rpm.',
    'Peck the drill and back it out to clear chips. Go deep enough that the hole is full diameter all the way through the length of the bushing, including the part the parting blade will cut.',
    'Part off 3/4" from the face: set the blade tip 0.812 back (0.8125, to the nearest division), at about 300 rpm. Feed in until the bushing drops off.',
  ],
  requireParted: true,
  concepts: ['facing', 'turning to diameter', 'center drilling', 'drilling', 'parting'],
};
