// Cutting rules: surface speed, limits, crash geometry.
import { MACHINE, type Material, type RectFootprint, type TailstockToolId, type ToolId } from './types';
import { TAILSTOCK_TOOLS, tailstockTipZ } from './tools';

/** Surface feet per minute for a diameter (in) at rpm. */
export function sfm(diameter: number, rpm: number): number {
  return (Math.PI * diameter * rpm) / 12;
}

export function sfmLimit(material: Material, tool: ToolId | TailstockToolId = 'turning'): number {
  const base = MACHINE.sfmLimit[material];
  return tool === 'parting' ? base * MACHINE.partingSfmFactor : base;
}

export function maxDepthOfCut(material: Material): number {
  return MACHINE.maxDepthOfCut[material];
}

/** Highest rpm (any value) that stays at or under the sfm limit for this diameter and tool. */
export function maxRpmAtDiameter(material: Material, diameter: number, tool: ToolId | TailstockToolId = 'turning'): number {
  if (diameter <= 0) return Infinity;
  return (sfmLimit(material, tool) * 12) / (Math.PI * diameter);
}

export function partingMaxRpmAtDiameter(material: Material, diameter: number): number {
  return maxRpmAtDiameter(material, diameter, 'parting');
}

/**
 * Recommended speed: the highest selectable rpm option (> 0) that does not chatter, falling back
 * to the lowest non-zero option. Parting is also held to MACHINE.partingMaxRpm (300): a blade
 * buried in the work wants a slow, steady speed, and every lesson, hint and solution parts at 300.
 */
export function recommendedRpm(material: Material, diameter: number, tool: ToolId | TailstockToolId = 'turning'): number {
  const limit = maxRpmAtDiameter(material, diameter, tool);
  const max = tool === 'parting' ? Math.min(limit, MACHINE.partingMaxRpm) : limit;
  const options = MACHINE.rpmOptions.filter((r) => r > 0);
  let best = options[0];
  for (const r of options) if (r <= max + 1e-9) best = r;
  return best;
}

/** Snaps an arbitrary rpm to the nearest selectable option. */
export function snapRpm(rpm: number): number {
  let best = MACHINE.rpmOptions[0];
  for (const r of MACHINE.rpmOptions) if (Math.abs(r - rpm) < Math.abs(best - rpm)) best = r;
  return best;
}

function rectsOverlap(a: RectFootprint, xMin: number, xMax: number, zMin: number, zMax: number): boolean {
  return a.xMin < xMax && a.xMax > xMin && a.zMin < zMax && a.zMax > zMin;
}

/** Does the toolpost envelope hit the chuck jaws (or the chuck body behind them)? */
export function hitsChuck(env: RectFootprint): boolean {
  const jaws = rectsOverlap(env, -Infinity, MACHINE.chuckJawOuterRadius, -MACHINE.chuckJawLength, 0);
  const body = rectsOverlap(env, -Infinity, MACHINE.chuckBodyRadius, -Infinity, -MACHINE.chuckJawLength);
  return jaws || body;
}

/** Z where the tailstock body (the casting around the quill) starts. */
export function tailstockBodyZ(tailstockZ: number): number {
  return tailstockZ + MACHINE.tailstockBodyOffset;
}

/** Does the carriage itself (any tool or none) run into the tailstock? The tip z can't pass the body. */
export function carriageHitsTailstock(z: number, tailstockZ: number): boolean {
  return z > tailstockBodyZ(tailstockZ) + 1e-9;
}

/** Feed per spindle revolution (in/rev) for a feed rate in in/s; Infinity when the spindle is stopped. */
export function feedPerRev(feedRate: number, rpm: number): number {
  return rpm > 0 ? feedRate / (rpm / 60) : Infinity;
}

/** Highest feed per revolution before "poor finish" for a tool. */
export function maxFeedPerRev(tool: ToolId | TailstockToolId): number {
  return MACHINE.maxFeedPerRev[tool] ?? MACHINE.maxFeedPerRev.turning;
}

/** Does the toolpost envelope hit the tailstock body, the quill or the tool mounted in it? */
export function hitsTailstock(env: RectFootprint, tool: TailstockToolId, tailstockZ: number, quill: number): boolean {
  const quillFace = tailstockZ - quill;
  if (rectsOverlap(env, -Infinity, MACHINE.quillRadius, quillFace, Infinity)) return true;
  if (rectsOverlap(env, -Infinity, MACHINE.tailstockBodyRadius, tailstockBodyZ(tailstockZ), Infinity)) return true;
  if (tool === 'none') return false;
  const tip = tailstockTipZ(tool, tailstockZ, quill);
  return rectsOverlap(env, -Infinity, TAILSTOCK_TOOLS[tool].radius, tip, quillFace);
}
