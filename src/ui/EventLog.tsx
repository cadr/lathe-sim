import { useState } from 'react';
import { useLathe } from '../store/useLathe';
import { toastText } from '../store/toastText';
import { toastTone } from './Toasts';
import styles from './panels.module.css';

export interface EventLogProps {
  /** max rows shown (newest first) */
  limit?: number;
}

export function EventLog({ limit = 200 }: EventLogProps) {
  const events = useLathe((s) => s.state.events);
  const [showCuts, setShowCuts] = useState(false);
  const rows = [];
  for (let i = events.length - 1; i >= 0 && rows.length < limit; i--) {
    const e = events[i];
    if (!showCuts && e.kind === 'cut') continue;
    rows.push(
      <li key={i} className={`${styles.logRow} ${styles[`tone_${toastTone(e.kind)}`]}`} data-kind={e.kind}>
        <span className={styles.logTime}>{e.t.toFixed(1)}s</span>
        <span>{toastText(e)}</span>
      </li>,
    );
  }
  return (
    <div className={styles.stack} data-testid="event-log">
      <label className={styles.checkbox}>
        <input type="checkbox" checked={showCuts} onChange={(e) => setShowCuts(e.target.checked)} data-testid="event-log-cuts" />
        Show cut events
      </label>
      {rows.length === 0 ? <div className={styles.note}>No events yet.</div> : <ol className={styles.log}>{rows}</ol>}
    </div>
  );
}
