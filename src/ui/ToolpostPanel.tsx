import { useShallow } from 'zustand/react/shallow';
import { TOOLS, TOOL_IDS } from '../engine';
import { toolIcons } from '../art';
import { useLathe } from '../store/useLathe';
import { Icon } from './Icon';
import common from './common.module.css';
import styles from './panels.module.css';

export interface ToolpostPanelProps {
  disabled?: boolean;
}

/** The engine implements every tool in the catalog (the boring bar included), so all are offered. */
export function ToolpostPanel({ disabled = false }: ToolpostPanelProps) {
  const { tool, broken, running } = useLathe(
    useShallow((st) => ({
      tool: st.state.tool,
      broken: st.state.damage.toolBroken,
      running: st.state.spindle.on && st.state.spindle.rpm > 0,
    })),
  );
  const dispatch = useLathe((st) => st.dispatch);
  return (
    <div className={styles.stack}>
      <div className={common.cardGrid} role="group" aria-label="Toolpost tools">
        {TOOL_IDS.map((id) => {
          const info = TOOLS[id];
          const selected = tool === id;
          const isBroken = selected && broken;
          return (
            <button
              key={id}
              type="button"
              className={isBroken ? common.cardBroken : common.card}
              aria-pressed={selected}
              aria-label={`${info.name}${isBroken ? ' (broken, select to replace)' : ''}`}
              title={info.description}
              data-testid={`tool-${id}`}
              data-broken={isBroken || undefined}
              disabled={disabled}
              onClick={() => dispatch({ type: 'selectTool', tool: id })}
            >
              <Icon src={toolIcons[id]} size={32} />
              <span>{info.name}</span>
              <span className={common.cardNote}>{isBroken ? 'BROKEN: click for a fresh insert' : info.description}</span>
            </button>
          );
        })}
      </div>
      {running && <div className={common.warnText} data-testid="toolpost-warning">Stop the spindle before changing tools.</div>}
    </div>
  );
}
