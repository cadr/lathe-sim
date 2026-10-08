// Mistake analysis: explains what went wrong from the grade, the event log and the action log.
import type { Challenge, GradeResult, LatheEvent, LatheState, Mistake, ToolId } from './types';
import { MACHINE } from './types';
import { SHOULDER_TOL, fmtIn, measure } from './grader';
import { describeAction, impossibleReason, isPersistentCheck, scriptProgress } from './hints';
import { maxFeedPerRev, recommendedRpm } from './physics';
import { PARTING_BLADE_WIDTH, TOOLS } from './tools';

const thou = (inches: number) => Math.round(Math.abs(inches) * 1000);

type EventOf<K extends LatheEvent['kind']> = Extract<LatheEvent, { kind: K }>;

function eventsOf<K extends LatheEvent['kind']>(state: LatheState, kind: K): EventOf<K>[] {
  return state.events.filter((e): e is EventOf<K> => e.kind === kind);
}

function toolName(tool: string | undefined): string {
  if (tool && tool in TOOLS) return TOOLS[tool as ToolId].name.toLowerCase();
  return tool ? tool.replace(/-/g, ' ') : 'tool';
}

function actionText(state: LatheState, index: number | undefined): string {
  if (index === undefined) return '';
  const entry = state.actions[index];
  if (!entry) return '';
  return (describeAction(entry.action) ?? '').replace(/\.$/, '');
}

const turnsOf = (inches: number) => {
  const t = Math.round((Math.abs(inches) / MACHINE.zHandwheelPitch) * 2) / 2;
  return t === 1 ? 'one turn' : `${t} turns`;
};

/** Local depth from the face over which the bore is at least minDiameter. */
function boreDepth(piece: NonNullable<ReturnType<typeof measure>['piece']>, minDiameter: number): number {
  const { wp, front, back } = piece;
  let depth = 0;
  for (let i = wp.outer.length - 1; i >= 0; i--) {
    const z0 = wp.zStart + i * wp.dz;
    if (z0 + wp.dz > front + 1e-9) continue;
    if (z0 < back - 1e-9) break;
    if (wp.outer[i] <= wp.inner[i] || 2 * wp.inner[i] < minDiameter - 1e-6) break;
    depth = front - z0;
  }
  return Math.round(depth * 1e6) / 1e6;
}

export function analyze(challenge: Challenge, state: LatheState, grade: GradeResult): Mistake[] {
  const out: Mistake[] = [];
  const m = measure(challenge, state);
  const material = m.piece?.wp.material ?? state.workpiece?.material ?? challenge.stock.material;

  // ---- part not parted
  const noStock = !state.workpiece && state.partedPieces.length === 0 && state.inventory.length === 0;
  if (noStock) {
    out.push({
      severity: 'error',
      title: 'Nothing made yet',
      detail: `There is no stock in the chuck. Load the challenge stock (${fmtIn(challenge.stock.diameter)}" ${challenge.stock.material}) first.`,
    });
  } else if (challenge.requireParted && !m.piece) {
    out.push({
      severity: 'error',
      title: 'Part not parted off',
      detail:
        'The part is still on the stock. Mount the parting tool, slow down to around 300 rpm, and feed in steadily until it drops off past center.',
    });
  }

  // ---- still on the bar, but already past saving: say so now rather than after parting
  if (!noStock && challenge.requireParted && !m.piece && state.workpiece && challenge.solution.steps.length) {
    const lost = challenge.solution.steps.find((s) => s.check && isPersistentCheck(s.check) && impossibleReason(s.check, state));
    if (lost) {
      out.push({
        severity: 'error',
        title: "This part can't come out to size",
        detail: `${impossibleReason(lost.check!, state)} That happened at the step "${lost.title}". Part it off and check it to see the rest of your grade, then press Try again for a fresh bar.`,
        stepId: lost.id,
      });
    }
  }

  // ---- dimensions
  if (m.piece) {
    const parted = m.piece.parted;
    for (const sh of m.shoulders) {
      if (sh.ok || sh.actual === null) continue;
      const a = challenge.target.segments[sh.index];
      const b = challenge.target.segments[sh.index + 1];
      const off = sh.actual - sh.expected; // > 0: the front section is too long
      const frontName = `Ø${fmtIn(a.diameter)}`;
      const fixable = !parted && off < 0 && a.diameter < b.diameter;
      out.push({
        severity: 'error',
        title: `Shoulder in the wrong place: ${fmtIn(sh.actual)} from the face (wanted ${fmtIn(sh.expected)} ±${fmtIn(SHOULDER_TOL)})`,
        detail:
          `The step from ${frontName} to Ø${fmtIn(b.diameter)} is ${thou(off)} thou too far ${off > 0 ? 'toward the chuck' : 'toward the face'}, so the ${frontName} section is ${thou(off)} thou too ${off > 0 ? 'long' : 'short'}. The diameters themselves can still be right. ` +
          `Stop the cut ${fmtIn(sh.expected)} back from the face: that is Z = face − ${fmtIn(sh.expected)} on the DRO, or zero the carriage dial with the tool at the face and wind ${turnsOf(sh.expected)} toward the chuck. ` +
          (fixable
            ? `You can still fix this one: turn the ${frontName} section another ${thou(off)} thou back.`
            : `Measure the shoulder position before the last pass next time.`),
      });
    }
    for (const s of m.segments) {
      if (s.ok) continue;
      const { target, measured } = s;
      const span = `${fmtIn(target.z0)}–${fmtIn(target.z1)}" section`;
      if (measured.min === null || measured.max === null || measured.min <= 0) {
        out.push({
          severity: 'error',
          title: `Section missing (${span})`,
          detail: `There's no full-diameter material in the ${span}. The part is too short for this section of the drawing.`,
        });
      } else if (measured.min < target.diameter - target.tol) {
        out.push({
          severity: 'error',
          title: `Undersize: Ø${fmtIn(measured.min)} (wanted Ø${fmtIn(target.diameter)} ±${fmtIn(target.tol)})`,
          detail: `The ${span} is ${thou(target.diameter - measured.min)} thou under on diameter. Material can't be added back. Sneak up on the size with light passes and measure before the last one, and remember the cross-slide dial moves the radius, so each thou on the dial takes two off the diameter.`,
        });
      } else {
        const radial = (measured.max - target.diameter) / 2;
        out.push({
          severity: 'warning',
          title: `Oversize: Ø${fmtIn(measured.max)} (wanted Ø${fmtIn(target.diameter)} ±${fmtIn(target.tol)})`,
          detail: `The ${span} is ${thou(measured.max - target.diameter)} thou over on diameter. ${parted ? 'Next time, measure before parting off and take' : 'Take'} another pass of about ${thou(radial)} thou on the cross-slide dial. That comes off the radius, so the diameter drops twice as much.`,
        });
      }
    }
    const t = challenge.target;
    const len = m.length.actual;
    if (!m.length.ok && len !== null) {
      const blade = PARTING_BLADE_WIDTH.toFixed(4);
      if (len > t.overallLength) {
        out.push({
          severity: 'warning',
          title: `Too long: ${fmtIn(len)} (wanted ${fmtIn(t.overallLength)} ±${fmtIn(t.lengthTol)})`,
          detail: challenge.requireParted
            ? `The part is ${thou(len - t.overallLength)} thou too long. Measure from the faced end, and remember the parting blade is ${blade} wide. The part ends at the blade's tailstock-side edge.`
            : `The part is ${thou(len - t.overallLength)} thou too long. Face off another ${thou(len - t.overallLength)} thou: move the carriage that much toward the chuck and take another facing pass.`,
        });
      } else {
        out.push({
          severity: 'error',
          title: `Too short: ${fmtIn(len)} (wanted ${fmtIn(t.overallLength)} ±${fmtIn(t.lengthTol)})`,
          detail: challenge.requireParted
            ? `The part is ${thou(t.overallLength - len)} thou too short. Measure from the faced end before you part off, and allow for the blade width (${blade}).`
            : `The part is ${thou(t.overallLength - len)} thou too short: too much was faced off. Take light facing passes of about ten thou and watch Z on the DRO.`,
        });
      }
    }
    if (m.bore && !m.bore.ok && t.bore) {
      const b = m.bore.measured;
      const want = `wanted Ø${fmtIn(t.bore.diameter)} × ${fmtIn(t.bore.depth)} deep`;
      const lo = t.bore.diameter - t.bore.tol;
      if (b.max === null || b.max <= 0) {
        out.push({
          severity: 'error',
          title: `No hole (${want})`,
          detail: 'Center drill first, then drill with the right size drill. Peck in and back out to clear chips.',
        });
      } else if (b.max > t.bore.diameter + t.bore.tol) {
        out.push({
          severity: 'error',
          title: `Bore too big: Ø${fmtIn(b.max)} (${want})`,
          detail: 'The hole is oversize. Check the drill size before you drill, and center drill first so the drill starts true instead of wandering.',
        });
      } else {
        // full diameter only part of the way: find how deep
        const depth = boreDepth(m.piece, lo);
        out.push({
          severity: 'error',
          title: `Hole not deep enough: full size only ${fmtIn(depth)} deep (${want})`,
          detail:
            'Drill deeper. The point of a drill is a cone, so the full diameter starts about a third of the drill diameter behind the tip. Drill past the parting position so the hole is full size all the way through.',
        });
      }
    }
  }

  // ---- crash
  const crash = eventsOf(state, 'crash')[0];
  if (crash) {
    const what = crash.what === 'chuck' ? 'the chuck jaws' : 'the tailstock';
    const who = crash.tool === 'none' ? 'The carriage, with no tool fitted,' : `The ${toolName(crash.tool)}`;
    const pos =
      crash.z !== undefined && crash.x !== undefined ? ` at Z ${fmtIn(crash.z)}, X dia ${fmtIn(2 * crash.x)}` : '';
    const act = actionText(state, crash.actionIndex);
    const advice =
      crash.what === 'chuck'
        ? 'Keep the tool body clear of the jaws. Leave at least 0.100" between the jaw face and the tool, and remember the parting blade holder is wider than the blade.'
        : 'Move the tool out of the way, or back the quill out, before the tailstock and the toolpost meet.';
    out.push({
      severity: 'error',
      title: `Crash into ${what}`,
      detail: `${who} hit ${what}${pos}${act ? ` while you did this: ${act}` : ''}. ${advice}`,
      t: crash.t,
    });
  }

  // ---- boring bar into solid metal
  const solid = eventsOf(state, 'boringSolid')[0];
  if (solid) {
    out.push({
      severity: 'error',
      title: 'Boring bar pushed into solid metal',
      detail: `At Z ${fmtIn(solid.z)}, X dia ${fmtIn(2 * solid.x)} the boring bar met metal with no hole for it to work in, and broke. A boring bar only opens up an existing hole: drill first, then bore from the inside, a little at a time.`,
      t: solid.t,
    });
  }

  // ---- broken tool / heavy cuts
  const heavy = eventsOf(state, 'heavyCut');
  const broken = eventsOf(state, 'toolBroken');
  const maxDoc = MACHINE.maxDepthOfCut[material];
  if (broken.length) {
    const worst = Math.max(0, ...heavy.map((h) => h.depth));
    out.push({
      severity: 'error',
      title: 'Broke the tool',
      detail: `A cut of about ${thou(worst)} thou was far more than this ${material} can take (${thou(maxDoc)} thou max per pass). Take several roughing passes instead of one big bite.`,
      t: broken[0].t,
    });
  } else if (heavy.length) {
    const worst = heavy.reduce((a, b) => (b.depth > a.depth ? b : a));
    out.push({
      severity: 'warning',
      title: `Heavy cut${heavy.length > 1 ? ` (×${heavy.length})` : ''}`,
      detail: `You took about ${thou(worst.depth)} thou in one pass. For ${material}, keep each pass at ${thou(worst.max)} thou or less. Rough in steps, then finish with a light pass.`,
      t: worst.t,
    });
  }

  // ---- rubbing
  const rub = eventsOf(state, 'rubbing');
  if (rub.length) {
    out.push({
      severity: 'warning',
      title: `Rubbing with the spindle stopped${rub.length > 1 ? ` (×${rub.length})` : ''}`,
      detail: `The ${toolName(rub[0].tool)} touched the work while the spindle was off. Start the spindle before the tool touches the work, and back away before you stop it.`,
      t: rub[0].t,
    });
  }

  // ---- chatter
  const chat = eventsOf(state, 'chatter');
  if (chat.length) {
    const worst = chat.reduce((a, b) => (b.sfm > a.sfm ? b : a));
    const dia = worst.diameter ?? challenge.stock.diameter;
    const suggest = recommendedRpm(material, dia, (worst.tool as ToolId | undefined) ?? 'turning');
    out.push({
      severity: 'warning',
      title: `Chatter: speed too high${chat.length > 1 ? ` (×${chat.length})` : ''}`,
      detail: `At ${worst.rpm ?? '?'} rpm on Ø${fmtIn(dia)} the surface speed was ${Math.round(worst.sfm)} sfm, too fast for ${material}${worst.tool === 'parting' ? ' when parting' : ''}. Try ${suggest} rpm.`,
      t: worst.t,
    });
  }

  // ---- poor finish
  const poor = eventsOf(state, 'poorFinish');
  if (poor.length) {
    const worst = poor.reduce((a, b) => ((b.feedPerRev ?? b.feedRate) > (a.feedPerRev ?? a.feedRate) ? b : a));
    const limit = worst.limit ?? maxFeedPerRev('turning');
    const ipr = worst.feedPerRev !== undefined && Number.isFinite(worst.feedPerRev) ? worst.feedPerRev : null;
    // a comfortable target: half the limit at 600 rpm, in carriage handwheel turns per second
    const turnsPerSec = Math.round(((limit / 2) * 600) / 60 / MACHINE.zHandwheelPitch * 10) / 10;
    out.push({
      severity: 'warning',
      title: `Poor finish: feed too fast${poor.length > 1 ? ` (×${poor.length})` : ''}`,
      detail: `You fed at ${ipr !== null ? `${ipr.toFixed(3)}" per revolution (${worst.feedRate.toFixed(2)} in/s)` : `${worst.feedRate.toFixed(2)} in/s`} while cutting. Finish depends on how far the tool moves each time the work goes round: keep it under ${limit.toFixed(3)}" per revolution for this cut. At 600 rpm aim for about ${turnsPerSec} turn${turnsPerSec === 1 ? '' : 's'} of the handwheel per second, slow and steady.`,
      t: worst.t,
    });
  }

  // ---- reverse
  const wrong = eventsOf(state, 'wrongDirection');
  if (wrong.length) {
    out.push({
      severity: 'warning',
      title: 'Cutting with the spindle in reverse',
      detail: 'Right-hand tools cut with the spindle running forward. In reverse the work spins up into the back of the tool.',
      t: wrong[0].t,
    });
  }

  // ---- unsafe changes
  const unsafe = eventsOf(state, 'toolChangeWhileRunning');
  if (unsafe.length) {
    out.push({
      severity: 'warning',
      title: `Changed tool or stock with the spindle running${unsafe.length > 1 ? ` (×${unsafe.length})` : ''}`,
      detail: 'Always stop the spindle before you change tools or touch the chuck.',
      t: unsafe[0].t,
    });
  }

  // ---- skipped solution steps: a step about the work that never happened at all (its region
  // was never cut), while a later step about the work did. Steps that were done but came out
  // wrong are reported above as dimension problems, not as skipped.
  const steps = challenge.solution.steps;
  if (steps.length) {
    const { everTrue, everAttempted } = scriptProgress(challenge.solution, state, challenge.stock);
    const persistent = (i: number) => !!steps[i].check && isPersistentCheck(steps[i].check!);
    let lastTrue = -1;
    everTrue.forEach((v, i) => {
      if (v && persistent(i)) lastTrue = i;
    });
    const skipped = steps.filter((_s, i) => persistent(i) && !everAttempted[i] && i < lastTrue).slice(0, 3);
    for (const s of skipped) {
      out.push({
        severity: 'tip',
        title: `Skipped step: ${s.title}`,
        detail: s.why ? `${s.narration} ${s.why}` : s.narration,
        stepId: s.id,
      });
    }
  }

  // ---- center drilling skipped (a drilled hole without spotting it first)
  const centerStep = steps.some((s) => s.id === 'center-drill');
  if (centerStep) {
    const used = (tool: string) => state.actions.some((a) => a.action.type === 'selectTailstockTool' && a.action.tool === tool);
    const drilled = used('drill-1/4') || used('drill-1/8');
    if (drilled && !used('center-drill') && !out.some((o) => o.stepId === 'center-drill')) {
      out.push({
        severity: 'tip',
        title: 'Skipped center drilling',
        detail: 'Spot the face with the center drill before the twist drill. A drill started on a flat face wanders off center and the hole runs out.',
        stepId: 'center-drill',
      });
    }
  }

  if (grade.passed && out.length === 0) {
    out.push({ severity: 'tip', title: 'Clean job', detail: 'In tolerance with no safety problems. Nice work.' });
  }
  return out;
}
