// What to tell the user when a paused demo resumes after they changed the machine.
import { facePosition, impossibleReason, type LatheState, type ScriptStep } from '../engine';

/** The parts of the machine a resumed demo cares about, as they were when it was paused. */
export interface PauseSnapshot {
  x: number;
  z: number;
  quill: number;
  workpiece: LatheState['workpiece'];
  parted: number;
  tool: LatheState['tool'];
  tailstockTool: LatheState['tailstockTool'];
}

export function pauseSnapshot(s: LatheState): PauseSnapshot {
  return {
    x: s.x,
    z: s.z,
    quill: s.quill,
    workpiece: s.workpiece,
    parted: s.partedPieces.length + s.inventory.length,
    tool: s.tool,
    tailstockTool: s.tailstockTool,
  };
}

const f3 = (v: number) => v.toFixed(3);
/** Moves smaller than this (inches) are dial snapping, not the user's doing. */
const MOVE_TOL = 5e-4;

function list(items: string[]): string {
  return items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/**
 * A notice for resuming a demo, or null when nothing the user did while it was paused matters.
 * The demo always carries on from where the machine is, so the notice says what changed (where the
 * face is now, which axes moved) and whether the current step can still come out as narrated.
 */
export function resumeNotice(before: PauseSnapshot, s: LatheState, step: ScriptStep | null): string | null {
  const moved: string[] = [];
  if (Math.abs(s.z - before.z) > MOVE_TOL) moved.push('carriage');
  if (Math.abs(s.x - before.x) > MOVE_TOL) moved.push('cross slide');
  if (Math.abs(s.quill - before.quill) > MOVE_TOL) moved.push('tailstock quill');
  const workChanged = s.workpiece !== before.workpiece || s.partedPieces.length + s.inventory.length !== before.parted;
  const toolChanged = s.tool !== before.tool || s.tailstockTool !== before.tailstockTool;
  if (!moved.length && !workChanged && !toolChanged) return null;

  const did: string[] = [];
  if (moved.length) did.push(`moved the ${list(moved)}`);
  if (toolChanged) did.push('changed the tool');
  if (workChanged) did.push('changed the work');
  let text = `You ${list(did)} while the demo was paused. It carries on from here`;
  const faceNow = s.workpiece ? facePosition(s.workpiece) : null;
  const faceThen = before.workpiece ? facePosition(before.workpiece) : null;
  if (workChanged && faceNow !== null && (faceThen === null || Math.abs(faceNow - faceThen) > MOVE_TOL)) {
    text += `: the face is now at Z ${f3(faceNow)}`;
  } else if (moved.includes('carriage')) {
    text += `: the carriage is at Z ${f3(s.z)}`;
  }
  text += ', so its numbers may not match the narration.';
  const reason = step?.check ? impossibleReason(step.check, s) : null;
  if (reason && step) text += ` "${step.title}" can no longer come out as narrated: ${reason}`;
  return text;
}
