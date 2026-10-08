// Shared player UI: the transport (play / pause, step forward, speed, progress) and the
// current step's title, narration and illustration. Used by watched lessons, do-it-yourself
// "Show me" and challenge solution playback.
import { useMemo, type ReactNode } from 'react';
import { uiIcons } from '../art';
import { describeContext, type DescribeContext, type ScriptStep } from '../engine';
import { SPEEDS, useLathe } from '../store';
import { StepIllustration } from './StepIllustration';
import styles from './projects.module.css';

export function SpeedButtons({ label = 'Speed', title }: { label?: string; title?: string }) {
  const speed = useLathe((s) => s.speed);
  const setSpeed = useLathe((s) => s.setSpeed);
  return (
    <div className={styles.row} role="group" aria-label={label === 'Speed' ? 'Playback speed' : label} title={title}>
      <span className={styles.meta}>{label}</span>
      {SPEEDS.map((s) => (
        <button
          key={s}
          type="button"
          className={`${styles.button} ${styles.small} ${speed === s ? styles.active : ''}`}
          aria-pressed={speed === s}
          data-testid={`speed-${s}`}
          onClick={() => setSpeed(s)}
        >
          {s}×
        </button>
      ))}
    </div>
  );
}

export function ProgressBar({ value, label, testId = 'lesson-progress' }: { value: number; label: string; testId?: string }) {
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100);
  return (
    <div
      className={styles.progress}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
      data-testid={testId}
    >
      <div className={styles.progressFill} style={{ width: `${pct}%` }} />
    </div>
  );
}

/**
 * The machine position when `key` (the step) last changed: a stable starting point for a step's
 * instructions while a player runs through it.
 */
export function useStepStart(key: unknown): DescribeContext {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => describeContext(useLathe.getState().state), [key]);
}

/** The step's narration, "why" and illustration (title is rendered by the caller). */
export function StepBody({ step, narration = true, from }: { step: ScriptStep; narration?: boolean; from?: DescribeContext }) {
  return (
    <>
      {narration && (
        <p className={styles.narration} data-testid="lesson-narration">
          {step.narration}
        </p>
      )}
      {step.why && (
        <details className={styles.why} data-testid="lesson-why">
          <summary>Why?</summary>
          <p>{step.why}</p>
        </details>
      )}
      <StepIllustration step={step} from={from} />
    </>
  );
}

export interface TransportProps {
  /** test id prefix: 'lesson' or 'solution' */
  prefix: string;
  /** total steps in the script being played */
  stepCount: number;
  /** extra buttons after Step forward (e.g. Restart, Take over) */
  extra?: ReactNode;
}

/**
 * Play / pause, step forward, speed and progress for the store's player, with the current
 * step's position line and caption.
 */
export function Transport({ prefix, stepCount, extra }: TransportProps) {
  const status = useLathe((s) => s.playerStatus);
  const playPause = useLathe((s) => s.playPause);
  const stepForward = useLathe((s) => s.stepForward);
  const index = status?.stepIndex ?? 0;
  const done = status?.done ?? false;
  const playing = status?.playing ?? false;
  return (
    <>
      <div className={styles.meta} data-testid={`${prefix}-position`}>
        {done ? `All ${stepCount} steps done` : `Step ${index + 1} of ${stepCount}`}
      </div>
      <ProgressBar value={status?.progress ?? 0} label="Step progress" testId={`${prefix}-progress`} />
      <div className={styles.row} role="group" aria-label="Transport">
        <button
          type="button"
          className={styles.primary}
          data-testid={`${prefix}-play`}
          aria-pressed={playing}
          disabled={done}
          onClick={() => playPause()}
        >
          <img className={styles.icon} src={playing ? uiIcons.pause : uiIcons.play} alt="" />
          {playing ? 'Pause' : 'Play'}
        </button>
        <button
          type="button"
          className={styles.button}
          data-testid={`${prefix}-step`}
          disabled={done}
          onClick={() => stepForward()}
        >
          <img className={styles.icon} src={uiIcons.stepForward} alt="" />
          Step forward
        </button>
        {extra}
      </div>
      <SpeedButtons />
      {status?.caption && (
        <p className={styles.caption} data-testid={`${prefix}-caption`} aria-live="polite">
          {status.caption}
        </p>
      )}
    </>
  );
}
