import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { createStock, type TargetSpec } from '../../engine';
import { getChallenge } from '../../content';
import { useLathe } from '../../store/useLathe';
import { SectionDiagram, SectionView, sectionBounds, type SectionInput } from '../SectionView';
import { PartDrawing, tolText } from '../PartDrawing';

const brass = { material: 'brass' as const, diameter: 1, length: 3, stickOut: 1.5 };
const base: SectionInput = { workpiece: null, x: 0.75, z: 2, quill: 0, tool: 'none', tailstockTool: 'none', tailstockZ: 4 };

describe('SectionDiagram', () => {
  it('renders chuck and no profile without stock', () => {
    render(<SectionDiagram section={base} width={500} />);
    const svg = screen.getByTestId('section-view');
    expect(svg).toHaveAttribute('width', '500');
    expect(screen.getByTestId('section-jaws')).toBeInTheDocument();
    expect(screen.queryByTestId('section-profile')).toBeNull();
    expect(screen.queryByTestId('section-tool')).toBeNull();
    expect(screen.getByTestId('section-dia')).toHaveTextContent('No stock');
  });

  it('renders the profile, tool footprint, quill and drill, and the diameter at the tool', () => {
    const wp = createStock(brass);
    render(<SectionDiagram section={{ ...base, workpiece: wp, z: 1.2, x: 0.6, tool: 'turning', tailstockTool: 'drill-1/4', quill: 0.5 }} />);
    const d = screen.getByTestId('section-profile').getAttribute('d') ?? '';
    expect(d.length).toBeGreaterThan(10);
    // mirrored: two rectangles for one segment
    expect(d.match(/M/g)?.length).toBe(2);
    expect(screen.getByTestId('section-tool')).toBeInTheDocument();
    expect(screen.getByTestId('section-drill')).toBeInTheDocument();
    expect(screen.getByTestId('section-quill')).toBeInTheDocument();
    expect(screen.getByTestId('section-dia')).toHaveTextContent('Ø 1.000 at Z 1.200');
  });

  it('draws a bore and the live center', () => {
    const wp = createStock(brass);
    for (let i = 0; i < wp.inner.length; i++) wp.inner[i] = 0.125;
    render(<SectionDiagram section={{ ...base, workpiece: wp, tailstockTool: 'live-center' }} />);
    expect(screen.getByTestId('section-bore')).toBeInTheDocument();
    expect(screen.getByTestId('section-drill')).toBeInTheDocument();
  });

  it('bounds grow to include the work and tool', () => {
    const b = sectionBounds({ ...base, z: 4.2, x: 1.2 });
    expect(b.zMax).toBeGreaterThan(4.2);
    expect(b.rMax).toBeGreaterThan(1.2);
    expect(b.zMin).toBeLessThan(-0.6);
  });
});

describe('SectionView (connected)', () => {
  beforeEach(() => act(() => useLathe.getState().reset()));

  it('updates when material is removed', () => {
    render(<SectionView width={600} />);
    const s = useLathe.getState();
    act(() => {
      s.dispatch({ type: 'loadStock', stock: brass });
      s.dispatch({ type: 'selectTool', tool: 'turning' });
      s.dispatch({ type: 'setSpindle', on: true });
    });
    const before = screen.getByTestId('section-profile').getAttribute('d');
    act(() => {
      s.turn('z', -6, 2); // z 1.4: footprint covers the end of the stock
      s.turn('x', 7, 3); // radius 0.4: 0.1 off the radius... in small slices it is a facing move
    });
    // x feed is facing; the profile has changed
    expect(screen.getByTestId('section-profile').getAttribute('d')).not.toBe(before);
    expect(screen.getByTestId('section-dia')).toHaveTextContent(/Ø 0\.800 at Z 1\.400/);
  });
});

describe('PartDrawing', () => {
  it('renders diameters, lengths and tolerances for the stepped shaft', () => {
    const target = getChallenge('stepped-shaft')!.target;
    render(<PartDrawing target={target} title="Stepped shaft" />);
    const svg = screen.getByTestId('part-drawing');
    expect(svg).toHaveTextContent('Ø0.750 ±0.005');
    expect(svg).toHaveTextContent('Ø0.500 ±0.005');
    expect(svg).toHaveTextContent('1.250 ±0.010');
    expect(screen.getByTestId('pd-len-0')).toBeInTheDocument();
    expect(screen.getByTestId('pd-len-1')).toBeInTheDocument();
    expect(screen.getByTestId('pd-outline').getAttribute('d')).toMatch(/^M/);
    expect(svg).toHaveTextContent('Stepped shaft');
    expect(svg.querySelector('marker')).not.toBeNull();
  });

  it('renders a through bore', () => {
    const target = getChallenge('bushing')!.target;
    render(<PartDrawing target={target} />);
    expect(screen.getByTestId('pd-bore')).toHaveTextContent(/Ø0\.250 ±0\.010 (THRU|× )/);
    expect(screen.queryByTestId('pd-len-0')).toBeNull();
  });

  it('renders a blind bore with depth', () => {
    const target: TargetSpec = {
      segments: [{ z0: 0, z1: 1, diameter: 1, tol: 0.005 }],
      overallLength: 1,
      lengthTol: 0.01,
      bore: { diameter: 0.25, depth: 0.5, tol: 0.01 },
    };
    render(<PartDrawing target={target} width={400} />);
    expect(screen.getByTestId('pd-bore')).toHaveTextContent('× 0.500 DP');
    expect(screen.getByTestId('part-drawing')).toHaveAttribute('width', '400');
  });

  it('tolText formats', () => {
    expect(tolText(0.5, 0.005, 'Ø')).toBe('Ø0.500 ±0.005');
  });
});

describe('PartDrawing in the chuck', () => {
  it('draws the jaws, measures from them and runs the outline to the overall length', () => {
    const target = { segments: [{ z0: 0, z1: 1.4, diameter: 1, tol: 0.01 }], overallLength: 1.465, lengthTol: 0.025 };
    render(<PartDrawing target={target} inChuck />);
    expect(screen.getByTestId('pd-jaws')).toHaveTextContent('JAWS');
    expect(screen.getByTestId('pd-length')).toHaveTextContent('1.465 ±0.025 FROM JAWS');
    expect(screen.getByTestId('pd-face')).toHaveTextContent('FACE');
    expect(screen.queryByTestId('pd-general-tol')).toBeNull();
    // the outline's left edge is the overall-length extension line
    const xs = (screen.getByTestId('pd-outline').getAttribute('d') ?? '').match(/[\d.]+(?=,)/g)!.map(Number);
    const ext = screen.getByTestId('pd-length').querySelector('line')!;
    expect(Math.min(...xs)).toBeCloseTo(Number(ext.getAttribute('x1')), 0);
  });

  it('a stepped part gets a general tolerance note for its shoulder lengths', () => {
    const target = {
      segments: [
        { z0: 0, z1: 0.75, diameter: 0.5, tol: 0.005 },
        { z0: 0.75, z1: 1.25, diameter: 0.75, tol: 0.005 },
      ],
      overallLength: 1.25,
      lengthTol: 0.01,
    };
    render(<PartDrawing target={target} />);
    expect(screen.getByTestId('pd-general-tol')).toHaveTextContent('±0.010');
    expect(screen.queryByTestId('pd-jaws')).toBeNull();
  });
});

