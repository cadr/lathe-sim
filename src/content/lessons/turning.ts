import type { Script, ScriptAction, StockSpec } from '../../engine';
import {
  CUT_SPEED,
  FINISH_SPEED,
  Machine,
  POSITION_TOL,
  RETRACT_X,
  diaCheck,
  diaRange,
  faceActions,
  facedTo,
  xNear,
  zNear,
} from '../helpers';

/**
 * Turn a 1.000" brass bar down to 0.750" over a 1.000" length.
 * Face is made at z = 1.480 (two passes). The shoulder sits 1.000 back: z = 0.480.
 * Tool starts each pass at z = 1.530 (0.05 beyond the end), never closer than 0.48 to
 * the jaws (jaw face is z = 0).
 *
 * Safe measuring: after the skim the carriage runs back out past the end with the cross slide
 * untouched (the tool rides over the ring it just cut, so nothing is removed), the spindle is
 * stopped, and only then do we measure and zero. The spindle is stopped again to measure
 * before the finishing pass.
 *
 * Positions (x radius, z tip) and cross-slide dial readings after zeroing at x = 0.495:
 *  skim:    x 0.495, z 1.530 -> 1.330, back to 1.530   dial 0
 *  rough 1: x .455 (Ø0.910)  40 thou in  -> dial 40
 *  rough 2: x .415 (Ø0.830)  80 thou in  -> 1 turn + 30 -> dial 30
 *  rough 3: x .380 (Ø0.760) 115 thou in  -> 2 turns + 15 -> dial 15
 *  finish:  x .375 (Ø0.750) 120 thou in  -> 2 turns + 20 -> dial 20
 * The cross-slide dial has 50 divisions (0.050 a turn), which is why the readings wrap.
 * Roughing checks accept anything from the finished size up to the pass size, so a pass
 * that went a little deep never strands you; only going under 0.750 is a real mistake.
 */
const m = new Machine();

const stock: StockSpec = { material: 'brass', diameter: 1.0, length: 3.0, stickOut: 1.5 };

const FACE_Z = 1.48;
const START_Z = 1.53; // 0.05 past the faced end, tool clear of the work
const SHOULDER_Z = 0.48; // 1.000 back from the face
const SKIM_X = 0.495;
/** region checked for diameters: inside the turned length, away from the shoulder and the end */
const Z0 = 0.5;
const Z1 = 1.45;
/** the finished size and its tolerance */
const FINAL = 0.75;
const FINAL_TOL = 0.0025;

/** One turning pass at radius r: in, cut to the shoulder, out, back to start. */
function pass(r: number, speed: number): ScriptAction[] {
  return [
    m.rapidX(r), // in to depth, beyond the end of the work
    m.feedZ(SHOULDER_Z, speed), // z 1.530 -> 0.480 (10.5 rev ccw)
    m.rapidX(RETRACT_X), // out to x = 0.600
    m.rapidZ(START_Z), // back to z = 1.530 (10.5 rev cw)
  ];
}

/** A roughing pass is good once the bar is no bigger than the pass size and not under the final size. */
const roughCheck = (diameter: number) => diaRange(Z0, Z1, FINAL + FINAL_TOL, diameter + 0.003);

export const turningLesson: Script = {
  id: 'turning',
  steps: [
    {
      id: 'setup',
      title: 'Set up',
      narration: 'Chuck a 1 inch brass bar with 1.5 inches showing, mount the turning tool and start the spindle at 600 rpm.',
      why: 'Same setup as the facing lesson. At 600 rpm a 1 inch brass bar runs at about 157 surface feet per minute, a comfortable speed.',
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
      title: 'Face the end first',
      narration: 'Take two ten-thou facing passes, to Z 1.490 and then Z 1.480, so we have a clean face to measure from.',
      why: 'We always face first. Every length we cut from here is measured back from this face.',
      actions: faceActions(m, [1.49, FACE_Z], 0.5), // ends x = 0.700, z = 1.480
      camera: 'tool',
      check: { kind: 'all', checks: [xNear(m), facedTo(FACE_Z)] },
    },
    {
      id: 'start-position',
      title: 'Carriage out past the end',
      narration: 'Wind the carriage back out so the tool tip is a little past the end of the bar, at Z 1.530.',
      why: 'We start each turning pass beyond the end so we can set the depth of cut with the tool clear of the work.',
      actions: [m.rapidZ(START_Z)], // z 1.480 -> 1.530 (0.5 rev cw)
      camera: 'tool',
      check: zNear(m),
    },
    {
      id: 'skim-cut',
      title: 'Take a light skim cut',
      narration:
        'Bring the tool in to a radius of 0.495 (X dia 0.990), then cut a short stretch toward the chuck, to Z 1.330. This leaves a small clean ring we can measure.',
      why: 'We do not know exactly where the tool is touching the bar. A light skim gives us a true surface to measure and tells us the real size of the bar.',
      actions: [
        m.rapidX(SKIM_X), // x 0.700 -> 0.495 (4.1 rev cw); 0.005 radial depth
        m.feedZ(1.33, CUT_SPEED), // z 1.530 -> 1.330 (2.0 rev ccw); skim on z 1.33 .. 1.48
      ],
      camera: 'tool',
      check: { kind: 'all', checks: [xNear(m), zNear(m)] },
    },
    {
      id: 'clear-to-measure',
      title: 'Run clear and stop',
      narration:
        'Leave the cross slide alone. Wind the carriage back out past the end of the bar, to Z 1.530, then stop the spindle.',
      why: 'Never measure with the work turning or with the tool against it. Running out along the ring you just cut removes nothing, and keeping the cross slide where it was means the dial still knows the size of that ring.',
      actions: [
        m.rapidZ(START_Z), // z 1.330 -> 1.530 (2.0 rev cw), x stays 0.495
        { type: 'setSpindle', on: false },
      ],
      camera: 'tool',
      check: { kind: 'all', checks: [xNear(m), zNear(m), { kind: 'spindle', on: false }] },
    },
    {
      id: 'zero-dial',
      title: 'Measure and zero the dial',
      narration:
        'With the spindle stopped, measure the skimmed ring with a micrometer. In this demo it reads 0.990; yours reads whatever X dia your skim left, about 0.990. Now zero the cross slide dial. Zero on the dial now means the diameter you just measured.',
      why: 'The dial reads tool travel on the radius, so every thousandth on the dial changes the diameter by two thousandths. Zeroing at a known size lets you count down to the size you want.',
      actions: [
        { type: 'say', text: 'In this demo the micrometer reads 0.990: the bar diameter at this ring.', duration: 3 },
        { type: 'zeroDial', axis: 'x' }, // dial zero at x = 0.495
        { type: 'wait', duration: 1 },
      ],
      camera: 'tool',
      check: { kind: 'dialZeroBetween', axis: 'x', min: SKIM_X - POSITION_TOL, max: SKIM_X + POSITION_TOL },
    },
    {
      id: 'rough-1',
      title: 'Roughing pass one',
      narration:
        'Start the spindle. Bring the cross slide in to X dia 0.910 and cut 1 inch along, to Z 0.480. With a skim of 0.990 that is forty thousandths from your zero, so the dial reads 40: 0.040 off the radius, 0.080 off the diameter. If your skim came out a little different, go by the moves listed below: they give the dial reading from your own zero.',
      why: 'Roughing removes metal fast. Brass can take 0.040 to 0.060 of depth per pass, but we leave a safe margin so the tool does not dig in or chatter.',
      actions: [{ type: 'setSpindle', on: true }, ...pass(0.455, CUT_SPEED)], // x .455 : dia 0.910
      camera: 'tool',
      check: roughCheck(0.91),
    },
    {
      id: 'rough-2',
      title: 'Roughing pass two',
      narration:
        'Another forty thou deeper, to X dia 0.830 on the DRO. From a 0.990 skim that is 80 thou from zero, and the cross slide dial only has 50 marks, so it is one full turn past zero and on to 30. Count the turn, or watch the DRO. Cut to the same stopping place.',
      why: 'Stop each pass at the same place, Z 0.480, so all the passes end at the same shoulder.',
      actions: pass(0.415, CUT_SPEED), // x .415 : dia 0.830, dial 30
      camera: 'tool',
      check: roughCheck(0.83),
    },
    {
      id: 'rough-3',
      title: 'Roughing pass three',
      narration:
        'This one is a little lighter, thirty-five thou, to X dia 0.760, which leaves five thou for the finishing pass. From a 0.990 skim that is 115 thou from zero: two full turns and on to 15.',
      why: 'We leave exactly 0.005 on the radius, ten thou on the diameter, for a clean finishing cut.',
      actions: pass(0.38, CUT_SPEED), // x .380 : dia 0.760, dial 15
      camera: 'tool',
      check: roughCheck(0.76),
    },
    {
      id: 'measure',
      title: 'Stop and measure before the last cut',
      narration:
        'The tool is out past the end of the bar. Stop the spindle and measure. In this demo the micrometer says 0.760; yours should read about the same. We need 0.750, so whatever it reads, the finishing pass takes the rest: here ten thou off the diameter, five on the radius.',
      why: 'Sneak up on the size: measure, then take the last cut. Material cannot be put back, so never guess on the last pass. Always stop the spindle to measure.',
      actions: [
        { type: 'setSpindle', on: false },
        { type: 'say', text: 'In this demo the micrometer reads 0.760. We want 0.750: five thou deeper on the dial.', duration: 4 },
      ],
      camera: 'chuck',
      check: { kind: 'all', checks: [{ kind: 'spindle', on: false }, roughCheck(0.76)] },
    },
    {
      id: 'finish-pass',
      title: 'Finishing pass',
      narration:
        'Start the spindle, bring the cross slide in to X dia 0.750 (from a 0.990 skim the dial reads 20, two full turns and 20), and take one slow, steady pass. A slower feed gives a smoother finish.',
      why: 'Feeding slower lets the tool shear a thin chip cleanly. The roughing passes fed about eight thou per turn of the work; this one feeds about three. This is where the surface finish comes from.',
      actions: [{ type: 'setSpindle', on: true }, ...pass(0.375, FINISH_SPEED)], // x .375 : dia 0.750, dial 20
      camera: 'tool',
      check: diaCheck(Z0, Z1, FINAL, FINAL_TOL),
    },
    {
      id: 'stop',
      title: 'Back out and stop',
      narration: 'Move the tool out of the way and stop the spindle. The bar is 0.750 for the first inch from the face, with a square shoulder.',
      why: 'The shoulder is square because the turning tool cuts a flat step where it stops.',
      actions: [
        m.rapidX(0.7), // x 0.600 -> 0.700 (2.0 rev ccw)
        { type: 'setSpindle', on: false },
      ],
      camera: 'overview',
      check: { kind: 'all', checks: [{ kind: 'spindle', on: false }, diaCheck(Z0, Z1, FINAL, FINAL_TOL)] },
    },
  ],
};
