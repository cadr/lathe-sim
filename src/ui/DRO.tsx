import { useShallow } from 'zustand/react/shallow';
import { dialGraduationFor } from '../engine';
import { useLathe } from '../store/useLathe';
import { fmt3 } from './derive';
import styles from './DRO.module.css';

export interface DROProps {
  className?: string;
}

/** Digital readout overlay. */
export function DRO({ className }: DROProps) {
  const s = useLathe(
    useShallow((st) => ({
      x: st.state.x,
      z: st.state.z,
      quill: st.state.quill,
      zero: st.state.dialZero,
      on: st.state.spindle.on,
      reverse: st.state.spindle.reverse,
      rpm: st.state.spindle.rpm,
      cutting: st.state.cutting,
      crashed: st.state.damage.crashed,
      broken: st.state.damage.toolBroken,
    })),
  );
  // whole graduations, wrapped to the collar (a reading of 99.6 shows 00, not 100)
  const dial = (axis: 'x' | 'z' | 'quill') => dialGraduationFor(axis, s[axis], s.zero[axis]);
  const dir = !s.on ? 'OFF' : s.reverse ? 'REV' : 'FWD';
  return (
    <section className={[styles.dro, className].filter(Boolean).join(' ')} aria-label="Digital readout">
      <Row label="X dia" value={fmt3(2 * s.x)} testId="dro-xdia" dial={dial('x')} dialTestId="dro-dial-x" />
      <Row label="X rad" value={fmt3(s.x)} testId="dro-xrad" />
      <Row label="Z" value={fmt3(s.z)} testId="dro-z" dial={dial('z')} dialTestId="dro-dial-z" />
      <Row label="Quill" value={fmt3(s.quill)} testId="dro-quill" dial={dial('quill')} dialTestId="dro-dial-quill" />
      <div className={styles.row}>
        <span className={styles.label}>RPM</span>
        <span className={styles.value} data-testid="dro-rpm">
          {s.rpm}
        </span>
        <span className={`${styles.dir} ${s.on ? styles.dirOn : ''}`} data-testid="dro-spindle">
          {dir}
        </span>
      </div>
      <div className={styles.badges}>
        {s.cutting && (
          <span className={styles.cutting} data-testid="dro-cutting">
            CUTTING
          </span>
        )}
        {s.crashed && (
          <span className={styles.danger} data-testid="dro-crash">
            CRASH
          </span>
        )}
        {s.broken && (
          <span className={styles.danger} data-testid="dro-broken">
            TOOL BROKEN
          </span>
        )}
      </div>
    </section>
  );
}

interface RowProps {
  label: string;
  value: string;
  testId: string;
  dial?: number;
  dialTestId?: string;
}

function Row({ label, value, testId, dial, dialTestId }: RowProps) {
  return (
    <div className={styles.row}>
      <span className={styles.label}>{label}</span>
      <span className={styles.value} data-testid={testId}>
        {value}
      </span>
      {dial !== undefined && (
        <span className={styles.dial} data-testid={dialTestId} title="Dial collar reading (thou)">
          ◷{String(dial).padStart(2, '0')}
        </span>
      )}
    </div>
  );
}
