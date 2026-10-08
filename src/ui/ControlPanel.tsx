import { useId, useState, type ReactNode } from 'react';
import { AxisHandwheel } from './AxisHandwheel';
import { SpindleControl } from './SpindleControl';
import { StockPanel } from './StockPanel';
import { TailstockPanel } from './TailstockPanel';
import { ToolpostPanel } from './ToolpostPanel';
import styles from './ControlPanel.module.css';

export type ControlSectionId = 'spindle' | 'cross' | 'carriage' | 'tailstock' | 'toolpost' | 'stock';

export interface ControlPanelProps {
  /** disable every control (e.g. while a lesson demo is playing) */
  disabled?: boolean;
  /** sections collapsed initially */
  initiallyCollapsed?: ControlSectionId[];
  className?: string;
}

export function ControlPanel({ disabled = false, initiallyCollapsed = [], className }: ControlPanelProps) {
  const [collapsed, setCollapsed] = useState<Set<ControlSectionId>>(() => new Set(initiallyCollapsed));
  const toggle = (id: ControlSectionId) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const section = (id: ControlSectionId, title: string, body: ReactNode) => (
    <Section key={id} id={id} title={title} open={!collapsed.has(id)} onToggle={() => toggle(id)}>
      {body}
    </Section>
  );
  return (
    <aside className={[styles.panel, className].filter(Boolean).join(' ')} aria-label="Lathe controls" data-testid="control-panel">
      {section('spindle', 'Spindle', <SpindleControl disabled={disabled} />)}
      {section('cross', 'Cross slide (X)', <AxisHandwheel axis="x" label="Cross slide" directionHint="CW → in" disabled={disabled} />)}
      {section('carriage', 'Carriage (Z)', <AxisHandwheel axis="z" label="Carriage" directionHint="CW → tailstock" disabled={disabled} />)}
      {section('tailstock', 'Tailstock', <TailstockPanel disabled={disabled} />)}
      {section('toolpost', 'Toolpost', <ToolpostPanel disabled={disabled} />)}
      {section('stock', 'Stock', <StockPanel disabled={disabled} />)}
    </aside>
  );
}

interface SectionProps {
  id: ControlSectionId;
  title: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}

function Section({ id, title, open, onToggle, children }: SectionProps) {
  const bodyId = useId();
  return (
    <section className={styles.section} data-testid={`section-${id}`}>
      <h3 className={styles.heading}>
        <button
          type="button"
          className={styles.toggle}
          aria-expanded={open}
          aria-controls={bodyId}
          data-testid={`section-toggle-${id}`}
          onClick={onToggle}
        >
          <span className={styles.chevron} aria-hidden="true">
            {open ? '▾' : '▸'}
          </span>
          {title}
        </button>
      </h3>
      <div id={bodyId} className={styles.body} hidden={!open}>
        {children}
      </div>
    </section>
  );
}
