// Dimensioned engineering drawing generated from a TargetSpec.
import { SHOULDER_TOL, type TargetSpec } from '../engine';
import { fmt3 } from './derive';
import styles from './PartDrawing.module.css';

export interface PartDrawingProps {
  target: TargetSpec;
  /** rendered width in px */
  width?: number;
  /** optional heading drawn in the title block */
  title?: string;
  /**
   * The part stays in the chuck (not parted off): the jaws are drawn at the back end, and the
   * overall length is measured from them.
   */
  inChuck?: boolean;
}

/** General tolerance for lengths drawn without one: the grader's shoulder tolerance. */
export const GENERAL_LENGTH_TOL = SHOULDER_TOL;

export function tolText(value: number, tol: number, prefix = ''): string {
  return `${prefix}${fmt3(value)} ±${fmt3(tol)}`;
}

const ARROW = 'pd-arrow';

/**
 * Full outline (mirrored about the centerline). z = 0 (the faced end) is drawn on the right,
 * as the part sits on the lathe, with the parted end on the left.
 */
export function PartDrawing({ target, width = 520, title, inChuck = false }: PartDrawingProps) {
  const L = Math.max(target.overallLength, ...target.segments.map((s) => s.z1), 0.1);
  const maxD = Math.max(...target.segments.map((s) => s.diameter), target.bore?.diameter ?? 0, 0.1);
  const left = inChuck ? 56 : 40;
  const right = 150;
  const top = 34;
  const bottomSpace = 30 + 20 * (target.segments.length > 1 ? 3 : 1);
  const scale = Math.min((width - left - right) / L, 180 / maxD);
  const height = Math.round(top + maxD * scale + bottomSpace + 10);
  const cy = top + (maxD * scale) / 2;
  // part-local z (0 at the face, on the right) -> svg x
  const X = (z: number) => left + (L - z) * scale;
  const Y = (r: number) => cy - r * scale;

  // outline as one closed path around the stepped profile; the last section runs on to the
  // overall length (a section is measured a little short of the part's ends)
  const sorted = [...target.segments].sort((a, b) => a.z0 - b.z0);
  const segs = sorted.map((s, i) => (i === sorted.length - 1 && s.z1 < L ? { ...s, z1: L } : s));
  let outline = '';
  if (segs.length) {
    const pts: [number, number][] = [];
    for (const s of segs) {
      pts.push([X(s.z0), Y(s.diameter / 2)], [X(s.z1), Y(s.diameter / 2)]);
    }
    const bottom = [...pts].reverse().map(([x, y]) => [x, 2 * cy - y] as [number, number]);
    outline = `M${pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join('L')}L${bottom
      .map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`)
      .join('L')}Z`;
  }
  // shoulders: vertical lines between steps
  const shoulders = segs.slice(1).map((s, i) => {
    const r = Math.max(s.diameter, segs[i].diameter) / 2;
    return <line key={`sh${i}`} x1={X(s.z0)} x2={X(s.z0)} y1={Y(r)} y2={Y(-r)} className={styles.outline} />;
  });

  const diaDims = segs.map((s, i) => {
    const x = (X(s.z0) + X(s.z1)) / 2;
    const r = s.diameter / 2;
    return (
      <g key={`d${i}`} data-testid={`pd-dia-${i}`}>
        <line x1={x} x2={x} y1={Y(r)} y2={Y(-r)} className={styles.dim} markerStart={`url(#${ARROW})`} markerEnd={`url(#${ARROW})`} />
        <text x={x + 4} y={Y(r) - 6} className={styles.dimText}>
          {tolText(s.diameter, s.tol, 'Ø')}
        </text>
      </g>
    );
  });

  const yLen1 = Y(-maxD / 2) + 22;
  const yLen2 = yLen1 + 20;
  const lenDim = (x0: number, x1: number, y: number, text: string, key: string, testId?: string) => (
    <g key={key} data-testid={testId}>
      <line x1={x0} x2={x0} y1={cy} y2={y + 4} className={styles.ext} />
      <line x1={x1} x2={x1} y1={cy} y2={y + 4} className={styles.ext} />
      <line x1={x0} x2={x1} y1={y} y2={y} className={styles.dim} markerStart={`url(#${ARROW})`} markerEnd={`url(#${ARROW})`} />
      <text x={(x0 + x1) / 2} y={y - 3} textAnchor="middle" className={styles.dimText}>
        {text}
      </text>
    </g>
  );
  const segLens =
    segs.length > 1 ? segs.map((s, i) => lenDim(X(s.z1), X(s.z0), yLen1, fmt3(s.z1 - s.z0), `l${i}`, `pd-len-${i}`)) : [];
  const overallY = segs.length > 1 ? yLen2 : yLen1;
  const overall = lenDim(
    X(target.overallLength),
    X(0),
    overallY,
    `${tolText(target.overallLength, target.lengthTol)}${inChuck ? ' FROM JAWS' : ''}`,
    'overall',
    'pd-length',
  );

  // chuck jaws gripping the back end of a part that stays in the chuck
  let jaws = null;
  if (inChuck) {
    const xj = X(L);
    const r = maxD / 2;
    const h = Math.min(24, r * scale * 0.9);
    jaws = (
      <g data-testid="pd-jaws">
        {[1, -1].map((sgn) => {
          const y = sgn > 0 ? Y(r) - h : Y(-r);
          return <rect key={sgn} x={xj - 16} y={y} width={16} height={h} className={styles.jaw} />;
        })}
        <text x={xj - 26} y={cy} textAnchor="middle" className={styles.note} transform={`rotate(-90 ${xj - 26} ${cy})`}>
          JAWS
        </text>
      </g>
    );
  }
  const generalTol =
    segs.length > 1 ? (
      <text x={width - 8} y={height - 8} textAnchor="end" className={styles.note} data-testid="pd-general-tol">
        UNTOLERANCED LENGTHS ±{fmt3(GENERAL_LENGTH_TOL)}
      </text>
    ) : null;

  let bore = null;
  if (target.bore) {
    const r = target.bore.diameter / 2;
    const through = target.bore.depth >= target.overallLength - 1e-6;
    const x1 = X(Math.min(target.bore.depth, L));
    bore = (
      <g data-testid="pd-bore">
        <line x1={X(0)} x2={x1} y1={Y(r)} y2={Y(r)} className={styles.hidden} />
        <line x1={X(0)} x2={x1} y1={Y(-r)} y2={Y(-r)} className={styles.hidden} />
        {!through && <line x1={x1} x2={x1} y1={Y(r)} y2={Y(-r)} className={styles.hidden} />}
        <line x1={X(0) - 6} x2={X(0) + 40} y1={Y(r)} y2={Y(r) - 24} className={styles.leader} markerStart={`url(#${ARROW})`} />
        <text x={X(0) + 42} y={Y(r) - 26} className={styles.dimText}>
          {tolText(target.bore.diameter, target.bore.tol, 'Ø')} {through ? 'THRU' : `× ${fmt3(target.bore.depth)} DP`}
        </text>
      </g>
    );
  }

  return (
    <svg
      className={styles.svg}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={`Part drawing: ${segs.map((s) => `diameter ${fmt3(s.diameter)} over ${fmt3(s.z1 - s.z0)}`).join(', ')}; overall length ${fmt3(target.overallLength)}${target.bore ? `; bore ${fmt3(target.bore.diameter)}` : ''}`}
      data-testid="part-drawing"
    >
      <defs>
        <marker id={ARROW} viewBox="0 0 10 10" refX={10} refY={5} markerWidth={7} markerHeight={7} orient="auto-start-reverse">
          <path d="M0,1L10,5L0,9Z" className={styles.arrow} />
        </marker>
      </defs>
      {title && (
        <text x={8} y={16} className={styles.title}>
          {title}
        </text>
      )}
      <line x1={left - 14} x2={X(0) + 14} y1={cy} y2={cy} className={styles.center} />
      {outline && <path d={outline} className={styles.outline} data-testid="pd-outline" />}
      {shoulders}
      {bore}
      {diaDims}
      {segLens}
      {overall}
      {jaws}
      {generalTol}
      {/* to the right of the faced end, clear of the diameter callouts */}
      <text x={X(0) + 8} y={cy - 6} textAnchor="start" className={styles.note} data-testid="pd-face">
        ← FACE
      </text>
    </svg>
  );
}
