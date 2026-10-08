import type { Script } from '../../engine';
import { Machine, xNear, zNear } from '../helpers';

/**
 * Machine tour. No stock is loaded and nothing cuts. Absolute targets (moveTo):
 *  cross slide: x 0.750 -> 0.500 (+5 rev cw) -> zero dial -> 0.600 (-2 rev ccw)
 *  carriage:    z 2.000 -> 2.500 (+5 rev cw) -> 1.000 (-15 rev ccw)
 *  quill:       q 0.000 -> 0.500 (+5 rev cw) -> 0.000 (-5 rev ccw)
 * With the toolpost at x = 0.6, z = 1.0 and the live center never reaching below
 * z = 1.5, nothing touches anything.
 */
const m = new Machine();

export const tourLesson: Script = {
  id: 'tour',
  steps: [
    {
      id: 'meet-the-machine',
      title: 'Meet the machine',
      narration:
        'This is a small bench lathe. On the left is the headstock with the spindle and chuck. The bed runs along the bottom, and the tailstock sits on the right.',
      why: 'A lathe spins the work and moves a stationary tool into it. Everything you make is a round part, cut a little at a time.',
      actions: [
        { type: 'say', text: 'The headstock holds the spindle, which spins the work.', duration: 3 },
        { type: 'say', text: 'The chuck on the spindle grips the bar with three jaws.', duration: 3 },
        { type: 'say', text: 'The bed has two ways. The carriage rides on them.', duration: 3 },
        { type: 'say', text: 'The tailstock slides on the same ways and holds drills and centers.', duration: 3 },
      ],
      camera: 'overview',
      check: { kind: 'spindle', on: false },
    },
    {
      id: 'toolpost',
      title: 'The toolpost holds the tool',
      narration:
        'The toolpost sits on the cross slide and holds the cutting tool. Let us mount the turning tool. Always change tools with the spindle stopped.',
      why: 'The tool tip is the only thing that touches the work. Its height and position decide everything about the cut.',
      actions: [
        { type: 'selectTool', tool: 'turning' },
        { type: 'say', text: 'Turning tool mounted. The spindle is off, so this is safe.', duration: 2 },
      ],
      camera: 'tool',
      check: { kind: 'toolIs', tool: 'turning' },
    },
    {
      id: 'cross-slide',
      title: 'The cross slide moves the tool in and out',
      narration:
        'Turn the cross slide handwheel clockwise and the tool moves toward the center of the work. Five turns brings the tool in a quarter of an inch.',
      why: 'One full turn moves the tool 0.050 of radius. Clockwise means toward the work, just like tightening a screw.',
      actions: [
        m.moveX(0.5, 3), // x 0.750 -> 0.500 (+5.0 rev cw)
      ],
      camera: 'tool',
      check: xNear(m), // x = 0.500
    },
    {
      id: 'zero-the-dial',
      title: 'Zero the dial',
      narration:
        'The collar on the handwheel is graduated in thousandths. You can turn the collar to zero at any point, then count from there. Now wind the tool back out two turns.',
      why: 'Each mark is 0.001 of tool travel on the radius. On the cross slide that takes 0.002 off the diameter of the part. Zeroing the dial gives you a starting point to count from.',
      actions: [
        { type: 'zeroDial', axis: 'x' }, // dial zero at x = 0.500
        m.moveX(0.6, 2), // x 0.500 -> 0.600 (-2.0 rev ccw)
      ],
      camera: 'tool',
      check: xNear(m), // x = 0.600
    },
    {
      id: 'carriage',
      title: 'The carriage moves along the work',
      narration:
        'The carriage handwheel slides the whole toolpost along the bed. Clockwise sends it toward the tailstock, counter-clockwise toward the chuck. Watch where the tool goes.',
      why: 'One turn is 0.100 of travel. That is how you set the length of a cut. Never run the tool into the chuck jaws, so we keep well clear of them.',
      actions: [
        m.moveZ(2.5, 3), // z 2.000 -> 2.500 (+5.0 rev cw, toward tailstock)
        m.moveZ(1.0, 5), // z 2.500 -> 1.000 (-15.0 rev ccw, toward chuck)
      ],
      camera: 'overview',
      check: zNear(m), // z = 1.000
    },
    {
      id: 'tailstock',
      title: 'The tailstock quill',
      narration:
        'The tailstock handwheel moves the quill, the round shaft that carries a drill or a center. Clockwise pushes it toward the chuck. We fit a live center and run it out and back.',
      why: 'Later we will use the quill to feed drills straight into the end of the bar. One turn moves it 0.100.',
      actions: [
        { type: 'selectTailstockTool', tool: 'live-center' },
        m.moveQ(0.5, 3), // q 0.000 -> 0.500 (+5.0 rev cw); live center tip at z = 4.0 - 0.5 - 2.0 = 1.5
        m.moveQ(0, 3), // q 0.500 -> 0.000 (-5.0 rev ccw)
      ],
      camera: 'tailstock',
      check: { kind: 'tailstockToolIs', tool: 'live-center' },
    },
    {
      id: 'spindle-start',
      title: 'Start the spindle',
      narration:
        'Choose a speed first, then start the spindle. At 600 rpm the chuck spins ten times a second. Always know where your hands are before you flip the switch.',
      why: 'The speeds on a small lathe are belt or gear ranges, so change speed with the spindle stopped. And never start up with the tool buried in the work.',
      actions: [
        { type: 'setRpm', rpm: 600 },
        { type: 'setSpindle', on: true },
        { type: 'wait', duration: 3 },
      ],
      camera: 'chuck',
      check: { kind: 'all', checks: [{ kind: 'spindle', on: true }, { kind: 'rpmAtLeast', rpm: 600 }] },
    },
    {
      id: 'spindle-stop',
      title: 'Stop the spindle',
      narration:
        'Switch the spindle off and let it come to a stop before you reach in. Never grab a chuck that is still turning.',
      why: 'Good habit: stop the spindle before measuring, changing a tool or touching the work.',
      actions: [
        { type: 'setSpindle', on: false },
        { type: 'say', text: 'That is the tour. Next, you will face a bar.', duration: 3 },
      ],
      camera: 'overview',
      check: { kind: 'spindle', on: false },
    },
  ],
};
