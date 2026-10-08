import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LatheScene, SceneErrorBoundary, webglAvailable } from '..';
import { SLOW_FPS, slowFrameRate } from '../LatheScene';

function Thrower(): null {
  throw new Error('Error creating WebGL context.');
}

// React re-dispatches render errors as window 'error' events in dev; jsdom prints
// those to stderr unless they are cancelled. The boundary still sees every error.
const quiet = (e: ErrorEvent) => e.preventDefault();

describe('SceneErrorBoundary', () => {
  beforeAll(() => window.addEventListener('error', quiet));
  afterAll(() => window.removeEventListener('error', quiet));
  afterEach(() => vi.restoreAllMocks());

  it('renders the fallback when something inside the canvas subtree throws', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const onError = vi.fn();
    render(
      <SceneErrorBoundary onError={onError}>
        <Thrower />
      </SceneErrorBoundary>,
    );
    expect(screen.getByTestId('scene-fallback')).toHaveTextContent('3D view unavailable');
    // reported as an error, so the e2e console guard fails on a broken scene
    expect(error).toHaveBeenCalledWith('3D view unavailable:', 'Error creating WebGL context.', expect.any(String));
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('renders children when nothing throws', () => {
    render(
      <SceneErrorBoundary>
        <p>ok</p>
      </SceneErrorBoundary>,
    );
    expect(screen.getByText('ok')).toBeInTheDocument();
    expect(screen.queryByTestId('scene-fallback')).toBeNull();
  });

  it('silent mode renders nothing on error', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { container } = render(
      <SceneErrorBoundary silent>
        <Thrower />
      </SceneErrorBoundary>,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('accepts a custom fallback', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    render(
      <SceneErrorBoundary fallback={<span>custom</span>}>
        <Thrower />
      </SceneErrorBoundary>,
    );
    expect(screen.getByText('custom')).toBeInTheDocument();
  });
});

describe('LatheScene without WebGL', () => {
  it('reports that it is unavailable so the app can start its own ticker', () => {
    expect(webglAvailable()).toBe(false);
    const onUnavailable = vi.fn();
    render(<LatheScene onUnavailable={onUnavailable} />);
    expect(onUnavailable).toHaveBeenCalledTimes(1);
  });

  it('shows the fallback inside the lathe-canvas wrapper', () => {
    render(<LatheScene />);
    const wrapper = screen.getByTestId('lathe-canvas');
    expect(wrapper).toContainElement(screen.getByTestId('scene-fallback'));
  });
});

describe('slowFrameRate', () => {
  it('reports the frame rate after the warm-up only when it is below the threshold', () => {
    const frames = (fps: number, seconds: number) => Array.from({ length: Math.ceil(fps * seconds) }, () => 1 / fps);
    expect(slowFrameRate([...frames(60, 2), ...frames(10, 5)])).toBeCloseTo(10, 0);
    expect(slowFrameRate([...frames(10, 2), ...frames(60, 5)])).toBeNull();
    expect(slowFrameRate(frames(10, 3))).toBeNull(); // not enough frames yet
    expect(SLOW_FPS).toBe(20);
  });
});
