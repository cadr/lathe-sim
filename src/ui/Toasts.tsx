import { uiIcons } from '../art';
import { useLathe, type ToastKind } from '../store/useLathe';
import { Icon } from './Icon';
import styles from './Toasts.module.css';

export type ToastTone = 'danger' | 'warn' | 'ok' | 'info';

export function toastTone(kind: ToastKind): ToastTone {
  switch (kind) {
    case 'crash':
    case 'toolBroken':
    case 'boringSolid':
    case 'heavyCut':
      return 'danger';
    case 'chatter':
    case 'rubbing':
    case 'poorFinish':
    case 'wrongDirection':
    case 'toolChangeWhileRunning':
      return 'warn';
    case 'parted':
      return 'ok';
    default:
      return 'info';
  }
}

export interface ToastsProps {
  className?: string;
}

export function Toasts({ className }: ToastsProps) {
  const toasts = useLathe((s) => s.toasts);
  const dismiss = useLathe((s) => s.dismissToast);
  return (
    // each toast announces itself: crashes and breakages as alerts (assertive), the rest politely
    <div className={[styles.stack, className].filter(Boolean).join(' ')} data-testid="toasts">
      {toasts.map((t) => {
        const tone = toastTone(t.kind);
        const icon = tone === 'danger' ? uiIcons.crash : tone === 'ok' ? uiIcons.check : uiIcons.warning;
        return (
          <div
            key={t.id}
            className={`${styles.toast} ${styles[tone]}`}
            data-testid={`toast-${t.kind}`}
            role={tone === 'danger' ? 'alert' : 'status'}
          >
            <Icon src={icon} size={20} />
            <span className={styles.text}>{t.text}</span>
            <button type="button" className={styles.close} aria-label="Dismiss" onClick={() => dismiss(t.id)}>
              ×
            </button>
          </div>
        );
      })}
    </div>
  );
}
