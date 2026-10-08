import { useCallback } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { MACHINE, dialReadingFor, type Axis } from '../engine';
import { useLathe } from '../store/useLathe';
import { Handwheel } from './Handwheel';

export interface AxisHandwheelProps {
  axis: Axis;
  label: string;
  directionHint?: string;
  disabled?: boolean;
  size?: number;
}

/** Handwheel wired to the store for one axis. The X wheel shows diameter as its position. */
export function AxisHandwheel({ axis, label, directionHint, disabled, size }: AxisHandwheelProps) {
  const { position, zero } = useLathe(useShallow((st) => ({ position: st.state[axis], zero: st.state.dialZero[axis] })));
  const turn = useLathe((st) => st.turn);
  const dispatch = useLathe((st) => st.dispatch);
  const onTurn = useCallback((revs: number, dt: number) => turn(axis, revs, dt), [turn, axis]);
  const onZero = useCallback(() => dispatch({ type: 'zeroDial', axis }), [dispatch, axis]);
  return (
    <Handwheel
      axis={axis}
      label={label}
      divisions={MACHINE.dialDivisions[axis]}
      reading={dialReadingFor(axis, position, zero)}
      position={position}
      displayPosition={axis === 'x' ? 2 * position : position}
      positionLabel={axis === 'x' ? 'Ø' : axis === 'z' ? 'Z' : 'Q'}
      directionHint={directionHint}
      onTurn={onTurn}
      onZero={onZero}
      disabled={disabled}
      size={size}
    />
  );
}
