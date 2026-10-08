// Small schematic of what a script step does: net tool moves as arrows, plus a list of the step's
// actions in machinist terms. Given where the machine is (`from`), absolute moves are spelled out
// with the direction, the number of turns and the dial reading at the target.
import { describeAction, describeActions, MACHINE, netMotion, type DescribeContext, type ScriptStep } from '../engine';
import styles from './projects.module.css';

export interface StepMotion {
  /** net radial motion of the tool (inches, + = in toward center) */
  x: number;
  /** net carriage motion (inches, + = toward the tailstock) */
  z: number;
  /** net quill motion (inches, + = advancing) */
  quill: number;
}

/**
 * Net tool motion of a step. With `from` (the machine position before the step) absolute moves
 * count too; without it only relative handwheel turns can be summed.
 */
export function stepMotion(step: ScriptStep, from?: DescribeContext): StepMotion {
  if (from) return netMotion(step.actions, from);
  const m: StepMotion = { x: 0, z: 0, quill: 0 };
  for (const a of step.actions) {
    if (a.type !== 'turnHandwheel') continue;
    if (a.axis === 'x') m.x += a.revolutions * MACHINE.xHandwheelPitch;
    else if (a.axis === 'z') m.z += a.revolutions * MACHINE.zHandwheelPitch;
    else m.quill += a.revolutions * MACHINE.quillPitch;
  }
  return m;
}

/** One line per action that does something, in machinist terms (spoken lines in quotes). */
export function stepSummary(step: ScriptStep, from?: DescribeContext): string[] {
  // describeActions tracks the machine position through the step; spoken lines are woven back in
  const moves = describeActions(
    step.actions.filter((a) => a.type !== 'say'),
    from,
  );
  const out: string[] = [];
  let k = 0;
  for (const a of step.actions) {
    if (a.type === 'say') out.push(`“${a.text}”`);
    else if (describeAction(a) !== null) out.push(moves[k++]);
  }
  return out;
}

const EPS = 1e-6;
const W = 170;
const H = 96;
const AXIS_Y = 62;

function Arrow({ x1, y1, x2, y2, label, testId }: { x1: number; y1: number; x2: number; y2: number; label: string; testId: string }) {
  const ang = Math.atan2(y2 - y1, x2 - x1);
  const hx = (d: number, s: number) => x2 - 7 * Math.cos(ang + s * d);
  const hy = (d: number, s: number) => y2 - 7 * Math.sin(ang + s * d);
  const head = `${x2},${y2} ${hx(0.45, 1)},${hy(0.45, 1)} ${hx(0.45, -1)},${hy(0.45, -1)}`;
  const tx = (x1 + x2) / 2;
  const ty = (y1 + y2) / 2;
  const horizontal = Math.abs(y2 - y1) < Math.abs(x2 - x1);
  return (
    <g data-testid={testId} stroke="var(--accent, #e0a040)" fill="var(--accent, #e0a040)">
      <line x1={x1} y1={y1} x2={x2} y2={y2} strokeWidth={2} />
      <polygon points={head} stroke="none" />
      <text
        x={horizontal ? tx : tx + 6}
        y={horizontal ? ty - 5 : ty}
        fontSize={9}
        stroke="none"
        fill="var(--text, #e6e2d8)"
        textAnchor={horizontal ? 'middle' : 'start'}
      >
        {label}
      </text>
    </g>
  );
}

const thou = (v: number) => `${Math.abs(v).toFixed(3)}"`;

export function StepIllustration({ step, from }: { step: ScriptStep; from?: DescribeContext }) {
  const m = stepMotion(step, from);
  const lines = stepSummary(step, from);
  // tool sits above the bar; screen y grows downward so "in toward center" points down
  const toolX = 112;
  const toolY = 30;
  return (
    <div className={styles.illustration} data-testid="step-illustration">
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Diagram: ${step.title}`}>
        {/* chuck */}
        <rect x={6} y={AXIS_Y - 26} width={18} height={52} fill="#555b63" rx={2} />
        {/* stock */}
        <rect x={24} y={AXIS_Y - 12} width={96} height={24} fill="#b8963c" opacity={0.85} />
        {/* center line */}
        <line x1={4} y1={AXIS_Y} x2={W - 4} y2={AXIS_Y} stroke="#888" strokeDasharray="4 3" strokeWidth={0.7} />
        {/* tailstock quill */}
        <rect x={W - 22} y={AXIS_Y - 8} width={18} height={16} fill="#555b63" rx={2} />
        {/* tool */}
        <polygon points={`${toolX},${toolY} ${toolX + 6},${toolY - 14} ${toolX + 16},${toolY - 14}`} fill="#cfd4da" />
        {Math.abs(m.z) > EPS && (
          <Arrow
            testId="arrow-z"
            x1={toolX + 8}
            y1={14}
            x2={m.z < 0 ? toolX - 40 : toolX + 48}
            y2={14}
            label={`${m.z < 0 ? '← chuck' : 'tailstock →'} ${thou(m.z)}`}
          />
        )}
        {Math.abs(m.x) > EPS && (
          <Arrow
            testId="arrow-x"
            x1={toolX - 8}
            y1={m.x > 0 ? toolY - 10 : toolY + 6}
            x2={toolX - 8}
            y2={m.x > 0 ? toolY + 6 : toolY - 10}
            label={`${m.x > 0 ? 'in' : 'out'} ${thou(m.x)}`}
          />
        )}
        {Math.abs(m.quill) > EPS && (
          <Arrow
            testId="arrow-quill"
            x1={W - 24}
            y1={AXIS_Y + 20}
            x2={m.quill > 0 ? W - 64 : W - 6}
            y2={AXIS_Y + 20}
            label={`quill ${thou(m.quill)}`}
          />
        )}
      </svg>
      {lines.length > 0 && (
        <ol className={styles.actionList} data-testid="step-actions" aria-label="What this step does">
          {lines.map((l, i) => (
            <li key={i}>{l}</li>
          ))}
        </ol>
      )}
    </div>
  );
}
