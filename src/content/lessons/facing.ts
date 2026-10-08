import type { Script, StockSpec } from '../../engine';
import { FACE_SPEED, Machine, facedTo, xNear, zNear } from '../helpers';

/**
 * Facing a 1.000" brass bar, stick-out 1.5 (end face at z = 1.500).
 * Absolute targets (moveTo), with the turns they take from the canonical path:
 *  carriage  to Z 1.490   (from 2.000: 5.1 rev ccw)   tool footprint z in [1.49, 1.74]
 *  cross     to x 0.550   (from 0.750: 4.0 rev cw)    outside the 0.500 radius
 *  cross     to x -0.010  (11.2 rev cw)               cuts the end, past center
 *  cross     to x 0.700   (14.2 rev ccw)              clear
 *  carriage  to Z 1.480   (0.1 rev ccw)               ten thou more off
 *  then the same x moves again.
 * Position checks are +/-0.003, tighter than the 0.010 carriage move between passes, so
 * "take another ten thou" can't already be satisfied when you arrive at it, and any position
 * inside a window still faces to within the next step's facedTo check.
 */
const m = new Machine();

const stock: StockSpec = { material: 'brass', diameter: 1.0, length: 3.0, stickOut: 1.5 };

export const facingLesson: Script = {
  id: 'facing',
  steps: [
    {
      id: 'load-stock',
      title: 'Load the bar',
      narration:
        'Put a 1 inch brass bar in the chuck with about an inch and a half sticking out, and tighten the jaws.',
      why: 'Keep the stick-out short so the bar stays stiff. A long overhang flexes away from the tool and chatters.',
      actions: [{ type: 'loadStock', stock }],
      camera: 'chuck',
      check: { kind: 'stockLoaded' },
    },
    {
      id: 'mount-tool',
      title: 'Mount the turning tool',
      narration: 'Put the turning tool in the toolpost. The spindle is off while we change the tool.',
      why: 'The turning tool can cut toward the chuck for turning, or across the end for facing.',
      actions: [{ type: 'selectTool', tool: 'turning' }],
      camera: 'tool',
      check: { kind: 'toolIs', tool: 'turning' },
    },
    {
      id: 'set-speed',
      title: 'Pick a speed and start the spindle',
      narration: 'Dial in 600 rpm and start the spindle. That is a good speed for a 1 inch brass bar.',
      why: 'Surface speed depends on diameter and rpm. Brass is happy up to about 300 surface feet per minute, and 600 rpm on one inch is only about 157.',
      actions: [
        { type: 'setRpm', rpm: 600 },
        { type: 'setSpindle', on: true },
        { type: 'wait', duration: 1.5 },
      ],
      camera: 'chuck',
      check: { kind: 'all', checks: [{ kind: 'spindle', on: true }, { kind: 'rpmAtLeast', rpm: 600 }] },
    },
    {
      id: 'position-carriage',
      title: 'Carriage to ten thou in from the end',
      narration:
        'Wind the carriage toward the chuck until the tool tip is ten thou in from the end of the bar, at Z 1.490 on the DRO. That ten thou is how much we will cut off.',
      why: 'The tool is still well outside the bar, so nothing is touching yet. We set the depth of cut with the carriage when we face.',
      actions: [m.rapidZ(1.49)], // z 2.000 -> 1.490 (-5.1 rev ccw)
      camera: 'tool',
      check: zNear(m), // z = 1.490
    },
    {
      id: 'approach-outside',
      title: 'Bring the tool up from outside',
      narration:
        'Turn the cross slide clockwise to bring the tool close to the bar, but stay outside the surface.',
      why: 'Always approach from outside the work. Coming in toward a spinning bar from a safe distance means you control exactly where the first touch happens.',
      actions: [m.rapidX(0.55)], // x 0.700 -> 0.550 (+3.0 rev cw); bar radius is 0.500
      camera: 'tool',
      check: xNear(m), // x = 0.550
    },
    {
      id: 'face-pass-1',
      title: 'Face across to the center',
      narration:
        'Now wind the cross slide in at a steady speed. The tool shaves a thin layer off the end. Keep going a little past center so no nub is left standing.',
      why: 'At the center the tool is cutting at almost zero surface speed. Going just past (here to minus ten thou) shears off the last little pip.',
      actions: [m.feedX(-0.01, FACE_SPEED)], // x 0.550 -> -0.010 (+11.2 rev cw)
      camera: 'tool',
      check: { kind: 'all', checks: [xNear(m), facedTo(1.49)] }, // x = -0.010, face at 1.490
    },
    {
      id: 'retract-1',
      title: 'Back the tool out',
      narration: 'Turn the cross slide counter-clockwise to bring the tool back out. Do not move the carriage yet.',
      why: 'Backing out along the face you just cut does not touch the work. Moving the carriage with the tool still against the face would score a ring in it.',
      actions: [m.rapidX(0.7)], // x -0.010 -> 0.700 (-14.2 rev ccw)
      camera: 'tool',
      check: xNear(m), // x = 0.700
    },
    {
      id: 'advance-carriage',
      title: 'Take another ten thou',
      narration: 'Wind the carriage another tenth of a turn toward the chuck, to Z 1.480. That is ten more thousandths.',
      why: 'Light passes leave a better finish and a gentler cut. The carriage handwheel is 0.100 per turn, so a tenth of a turn is exactly 0.010.',
      actions: [m.rapidZ(1.48)], // z 1.490 -> 1.480 (-0.1 rev ccw)
      camera: 'tool',
      check: zNear(m), // z = 1.480
    },
    {
      id: 'face-pass-2',
      title: 'Face again',
      narration: 'Same as before: bring the tool in from outside, then feed across past center.',
      why: 'Repeat until the whole face is clean. Two light passes is plenty on a bar that was cut off with a saw.',
      actions: [
        m.rapidX(0.55), // x 0.700 -> 0.550 (+3.0 rev cw)
        m.feedX(-0.01, FACE_SPEED), // x 0.550 -> -0.010 (+11.2 rev cw), face now at 1.480
      ],
      camera: 'tool',
      check: { kind: 'all', checks: [xNear(m), facedTo(1.48)] },
    },
    {
      id: 'retract-2',
      title: 'Back out and look at your work',
      narration: 'Back the tool out. The end of the bar should now be flat and bright.',
      why: 'The faced end is now your reference surface. From here on, every length gets measured from this face.',
      actions: [m.rapidX(0.7)], // x -0.010 -> 0.700 (-14.2 rev ccw)
      camera: 'chuck',
      check: { kind: 'all', checks: [xNear(m), facedTo(1.48)] },
    },
    {
      id: 'stop',
      title: 'Stop the spindle',
      narration: 'Switch the spindle off. That is facing: tool in from outside, across past center, out, advance, repeat.',
      why: 'Never leave the spindle running while you inspect the part or reach for the chuck.',
      actions: [{ type: 'setSpindle', on: false }],
      camera: 'overview',
      check: { kind: 'all', checks: [{ kind: 'spindle', on: false }, facedTo(1.48)] },
    },
  ],
};
