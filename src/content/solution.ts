/**
 * Builds the reference solution Script for a challenge from a short description of
 * the job: face, turn one or more diameters (largest first), optionally center
 * drill and drill through, optionally part off.
 *
 * Checks are chosen to stay TRUE once reached (facing, diameters over the region
 * that is not cut again later, bores, parted), because `nextHint` looks for the
 * first step whose check is false.
 */
import type { Script, ScriptAction, ScriptStep, StockSpec } from '../engine';
import {
  CENTER_DRILL_SPEED,
  Machine,
  PART_SPEED,
  PARK_X,
  bladeZFor,
  onDial,
  centerSpotCheck,
  diaCheck,
  drillTipZ,
  facedTo,
  faceActions,
  passRadii,
  peckActions,
  round,
  turnActions,
} from './helpers';

export interface SolutionConfig {
  id: string;
  stock: StockSpec;
  /** Z of the face after each facing pass (e.g. [1.49, 1.48]). */
  faceZs: number[];
  /** Diameters to turn, in order, largest first. endZ = shoulder/tool-tip z. */
  turns: { diameter: number; endZ: number }[];
  /** Quill extensions for each peck of the 1/4" drill (omit for no bore). */
  drillPecks?: number[];
  /** Finished length of the parted piece (omit to leave the work in the chuck). */
  partLength?: number;
}

const FACE_RPM = 600;
const DRILL_PARK_Z = 0.25;

export function makeSolution(cfg: SolutionConfig): Script {
  const m = new Machine();
  const stockRadius = cfg.stock.diameter / 2;
  const zf = cfg.faceZs[cfg.faceZs.length - 1];
  const steps: ScriptStep[] = [];

  steps.push({
    id: 'load-stock',
    title: 'Load the stock',
    narration: `Chuck the ${cfg.stock.diameter.toFixed(3)}" bar with ${cfg.stock.stickOut.toFixed(2)}" sticking out of the jaws and tighten it.`,
    why: 'Short stick-out keeps the bar stiff. Rule of thumb: no more than three times the diameter unless you support it.',
    actions: [{ type: 'loadStock', stock: cfg.stock }],
    camera: 'chuck',
    check: { kind: 'stockLoaded' },
  });

  steps.push({
    id: 'face',
    title: 'Face the end',
    narration: `Mount the turning tool, run at ${FACE_RPM} rpm, and face the end in ${cfg.faceZs.length} light passes down to z = ${zf.toFixed(3)}.`,
    why: 'Facing makes a clean, square reference face. Every length is measured from it.',
    actions: [
      { type: 'selectTool', tool: 'turning' },
      { type: 'setRpm', rpm: FACE_RPM },
      { type: 'setSpindle', on: true },
      ...faceActions(m, cfg.faceZs, stockRadius),
    ],
    camera: 'tool',
    check: facedTo(zf),
  });

  // Turning
  let prevRadius = stockRadius;
  cfg.turns.forEach((t, i) => {
    const target = onDial(t.diameter / 2); // on a dial division: Ø0.875 is cut to 0.876
    const radii = passRadii(prevRadius, target);
    const next = cfg.turns[i + 1];
    const regionEnd = next && next.endZ > t.endZ ? next.endZ - 0.03 : zf - 0.03;
    steps.push({
      id: `turn-${i + 1}`,
      title: `Turn to ${t.diameter.toFixed(3)} diameter`,
      narration: `Rough in passes of 0.040 or less, then take a 0.005 finishing pass until the bar measures ${t.diameter.toFixed(3)}. Cut as far as z = ${t.endZ.toFixed(3)}.`,
      why: 'Sneak up on the final size. Metal that has been cut cannot be put back.',
      actions: turnActions(m, { faceZ: zf, endZ: t.endZ, radii }),
      camera: 'tool',
      check: diaCheck(t.endZ + 0.05, regionEnd, t.diameter, 0.002),
    });
    prevRadius = target;
  });

  // Drilling
  if (cfg.drillPecks && cfg.drillPecks.length > 0) {
    if (zf + 0.01 >= drillTipZ(2.5, 0)) {
      throw new Error(`${cfg.id}: face at ${zf} is too far out for the drill to start clear of the work`);
    }
    const qApproach = round(2.48 - zf, 6); // center drill tip 0.02 clear of the face
    const qDepth = round(2.6 - zf, 6); // center drill tip 0.10 into the face
    const lastQ = cfg.drillPecks[cfg.drillPecks.length - 1];
    const finalTip = drillTipZ(2.5, lastQ);

    const centerActions: ScriptAction[] = [];
    if (m.x !== PARK_X) centerActions.push(m.rapidX(PARK_X)); // tool out of the way
    centerActions.push(m.rapidZ(DRILL_PARK_Z)); // carriage back toward the chuck
    centerActions.push({ type: 'setSpindle', on: false });
    centerActions.push({ type: 'selectTailstockTool', tool: 'center-drill' });
    centerActions.push({ type: 'setRpm', rpm: 1200 });
    centerActions.push({ type: 'setSpindle', on: true });
    centerActions.push(m.rapidQ(qApproach));
    centerActions.push(m.feedQ(qDepth, CENTER_DRILL_SPEED));
    centerActions.push(m.rapidQ(0));
    steps.push({
      id: 'center-drill',
      title: 'Center drill',
      narration: 'Slide the carriage out of the way, fit the center drill, run at 1200 rpm and spot a small cone in the face. Back it out.',
      why: 'A twist drill wanders on a flat face. The center drill makes a dimple for it to start in.',
      actions: centerActions,
      camera: 'tailstock',
      check: centerSpotCheck(zf),
    });

    const drillActions: ScriptAction[] = [];
    drillActions.push({ type: 'setSpindle', on: false });
    drillActions.push({ type: 'selectTailstockTool', tool: 'drill-1/4' });
    drillActions.push({ type: 'setRpm', rpm: 600 });
    drillActions.push({ type: 'setSpindle', on: true });
    drillActions.push(...peckActions(m, cfg.drillPecks));
    steps.push({
      id: 'drill',
      title: 'Drill the 1/4" hole',
      narration: `Fit the 1/4" drill, run at 600 rpm and peck it in, backing out between pecks to clear chips, until the tip reaches z = ${finalTip.toFixed(3)}.`,
      why: 'Pecking clears chips and keeps the drill cool. Packed chips jam the drill and can snap it.',
      actions: drillActions,
      camera: 'tailstock',
      check: { kind: 'boreAtLeast', z0: round(finalTip + 0.1, 6), z1: round(zf - 0.03, 6), minDiameter: 0.245 },
    });
  }

  // Parting
  if (cfg.partLength !== undefined) {
    const bladeZ = bladeZFor(zf, cfg.partLength);
    const atBlade = cfg.turns.filter((t) => t.endZ <= bladeZ - 0.05).pop();
    const radiusAtBlade = atBlade ? onDial(atBlade.diameter / 2) : stockRadius;
    const bored = !!cfg.drillPecks && cfg.drillPecks.length > 0;
    const partActions: ScriptAction[] = [];
    partActions.push({ type: 'setSpindle', on: false });
    partActions.push({ type: 'selectTool', tool: 'parting' });
    partActions.push({ type: 'setRpm', rpm: 300 });
    partActions.push({ type: 'setSpindle', on: true });
    partActions.push(m.rapidZ(bladeZ)); // blade sits where the piece will be partLength long
    partActions.push(m.rapidX(round(radiusAtBlade + 0.02, 4)));
    partActions.push(m.feedX(bored ? 0.1 : -0.01, PART_SPEED));
    steps.push({
      id: 'part-off',
      title: 'Part off',
      narration: `Swap to the parting blade, drop to 300 rpm, put the blade at z = ${bladeZ.toFixed(3)} and feed steadily in until the piece drops off.`,
      why: `The blade is 0.0625 wide, so its far edge lands at z = ${round(bladeZ + 0.0625, 4).toFixed(4)}, which leaves the piece ${cfg.partLength.toFixed(3)} long. Feed slowly, about three thou per turn of the work, and let the part drop into the chip tray. Never reach for it while the chuck turns.`,
      actions: partActions,
      camera: 'tool',
      check: { kind: 'parted' },
    });
  }

  // Shut down
  steps.push({
    id: 'stop',
    title: 'Back out and stop',
    narration: 'Back the tool well clear and switch the spindle off.',
    why: 'Never leave a tool touching the work or the spindle running when you walk away.',
    actions: m.x !== PARK_X
      ? [m.rapidX(PARK_X), { type: 'setSpindle', on: false }]
      : [{ type: 'setSpindle', on: false }],
    camera: 'overview',
    check: { kind: 'spindle', on: false },
  });

  return { id: cfg.id, steps };
}
