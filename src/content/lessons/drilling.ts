import type { Script, StockSpec } from '../../engine';
import { CENTER_DRILL_SPEED, DRILL_SPEED, Machine, centerSpotCheck, faceActions, facedTo, xNear, zNear } from '../helpers';

/**
 * Drilling a 1/4" hole 0.5" deep in a faced 1.000" brass bar (face at z = 1.480).
 *
 * Tailstock geometry: tailstockZ = 4.0, tip z = 4.0 - quill - toolLength.
 *  center drill (length 1.5): tip z = 2.5 - q
 *    q 0 -> 1.00 : tip z 1.500 (0.02 clear of the face)
 *    q 1.00 -> 1.12 : tip z 1.380 (0.10 into the face)
 *  1/4" drill (length 2.5): tip z = 1.5 - q
 *    q 0 -> 0.20 : tip 1.300 | 0.18 -> 0.36 : tip 1.140 | 0.34 -> 0.52 : tip 0.980
 *    final depth = 1.480 - 0.980 = 0.500. The full 1/4" diameter starts about
 *    0.075 behind the tip (118 degree point), so z >= 1.055 is full diameter.
 *
 * The carriage is parked at z = 0.25 with the tool at x = 0.7 so it stays well
 * out of the way of the quill.
 */
const m = new Machine();

const stock: StockSpec = { material: 'brass', diameter: 1.0, length: 3.0, stickOut: 1.5 };

export const drillingLesson: Script = {
  id: 'drilling',
  steps: [
    {
      id: 'setup',
      title: 'Set up and face the end',
      narration: 'Load a 1 inch brass bar, mount the turning tool and face the end, just as before.',
      why: 'A drill wants a flat, square face to start on. Facing first also gives us a clean reference for the hole depth.',
      actions: [
        { type: 'loadStock', stock },
        { type: 'selectTool', tool: 'turning' },
        { type: 'setRpm', rpm: 600 },
        { type: 'setSpindle', on: true },
        ...faceActions(m, [1.49, 1.48], 0.5), // ends x = 0.700, z = 1.480
      ],
      camera: 'tool',
      check: { kind: 'all', checks: [{ kind: 'stockLoaded' }, facedTo(1.48)] },
    },
    {
      id: 'park-carriage',
      title: 'Move the carriage out of the way',
      narration: 'Wind the carriage back toward the chuck, with the tool pulled well clear of the bar, to give the tailstock room.',
      why: 'The tailstock quill and drill come in along the center line. The carriage and tool must be clear of them. Stay at least a tenth of an inch from the jaws.',
      actions: [m.rapidZ(0.25)], // z 1.480 -> 0.250 (-12.3 rev ccw); tool at x = 0.700
      camera: 'overview',
      check: { kind: 'all', checks: [zNear(m), xNear(m)] },
    },
    {
      id: 'fit-center-drill',
      title: 'Fit the center drill',
      narration: 'Stop the spindle, put the center drill in the tailstock and run the spindle at 1200 rpm.',
      why: 'A center drill is short and stiff, so it will not wander. It is small, so it needs a high rpm to cut properly.',
      actions: [
        { type: 'setSpindle', on: false },
        { type: 'selectTailstockTool', tool: 'center-drill' },
        { type: 'setRpm', rpm: 1200 },
        { type: 'setSpindle', on: true },
        { type: 'wait', duration: 1 },
      ],
      camera: 'tailstock',
      check: { kind: 'all', checks: [{ kind: 'tailstockToolIs', tool: 'center-drill' }, { kind: 'spindle', on: true }, { kind: 'rpmAtLeast', rpm: 1200 }] },
    },
    {
      id: 'center-drill',
      title: 'Spot the center',
      narration: 'Run the quill up to the face, then feed in about a tenth of an inch and back out.',
      why: 'The center drill makes a small cone in the face. The twist drill then starts in that cone instead of skating around on the flat face.',
      actions: [
        m.rapidQ(1.0), // q 0 -> 1.000 (+10 rev cw); tip z = 2.5 - 1.0 = 1.500, clear of the 1.480 face
        m.feedQ(1.12, CENTER_DRILL_SPEED), // q 1.000 -> 1.120 (+1.2 rev cw); tip z 1.380, 0.10 into the face
        m.rapidQ(0), // q 1.120 -> 0 (-11.2 rev ccw)
      ],
      camera: 'tailstock',
      check: centerSpotCheck(1.48),
    },
    {
      id: 'fit-drill',
      title: 'Change to the 1/4" drill',
      narration: 'Stop the spindle and swap to the 1/4 inch drill. Slow down to 600 rpm and start again.',
      why: 'Bigger drills need a lower speed. The cutting edge at the outside of a larger drill moves faster for the same rpm.',
      actions: [
        { type: 'setSpindle', on: false },
        { type: 'selectTailstockTool', tool: 'drill-1/4' },
        { type: 'setRpm', rpm: 600 },
        { type: 'setSpindle', on: true },
        { type: 'wait', duration: 1 },
      ],
      camera: 'tailstock',
      check: { kind: 'all', checks: [{ kind: 'tailstockToolIs', tool: 'drill-1/4' }, { kind: 'spindle', on: true }, { kind: 'rpmAtMost', rpm: 600 }] },
    },
    {
      id: 'peck-1',
      title: 'First peck',
      narration: 'Feed the drill in about 0.2 of an inch, then back all the way out to clear the chips.',
      why: 'Pecking breaks the chips and lets coolant and air reach the cutting edge. Chips packed in a deep hole can jam and snap a drill.',
      actions: [
        m.feedQ(0.2, DRILL_SPEED), // q 0 -> 0.200 (+2 rev cw); tip z = 1.5 - 0.2 = 1.300
        m.rapidQ(0), // q 0.200 -> 0 (-2 rev ccw)
      ],
      camera: 'tailstock',
      check: { kind: 'boreAtLeast', z0: 1.4, z1: 1.45, minDiameter: 0.245 },
    },
    {
      id: 'peck-2',
      title: 'Second peck',
      narration: 'Run in quickly to just above the bottom of the hole (quill 0.180), then feed another 0.180, to quill 0.360.',
      why: 'The rapid move down the hole saves time. Slow down before the drill reaches the bottom, so you do not hit it hard.',
      actions: [
        m.rapidQ(0.18), // q 0 -> 0.180 (+1.8 rev cw); tip z 1.320, 0.02 above the hole bottom
        m.feedQ(0.36, DRILL_SPEED), // q 0.180 -> 0.360 (+1.8 rev cw); tip z 1.140
        m.rapidQ(0), // q 0.360 -> 0 (-3.6 rev ccw)
      ],
      camera: 'tailstock',
      check: { kind: 'boreAtLeast', z0: 1.24, z1: 1.45, minDiameter: 0.245 },
    },
    {
      id: 'peck-3',
      title: 'Final peck to half an inch',
      narration: 'One more peck, down to a depth of 0.500 from the face. Then back the quill all the way out.',
      why: 'Count the quill turns, or watch the quill scale: the tip of the drill is 0.500 deep when the quill has travelled 0.520. The first 0.02 was air. Drawings give a hole depth to where the full diameter ends, and the drill point is a cone, so this hole is full size about 0.425 deep.',
      actions: [
        m.rapidQ(0.34), // q 0 -> 0.340 (+3.4 rev cw); tip z 1.160, 0.02 above the hole bottom
        m.feedQ(0.52, DRILL_SPEED), // q 0.340 -> 0.520 (+1.8 rev cw); tip z 0.980, hole is 0.500 deep
        m.rapidQ(0), // q 0.520 -> 0 (-5.2 rev ccw)
      ],
      camera: 'tailstock',
      check: { kind: 'boreAtLeast', z0: 1.08, z1: 1.45, minDiameter: 0.245 },
    },
    {
      id: 'stop',
      title: 'Stop the spindle',
      narration: 'The quill is out and the hole is done. Switch the spindle off.',
      why: 'Check the hole with a pin gauge or the shank of the drill. It should be 1/4 inch and half an inch deep.',
      actions: [{ type: 'setSpindle', on: false }],
      camera: 'overview',
      check: { kind: 'all', checks: [{ kind: 'spindle', on: false }, { kind: 'boreAtLeast', z0: 1.08, z1: 1.45, minDiameter: 0.245 }] },
    },
  ],
};
