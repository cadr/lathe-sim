// Pure helpers shared by UI components.
import { diameterAt, profileSegments, type LatheState, type Material, type Workpiece } from '../engine';

export const fmt3 = (v: number) => (Math.abs(v) < 0.0005 ? 0 : v).toFixed(3);

/** Largest outer diameter of material at z >= 0 (the part sticking out of the jaws). */
export function protrudingDiameter(wp: Workpiece): number {
  let max = 0;
  for (let i = 0; i < wp.outer.length; i++) {
    const zc = wp.zStart + (i + 0.5) * wp.dz;
    if (zc >= 0 && wp.outer[i] > wp.inner[i]) max = Math.max(max, wp.outer[i]);
  }
  return 2 * max;
}

/** Diameter the tool is (or would be) cutting: at the tool's z if there is material, else the largest protruding diameter. */
export function workingDiameter(state: Pick<LatheState, 'workpiece' | 'z'>): number {
  const wp = state.workpiece;
  if (!wp) return 0;
  const at = diameterAt(wp, state.z);
  return at > 0 ? at : protrudingDiameter(wp);
}

export const MATERIAL_NAMES: Record<Material, string> = {
  brass: 'Brass',
  aluminum: 'Aluminum',
  steel: 'Steel',
  delrin: 'Delrin',
};

/** One-line summary of a piece, e.g. "Brass Ø0.750×0.500, Ø0.500×0.750, bore Ø0.250". */
export function pieceSummary(wp: Workpiece): string {
  const segs = profileSegments(wp);
  if (!segs.length) return `${MATERIAL_NAMES[wp.material]} (empty)`;
  const length = segs[segs.length - 1].z1 - segs[0].z0;
  const merged: { d: number; len: number }[] = [];
  for (const s of segs) {
    const last = merged[merged.length - 1];
    if (last && Math.abs(last.d - s.diameter) < 0.0015) last.len += s.z1 - s.z0;
    else merged.push({ d: s.diameter, len: s.z1 - s.z0 });
  }
  // keep the summary short: skip slivers under 0.02" (chamfer-ish steps from sampling)
  const parts = merged.filter((m) => m.len >= 0.02).map((m) => `Ø${fmt3(m.d)}×${fmt3(m.len)}`);
  const bore = Math.max(...segs.map((s) => s.boreDiameter));
  const boreText = bore > 0 ? `, bore Ø${fmt3(bore)}` : '';
  return `${MATERIAL_NAMES[wp.material]} ${parts.join(', ')}${boreText} (L ${fmt3(length)})`;
}
