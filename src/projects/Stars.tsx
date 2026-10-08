import styles from './projects.module.css';

/** Difficulty as filled/empty stars, out of 3. */
export function Stars({ n, max = 3 }: { n: number; max?: number }) {
  const filled = Math.max(0, Math.min(max, Math.round(n)));
  return (
    <span className={styles.stars} role="img" aria-label={`Difficulty ${filled} of ${max}`}>
      {'★'.repeat(filled)}
      {'☆'.repeat(max - filled)}
    </span>
  );
}
