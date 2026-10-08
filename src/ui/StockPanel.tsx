import { useId, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { MACHINE, type Material, type StockSpec } from '../engine';
import { materialIcons, uiIcons } from '../art';
import { getChallenge } from '../content';
import { useLathe } from '../store/useLathe';
import { Icon } from './Icon';
import { MATERIAL_NAMES, pieceSummary } from './derive';
import common from './common.module.css';
import styles from './panels.module.css';

export interface StockPanelProps {
  disabled?: boolean;
}

export interface StockPreset {
  id: string;
  label: string;
  spec: StockSpec;
}

export const STOCK_PRESETS: StockPreset[] = [
  { id: 'brass-1000', label: '1.000 × 3.000 brass', spec: { material: 'brass', diameter: 1.0, length: 3.0, stickOut: 1.5 } },
  { id: 'bar-750', label: '0.750 bar', spec: { material: 'brass', diameter: 0.75, length: 3.0, stickOut: 1.5 } },
];

/** Shortest length the jaws need to grip (half the jaw length, rounded up to a common fraction). */
export const MIN_GRIP = 0.375;

export const STOCK_LIMITS = {
  diameter: [0.125, 2 * MACHINE.chuckJawOuterRadius] as const,
  length: [0.25, 6] as const,
};

/** Validation message for a stock spec, or null when it can be loaded. */
export function stockError(spec: StockSpec): string | null {
  const { diameter, length, stickOut } = spec;
  if (![diameter, length, stickOut].every(Number.isFinite)) return 'Enter numbers for every size.';
  if (diameter < STOCK_LIMITS.diameter[0] || diameter > STOCK_LIMITS.diameter[1])
    return `Diameter must be ${STOCK_LIMITS.diameter[0]}–${STOCK_LIMITS.diameter[1].toFixed(3)}".`;
  if (length < STOCK_LIMITS.length[0] || length > STOCK_LIMITS.length[1])
    return `Length must be ${STOCK_LIMITS.length[0]}–${STOCK_LIMITS.length[1]}".`;
  if (stickOut <= 0 || stickOut > length) return 'Stick-out must be more than 0 and no more than the length.';
  if (length - stickOut < MIN_GRIP - 1e-9)
    return `Leave at least ${MIN_GRIP.toFixed(3)}" in the jaws: stick-out can be at most ${(length - MIN_GRIP).toFixed(3)}" for this length.`;
  if (stickOut > MACHINE.tailstockZ - 0.5) return `Stick-out must stay under ${(MACHINE.tailstockZ - 0.5).toFixed(1)}" to clear the tailstock.`;
  return null;
}

const MATERIALS = Object.keys(MATERIAL_NAMES) as Material[];

export function StockPanel({ disabled = false }: StockPanelProps) {
  const { workpiece, parted, inventory, mode } = useLathe(
    useShallow((st) => ({
      workpiece: st.state.workpiece,
      parted: st.state.partedPieces,
      inventory: st.state.inventory,
      mode: st.mode,
    })),
  );
  const dispatch = useLathe((st) => st.dispatch);
  const [spec, setSpec] = useState<StockSpec>(STOCK_PRESETS[0].spec);
  const uid = useId();
  const challenge = mode.kind === 'challenge' ? getChallenge(mode.id) : undefined;
  const presets = challenge ? [{ id: 'challenge', label: `Challenge stock`, spec: challenge.stock }, ...STOCK_PRESETS] : STOCK_PRESETS;
  const error = stockError(spec);

  const num = (key: 'diameter' | 'length' | 'stickOut', label: string) => (
    <label className={styles.field} htmlFor={`${uid}-${key}`}>
      <span className={common.label}>{label}</span>
      <input
        id={`${uid}-${key}`}
        type="number"
        step={0.001}
        min={0}
        className={styles.input}
        value={Number.isFinite(spec[key]) ? spec[key] : ''}
        data-testid={`stock-${key}`}
        disabled={disabled}
        onChange={(e) => setSpec({ ...spec, [key]: e.target.value === '' ? NaN : Number(e.target.value) })}
      />
    </label>
  );

  return (
    <div className={styles.stack}>
      <div className={styles.presetRow} role="group" aria-label="Stock presets">
        {presets.map((p) => (
          <button
            key={p.id}
            type="button"
            className={common.btn}
            data-testid={`stock-preset-${p.id}`}
            disabled={disabled}
            onClick={() => setSpec(p.spec)}
          >
            {p.label}
          </button>
        ))}
      </div>
      <div className={styles.fieldGrid}>
        <label className={styles.field} htmlFor={`${uid}-material`}>
          <span className={common.label}>Material</span>
          <span className={styles.materialRow}>
            <img src={materialIcons[spec.material]} alt="" width={18} height={18} />
            <select
              id={`${uid}-material`}
              className={styles.input}
              value={spec.material}
              data-testid="stock-material"
              disabled={disabled}
              onChange={(e) => setSpec({ ...spec, material: e.target.value as Material })}
            >
              {MATERIALS.map((m) => (
                <option key={m} value={m}>
                  {MATERIAL_NAMES[m]}
                </option>
              ))}
            </select>
          </span>
        </label>
        {num('diameter', 'Diameter')}
        {num('length', 'Length')}
        {num('stickOut', 'Stick-out')}
      </div>
      {error && (
        <div className={common.warnText} role="alert">
          {error}
        </div>
      )}
      <div className={styles.presetRow}>
        <button
          type="button"
          className={common.btnPrimary}
          data-testid="stock-load"
          disabled={disabled || error !== null}
          onClick={() => dispatch({ type: 'loadStock', stock: spec })}
        >
          <Icon src={uiIcons.loadStock} size={16} /> Load
        </button>
        <button
          type="button"
          className={common.btn}
          data-testid="stock-remove"
          disabled={disabled || !workpiece}
          onClick={() => dispatch({ type: 'removeStock' })}
        >
          Remove
        </button>
        <button
          type="button"
          className={common.btn}
          data-testid="stock-collect"
          disabled={disabled || parted.length === 0}
          onClick={() => dispatch({ type: 'collectPart' })}
        >
          <Icon src={uiIcons.collectPart} size={16} /> Collect part
          {parted.length > 0 ? ` (${parted.length})` : ''}
        </button>
      </div>
      {parted.length > 0 && <div className={styles.note}>{parted.length} part(s) waiting in the chip tray.</div>}
      <div>
        <div className={common.label}>Inventory</div>
        {inventory.length === 0 ? (
          <div className={styles.note}>No finished parts yet.</div>
        ) : (
          <ol className={styles.inventory} data-testid="stock-inventory">
            {inventory.map((wp, i) => (
              <li key={i} className={common.mono}>
                {pieceSummary(wp)}
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}
