// 2D cross-section of the workpiece, chuck, toolpost tool and tailstock.
import { useShallow } from 'zustand/react/shallow';
import {
  MACHINE,
  TAILSTOCK_TOOLS,
  diameterAt,
  facePosition,
  profileSegments,
  tailstockTipZ,
  toolFootprint,
  type LatheState,
} from '../engine';
import { useLathe } from '../store/useLathe';
import { fmt3 } from './derive';
import styles from './SectionView.module.css';

export type SectionInput = Pick<LatheState, 'workpiece' | 'x' | 'z' | 'quill' | 'tool' | 'tailstockTool' | 'tailstockZ'>;

export interface SectionDiagramProps {
  section: SectionInput;
  /** rendered width in px; height follows from the scale */
  width?: number;
}

export interface SectionViewProps {
  width?: number;
}

export interface SectionBounds {
  zMin: number;
  zMax: number;
  rMax: number;
}

/** World window shown: from behind the jaws to past the work, tool and tailstock tip. */
export function sectionBounds(s: SectionInput): SectionBounds {
  const wp = s.workpiece;
  const face = wp ? (facePosition(wp) ?? 0) : 0;
  let maxR = 0;
  if (wp) for (let i = 0; i < wp.outer.length; i++) maxR = Math.max(maxR, wp.outer[i]);
  const tip = tailstockTipZ(s.tailstockTool, s.tailstockZ, s.quill);
  const quillFace = s.tailstockZ - s.quill;
  const tsReach = s.tailstockTool === 'none' ? Math.min(tip, s.tailstockZ) + 0.4 : quillFace + 0.4;
  const zMax = Math.min(s.tailstockZ + 0.75, Math.max(2, face + 0.75, s.z + 0.6, tsReach));
  const rMax = Math.max(1.15, maxR + 0.25, Math.min(s.x + 0.35, MACHINE.xRange[1] + 0.2));
  return { zMin: -0.85, zMax, rMax };
}

function gridValues(lo: number, hi: number, step: number): number[] {
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(Math.round(v * 1000) / 1000);
  return out;
}

export function SectionDiagram({ section: s, width = 640 }: SectionDiagramProps) {
  const b = sectionBounds(s);
  const scale = width / (b.zMax - b.zMin);
  const height = Math.round(2 * b.rMax * scale);
  const X = (z: number) => (z - b.zMin) * scale;
  const Y = (r: number) => (b.rMax - r) * scale;
  const clampR = (r: number) => Math.min(r, b.rMax);
  const rect = (z0: number, z1: number, r0: number, r1: number) =>
    `M${X(z0).toFixed(2)},${Y(r1).toFixed(2)}H${X(z1).toFixed(2)}V${Y(r0).toFixed(2)}H${X(z0).toFixed(2)}Z`;
  const both = (z0: number, z1: number, r0: number, r1: number) => rect(z0, z1, r0, r1) + rect(z0, z1, -r1, -r0);

  // workpiece
  const wp = s.workpiece;
  const segs = wp ? profileSegments(wp) : [];
  const profile = segs.map((g) => both(g.z0, g.z1, g.boreDiameter / 2, g.diameter / 2)).join('');
  const bore = segs
    .filter((g) => g.boreDiameter > 0)
    .map((g) => rect(g.z0, g.z1, -g.boreDiameter / 2, g.boreDiameter / 2))
    .join('');
  const gripR = wp ? Math.max(0.05, diameterAt(wp, -0.3) / 2) : 0.25;

  // chuck: jaws around the stock and the body behind them
  const J = MACHINE.chuckJawLength;
  const jaws = both(-J, 0, gripR, MACHINE.chuckJawOuterRadius);
  const body = both(b.zMin, -J, 0, clampR(MACHINE.chuckBodyRadius));

  // toolpost tool (upper half only: the tool sits on the near side)
  const fp = toolFootprint(s.tool, s.x, s.z);
  const toolPath = fp ? rect(fp.zMin, fp.zMax, Math.max(fp.xMin, -b.rMax), clampR(fp.xMax)) : '';

  // tailstock: quill body and the tool in it
  const quillFace = s.tailstockZ - s.quill;
  const quillFull = quillFace < b.zMax ? rect(quillFace, b.zMax, -MACHINE.quillRadius, MACHINE.quillRadius) : '';
  const tsBody = s.tailstockZ < b.zMax ? rect(s.tailstockZ, b.zMax, -clampR(1.0), clampR(1.0)) : '';
  const tsInfo = TAILSTOCK_TOOLS[s.tailstockTool];
  const tip = tailstockTipZ(s.tailstockTool, s.tailstockZ, s.quill);
  let drillPath = '';
  if (s.tailstockTool !== 'none') {
    const r = tsInfo.radius;
    const cone = s.tailstockTool === 'live-center' ? r * 1.5 : r / Math.tan((59 * Math.PI) / 180);
    drillPath = `M${X(tip)},${Y(0)}L${X(tip + cone)},${Y(r)}H${X(quillFace)}V${Y(-r)}H${X(tip + cone)}Z`;
  }

  const toolDia = wp ? diameterAt(wp, s.z) : 0;
  const zGrid = gridValues(b.zMin, b.zMax, 0.25);
  const rGrid = gridValues(-b.rMax, b.rMax, 0.25);

  return (
    <svg
      className={styles.svg}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={`Section view. ${wp ? `Diameter at the tool: ${fmt3(toolDia)} inches.` : 'No stock loaded.'}`}
      data-testid="section-view"
    >
      <g className={styles.grid}>
        {zGrid.map((z) => (
          <line key={`z${z}`} x1={X(z)} x2={X(z)} y1={0} y2={height} className={Math.abs(z % 1) < 1e-6 ? styles.gridMajor : undefined} />
        ))}
        {rGrid.map((r) => (
          <line key={`r${r}`} x1={0} x2={width} y1={Y(r)} y2={Y(r)} />
        ))}
      </g>
      {zGrid
        .filter((z) => Math.abs((z * 2) % 1) < 1e-6)
        .map((z) => (
          <text key={`zl${z}`} x={X(z) + 2} y={height - 4} className={styles.gridLabel}>
            {z.toFixed(1)}
          </text>
        ))}
      {rGrid
        .filter((r) => r > 0 && Math.abs((r * 2) % 1) < 1e-6)
        .map((r) => (
          <text key={`rl${r}`} x={2} y={Y(r) - 2} className={styles.gridLabel}>
            Ø{(2 * r).toFixed(1)}
          </text>
        ))}
      <path d={body} className={styles.chuck} data-testid="section-chuck" />
      <path d={jaws} className={styles.jaws} data-testid="section-jaws" />
      {profile && <path d={profile} className={styles[`mat_${wp?.material ?? 'brass'}`]} data-testid="section-profile" />}
      {bore && <path d={bore} className={styles.bore} data-testid="section-bore" />}
      {tsBody && <path d={tsBody} className={styles.chuck} data-testid="section-tailstock" />}
      {quillFull && <path d={quillFull} className={styles.quill} data-testid="section-quill" />}
      {drillPath && <path d={drillPath} className={styles.drill} data-testid="section-drill" />}
      {toolPath && <path d={toolPath} className={styles.tool} data-testid="section-tool" />}
      <line x1={0} x2={width} y1={Y(0)} y2={Y(0)} className={styles.axis} />
      <text x={X(0) + 3} y={12} className={styles.gridLabel}>
        jaw face
      </text>
      <text x={width - 6} y={14} textAnchor="end" className={styles.readout} data-testid="section-dia">
        {wp ? `Ø ${fmt3(toolDia)} at Z ${fmt3(s.z)}` : 'No stock'}
      </text>
    </svg>
  );
}

/** Section view wired to the store. */
export function SectionView({ width }: SectionViewProps) {
  const section = useLathe(
    useShallow(
      (st): SectionInput => ({
        workpiece: st.state.workpiece,
        x: st.state.x,
        z: st.state.z,
        quill: st.state.quill,
        tool: st.state.tool,
        tailstockTool: st.state.tailstockTool,
        tailstockZ: st.state.tailstockZ,
      }),
    ),
  );
  return <SectionDiagram section={section} width={width} />;
}
