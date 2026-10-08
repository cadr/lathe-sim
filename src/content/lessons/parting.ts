import type { Script, StockSpec } from '../../engine';
import { Machine, PART_SPEED, bladeZFor, faceActions, facedTo, xNear, zNear } from '../helpers';

/**
 * Parting a 1.000" long piece from a 1.000" brass bar.
 * Face is made at z = 1.480. Blade tip is placed at z = 0.418:
 *   bladeZFor(1.48, 1.0) = 1.48 - 1.0 - 0.0625 = 0.4175 -> 0.418
 * The blade occupies z 0.418 .. 0.4805, so the piece runs 0.4805 .. 1.480
 * (0.9995 long). The blade tip is 0.418 from the jaw face, well over 0.1.
 *
 * Handwheel positions:
 *  carriage z 1.480 -> 0.418 (-10.62 rev ccw)
 *  cross    x 0.700 -> 0.520 (+3.6 rev cw), -> 0.150 (+7.4 rev cw), -> -0.010 (+3.2 rev cw)
 *  cross    x -0.010 -> 0.700 (-14.2 rev ccw)
 */
const m = new Machine();

const stock: StockSpec = { material: 'brass', diameter: 1.0, length: 3.0, stickOut: 1.5 };
const BLADE_Z = bladeZFor(1.48, 1.0); // 0.418

export const partingLesson: Script = {
  id: 'parting',
  steps: [
    {
      id: 'setup',
      title: 'Load the bar and face the end',
      narration: 'Load a 1 inch brass bar, mount the turning tool and face the end so we have a clean face to measure from.',
      why: 'We measure the length of the piece from the faced end, so the face comes first.',
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
      id: 'parting-tool',
      title: 'Swap to the parting tool and slow down',
      narration: 'Stop the spindle, change to the parting tool and slow the spindle down to 300 rpm.',
      why: 'The parting blade is thin and sticks out a long way, so it is easily upset. A lower speed keeps it from chattering, and chatter is how parting blades snap.',
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
      id: 'position-blade',
      title: 'Set the length',
      narration:
        'Move the carriage so the blade is 1 inch plus the blade width back from the face. The blade is 0.0625 wide, so the tip goes 1.0625 behind the face. The dial only has whole thousandths, so round it to 1.062: Z 0.418 on the DRO.',
      why: 'The part ends on the tailstock side of the blade, so the blade width does not come out of your part. It comes out of the bar behind it. Put the blade tip at 1.062 from the face, the nearest division to 1.0625.',
      actions: [m.rapidZ(BLADE_Z)], // z 1.480 -> 0.418 (-10.62 rev ccw)
      camera: 'tool',
      check: zNear(m, 0.005), // z = 0.418, tip 0.418 from the jaws
    },
    {
      id: 'clearance',
      title: 'Check the jaw clearance',
      narration: 'The blade is more than four tenths of an inch from the chuck jaws. Never part closer than about a tenth.',
      why: 'If the blade touches the jaws it will crash, and the blade or the chuck will be damaged. The sim leaves a safe margin, and so should you.',
      actions: [{ type: 'say', text: 'Blade tip at 0.418, well clear of the jaws.', duration: 2.5 }],
      camera: 'chuck',
      check: zNear(m, 0.005),
    },
    {
      id: 'approach',
      title: 'Bring the blade up to the bar',
      narration: 'Turn the cross slide clockwise until the blade is just outside the bar.',
      why: 'As always, stay outside the work until you are ready to cut.',
      actions: [m.rapidX(0.52)], // x 0.700 -> 0.520 (+3.6 rev cw)
      camera: 'tool',
      check: xNear(m),
    },
    {
      id: 'part-off',
      title: 'Feed in steadily',
      narration:
        'Wind the cross slide in at a slow, steady rate, about three thou per turn of the work. Do not stop in the cut, and keep the same feed all the way to the center. The piece will drop off.',
      why: 'Stopping in the cut makes the blade rub and work harden the brass. Feeding too fast jams the blade. Slow and steady wins. Here that is about a turn of the cross-slide handwheel every three seconds.',
      actions: [
        m.feedX(0.15, PART_SPEED), // x 0.520 -> 0.150 (+7.4 rev cw), about 7.4 s
        { type: 'say', text: 'Nearly through. Keep the same feed.', duration: 1 },
        m.feedX(-0.01, PART_SPEED), // x 0.150 -> -0.010 (+3.2 rev cw)
        { type: 'wait', duration: 1 },
      ],
      camera: 'tool',
      check: { kind: 'parted' },
    },
    {
      id: 'retract',
      title: 'Back the blade out',
      narration: 'Wind the blade all the way back out.',
      why: 'Back out right away. The blade is thin, and it does not like to be left in a slot.',
      actions: [m.rapidX(0.7)], // x -0.010 -> 0.700 (-14.2 rev ccw)
      camera: 'tool',
      check: { kind: 'all', checks: [xNear(m), { kind: 'parted' }] },
    },
    {
      id: 'catch',
      title: 'Stop and collect the part',
      narration: 'Let the piece drop into the chip tray. Stop the spindle, wait for the chuck to stop turning, then pick up the finished piece.',
      why: 'Never reach in to catch a part while the chuck is turning. Let it fall into the chip tray, or use a part catcher or a wire hook. Once the spindle has stopped you can take it from the tray.',
      actions: [
        { type: 'setSpindle', on: false },
        { type: 'collectPart' },
      ],
      camera: 'overview',
      check: { kind: 'spindle', on: false },
    },
  ],
};
