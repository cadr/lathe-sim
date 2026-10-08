import { useShallow } from 'zustand/react/shallow';
import { TAILSTOCK_TOOLS, TAILSTOCK_TOOL_IDS, tailstockTipZ } from '../engine';
import { tailstockToolIcons } from '../art';
import { useLathe } from '../store/useLathe';
import { AxisHandwheel } from './AxisHandwheel';
import { Icon } from './Icon';
import { fmt3 } from './derive';
import common from './common.module.css';
import styles from './panels.module.css';

export interface TailstockPanelProps {
  disabled?: boolean;
}

export function TailstockPanel({ disabled = false }: TailstockPanelProps) {
  const { tool, tailstockZ, quill } = useLathe(
    useShallow((st) => ({ tool: st.state.tailstockTool, tailstockZ: st.state.tailstockZ, quill: st.state.quill })),
  );
  const dispatch = useLathe((st) => st.dispatch);
  const tip = tailstockTipZ(tool, tailstockZ, quill);
  return (
    <div className={styles.stack}>
      <div className={common.cardGrid} role="group" aria-label="Tailstock tools">
        {TAILSTOCK_TOOL_IDS.map((id) => {
          const info = TAILSTOCK_TOOLS[id];
          return (
            <button
              key={id}
              type="button"
              className={common.card}
              aria-pressed={tool === id}
              aria-label={info.name}
              title={info.description}
              data-testid={`tstool-${id}`}
              disabled={disabled}
              onClick={() => dispatch({ type: 'selectTailstockTool', tool: id })}
            >
              <Icon src={tailstockToolIcons[id]} size={28} />
              <span>{info.name}</span>
            </button>
          );
        })}
      </div>
      <AxisHandwheel axis="quill" label="Tailstock quill" directionHint="CW → advance" disabled={disabled} size={120} />
      <div className={styles.sfmRow}>
        <span className={common.label}>{tool === 'none' ? 'Quill face Z' : 'Tip Z'}</span>
        <span className={common.mono} data-testid="tailstock-tipz">
          {fmt3(tip)}
        </span>
      </div>
    </div>
  );
}
