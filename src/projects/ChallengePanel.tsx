// Project tab content while a challenge is active.
import { useEffect, useRef, useState } from 'react';
import { uiIcons } from '../art';
import { getChallenge } from '../content';
import type { Challenge, StockSpec, Workpiece } from '../engine';
import { useLathe } from '../store';
import { StepBody, Transport, useStepStart } from './Transport';
import { PartDrawing } from '../ui/PartDrawing';
import { GradeCard } from './GradeCard';
import { Stars } from './Stars';
import styles from './projects.module.css';

const fmt = (v: number) => v.toFixed(3);

export const SOLUTION_CONFIRM = 'Show the solution? This resets your work and plays the reference solution.';
export const RETRY_CONFIRM = 'Start again? This throws away your work on this part.';

export interface ChallengePanelProps {
  /** Challenge to show. Defaults to the challenge in the store's mode. */
  challenge?: Challenge;
  /**
   * Confirmation used before a destructive action (Show solution, Try again). Defaults to an
   * inline confirmation bar in the panel.
   */
  confirm?: (message: string) => boolean;
}

/** Whether the chucked workpiece is this stock (same material and size, as loaded). */
export function isStock(wp: Workpiece | null, stock: StockSpec): boolean {
  if (!wp) return false;
  const close = (a: number, b: number) => Math.abs(a - b) < 1e-6;
  return (
    wp.material === stock.material &&
    close(wp.zEnd, stock.stickOut) &&
    close(wp.zEnd - wp.zStart, stock.length) &&
    // the first column is deep in the jaws, so it is never cut
    close(2 * (wp.outer[0] ?? 0), stock.diameter)
  );
}

type Pending = 'solution' | 'retry' | null;

/** The reference solution's player: transport, current step and Take over. */
function SolutionPlayback({ challenge }: { challenge: Challenge }) {
  const index = useLathe((s) => s.playerStatus?.stepIndex ?? 0);
  const done = useLathe((s) => s.playerStatus?.done ?? false);
  const takeOver = useLathe((s) => s.takeOver);
  const steps = challenge.solution.steps;
  const step = steps[index];
  const from = useStepStart(`${index}:${done}`);
  return (
    <section className={styles.solution} data-testid="solution-playback" aria-label="Solution playback">
      <h3 className={styles.sectionTitle}>Reference solution</h3>
      <Transport
        prefix="solution"
        stepCount={steps.length}
        extra={
          !done && (
            <button
              type="button"
              className={styles.button}
              data-testid="solution-take-over"
              title="Stop the solution here and finish the part yourself"
              onClick={() => takeOver()}
            >
              Take over
            </button>
          )
        }
      />
      {done ? (
        <p data-testid="solution-done">
          The solution is finished. Check the part to see it measured, or Try again to make it yourself.
        </p>
      ) : (
        step && (
          <>
            <h4 className={styles.stepTitle} data-testid="solution-step-title">
              {step.title}
            </h4>
            <StepBody step={step} from={from} />
          </>
        )
      )}
    </section>
  );
}

export function ChallengePanel({ challenge: given, confirm }: ChallengePanelProps) {
  const mode = useLathe((s) => s.mode);
  const hint = useLathe((s) => s.hint);
  const grade = useLathe((s) => s.grade);
  const mistakes = useLathe((s) => s.mistakes);
  const loaded = useLathe((s) => s.state.workpiece !== null);
  const playing = useLathe((s) => s.player !== null);
  const solutionPlayed = useLathe((s) => s.solutionPlayed);
  const hasWork = useLathe((s) => s.state.actions.length > 0);
  const [pending, setPending] = useState<Pending>(null);
  const gradeRef = useRef<HTMLDivElement>(null);
  // a fresh grade can sit below the fold of the bottom panel: bring it into view
  useEffect(() => {
    if (grade) gradeRef.current?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
  }, [grade]);
  const dispatch = useLathe((s) => s.dispatch);
  const requestHint = useLathe((s) => s.requestHint);
  const checkPart = useLathe((s) => s.checkPart);
  const playSolution = useLathe((s) => s.playSolution);
  const startChallenge = useLathe((s) => s.startChallenge);
  const reset = useLathe((s) => s.reset);

  const challenge = given ?? (mode.kind === 'challenge' ? getChallenge(mode.id) : undefined);
  const isThisStock = useLathe((s) => !!challenge && isStock(s.state.workpiece, challenge.stock));
  if (!challenge) {
    return (
      <div className={styles.panel}>
        <p>No challenge selected.</p>
      </div>
    );
  }
  const { stock } = challenge;
  const run = (what: Exclude<Pending, null>) => {
    setPending(null);
    if (what === 'solution') playSolution();
    else startChallenge(challenge.id);
  };
  // ask first, inline (or through the given confirm function)
  const request = (what: Exclude<Pending, null>) => {
    if (what === 'retry' && !hasWork && !playing) return run('retry');
    if (confirm) {
      if (confirm(what === 'solution' ? SOLUTION_CONFIRM : RETRY_CONFIRM)) run(what);
      return;
    }
    setPending(what);
  };

  return (
    <div className={styles.panel} data-testid="challenge-panel">
      <div className={styles.header}>
        <h2>{challenge.title}</h2>
        <Stars n={challenge.difficulty} />
        <button
          type="button"
          className={styles.button}
          data-testid="challenge-retry"
          onClick={() => request('retry')}
        >
          Try again
        </button>
        <button type="button" className={styles.button} data-testid="challenge-exit" onClick={() => reset()}>
          Exit
        </button>
      </div>
      {pending && (
        <div className={styles.confirmBar} role="alertdialog" aria-label="Confirm" data-testid="challenge-confirm">
          <span>{pending === 'solution' ? SOLUTION_CONFIRM : RETRY_CONFIRM}</span>
          <button type="button" className={styles.primary} data-testid="challenge-confirm-yes" onClick={() => run(pending)}>
            {pending === 'solution' ? 'Show solution' : 'Start again'}
          </button>
          <button type="button" className={styles.button} data-testid="challenge-confirm-no" onClick={() => setPending(null)}>
            Cancel
          </button>
        </div>
      )}
      {/* the solution player comes first so its transport and narration are in view */}
      {playing && <SolutionPlayback challenge={challenge} />}
      <p className={styles.intro}>{challenge.description}</p>
      <ul className={styles.chips} aria-label="Concepts">
        {challenge.concepts.map((k) => (
          <li key={k} className={styles.chip}>
            {k}
          </li>
        ))}
      </ul>

      <div className={styles.challengeBody}>
        <div className={styles.current}>
          <h3 className={styles.sectionTitle}>Stock</h3>
          <dl className={styles.stock} data-testid="challenge-stock">
            <dt>Material</dt>
            <dd>{stock.material}</dd>
            <dt>Diameter</dt>
            <dd>Ø{fmt(stock.diameter)}"</dd>
            <dt>Length</dt>
            <dd>{fmt(stock.length)}"</dd>
            <dt>Stick-out</dt>
            <dd>{fmt(stock.stickOut)}"</dd>
          </dl>
          <div className={styles.row}>
            <button
              type="button"
              className={styles.button}
              data-testid="challenge-load-stock"
              onClick={() => dispatch({ type: 'loadStock', stock })}
            >
              <img className={styles.icon} src={uiIcons.loadStock} alt="" />
              {loaded && isThisStock ? 'Reload this stock' : 'Load this stock'}
            </button>
          </div>

          <h3 className={styles.sectionTitle}>Drawing</h3>
          <div className={styles.drawing}>
            <PartDrawing target={challenge.target} inChuck={!challenge.requireParted} />
          </div>
        </div>

        <div className={styles.current}>
          <div className={styles.row}>
            <button
              type="button"
              className={styles.button}
              data-testid="challenge-hint"
              onClick={() => requestHint()}
            >
              <img className={styles.icon} src={uiIcons.hint} alt="" />
              Hint
            </button>
            <button
              type="button"
              className={styles.primary}
              data-testid="challenge-check"
              onClick={() => checkPart()}
            >
              Check my part
            </button>
            <button
              type="button"
              className={styles.button}
              data-testid="challenge-solution"
              onClick={() => request('solution')}
            >
              Show solution
            </button>
          </div>

          {hint && (
            <div className={styles.hint} data-testid="challenge-hint-text" data-level={hint.level} aria-live="polite">
              <h4>
                <span className={styles.hintLevel} data-testid="challenge-hint-level">
                  {hint.level === 1 ? 'Hint' : 'More specific'}
                </span>
                {hint.title}
              </h4>
              {hint.notice && (
                <p className={styles.hintNotice} data-testid="challenge-hint-notice">
                  {hint.notice}
                </p>
              )}
              {hint.lines && hint.lines.length > 1 ? (
                <ol className={styles.hintLines} data-testid="challenge-hint-lines">
                  {hint.lines.map((l, i) => (
                    <li key={i}>{l}</li>
                  ))}
                </ol>
              ) : (
                <p>{hint.notice && hint.text.startsWith(hint.notice) ? hint.text.slice(hint.notice.length).trim() : hint.text}</p>
              )}
            </div>
          )}

          {grade && (
            <div ref={gradeRef}>
              {solutionPlayed && (
                <p className={styles.note} data-testid="grade-solution-note">
                  This part was made (at least partly) by the reference solution.
                </p>
              )}
              <GradeCard grade={grade} mistakes={mistakes} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
