import type { Script, StockSpec } from '../../engine';
import {
  CENTER_DRILL_SPEED,
  Machine,
  PARK_X,
  PART_SPEED,
  bladeZFor,
  centerSpotCheck,
  diaCheck,
  faceActions,
  facedTo,
  passRadii,
  peckActions,
  turnActions,
  xNear,
} from '../helpers';

/**
 * The brass bushing, end to end: 7/8" OD x 3/4" long with a 1/4" hole through.
 *
 * Positions (x radius, z tool tip, q quill):
 *  face:   z = 1.480 after two 0.010 passes
 *  turn:   tool radii .470 .443 .438 (0.030, 0.027, 0.005 radial), cut back to z = 0.600;
 *          Ø0.876 is the nearest dial division to the drawing's 0.875
 *  park:   x 0.600 -> 0.700 (-2.0 rev ccw), z 1.530 -> 0.250 (-12.8 rev ccw)
 *  center: q 0 -> 1.00 -> 1.12 -> 0 (tip z 1.500 -> 1.380)
 *  drill:  pecks q .25 .50 .75 .95, tip z = 4.0 - q - 2.5 = 1.25 1.00 0.75 0.55
 *          Full 1/4" diameter from z = 0.625 forward, so the hole is fully through
 *          the piece, which starts at z = 0.7305.
 *  part:   blade tip z = bladeZFor(1.48, 0.75) = 0.668: blade covers 0.668 .. 0.7305;
 *          x 0.700 -> 0.458 (+4.84 rev cw) -> 0.100 (+7.16 rev cw), 0.100 is inside
 *          the 0.125 bore radius, so the piece comes free.
 *  piece:  z 0.7305 .. 1.480 = 0.7495 long.
 */
const m = new Machine();

const stock: StockSpec = { material: 'brass', diameter: 1.0, length: 3.0, stickOut: 1.5 };
const BLADE_Z = bladeZFor(1.48, 0.75); // 0.668

export const fullProjectLesson: Script = {
  id: 'full-project',
  steps: [
    {
      id: 'setup',
      title: 'Load the bar',
      narration:
        'We are making a brass bushing: 7/8 inch outside diameter, 3/4 inch long, with a 1/4 inch hole through it. Load a 1 inch brass bar, 1.5 inches out of the chuck.',
      why: 'Plan the order of operations first: face, turn the outside while the bar is stiff, drill, then part off last.',
      actions: [
        { type: 'loadStock', stock },
        { type: 'selectTool', tool: 'turning' },
        { type: 'setRpm', rpm: 600 },
        { type: 'setSpindle', on: true },
        { type: 'wait', duration: 1 },
      ],
      camera: 'chuck',
      check: { kind: 'all', checks: [{ kind: 'stockLoaded' }, { kind: 'toolIs', tool: 'turning' }, { kind: 'spindle', on: true }] },
    },
    {
      id: 'face',
      title: 'Face the end',
      narration: 'Two ten-thou passes across the end, from outside to just past center.',
      why: 'The faced end is the reference for every length on this part.',
      actions: faceActions(m, [1.49, 1.48], 0.5), // ends x = 0.700, z = 1.480
      camera: 'tool',
      check: { kind: 'all', checks: [xNear(m), facedTo(1.48)] },
    },
    {
      id: 'turn-od',
      title: 'Turn the outside to 7/8"',
      narration:
        'Turn the diameter down to 0.875 in a few passes: two roughing passes and a light finishing pass. We turn back to Z 0.600, about 0.88 from the face. That is a little past the 0.75 length plus the blade, so the parting blade will cut inside the turned section.',
      why: 'Turn the outside while the bar is still solid and stiff. Turning a bar that already has a hole in it flexes more.',
      actions: turnActions(m, { faceZ: 1.48, endZ: 0.6, radii: passRadii(0.5, 0.4375) }), // radii .47 .443 .438
      camera: 'tool',
      check: diaCheck(0.65, 1.45, 0.875, 0.0025),
    },
    {
      id: 'clear-the-way',
      title: 'Clear the tool and carriage',
      narration:
        'Back the tool well out, to X dia 1.400, and wind the carriage toward the chuck to Z 0.250, leaving at least a tenth of an inch clear of the jaws. This makes room for the tailstock.',
      why: 'The tailstock drill comes in along the center line. The tool and carriage must be out of its way.',
      actions: [
        m.rapidX(PARK_X), // x 0.600 -> 0.700 (-2.0 rev ccw)
        m.rapidZ(0.25), // z 1.530 -> 0.250 (-12.8 rev ccw)
      ],
      camera: 'overview',
      check: xNear(m),
    },
    {
      id: 'center-drill',
      title: 'Center drill',
      narration: 'Stop, fit the center drill and run at 1200 rpm. Spot a small cone in the end of the bar.',
      why: 'The cone guides the twist drill so the hole starts exactly on center.',
      actions: [
        { type: 'setSpindle', on: false },
        { type: 'selectTailstockTool', tool: 'center-drill' },
        { type: 'setRpm', rpm: 1200 },
        { type: 'setSpindle', on: true },
        m.rapidQ(1.0), // q 0 -> 1.000 (+10 rev cw); tip z 1.500
        m.feedQ(1.12, CENTER_DRILL_SPEED), // q 1.000 -> 1.120 (+1.2 rev cw); tip z 1.380
        m.rapidQ(0), // q 1.120 -> 0 (-11.2 rev ccw)
      ],
      camera: 'tailstock',
      check: centerSpotCheck(1.48),
    },
    {
      id: 'drill-through',
      title: 'Drill the 1/4" hole all the way through',
      narration:
        'Change to the 1/4 inch drill at 600 rpm. Peck in four times, clearing the chips each time. We go to 0.95 of quill travel, so the drill is well past the length of the bushing.',
      why: 'The hole has to run the full 3/4 inch of the finished piece, and the point of a drill is cone shaped. We drill past the parting position so the hole is full diameter all the way through the piece.',
      actions: [
        { type: 'setSpindle', on: false },
        { type: 'selectTailstockTool', tool: 'drill-1/4' },
        { type: 'setRpm', rpm: 600 },
        { type: 'setSpindle', on: true },
        ...peckActions(m, [0.25, 0.5, 0.75, 0.95]), // tip z 1.25, 1.00, 0.75, 0.55; ends q = 0
      ],
      camera: 'tailstock',
      check: { kind: 'boreAtLeast', z0: 0.65, z1: 1.45, minDiameter: 0.245 },
    },
    {
      id: 'parting-tool',
      title: 'Parting tool, 300 rpm',
      narration: 'Stop the spindle, change to the parting tool and slow down to 300 rpm.',
      why: 'Parting is hard on a tool. Slow is smooth.',
      actions: [
        { type: 'setSpindle', on: false },
        { type: 'selectTool', tool: 'parting' },
        { type: 'setRpm', rpm: 300 },
        { type: 'setSpindle', on: true },
        { type: 'wait', duration: 1 },
      ],
      camera: 'tool',
      check: { kind: 'all', checks: [{ kind: 'toolIs', tool: 'parting' }, { kind: 'spindle', on: true }, { kind: 'rpmAtMost', rpm: 300 }] },
    },
    {
      id: 'part-off',
      title: 'Part it off at 3/4"',
      narration:
        'Put the blade tip 0.8125 behind the face, which is 3/4 plus the blade width. Bring it in from outside and feed steadily. Because the hole is already there, the bushing is free as soon as the blade reaches the bore.',
      why: 'The blade width comes out of the stock behind the part. Our bushing is on the tailstock side of the cut, so it keeps its full length.',
      actions: [
        m.rapidZ(BLADE_Z), // z 0.250 -> 0.668 (+4.18 rev cw); blade covers 0.668 .. 0.7305
        m.rapidX(0.458), // x 0.700 -> 0.458 (+4.84 rev cw); outside the 0.438 turned radius
        m.feedX(0.1, PART_SPEED), // x 0.458 -> 0.100 (+7.16 rev cw); inside the 0.125 bore radius
        { type: 'wait', duration: 1 },
      ],
      camera: 'tool',
      check: { kind: 'parted' },
    },
    {
      id: 'finish',
      title: 'Back out, stop, and collect',
      narration: 'The bushing drops into the chip tray. Back the blade out, stop the spindle, and once the chuck has stopped take your finished bushing.',
      why: 'The finished part should be 7/8 inch outside diameter, 3/4 inch long, with a 1/4 inch hole through. If you had a chamfer or a deburr to do, this is where you would do it.',
      actions: [
        m.rapidX(PARK_X), // x 0.100 -> 0.700 (-12.0 rev ccw)
        { type: 'setSpindle', on: false },
        { type: 'collectPart' },
      ],
      camera: 'overview',
      check: { kind: 'spindle', on: false },
    },
  ],
};
