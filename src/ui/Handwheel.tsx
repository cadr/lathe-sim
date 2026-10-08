// Handwheel with a graduated, zeroable dial collar.
import { useCallback, useEffect, useRef } from 'react';
import type { KeyboardEvent, PointerEvent as ReactPointerEvent } from 'react';
import { MACHINE, type Axis } from '../engine';
import { handwheelWheel } from '../art';
import { useHoldRepeat } from './useHoldRepeat';
import styles from './Handwheel.module.css';
import common from './common.module.css';

export interface HandwheelProps {
  axis: Axis;
  label: string;
  /** dial divisions per revolution: 50 for x, 100 for z and quill */
  divisions: number;
  /** dial reading in thousandths (engine.dialReading) */
  reading: number;
  /** axis position in inches */
  position: number;
  /** positive revolutions = clockwise; dt = seconds the motion took */
  onTurn: (revolutions: number, dt: number) => void;
  onZero: () => void;
  /** direction reminder, e.g. "CW → in" */
  directionHint?: string;
  /** label for the position readout, e.g. "X dia" */
  positionLabel?: string;
  /** value shown in the position readout (defaults to position) */
  displayPosition?: number;
  /** rendered wheel size in px */
  size?: number;
  disabled?: boolean;
}

/**
 * Feed (in/s) a button, key or mouse-wheel step is reported at: a steady, careful turn of the
 * wheel. It stays under every finish limit at 300 rpm and up (parting allows 0.004"/rev, which
 * is 0.02 in/s at 300 rpm), so stepping through a cut never counts as a poor finish. Dragging
 * and held buttons report their real speed instead.
 */
export const STEADY_FEED = 0.02;
/** shortest dt reported for one step */
export const MIN_STEP_DT = 0.05;
/** dt used for a drag division when the pointer events carry no usable timestamps */
export const DRAG_FALLBACK_DT = 0.05;

/** Lead screw travel per handwheel revolution for an axis, in inches. */
export function pitchFor(axis: Axis): number {
  return axis === 'x' ? MACHINE.xHandwheelPitch : axis === 'z' ? MACHINE.zHandwheelPitch : MACHINE.quillPitch;
}

/** dt (s) reported for a step of `divs` divisions: the time a steady STEADY_FEED turn takes. */
export function dtForDivisions(divs: number, divisions: number, pitch: number): number {
  const inches = (Math.abs(divs) / divisions) * pitch;
  return Math.max(MIN_STEP_DT, inches / STEADY_FEED);
}

const TAU = Math.PI * 2;

/** Signed smallest angle difference a - b in (-π, π]. */
export function angleDelta(a: number, b: number): number {
  let d = (a - b) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d <= -Math.PI) d += TAU;
  return d;
}

/** Keys that turn a focused wheel: → / ↑ clockwise, ← / ↓ counter-clockwise, PageUp/Down a revolution. */
const KEY_STEPS: Record<string, { dir: 1 | -1; rev?: boolean }> = {
  ArrowRight: { dir: 1 },
  ArrowUp: { dir: 1 },
  ArrowLeft: { dir: -1 },
  ArrowDown: { dir: -1 },
  PageUp: { dir: 1, rev: true },
  PageDown: { dir: -1, rev: true },
};

/** Dial reading as shown on the collar: whole divisions, 0 to divisions − 1, two digits. */
export function formatReading(reading: number, divisions: number): string {
  const r = (((Math.round(reading) % divisions) + divisions) % divisions);
  return String(r).padStart(2, '0');
}

interface DragState {
  pointerId: number;
  cx: number;
  cy: number;
  angle: number;
  /** accumulated revolutions not yet dispatched (less than one division) */
  pending: number;
  lastTime: number;
}

export function Handwheel({
  axis,
  label,
  divisions,
  reading,
  position,
  onTurn,
  onZero,
  directionHint,
  positionLabel,
  displayPosition,
  size = 150,
  disabled = false,
}: HandwheelProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const drag = useRef<DragState | null>(null);
  const onTurnRef = useRef(onTurn);
  useEffect(() => {
    onTurnRef.current = onTurn;
  }, [onTurn]);

  const turnDivisions = useCallback(
    (divs: number, dt?: number) => {
      if (disabled || divs === 0) return;
      onTurnRef.current(divs / divisions, dt ?? dtForDivisions(divs, divisions, pitchFor(axis)));
    },
    [disabled, divisions, axis],
  );

  // a drag in progress ends when the wheel is disabled (e.g. a demo starts)
  useEffect(() => {
    if (disabled) drag.current = null;
  }, [disabled]);

  // mouse wheel: needs a non-passive listener to stop the page scrolling
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      // with Shift held, macOS and Chrome on Windows turn vertical scrolling into deltaX
      const delta = e.deltaY !== 0 ? e.deltaY : e.shiftKey ? e.deltaX : 0;
      if (disabled || delta === 0) return;
      e.preventDefault();
      const step = e.shiftKey ? 10 : 1;
      // scroll down = clockwise
      turnDivisions(delta > 0 ? step : -step);
    };
    el.addEventListener('wheel', handler, { passive: false });
    return () => el.removeEventListener('wheel', handler);
  }, [disabled, turnDivisions]);

  const onKeyDown = (e: KeyboardEvent<SVGSVGElement>) => {
    const key = KEY_STEPS[e.key];
    if (!key) return;
    e.preventDefault();
    // PageUp / PageDown always turn a full revolution (Alt+arrow is Back/Forward on some systems)
    const step = key.rev || e.altKey ? divisions : e.shiftKey ? 10 : 1;
    turnDivisions(key.dir * step);
  };

  const pointerAngle = (d: { cx: number; cy: number }, clientX: number, clientY: number) =>
    Math.atan2(clientY - d.cy, clientX - d.cx);

  const onPointerDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (disabled || e.button !== 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    drag.current = { pointerId: e.pointerId, cx, cy, angle: pointerAngle({ cx, cy }, e.clientX, e.clientY), pending: 0, lastTime: e.timeStamp };
  };

  const onPointerMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    const a = pointerAngle(d, e.clientX, e.clientY);
    // screen y points down, so increasing atan2 angle is clockwise
    d.pending += angleDelta(a, d.angle) / TAU;
    d.angle = a;
    const whole = Math.trunc(d.pending * divisions + (d.pending >= 0 ? 1e-9 : -1e-9));
    if (whole === 0) return;
    d.pending -= whole / divisions;
    const elapsed = (e.timeStamp - d.lastTime) / 1000;
    d.lastTime = e.timeStamp;
    const perDiv = elapsed > 0 ? elapsed / Math.abs(whole) : DRAG_FALLBACK_DT;
    const sign = Math.sign(whole);
    for (let i = 0; i < Math.abs(whole); i++) onTurnRef.current(sign / divisions, perDiv);
  };

  const endDrag = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (drag.current?.pointerId !== e.pointerId) return;
    drag.current = null;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
  };

  // collar: graduation i sits at angle -i/n (numbers increase counter-clockwise) and the
  // collar turns clockwise with the reading, so graduation `reading` is under the index mark.
  const rotation = (reading / divisions) * 360;
  const numberEvery = divisions >= 100 ? 10 : 5;
  const ticks = [];
  for (let i = 0; i < divisions; i++) {
    const ang = (-i / divisions) * TAU - Math.PI / 2;
    const major = i % numberEvery === 0;
    const mid = divisions >= 100 && i % 5 === 0;
    const r0 = major ? 70 : mid ? 74 : 77;
    const r1 = 82;
    ticks.push(
      <line
        key={i}
        x1={100 + r0 * Math.cos(ang)}
        y1={100 + r0 * Math.sin(ang)}
        x2={100 + r1 * Math.cos(ang)}
        y2={100 + r1 * Math.sin(ang)}
        className={major ? styles.tickMajor : styles.tick}
      />,
    );
    if (major) {
      ticks.push(
        <text
          key={`n${i}`}
          x={100 + 61 * Math.cos(ang)}
          y={100 + 61 * Math.sin(ang)}
          className={styles.tickLabel}
          textAnchor="middle"
          dominantBaseline="central"
          transform={`rotate(${(-i / divisions) * 360} ${100 + 61 * Math.cos(ang)} ${100 + 61 * Math.sin(ang)})`}
        >
          {i}
        </text>,
      );
    }
  }

  const readingText = formatReading(reading, divisions);
  const shown = displayPosition ?? position;
  return (
    <div className={styles.root} data-axis={axis}>
      <div className={styles.header}>
        <span className={common.label}>{label}</span>
        {directionHint && <span className={styles.dirHint}>{directionHint}</span>}
      </div>
      <div className={styles.body}>
        <svg
          ref={svgRef}
          className={styles.wheel}
          width={size}
          height={size}
          viewBox="0 0 200 200"
          role="slider"
          tabIndex={disabled ? -1 : 0}
          aria-label={`${label} handwheel`}
          aria-valuemin={0}
          aria-valuemax={divisions - 1}
          aria-valuenow={Number(readingText)}
          aria-valuetext={`dial ${readingText} thou, position ${shown.toFixed(3)} inches`}
          aria-disabled={disabled || undefined}
          data-testid={`hw-${axis}-wheel`}
          onKeyDown={onKeyDown}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onLostPointerCapture={endDrag}
        >
          <g transform={`rotate(${rotation} 100 100)`}>
            <image href={handwheelWheel} x={0} y={0} width={200} height={200} />
            <circle cx={100} cy={100} r={84} className={styles.collar} />
            {ticks}
          </g>
          <polygon points="100,13 93,2 107,2" className={styles.index} />
          <line x1={100} y1={13} x2={100} y2={24} className={styles.indexLine} />
          <rect x={72} y={86} width={56} height={28} rx={4} className={styles.readoutBg} />
          <text x={100} y={101} className={styles.readout} textAnchor="middle" dominantBaseline="central">
            {readingText}
          </text>
        </svg>
        <div className={styles.side}>
          <div className={styles.bigReading} data-testid={`hw-${axis}-reading`} aria-live="off">
            {readingText}
          </div>
          <div className={common.label}>thou</div>
          <div className={styles.position} data-testid={`hw-${axis}-position`}>
            {positionLabel ? `${positionLabel} ` : ''}
            {shown.toFixed(3)}
          </div>
          <button
            type="button"
            className={common.btn}
            data-testid={`hw-${axis}-zero`}
            aria-label={`Zero the ${label} dial`}
            onClick={onZero}
            disabled={disabled}
          >
            Zero
          </button>
        </div>
      </div>
      <div className={styles.buttons}>
        <StepButton axis={axis} id="minusrev" text="−1 rev" divs={-divisions} label={label} onStep={turnDivisions} disabled={disabled} />
        <StepButton axis={axis} id="minus10" text="−10" divs={-10} label={label} onStep={turnDivisions} disabled={disabled} />
        <StepButton axis={axis} id="minus1" text="−1" divs={-1} label={label} onStep={turnDivisions} disabled={disabled} />
        <StepButton axis={axis} id="plus1" text="+1" divs={1} label={label} onStep={turnDivisions} disabled={disabled} />
        <StepButton axis={axis} id="plus10" text="+10" divs={10} label={label} onStep={turnDivisions} disabled={disabled} />
        <StepButton axis={axis} id="plusrev" text="+1 rev" divs={divisions} label={label} onStep={turnDivisions} disabled={disabled} />
      </div>
    </div>
  );
}

interface StepButtonProps {
  axis: Axis;
  id: string;
  text: string;
  divs: number;
  label: string;
  onStep: (divs: number, dt?: number) => void;
  disabled: boolean;
}

function StepButton({ axis, id, text, divs, label, onStep, disabled }: StepButtonProps) {
  // repeats report the real time between them, so holding a button feeds as fast as it really moves
  const fire = useCallback((repeatDt?: number) => onStep(divs, repeatDt), [onStep, divs]);
  const handlers = useHoldRepeat(fire, disabled);
  const dir = divs > 0 ? 'clockwise' : 'counter-clockwise';
  const amount = Math.abs(divs) >= 50 ? 'one revolution' : `${Math.abs(divs)} division${Math.abs(divs) === 1 ? '' : 's'}`;
  return (
    <button
      type="button"
      className={common.btn}
      data-testid={`hw-${axis}-${id}`}
      aria-label={`Turn ${label} ${amount} ${dir}`}
      disabled={disabled}
      {...handlers}
    >
      {text}
    </button>
  );
}
