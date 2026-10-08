// Project tab content while a lesson is active: watch mode (the ScriptPlayer plays the lesson)
// or do-it-yourself mode (the user performs each step; its check advances the lesson).
//
// Layout: the current step (and in do-it-yourself mode, what it is waiting for) comes first, so it
// is visible without scrolling even in a short bottom panel. The step list sits beside it.
import { useCallback, useEffect, useRef, useState } from 'react';
import { uiIcons } from '../art';
import { getLesson, getLessonMeta } from '../content';
import { useShallow } from 'zustand/react/shallow';
import { describeCheck, evaluateCheck, type CameraPreset, type DescribeContext, type Script, type ScriptStep } from '../engine';
import { useLathe } from '../store';
import { ProgressBar, SpeedButtons, StepBody, Transport, useStepStart } from './Transport';
import styles from './projects.module.css';

/** Camera presets in display order. The camera buttons themselves live in the app header. */
export const CAMERA_PRESETS: readonly CameraPreset[] = ['overview', 'tool', 'chuck', 'tailstock'];
/** ms the checkmark shows before do-it-yourself mode moves to the next step */
export const DIY_ADVANCE_DELAY = 700;
/** ms a step that was already done on arrival stays up (so it can be read) before moving on */
export const ALREADY_DONE_DELAY = 2000;

function StepList({
  steps,
  current,
  done,
  onSelect,
}: {
  steps: ScriptStep[];
  current: number;
  done: (i: number) => boolean;
  onSelect: (i: number) => void;
}) {
  const list = useRef<HTMLOListElement>(null);
  // keep the current step in view inside the (scrolling) list without scrolling the page
  useEffect(() => {
    const ol = list.current;
    const item = ol?.querySelector<HTMLElement>('[aria-current="step"]');
    if (!ol || !item) return;
    const top = item.offsetTop - ol.offsetTop;
    if (top < ol.scrollTop || top + item.offsetHeight > ol.scrollTop + ol.clientHeight) {
      ol.scrollTop = Math.max(0, top - ol.clientHeight / 3);
    }
  }, [current]);
  const doneCount = steps.filter((_, i) => done(i)).length;
  return (
    <details className={styles.stepsBox} open data-testid="lesson-steps">
      <summary>
        Steps <span className={styles.meta}>({doneCount} of {steps.length} done)</span>
      </summary>
      <ol ref={list} className={styles.steps} aria-label="Lesson steps">
        {steps.map((s, i) => {
          const isCurrent = i === current;
          const isDone = done(i);
          return (
            <li key={s.id}>
              <button
                type="button"
                className={`${styles.stepButton} ${isCurrent ? styles.stepCurrent : ''} ${isDone ? styles.stepDone : ''}`}
                aria-current={isCurrent ? 'step' : undefined}
                data-testid={`lesson-step-${i}`}
                data-done={isDone}
                onClick={() => onSelect(i)}
              >
                <span className={styles.stepNum}>{i + 1}.</span>
                <span style={{ flex: 1 }}>{s.title}</span>
                {isDone && (
                  <span className={styles.tick} role="img" aria-label="done">
                    ✔
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ol>
    </details>
  );
}

function StepTitle({ step }: { step: ScriptStep }) {
  return (
    <h3 className={styles.stepTitle} data-testid="lesson-step-title">
      {step.title}
    </h3>
  );
}

// ------------------------------------------------------------------ watch

/** Steps whose check did not come out as narrated, for the end-of-lesson banner. */
function DeviationList({ script, steps, intro }: { script: Script; steps: readonly number[]; intro: string }) {
  return (
    <div className={styles.deviations} data-testid="lesson-deviations">
      {intro}
      <ul>
        {steps.map((i) => {
          const step = script.steps[i];
          return (
            <li key={i}>
              Step {i + 1}, {step.title}: {step.check ? `wanted ${describeCheck(step.check)}` : 'not done'}.
            </li>
          );
        })}
      </ul>
    </div>
  );
}

const NO_DEVIATIONS: readonly number[] = [];

function WatchView({ script }: { script: Script }) {
  const index = useLathe((s) => s.playerStatus?.stepIndex ?? 0);
  const done = useLathe((s) => s.playerStatus?.done ?? false);
  const deviations = useLathe((s) => s.playerStatus?.deviations ?? NO_DEVIATIONS);
  const jumpTo = useLathe((s) => s.jumpTo);
  const step = script.steps[index];
  const from = useStepStart(`${index}:${done}`);

  return (
    <div className={styles.lessonBody}>
      <div className={styles.current}>
        <Transport
          prefix="lesson"
          stepCount={script.steps.length}
          extra={
            <button type="button" className={styles.button} data-testid="lesson-restart" onClick={() => jumpTo(0)}>
              <img className={styles.icon} src={uiIcons.restart} alt="" />
              Restart
            </button>
          }
        />
        {done ? (
          deviations.length ? (
            <>
              <p className={styles.narration} data-testid="lesson-complete" data-deviations={deviations.length}>
                Lesson completed with deviations. The machine was changed during the demo, so not every step came out as narrated. Restart to watch it clean, or try it yourself.
              </p>
              <DeviationList script={script} steps={deviations} intro="These steps did not end the way the lesson describes:" />
            </>
          ) : (
            <p className={styles.narration} data-testid="lesson-complete">
              Lesson complete. Restart to watch again, or try it yourself.
            </p>
          )
        ) : (
          step && (
            <>
              <StepTitle step={step} />
              <StepBody step={step} from={from} />
            </>
          )
        )}
      </div>
      <StepList steps={script.steps} current={done ? -1 : index} done={(i) => done || i < index} onSelect={jumpTo} />
    </div>
  );
}

// ------------------------------------------------------------------ do it yourself

/** Whether step i's check already holds for the store's current state. */
function arrivalHolds(script: Script, i: number): boolean {
  const check = script.steps[i]?.check;
  return !!check && evaluateCheck(check, useLathe.getState().state);
}

/** How the user got to the current step: moving on (Next or a completed check) or picking it from the list. */
type Arrival = 'forward' | 'picked';

function DiyView({ script, lessonId, onStep }: { script: Script; lessonId: string; onStep?: (i: number) => void }) {
  const setCamera = useLathe((s) => s.setCamera);
  const startLesson = useLathe((s) => s.startLesson);
  const showMe = useLathe((s) => s.showMe);
  const stopDemo = useLathe((s) => s.stopDemo);
  const showing = useLathe((s) => s.demo !== null);
  // where the machine is now: the step's moves are spelled out from here (turns, dial readings)
  const live = useLathe(
    useShallow((s): DescribeContext => ({ x: s.state.x, z: s.state.z, quill: s.state.quill, dialZero: s.state.dialZero })),
  );
  // the store's lesson player sits at the step the lesson was started from (Watch → DIY keeps it)
  const [index, setIndex] = useState(() => useLathe.getState().playerStatus?.stepIndex ?? 0);
  // true while the current step's check has held ever since we arrived at it
  const [heldOnArrival, setHeldOnArrival] = useState(() => arrivalHolds(script, index));
  const [arrival, setArrival] = useState<Arrival>('forward');
  // steps moved past with "Skip step" while their check did not hold (and not done since)
  const [skipped, setSkipped] = useState<readonly number[]>(NO_DEVIATIONS);
  const top = useRef<HTMLDivElement>(null);

  const n = script.steps.length;
  const complete = index >= n;
  const step = complete ? null : script.steps[index];
  // a narrow selector: re-render when the check flips, not on every engine frame
  const check = step?.check;
  const satisfied = useLathe((s) => !!check && evaluateCheck(check, s.state));
  if (heldOnArrival && !satisfied) setHeldOnArrival(false);

  const goTo = (i: number, how: Arrival) => {
    const next = Math.max(0, Math.min(n, i));
    if (step && next > index) {
      const ok = !step.check || evaluateCheck(step.check, useLathe.getState().state);
      setSkipped((was) => {
        const without = was.filter((k) => k !== index);
        return ok ? (without.length === was.length ? was : without) : [...without, index].sort((a, b) => a - b);
      });
    }
    setIndex(next);
    setArrival(how);
    setHeldOnArrival(arrivalHolds(script, next));
    const cam = script.steps[next]?.camera;
    if (cam) setCamera(cam);
  };

  // bring the instruction into view when the step changes (if it has scrolled out of view)
  const instruction = useRef<HTMLDivElement>(null);
  const firstStep = useRef(true);
  useEffect(() => {
    onStep?.(index);
    if (firstStep.current) {
      firstStep.current = false;
      return;
    }
    (instruction.current ?? top.current)?.scrollIntoView?.({ block: 'nearest' });
  }, [index, onStep]);

  // When the check holds (and Show me has finished), show the tick briefly, then move on. A step
  // that was already done when we arrived moves on too, after a longer pause so it can be read,
  // unless the user picked it from the list to look at it again.
  const autoAdvance = satisfied && !showing && (!heldOnArrival || arrival === 'forward');
  useEffect(() => {
    if (!autoAdvance) return;
    const id = setTimeout(() => goTo(index + 1, 'forward'), heldOnArrival ? ALREADY_DONE_DELAY : DIY_ADVANCE_DELAY);
    return () => clearTimeout(id);
    // goTo is recreated each render; index/heldOnArrival identify the pending move
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoAdvance, heldOnArrival, index]);

  const restart = () => {
    startLesson(lessonId, true);
    setSkipped(NO_DEVIATIONS);
    goTo(0, 'forward');
  };

  if (!step) {
    return (
      <div className={styles.lessonBody}>
        <div className={styles.current} ref={top}>
          <div className={styles.meta} data-testid="lesson-position">
            All {n} steps done
          </div>
          <ProgressBar value={1} label="Lesson progress" />
          {skipped.length ? (
            <>
              <p className={styles.narration} data-testid="lesson-complete" data-deviations={skipped.length}>
                You reached the end, with {skipped.length === 1 ? 'one step' : `${skipped.length} steps`} skipped. Go back to a skipped step from the list, or restart to do the whole lesson.
              </p>
              <DeviationList script={script} steps={skipped} intro="Skipped before they were done:" />
            </>
          ) : (
            <p className={styles.narration} data-testid="lesson-complete">
              Nice work: you did the whole lesson yourself.
            </p>
          )}
          <div className={styles.row}>
            <button type="button" className={styles.button} data-testid="lesson-restart" onClick={restart}>
              Restart
            </button>
          </div>
        </div>
        <StepList steps={script.steps} current={-1} done={() => true} onSelect={(i) => goTo(i, 'picked')} />
      </div>
    );
  }

  const doneText = heldOnArrival ? (autoAdvance ? '✔ Already done: moving on…' : '✔ Already done') : '✔ Done';
  return (
    <div className={styles.lessonBody}>
      <div className={styles.current} ref={top}>
        <div className={styles.positionRow}>
          <span className={styles.meta} data-testid="lesson-position">
            Step {index + 1} of {n}: your turn
          </span>
          <ProgressBar value={n ? index / n : 1} label="Lesson progress" />
        </div>
        <div
          ref={instruction}
          className={`${styles.instruction} ${satisfied ? styles.instructionDone : ''}`}
          data-testid="diy-instruction"
        >
          <StepTitle step={step} />
          <p className={styles.instructionText}>
            <strong>Your turn:</strong> {step.narration}
          </p>
          {step.check ? (
            <div className={styles.checkline} data-testid="diy-check" data-ok={satisfied} aria-live="polite">
              {satisfied ? (
                <span className={styles.checkOk} role="img" aria-label="step done">
                  {doneText}
                </span>
              ) : (
                <span className={styles.checkPending}>
                  <strong>Waiting until</strong> {describeCheck(step.check)}.
                </span>
              )}
            </div>
          ) : (
            <div className={styles.checkline}>
              <span className={styles.checkPending}>Press Next when you have done this.</span>
            </div>
          )}
        </div>
        <div className={styles.row} role="group" aria-label="Step controls">
          {showing ? (
            <button type="button" className={styles.button} data-testid="diy-show-me" onClick={() => stopDemo()}>
              <img className={styles.icon} src={uiIcons.pause} alt="" />
              Stop the demo
            </button>
          ) : (
            <button
              type="button"
              className={styles.button}
              data-testid="diy-show-me"
              title="Plays this step on the machine for you. The controls are locked while it plays."
              onClick={() => {
                setHeldOnArrival(false);
                showMe(step);
              }}
            >
              <img className={styles.icon} src={uiIcons.play} alt="" />
              Show me
            </button>
          )}
          <button
            type="button"
            className={styles.button}
            data-testid="diy-next"
            disabled={showing}
            onClick={() => goTo(index + 1, 'forward')}
          >
            <img className={styles.icon} src={uiIcons.stepForward} alt="" />
            {step.check && !satisfied ? 'Skip step' : 'Next'}
          </button>
          <button type="button" className={styles.button} data-testid="lesson-restart" onClick={restart}>
            <img className={styles.icon} src={uiIcons.restart} alt="" />
            Restart
          </button>
        </div>
        <SpeedButtons label="Show me speed" title="How fast Show me plays the step" />
        <StepBody step={step} narration={false} from={live} />
      </div>
      <StepList
        steps={script.steps}
        current={index}
        done={(i) => i < index}
        onSelect={(i) => goTo(i, 'picked')}
      />
    </div>
  );
}

// ------------------------------------------------------------------ panel

export interface LessonPanelProps {
  /** Lesson to show. Defaults to the lesson in the store's mode. */
  lessonId?: string;
  /** Do-it-yourself mode. Defaults to the store's mode. */
  doItYourself?: boolean;
}

export function LessonPanel({ lessonId, doItYourself }: LessonPanelProps) {
  const mode = useLathe((s) => s.mode);
  const reset = useLathe((s) => s.reset);
  const startLesson = useLathe((s) => s.startLesson);
  const diyIndex = useRef(0);
  const setDiyIndex = useCallback((i: number) => {
    diyIndex.current = i;
  }, []);

  const id = lessonId ?? (mode.kind === 'lesson' ? mode.id : undefined);
  const diy = doItYourself ?? (mode.kind === 'lesson' && mode.doItYourself);
  const script = id ? getLesson(id) : undefined;
  if (!id || !script) {
    return (
      <div className={styles.panel}>
        <p>No lesson selected.</p>
      </div>
    );
  }
  const title = getLessonMeta(id)?.title ?? id;
  // switching modes keeps your place: the new mode starts at the step you were on
  const switchMode = () => {
    const st = useLathe.getState();
    const at = diy ? diyIndex.current : st.playerStatus?.done ? 0 : (st.playerStatus?.stepIndex ?? 0);
    startLesson(id, !diy, at >= script.steps.length ? 0 : at);
  };

  return (
    <div className={`${styles.panel} ${styles.lessonPanel}`} data-testid="lesson-panel" data-diy={diy}>
      <div className={styles.header}>
        <h2>
          {title}
          <span className={styles.modeTag}>{diy ? 'Do it yourself' : 'Watch'}</span>
        </h2>
        <button
          type="button"
          className={styles.button}
          data-testid="lesson-switch-mode"
          title="Switch mode, starting from the step you are on"
          onClick={switchMode}
        >
          {diy ? 'Watch instead' : 'Do it yourself'}
        </button>
        <button type="button" className={styles.button} data-testid="lesson-exit" onClick={() => reset()}>
          Exit lesson
        </button>
      </div>
      {diy ? <DiyView key={id} script={script} lessonId={id} onStep={setDiyIndex} /> : <WatchView script={script} />}
    </div>
  );
}
