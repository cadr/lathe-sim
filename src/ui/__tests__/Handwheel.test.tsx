import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Handwheel, angleDelta, dtForDivisions, formatReading, MIN_STEP_DT, STEADY_FEED } from '../Handwheel';

// x: 0.050" per rev, 50 divisions; reported at the steady feed
const DT_ONE_DIVISION = MIN_STEP_DT;
const DT_TEN_DIVISIONS = 0.01 / STEADY_FEED;
const DT_ONE_REV = 0.05 / STEADY_FEED;
import { HOLD_DELAY_MS, REPEAT_MS } from '../useHoldRepeat';

function setup(over: Partial<Parameters<typeof Handwheel>[0]> = {}) {
  const onTurn = vi.fn();
  const onZero = vi.fn();
  const utils = render(
    <Handwheel axis="x" label="Cross slide" divisions={50} reading={12} position={0.5} onTurn={onTurn} onZero={onZero} directionHint="CW → in" {...over} />,
  );
  return { onTurn, onZero, ...utils };
}

afterEach(() => vi.useRealTimers());

describe('Handwheel', () => {
  it('shows the dial reading, position and direction hint', () => {
    setup({ positionLabel: 'Ø', displayPosition: 1.0 });
    expect(screen.getByTestId('hw-x-reading')).toHaveTextContent('12');
    expect(screen.getByTestId('hw-x-position')).toHaveTextContent('Ø 1.000');
    expect(screen.getByText('CW → in')).toBeInTheDocument();
    const wheel = screen.getByRole('slider', { name: 'Cross slide handwheel' });
    expect(wheel).toHaveAttribute('aria-valuenow', '12');
    expect(wheel).toHaveAttribute('aria-valuemax', '49');
  });

  it('pads single-digit readings and wraps', () => {
    setup({ reading: 3 });
    expect(screen.getByTestId('hw-x-reading')).toHaveTextContent('03');
  });

  it('numbers the collar every 5 for 50 divisions and every 10 for 100', () => {
    const { container, unmount } = setup();
    expect(container.querySelectorAll('text').length).toBe(10 + 1);
    unmount();
    const r = render(<Handwheel axis="z" label="Carriage" divisions={100} reading={0} position={2} onTurn={vi.fn()} onZero={vi.fn()} />);
    expect(r.container.querySelectorAll('text').length).toBe(10 + 1);
  });

  it.each([
    ['minus1', -1 / 50, DT_ONE_DIVISION],
    ['plus1', 1 / 50, DT_ONE_DIVISION],
    ['minus10', -10 / 50, DT_TEN_DIVISIONS],
    ['plus10', 10 / 50, DT_TEN_DIVISIONS],
    ['minusrev', -1, DT_ONE_REV],
    ['plusrev', 1, DT_ONE_REV],
  ])('button %s turns %f rev (keyboard click)', (id, revs, dt) => {
    const { onTurn } = setup();
    fireEvent.click(screen.getByTestId(`hw-x-${id}`));
    expect(onTurn).toHaveBeenCalledTimes(1);
    expect(onTurn.mock.calls[0][0]).toBeCloseTo(revs);
    expect(onTurn.mock.calls[0][1]).toBeCloseTo(dt);
  });

  it('a full-rev button on z reports a steady feed (0.1" in 5 s: 0.004"/rev even at 300 rpm)', () => {
    const onTurn = vi.fn();
    render(<Handwheel axis="z" label="Carriage" divisions={100} reading={0} position={2} onTurn={onTurn} onZero={vi.fn()} />);
    fireEvent.click(screen.getByTestId('hw-z-plusrev'));
    expect(onTurn.mock.calls[0][0]).toBe(1);
    expect(onTurn.mock.calls[0][1]).toBeCloseTo(5);
    fireEvent.click(screen.getByTestId('hw-z-minus1'));
    expect(onTurn).toHaveBeenLastCalledWith(-0.01, 0.05);
  });

  it('pointer press fires once; holding repeats; release stops', () => {
    vi.useFakeTimers();
    const { onTurn } = setup();
    const btn = screen.getByTestId('hw-x-plus1');
    fireEvent.pointerDown(btn, { button: 0 });
    expect(onTurn).toHaveBeenCalledTimes(1);
    act(() => vi.advanceTimersByTime(HOLD_DELAY_MS - 10));
    expect(onTurn).toHaveBeenCalledTimes(1);
    act(() => vi.advanceTimersByTime(10 + REPEAT_MS * 3));
    expect(onTurn).toHaveBeenCalledTimes(4);
    fireEvent.pointerUp(btn);
    // a mouse click after pointerdown has detail 1 and must not double-fire
    fireEvent.click(btn, { detail: 1 });
    act(() => vi.advanceTimersByTime(REPEAT_MS * 5));
    expect(onTurn).toHaveBeenCalledTimes(4);
  });

  it('repeats report the real time since the last repeat, so a held button feeds at its true rate', () => {
    vi.useFakeTimers();
    const { onTurn } = setup();
    fireEvent.pointerDown(screen.getByTestId('hw-x-plusrev'), { button: 0 });
    act(() => vi.advanceTimersByTime(HOLD_DELAY_MS + REPEAT_MS * 2));
    expect(onTurn.mock.calls[0][1]).toBeCloseTo(DT_ONE_REV);
    // first repeat: HOLD_DELAY + REPEAT after the press; then REPEAT apart
    expect(onTurn.mock.calls[1][1]).toBeCloseTo((HOLD_DELAY_MS + REPEAT_MS) / 1000, 2);
    expect(onTurn.mock.calls[2][1]).toBeCloseTo(REPEAT_MS / 1000, 2);
  });

  it('a hold stops when the button becomes disabled and does not resume when re-enabled', () => {
    vi.useFakeTimers();
    const onTurn = vi.fn();
    const props = { axis: 'x' as const, label: 'Cross slide', divisions: 50, reading: 0, position: 0.5, onTurn, onZero: vi.fn() };
    const { rerender } = render(<Handwheel {...props} />);
    fireEvent.pointerDown(screen.getByTestId('hw-x-plus1'), { button: 0 });
    act(() => vi.advanceTimersByTime(HOLD_DELAY_MS + REPEAT_MS));
    rerender(<Handwheel {...props} disabled />);
    const n = onTurn.mock.calls.length;
    act(() => vi.advanceTimersByTime(REPEAT_MS * 5));
    rerender(<Handwheel {...props} />);
    act(() => vi.advanceTimersByTime(REPEAT_MS * 5));
    expect(onTurn).toHaveBeenCalledTimes(n);
  });

  it('Shift+wheel reads deltaX when the browser turns it into horizontal scrolling', () => {
    const { onTurn } = setup();
    const wheel = screen.getByTestId('hw-x-wheel');
    fireEvent.wheel(wheel, { deltaY: 0, deltaX: 100, shiftKey: true });
    expect(onTurn).toHaveBeenLastCalledWith(10 / 50, expect.any(Number));
    fireEvent.wheel(wheel, { deltaY: 0, deltaX: 100 });
    expect(onTurn).toHaveBeenCalledTimes(1);
  });

  it('PageUp / PageDown turn a revolution; ↑ / ↓ one division', () => {
    const { onTurn } = setup();
    const wheel = screen.getByTestId('hw-x-wheel');
    fireEvent.keyDown(wheel, { key: 'PageUp' });
    expect(onTurn).toHaveBeenLastCalledWith(1, DT_ONE_REV);
    fireEvent.keyDown(wheel, { key: 'PageDown' });
    expect(onTurn).toHaveBeenLastCalledWith(-1, DT_ONE_REV);
    fireEvent.keyDown(wheel, { key: 'ArrowUp' });
    expect(onTurn.mock.calls[2][0]).toBeCloseTo(1 / 50);
    fireEvent.keyDown(wheel, { key: 'ArrowDown' });
    expect(onTurn.mock.calls[3][0]).toBeCloseTo(-1 / 50);
  });

  it('formats readings on the collar, wrapping 49.6 to 00', () => {
    expect(formatReading(49.6, 50)).toBe('00');
    expect(formatReading(-1, 100)).toBe('99');
    expect(formatReading(7.2, 100)).toBe('07');
  });

  it('pointer leave stops the repeat', () => {
    vi.useFakeTimers();
    const { onTurn } = setup();
    const btn = screen.getByTestId('hw-x-minus10');
    fireEvent.pointerDown(btn, { button: 0 });
    act(() => vi.advanceTimersByTime(HOLD_DELAY_MS + REPEAT_MS));
    const n = onTurn.mock.calls.length;
    fireEvent.pointerLeave(btn);
    act(() => vi.advanceTimersByTime(REPEAT_MS * 5));
    expect(onTurn).toHaveBeenCalledTimes(n);
  });

  it('zero button calls onZero', () => {
    const { onZero } = setup();
    fireEvent.click(screen.getByTestId('hw-x-zero'));
    expect(onZero).toHaveBeenCalledTimes(1);
  });

  it('keyboard: → is clockwise, ← counter-clockwise, shift = 10, alt = 1 rev', () => {
    const { onTurn } = setup();
    const wheel = screen.getByTestId('hw-x-wheel');
    fireEvent.keyDown(wheel, { key: 'ArrowRight' });
    fireEvent.keyDown(wheel, { key: 'ArrowLeft' });
    fireEvent.keyDown(wheel, { key: 'ArrowRight', shiftKey: true });
    fireEvent.keyDown(wheel, { key: 'ArrowLeft', altKey: true });
    fireEvent.keyDown(wheel, { key: 'a' });
    const revs = onTurn.mock.calls.map((c) => c[0]);
    expect(revs).toHaveLength(4);
    expect(revs[0]).toBeCloseTo(1 / 50);
    expect(revs[1]).toBeCloseTo(-1 / 50);
    expect(revs[2]).toBeCloseTo(10 / 50);
    expect(revs[3]).toBeCloseTo(-1);
  });

  it('mouse wheel: one notch = 1 division, shift = 10, scroll down = clockwise', () => {
    const { onTurn } = setup();
    const wheel = screen.getByTestId('hw-x-wheel');
    fireEvent.wheel(wheel, { deltaY: 100 });
    fireEvent.wheel(wheel, { deltaY: -100, shiftKey: true });
    fireEvent.wheel(wheel, { deltaY: 0 });
    expect(onTurn).toHaveBeenCalledTimes(2);
    expect(onTurn.mock.calls[0][0]).toBeCloseTo(1 / 50);
    expect(onTurn.mock.calls[1][0]).toBeCloseTo(-10 / 50);
  });

  it('drag clockwise dispatches whole divisions, one per call, with dt from timestamps', () => {
    const { onTurn } = setup();
    const wheel = screen.getByTestId('hw-x-wheel');
    // jsdom rect is all zeros, so the center is (0,0)
    fireEvent.pointerDown(wheel, { button: 0, pointerId: 1, clientX: 100, clientY: 0, timeStamp: 0 });
    // quarter turn clockwise on screen (y down): from +x to +y
    fireEvent.pointerMove(wheel, { pointerId: 1, clientX: 0, clientY: 100 });
    expect(onTurn.mock.calls.length).toBe(12); // 12.5 divisions → 12 whole
    for (const [r, dt] of onTurn.mock.calls) {
      expect(r).toBeCloseTo(1 / 50);
      expect(dt).toBeGreaterThan(0);
    }
    // back counter-clockwise past the start
    onTurn.mockClear();
    fireEvent.pointerMove(wheel, { pointerId: 1, clientX: 100, clientY: -100 });
    const total = onTurn.mock.calls.reduce((a, c) => a + c[0], 0);
    expect(total).toBeLessThan(0);
    for (const [r] of onTurn.mock.calls) expect(r).toBeCloseTo(-1 / 50);
    fireEvent.pointerUp(wheel, { pointerId: 1 });
    onTurn.mockClear();
    fireEvent.pointerMove(wheel, { pointerId: 1, clientX: 0, clientY: 100 });
    expect(onTurn).not.toHaveBeenCalled();
  });

  it('ignores input when disabled', () => {
    const { onTurn } = setup({ disabled: true });
    fireEvent.click(screen.getByTestId('hw-x-plus1'));
    fireEvent.keyDown(screen.getByTestId('hw-x-wheel'), { key: 'ArrowRight' });
    fireEvent.wheel(screen.getByTestId('hw-x-wheel'), { deltaY: 100 });
    expect(onTurn).not.toHaveBeenCalled();
    expect(screen.getByTestId('hw-x-zero')).toBeDisabled();
  });

  it('helpers', () => {
    expect(angleDelta(0.1, -0.1)).toBeCloseTo(0.2);
    expect(angleDelta(Math.PI - 0.1, -Math.PI + 0.1)).toBeCloseTo(-0.2);
    expect(angleDelta(-Math.PI + 0.1, Math.PI - 0.1)).toBeCloseTo(0.2);
    expect(dtForDivisions(1, 50, 0.05)).toBe(MIN_STEP_DT);
    expect(dtForDivisions(-10, 100, 0.1)).toBeCloseTo(0.5);
    expect(dtForDivisions(100, 100, 0.1)).toBeCloseTo(5);
    expect(dtForDivisions(50, 50, 0.05)).toBeCloseTo(2.5);
  });
});
