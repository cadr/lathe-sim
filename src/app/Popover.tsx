// A header button that opens a small panel. Closes on Escape, on a click outside, or on the button.
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import styles from '../App.module.css';

export interface PopoverProps {
  label: string;
  /** button content (defaults to the label) */
  button?: ReactNode;
  testId: string;
  children: ReactNode;
}

export function Popover({ label, button, testId, children }: PopoverProps) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    const onDown = (e: PointerEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onDown);
    };
  }, [open]);

  return (
    <div className={styles.popRoot} ref={root}>
      <button
        type="button"
        className={styles.headerButton}
        aria-expanded={open}
        aria-controls={panelId}
        aria-haspopup="dialog"
        data-testid={testId}
        onClick={() => setOpen((o) => !o)}
      >
        {button ?? label}
      </button>
      {open && (
        <div id={panelId} className={styles.popover} role="dialog" aria-label={label} data-testid={`${testId}-panel`}>
          {children}
        </div>
      )}
    </div>
  );
}
