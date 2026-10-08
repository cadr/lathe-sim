// Landing content for the Project tab in free-play mode: lesson and challenge lists.
import { logo } from '../art';
import { challenges, getLesson, lessonMeta } from '../content';
import { scriptDuration } from '../engine';
import { useLathe } from '../store';
import { Stars } from './Stars';
import styles from './projects.module.css';

/** Rough level for each lesson, in teaching order. */
export function lessonLevel(index: number, total: number): 'Beginner' | 'Intermediate' | 'Advanced' {
  if (index < 2) return 'Beginner';
  if (index >= total - 1) return 'Advanced';
  return 'Intermediate';
}

/** Watch time at 1× for a lesson card: seconds (to the nearest 5) under a minute, else minutes. */
export function formatMinutes(seconds: number): string {
  if (seconds < 55) return `~${Math.max(5, Math.round(seconds / 5) * 5)} s`;
  return `~${Math.max(1, Math.round(seconds / 60))} min`;
}

export function Home() {
  const startLesson = useLathe((s) => s.startLesson);
  const startChallenge = useLathe((s) => s.startChallenge);

  return (
    <div className={styles.panel} data-testid="project-home">
      <div className={styles.header}>
        <img className={styles.logo} src={logo} alt="Lathe Sim" />
      </div>
      <p className={styles.intro}>
        Learn to run a small bench lathe by actually running one. Watch a lesson to see how each job is done, step by
        step, then try it yourself with the handwheels. When you are ready, take on a challenge: you get a dimensioned
        drawing and a bar of stock, and your part is measured and graded when you are done.
      </p>

      <h3 className={styles.sectionTitle}>Lessons</h3>
      <ul className={styles.cards}>
        {lessonMeta.map((meta, i) => {
          const script = getLesson(meta.id);
          return (
            <li key={meta.id} className={styles.card} data-testid={`lesson-card-${meta.id}`}>
              <h4>
                {i + 1}. {meta.title}
              </h4>
              <p>{meta.summary}</p>
              <div className={styles.meta}>
                <span>{lessonLevel(i, lessonMeta.length)}</span>
                {script && <span>{script.steps.length} steps</span>}
                {script && <span title="Watch time at 1× speed">{formatMinutes(scriptDuration(script))} to watch</span>}
              </div>
              <div className={styles.row}>
                <button
                  type="button"
                  className={styles.primary}
                  data-testid={`lesson-watch-${meta.id}`}
                  onClick={() => startLesson(meta.id, false)}
                >
                  Watch
                </button>
                <button
                  type="button"
                  className={styles.button}
                  data-testid={`lesson-diy-${meta.id}`}
                  onClick={() => startLesson(meta.id, true)}
                >
                  Do it yourself
                </button>
              </div>
            </li>
          );
        })}
      </ul>

      <h3 className={styles.sectionTitle}>Challenges</h3>
      <ul className={styles.cards}>
        {challenges.map((c) => (
          <li key={c.id} className={styles.card} data-testid={`challenge-card-${c.id}`}>
            <h4>{c.title}</h4>
            <div className={styles.meta}>
              <Stars n={c.difficulty} />
            </div>
            <p>{c.description}</p>
            <ul className={styles.chips} aria-label="Concepts">
              {c.concepts.map((k) => (
                <li key={k} className={styles.chip}>
                  {k}
                </li>
              ))}
            </ul>
            <div className={styles.row}>
              <button
                type="button"
                className={styles.primary}
                data-testid={`challenge-start-${c.id}`}
                onClick={() => startChallenge(c.id)}
              >
                Start
              </button>
            </div>
          </li>
        ))}
      </ul>

      <p className={styles.note}>
        <strong>Free play:</strong> the machine is yours. Load stock from the control panel, pick a tool and cut
        whatever you like. Nothing is graded.
      </p>
    </div>
  );
}
