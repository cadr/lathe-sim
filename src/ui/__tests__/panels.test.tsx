import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useLathe } from '../../store/useLathe';
import { SpindleControl, sfmStatus } from '../SpindleControl';
import { ToolpostPanel } from '../ToolpostPanel';
import { TailstockPanel } from '../TailstockPanel';
import { StockPanel, stockError } from '../StockPanel';
import { DRO } from '../DRO';
import { Toasts, toastTone } from '../Toasts';
import { EventLog } from '../EventLog';
import { ControlPanel } from '../ControlPanel';
import { pieceSummary, workingDiameter, fmt3 } from '../derive';
import { createStock } from '../../engine';

const st = () => useLathe.getState();
const brass = { material: 'brass' as const, diameter: 1, length: 3, stickOut: 1.5 };

beforeEach(() => {
  act(() => st().reset());
});

describe('SpindleControl', () => {
  it('switches FWD / REV / OFF', () => {
    render(<SpindleControl />);
    expect(screen.getByTestId('spindle-off')).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(screen.getByTestId('spindle-fwd'));
    expect(st().state.spindle).toMatchObject({ on: true, reverse: false });
    expect(screen.getByTestId('spindle-fwd')).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(screen.getByTestId('spindle-rev'));
    expect(st().state.spindle).toMatchObject({ on: true, reverse: true });
    fireEvent.click(screen.getByTestId('spindle-off'));
    expect(st().state.spindle.on).toBe(false);
  });

  it('arrow keys move through the radio groups (roving focus)', () => {
    render(<SpindleControl />);
    const dir = screen.getByRole('radiogroup', { name: 'Spindle direction' });
    expect(screen.getByTestId('spindle-off')).toHaveAttribute('tabindex', '0');
    expect(screen.getByTestId('spindle-fwd')).toHaveAttribute('tabindex', '-1');
    fireEvent.keyDown(dir, { key: 'ArrowRight' });
    expect(st().state.spindle).toMatchObject({ on: true, reverse: true });
    expect(screen.getByTestId('spindle-rev')).toHaveFocus();
    fireEvent.keyDown(dir, { key: 'Home' });
    expect(st().state.spindle).toMatchObject({ on: true, reverse: false });
    const rpm = screen.getByRole('radiogroup', { name: 'Spindle speed (rpm)' });
    fireEvent.keyDown(rpm, { key: 'ArrowLeft' });
    expect(st().state.spindle.rpm).toBe(300);
    fireEvent.keyDown(rpm, { key: 'End' });
    expect(st().state.spindle.rpm).toBe(2000);
    expect(screen.getByTestId('rpm-2000')).toHaveFocus();
  });

  it('offers rpm options without 0 and sets rpm', () => {
    render(<SpindleControl />);
    expect(screen.queryByTestId('rpm-0')).toBeNull();
    fireEvent.click(screen.getByTestId('rpm-300'));
    expect(st().state.spindle.rpm).toBe(300);
    expect(screen.getByTestId('rpm-300')).toHaveAttribute('aria-checked', 'true');
  });

  it('shows sfm with status and the recommended rpm', () => {
    render(<SpindleControl />);
    expect(screen.getByTestId('spindle-sfm')).toHaveTextContent('—');
    act(() => st().dispatch({ type: 'loadStock', stock: brass }));
    // 1" brass at 600 rpm = 157 sfm, limit 300
    expect(screen.getByTestId('spindle-sfm')).toHaveTextContent('157 sfm');
    expect(screen.getByTestId('spindle-sfm')).toHaveAttribute('data-status', 'ok');
    expect(screen.getByTestId('spindle-recommended')).toHaveTextContent('600 rpm');
    fireEvent.click(screen.getByTestId('rpm-2000'));
    expect(screen.getByTestId('spindle-sfm')).toHaveAttribute('data-status', 'over');
    fireEvent.click(screen.getByTestId('spindle-fwd'));
    expect(screen.getByText(/expect chatter/)).toBeInTheDocument();
    act(() => st().dispatch({ type: 'selectTool', tool: 'parting' }));
    expect(screen.getByTestId('spindle-recommended')).toHaveTextContent('300 rpm');
  });

  it('sfmStatus thresholds', () => {
    expect(sfmStatus(100, 300)).toBe('ok');
    expect(sfmStatus(280, 300)).toBe('warn');
    expect(sfmStatus(301, 300)).toBe('over');
  });
});

describe('ToolpostPanel', () => {
  it('selects tools, shows broken state and running warning', () => {
    render(<ToolpostPanel />);
    for (const id of ['none', 'turning', 'parting', 'boring']) expect(screen.getByTestId(`tool-${id}`)).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('tool-turning'));
    expect(st().state.tool).toBe('turning');
    expect(screen.getByTestId('tool-turning')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByTestId('toolpost-warning')).toBeNull();
    // break the tool with a very deep pass
    act(() => {
      st().dispatch({ type: 'loadStock', stock: brass });
      st().dispatch({ type: 'setSpindle', on: true });
      st().turn('x', 10, 1); // x 0.75 -> 0.25 (outside? no: 0.25 < 0.5 radius) but z=2 is clear of the stock
      st().turn('z', -6, 3); // feed into the 1.5 face: radial depth 0.25 → broken
    });
    expect(st().state.damage.toolBroken).toBe(true);
    expect(screen.getByTestId('tool-turning')).toHaveAttribute('data-broken', 'true');
    expect(screen.getByText(/BROKEN/)).toBeInTheDocument();
    expect(screen.getByTestId('toolpost-warning')).toBeInTheDocument();
  });
});

describe('TailstockPanel', () => {
  it('selects tailstock tools, turns the quill and shows the tip Z', () => {
    render(<TailstockPanel />);
    expect(screen.getByTestId('tailstock-tipz')).toHaveTextContent('4.000');
    fireEvent.click(screen.getByTestId('tstool-center-drill'));
    expect(st().state.tailstockTool).toBe('center-drill');
    expect(screen.getByTestId('tailstock-tipz')).toHaveTextContent('2.500');
    fireEvent.click(screen.getByTestId('hw-quill-plusrev'));
    expect(st().state.quill).toBeCloseTo(0.1);
    expect(screen.getByTestId('tailstock-tipz')).toHaveTextContent('2.400');
    fireEvent.click(screen.getByTestId('hw-quill-plus10'));
    expect(screen.getByTestId('hw-quill-reading')).toHaveTextContent('10');
    fireEvent.click(screen.getByTestId('hw-quill-zero'));
    expect(screen.getByTestId('hw-quill-reading')).toHaveTextContent('00');
  });
});

describe('StockPanel', () => {
  it('loads the default brass preset, removes it', () => {
    render(<StockPanel />);
    expect(screen.getByTestId('stock-remove')).toBeDisabled();
    expect(screen.getByTestId('stock-collect')).toBeDisabled();
    fireEvent.click(screen.getByTestId('stock-load'));
    expect(st().state.workpiece?.material).toBe('brass');
    expect(st().state.workpiece?.zEnd).toBeCloseTo(1.5);
    fireEvent.click(screen.getByTestId('stock-remove'));
    expect(st().state.workpiece).toBeNull();
  });

  it('edits material and sizes, uses presets, validates', () => {
    render(<StockPanel />);
    fireEvent.click(screen.getByTestId('stock-preset-bar-750'));
    expect(screen.getByTestId('stock-diameter')).toHaveValue(0.75);
    fireEvent.change(screen.getByTestId('stock-material'), { target: { value: 'aluminum' } });
    fireEvent.change(screen.getByTestId('stock-stickOut'), { target: { value: '1.25' } });
    fireEvent.click(screen.getByTestId('stock-load'));
    expect(st().state.workpiece?.material).toBe('aluminum');
    expect(st().state.workpiece?.zEnd).toBeCloseTo(1.25);
    fireEvent.change(screen.getByTestId('stock-diameter'), { target: { value: '5' } });
    expect(screen.getByRole('alert')).toHaveTextContent(/Diameter/);
    expect(screen.getByTestId('stock-load')).toBeDisabled();
    fireEvent.change(screen.getByTestId('stock-diameter'), { target: { value: '' } });
    expect(screen.getByRole('alert')).toHaveTextContent(/numbers/);
  });

  it('offers the challenge stock in challenge mode', () => {
    act(() => st().startChallenge('pin'));
    render(<StockPanel />);
    fireEvent.click(screen.getByTestId('stock-preset-challenge'));
    fireEvent.click(screen.getByTestId('stock-load'));
    expect(st().state.workpiece).not.toBeNull();
  });

  it('collects parted pieces into the inventory list', () => {
    act(() => {
      st().setSpeed(8);
      st().startChallenge('pin');
      st().playSolution();
    });
    act(() => {
      for (let i = 0; i < 100000 && !st().playerStatus?.done; i++) st().tick(1 / 20);
    });
    render(<StockPanel />);
    expect(st().state.partedPieces.length + st().state.inventory.length).toBeGreaterThan(0);
    if (st().state.partedPieces.length) {
      expect(screen.getByTestId('stock-collect')).toBeEnabled();
      fireEvent.click(screen.getByTestId('stock-collect'));
    }
    const inv = screen.getByTestId('stock-inventory');
    expect(within(inv).getAllByRole('listitem').length).toBeGreaterThan(0);
    expect(inv).toHaveTextContent(/Ø0\.50\d/);
  });

  it('stockError rules', () => {
    expect(stockError(brass)).toBeNull();
    expect(stockError({ ...brass, length: 10 })).toMatch(/Length/);
    expect(stockError({ ...brass, stickOut: 4 })).toMatch(/Stick-out/);
    expect(stockError({ ...brass, length: 5, stickOut: 3.8 })).toMatch(/tailstock/);
    // something has to stay in the jaws
    expect(stockError({ ...brass, stickOut: 3 })).toMatch(/in the jaws/);
    expect(stockError({ ...brass, stickOut: 2.625 })).toBeNull();
  });
});

describe('DRO', () => {
  it('formats positions to 3 decimals and shows dials, rpm, direction', () => {
    render(<DRO />);
    expect(screen.getByTestId('dro-xdia')).toHaveTextContent('1.500');
    expect(screen.getByTestId('dro-xrad')).toHaveTextContent('0.750');
    expect(screen.getByTestId('dro-z')).toHaveTextContent('2.000');
    expect(screen.getByTestId('dro-quill')).toHaveTextContent('0.000');
    expect(screen.getByTestId('dro-rpm')).toHaveTextContent('600');
    expect(screen.getByTestId('dro-spindle')).toHaveTextContent('OFF');
    act(() => {
      st().turn('x', 0.5);
      st().turn('z', -0.25);
      st().dispatch({ type: 'setSpindle', on: true, reverse: true });
    });
    expect(screen.getByTestId('dro-xdia')).toHaveTextContent('1.450');
    expect(screen.getByTestId('dro-dial-x')).toHaveTextContent('25');
    expect(screen.getByTestId('dro-z')).toHaveTextContent('1.975');
    expect(screen.getByTestId('dro-dial-z')).toHaveTextContent('75');
    expect(screen.getByTestId('dro-spindle')).toHaveTextContent('REV');
  });

  it('wraps dial readings to the collar (never shows 100 or 50)', () => {
    render(<DRO />);
    act(() => {
      // 0.4 thou toward the chuck from zero rounds to graduation 0, not 100
      st().dispatch({ type: 'turnHandwheel', axis: 'z', revolutions: -0.004 });
    });
    expect(screen.getByTestId('dro-dial-z')).toHaveTextContent('◷00');
  });

  it('shows CUTTING and damage badges', () => {
    render(<DRO />);
    expect(screen.queryByTestId('dro-cutting')).toBeNull();
    act(() => {
      st().dispatch({ type: 'loadStock', stock: brass });
      st().dispatch({ type: 'selectTool', tool: 'turning' });
      st().dispatch({ type: 'setSpindle', on: true });
      st().turn('z', -5.1, 2);
      st().turn('x', 6, 2);
      st().tick(0.016);
    });
    expect(screen.getByTestId('dro-cutting')).toBeInTheDocument();
    act(() => {
      st().turn('x', -10, 1);
      st().turn('z', -30, 5);
    });
    expect(screen.getByTestId('dro-crash')).toBeInTheDocument();
  });
});

describe('Toasts', () => {
  it('renders store toasts with tones and dismisses them', () => {
    render(<Toasts />);
    act(() => {
      st().dispatch({ type: 'loadStock', stock: brass });
      st().dispatch({ type: 'selectTool', tool: 'turning' });
      st().turn('z', -6, 1);
      st().turn('x', 6, 1);
    });
    const toast = screen.getByTestId('toast-rubbing');
    expect(toast).toHaveTextContent(/Rubbing/);
    fireEvent.click(within(toast).getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByTestId('toast-rubbing')).toBeNull();
  });

  it('crash toasts are alerts, warnings are polite status messages', () => {
    render(<Toasts />);
    act(() => {
      st().dispatch({ type: 'loadStock', stock: brass });
      st().dispatch({ type: 'selectTool', tool: 'turning' });
      st().turn('z', -6, 1);
      st().turn('x', 6, 1);
    });
    expect(screen.getByTestId('toast-rubbing')).toHaveAttribute('role', 'status');
    act(() => {
      st().turn('x', -10, 1);
      st().turn('z', -30, 5);
    });
    expect(screen.getByTestId('toast-crash')).toHaveAttribute('role', 'alert');
  });

  it('toastTone maps kinds', () => {
    expect(toastTone('crash')).toBe('danger');
    expect(toastTone('chatter')).toBe('warn');
    expect(toastTone('parted')).toBe('ok');
    expect(toastTone('spindleOn')).toBe('info');
  });
});

describe('EventLog', () => {
  it('lists events newest first and can show cut events', () => {
    render(<EventLog />);
    expect(screen.getByText('No events yet.')).toBeInTheDocument();
    act(() => {
      st().dispatch({ type: 'loadStock', stock: brass });
      st().dispatch({ type: 'selectTool', tool: 'turning' });
      st().dispatch({ type: 'setSpindle', on: true });
      st().turn('z', -5.1, 2);
      // a gentle facing feed (0.01 in/s, well under the per-revolution finish limit)
      st().turn('x', 6, 30);
    });
    const items = screen.getAllByRole('listitem');
    expect(items[0]).toHaveAttribute('data-kind', 'spindleOn');
    expect(items.some((li) => li.getAttribute('data-kind') === 'cut')).toBe(false);
    fireEvent.click(screen.getByTestId('event-log-cuts'));
    expect(screen.getAllByRole('listitem')[0]).toHaveAttribute('data-kind', 'cut');
  });
});

describe('ControlPanel', () => {
  it('composes the sections and collapses them', () => {
    render(<ControlPanel initiallyCollapsed={['stock']} />);
    expect(screen.getByTestId('hw-x-plus1')).toBeInTheDocument();
    expect(screen.getByTestId('hw-z-plus1')).toBeInTheDocument();
    expect(screen.getByTestId('spindle-fwd')).toBeInTheDocument();
    expect(screen.getByTestId('tool-turning')).toBeInTheDocument();
    expect(screen.getByTestId('stock-load')).not.toBeVisible();
    fireEvent.click(screen.getByTestId('section-toggle-stock'));
    expect(screen.getByTestId('stock-load')).toBeVisible();
    fireEvent.click(screen.getByTestId('section-toggle-cross'));
    expect(screen.getByTestId('section-toggle-cross')).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByTestId('hw-x-plus1')).not.toBeVisible();
  });

  it('x and z handwheel buttons move the machine with the right sign', () => {
    render(<ControlPanel />);
    fireEvent.click(screen.getByTestId('hw-x-plus10'));
    expect(st().state.x).toBeCloseTo(0.74); // clockwise = in
    expect(screen.getByTestId('hw-x-position')).toHaveTextContent('1.480');
    fireEvent.click(screen.getByTestId('hw-z-minusrev'));
    expect(st().state.z).toBeCloseTo(1.9); // counter-clockwise = toward chuck
    fireEvent.click(screen.getByTestId('hw-z-zero'));
    expect(screen.getByTestId('hw-z-reading')).toHaveTextContent('00');
  });

  it('disables controls', () => {
    render(<ControlPanel disabled />);
    expect(screen.getByTestId('spindle-fwd')).toBeDisabled();
    expect(screen.getByTestId('hw-z-plus1')).toBeDisabled();
    expect(screen.getByTestId('stock-load')).toBeDisabled();
  });
});

describe('derive helpers', () => {
  it('summarizes pieces and diameters', () => {
    const wp = createStock(brass);
    expect(pieceSummary(wp)).toMatch(/Brass Ø1\.000×3\.000/);
    expect(workingDiameter({ workpiece: wp, z: 1 })).toBeCloseTo(1);
    expect(workingDiameter({ workpiece: wp, z: 3 })).toBeCloseTo(1);
    expect(workingDiameter({ workpiece: null, z: 1 })).toBe(0);
    expect(fmt3(-0.0001)).toBe('0.000');
  });
});
