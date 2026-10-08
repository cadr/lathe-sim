import type { KeyboardEvent } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { MACHINE, recommendedRpm, sfm, sfmLimit } from '../engine';
import { uiIcons } from '../art';
import { useLathe } from '../store/useLathe';
import { Icon } from './Icon';
import { workingDiameter } from './derive';
import styles from './panels.module.css';
import common from './common.module.css';

export interface SpindleControlProps {
  disabled?: boolean;
}

type Dir = 'fwd' | 'off' | 'rev';
/** SFM status: ok, warn (within 15% of the limit) or over the limit. */
export function sfmStatus(value: number, limit: number): 'ok' | 'warn' | 'over' {
  if (value > limit + 1e-6) return 'over';
  if (value > limit * 0.85) return 'warn';
  return 'ok';
}

/**
 * Arrow-key handling for a radiogroup of buttons (roving focus): arrows move the selection to the
 * next or previous option and focus it, Home/End jump to the ends.
 */
export function radioKeyDown<T>(options: readonly T[], current: T, select: (v: T) => void) {
  return (e: KeyboardEvent<HTMLDivElement>) => {
    const i = Math.max(0, options.indexOf(current));
    let next: number;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (i + 1) % options.length;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (i - 1 + options.length) % options.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = options.length - 1;
    else return;
    e.preventDefault();
    select(options[next]);
    const buttons = e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]');
    buttons[next]?.focus();
  };
}

const RPMS = MACHINE.rpmOptions.filter((r) => r > 0);

export function SpindleControl({ disabled = false }: SpindleControlProps) {
  const s = useLathe(
    useShallow((st) => ({
      on: st.state.spindle.on,
      reverse: st.state.spindle.reverse,
      rpm: st.state.spindle.rpm,
      tool: st.state.tool,
      workpiece: st.state.workpiece,
      z: st.state.z,
    })),
  );
  const dispatch = useLathe((st) => st.dispatch);
  const dir: Dir = !s.on ? 'off' : s.reverse ? 'rev' : 'fwd';
  const setDir = (d: Dir) => dispatch({ type: 'setSpindle', on: d !== 'off', reverse: d === 'rev' });

  const material = s.workpiece?.material;
  const diameter = workingDiameter(s);
  const tool = s.tool === 'none' ? 'turning' : s.tool;
  const speed = diameter > 0 ? sfm(diameter, s.rpm) : 0;
  const limit = material ? sfmLimit(material, tool) : 0;
  const status = material ? sfmStatus(speed, limit) : 'ok';
  const rec = material && diameter > 0 ? recommendedRpm(material, diameter, tool) : null;

  const dirs: { id: Dir; label: string; icon: string }[] = [
    { id: 'fwd', label: 'FWD', icon: uiIcons.spindleFwd },
    { id: 'off', label: 'OFF', icon: uiIcons.spindleOff },
    { id: 'rev', label: 'REV', icon: uiIcons.spindleRev },
  ];

  return (
    <div className={styles.stack}>
      <div
        className={styles.segmented}
        role="radiogroup"
        aria-label="Spindle direction"
        onKeyDown={disabled ? undefined : radioKeyDown(dirs.map((d) => d.id), dir, setDir)}
      >
        {dirs.map((d) => (
          <button
            key={d.id}
            type="button"
            role="radio"
            aria-checked={dir === d.id}
            aria-label={`Spindle ${d.id === 'fwd' ? 'forward' : d.id === 'rev' ? 'reverse' : 'off'}`}
            data-testid={`spindle-${d.id}`}
            tabIndex={dir === d.id ? 0 : -1}
            className={`${styles.segment} ${dir === d.id ? (d.id === 'off' ? styles.segmentOff : styles.segmentOn) : ''}`}
            disabled={disabled}
            onClick={() => setDir(d.id)}
          >
            <Icon src={d.icon} size={18} />
            {d.label}
          </button>
        ))}
      </div>
      <div
        className={styles.rpmGroup}
        role="radiogroup"
        aria-label="Spindle speed (rpm)"
        onKeyDown={disabled ? undefined : radioKeyDown(RPMS, s.rpm, (rpm) => dispatch({ type: 'setRpm', rpm }))}
      >
        {RPMS.map((r) => (
            <button
              key={r}
              type="button"
              role="radio"
              aria-checked={s.rpm === r}
              aria-label={`${r} rpm${rec === r ? ' (recommended)' : ''}`}
              data-testid={`rpm-${r}`}
              tabIndex={s.rpm === r || (!RPMS.includes(s.rpm) && r === RPMS[0]) ? 0 : -1}
              className={`${styles.rpm} ${s.rpm === r ? styles.rpmActive : ''}`}
              disabled={disabled}
              onClick={() => dispatch({ type: 'setRpm', rpm: r })}
            >
              {r}
              {rec === r && <span className={styles.recDot} aria-hidden="true" />}
            </button>
          ))}
      </div>
      <div className={styles.sfmRow}>
        <span className={common.label}>Surface speed</span>
        <span className={`${common.mono} ${styles[`sfm_${status}`]}`} data-testid="spindle-sfm" data-status={status}>
          {material ? `${Math.round(speed)} sfm` : '—'}
          {material && <span className={styles.sfmLimit}> / {Math.round(limit)}</span>}
        </span>
      </div>
      {rec !== null && (
        <div className={styles.recTag} data-testid="spindle-recommended">
          Recommended: {rec} rpm at Ø{diameter.toFixed(3)} ({tool})
        </div>
      )}
      {status === 'over' && s.on && <div className={common.warnText}>Too fast for this diameter: expect chatter.</div>}
    </div>
  );
}
