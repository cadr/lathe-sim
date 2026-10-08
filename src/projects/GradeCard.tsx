import type { GradeResult, Mistake } from '../engine';
import styles from './projects.module.css';

const SEVERITY: Record<Mistake['severity'], { icon: string; label: string; className: string }> = {
  error: { icon: '✖', label: 'Error', className: styles.sevError },
  warning: { icon: '⚠', label: 'Warning', className: styles.sevWarning },
  tip: { icon: '💡', label: 'Tip', className: styles.sevTip },
};

export function formatTime(t: number): string {
  if (t < 60) return `${t.toFixed(1)} s`;
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function MistakeList({ mistakes }: { mistakes: Mistake[] }) {
  if (mistakes.length === 0) return null;
  return (
    <ul className={styles.mistakes} data-testid="mistake-list" aria-label="Where it went wrong">
      {mistakes.map((m, i) => {
        const sev = SEVERITY[m.severity];
        return (
          <li key={`${i}-${m.title}`} className={styles.mistake} data-testid="mistake" data-severity={m.severity}>
            <span className={sev.className} role="img" aria-label={sev.label}>
              {sev.icon}
            </span>
            <strong>
              {m.title}
              {m.t !== undefined && <span className={styles.mistakeTime}>at {formatTime(m.t)}</span>}
            </strong>
            <p>{m.detail}</p>
          </li>
        );
      })}
    </ul>
  );
}

export function GradeCard({ grade, mistakes }: { grade: GradeResult; mistakes: Mistake[] }) {
  return (
    <section className={styles.grade} data-testid="grade-card" aria-label="Grade">
      <div
        className={`${styles.banner} ${grade.passed ? styles.pass : styles.fail}`}
        data-testid="grade-banner"
        data-passed={grade.passed}
      >
        <span>{grade.passed ? 'Pass' : 'Not yet'}</span>
        <span data-testid="grade-score">{grade.score} / 100</span>
      </div>
      <table className={styles.table}>
        <thead>
          <tr>
            <th scope="col">Check</th>
            <th scope="col">Expected</th>
            <th scope="col">Actual</th>
            <th scope="col" aria-label="OK" />
          </tr>
        </thead>
        <tbody>
          {grade.checks.map((c) => (
            <tr key={c.label} data-testid="grade-check" data-ok={c.ok}>
              <td>{c.label}</td>
              <td>{c.expected}</td>
              <td>{c.actual}</td>
              <td>
                <span
                  className={c.ok ? styles.okIcon : styles.badIcon}
                  role="img"
                  aria-label={c.ok ? 'ok' : 'out of spec'}
                >
                  {c.ok ? '✔' : '✖'}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {grade.deductions.length > 0 && (
        <div>
          <strong>Deductions</strong>
          <ul className={styles.deductions} data-testid="grade-deductions">
            {grade.deductions.map((d) => (
              <li key={d.label}>
                {d.label}: −{d.points}
              </li>
            ))}
          </ul>
        </div>
      )}
      <MistakeList mistakes={mistakes} />
    </section>
  );
}
