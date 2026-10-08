import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App, { controlsLocked, lockedMessage, modeLabel } from '../../App';
import { useLathe } from '../../store';
import { NO3D_STORAGE_KEY } from '../settings';

const get = () => useLathe.getState();

function setSearch(search: string) {
  window.history.replaceState(null, '', `/${search}`);
}

describe('App shell', () => {
  beforeEach(() => {
    act(() => get().reset());
    localStorage.clear();
    setSearch('');
  });
  afterEach(() => {
    delete window.__lathe;
  });

  it('renders the header, tabs, viewport overlays and control panel', async () => {
    render(<App />);
    expect(within(screen.getByRole('banner')).getByRole('img', { name: 'Lathe Sim' })).toBeInTheDocument();
    expect(screen.getByTestId('mode-badge')).toHaveTextContent('Free play');
    for (const t of ['tab-project', 'tab-section', 'tab-log']) expect(screen.getByTestId(t)).toBeInTheDocument();
    expect(screen.getByTestId('control-panel')).toBeInTheDocument();
    expect(screen.getByTestId('dro-xdia')).toBeInTheDocument();
    expect(screen.getByTestId('toasts')).toBeInTheDocument();
    expect(screen.getByTestId('project-home')).toBeInTheDocument();
    // jsdom has no WebGL: the lazily loaded scene renders its fallback. Importing three can take
    // a few seconds under coverage instrumentation.
    expect(await screen.findByTestId('scene-fallback', undefined, { timeout: 20_000 })).toBeInTheDocument();
  }, 30_000);

  it('exposes the store as window.__lathe in dev', () => {
    render(<App />);
    expect(window.__lathe).toBe(useLathe);
  });

  it('switches tabs with clicks and arrow keys, and keeps the project panel mounted', () => {
    render(<App />);
    fireEvent.click(screen.getByTestId('tab-section'));
    expect(screen.getByTestId('tab-section')).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('section-view')).toBeInTheDocument();
    expect(screen.getByTestId('project-home')).not.toBeVisible();
    fireEvent.keyDown(screen.getByTestId('tab-section'), { key: 'ArrowRight' });
    expect(screen.getByTestId('event-log')).toBeInTheDocument();
    fireEvent.keyDown(screen.getByTestId('tab-log'), { key: 'ArrowRight' });
    expect(screen.getByTestId('tab-project')).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(screen.getByTestId('tab-project'), { key: 'ArrowLeft' });
    expect(screen.getByTestId('tab-log')).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(screen.getByTestId('tab-log'), { key: 'Enter' });
    expect(screen.getByTestId('tab-log')).toHaveAttribute('aria-selected', 'true');
  });

  it('starting a lesson shows its panel, updates the badge and locks the controls while it plays', () => {
    render(<App />);
    fireEvent.click(screen.getByTestId('tab-log'));
    fireEvent.click(screen.getByTestId('tab-project'));
    fireEvent.click(screen.getByTestId('lesson-watch-facing'));
    expect(screen.getByTestId('mode-badge')).toHaveTextContent('Lesson: Facing · Watch');
    expect(screen.getByTestId('lesson-panel')).toBeVisible();
    expect(screen.getByTestId('controls-locked')).toBeInTheDocument();
    expect(screen.getByTestId('spindle-fwd')).toBeDisabled();
    fireEvent.click(screen.getByTestId('lesson-play')); // pause
    expect(screen.queryByTestId('controls-locked')).not.toBeInTheDocument();
    expect(screen.getByTestId('spindle-fwd')).toBeEnabled();
    fireEvent.click(screen.getByTestId('app-home'));
    expect(get().mode.kind).toBe('free');
    expect(screen.getByTestId('project-home')).toBeVisible();
  });

  it('camera buttons set the store camera', () => {
    render(<App />);
    fireEvent.click(screen.getByTestId('cam-chuck'));
    expect(get().camera).toBe('chuck');
    expect(screen.getByTestId('cam-chuck')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('cam-overview')).toHaveAttribute('aria-pressed', 'false');
  });

  it('help popover opens, and closes on Escape and outside clicks', () => {
    render(<App />);
    fireEvent.click(screen.getByTestId('app-help'));
    const panel = screen.getByTestId('app-help-panel');
    expect(within(panel).getByText(/Shop safety rules/)).toBeInTheDocument();
    expect(panel).toHaveTextContent(/clockwise moves the tool in toward the center/);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByTestId('app-help-panel')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('app-help'));
    fireEvent.pointerDown(within(screen.getByTestId('app-help-panel')).getByText(/Shop safety rules/));
    expect(screen.getByTestId('app-help-panel')).toBeInTheDocument();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByTestId('app-help-panel')).not.toBeInTheDocument();
  });

  it('the settings toggle turns the 3D view off and remembers it', () => {
    const { unmount } = render(<App />);
    fireEvent.click(screen.getByTestId('app-settings'));
    const box = screen.getByTestId('setting-no3d');
    expect(box).not.toBeChecked();
    fireEvent.click(box);
    expect(localStorage.getItem(NO3D_STORAGE_KEY)).toBe('1');
    expect(screen.getByTestId('scene-fallback')).toHaveTextContent('3D view is off.');
    expect(screen.queryByTestId('lathe-canvas')).not.toBeInTheDocument();
    unmount();
    render(<App />);
    expect(screen.getByTestId('scene-fallback')).toHaveTextContent('3D view is off.');
    fireEvent.click(screen.getByTestId('app-settings'));
    fireEvent.click(screen.getByTestId('setting-no3d'));
    expect(localStorage.getItem(NO3D_STORAGE_KEY)).toBeNull();
  });

  it('?no3d=1 forces the fallback and locks the setting', () => {
    setSearch('?no3d=1');
    render(<App />);
    expect(screen.getByTestId('scene-fallback')).toHaveTextContent('3D view is off.');
    fireEvent.click(screen.getByTestId('app-settings'));
    expect(screen.getByTestId('setting-no3d')).toBeChecked();
    expect(screen.getByTestId('setting-no3d')).toBeDisabled();
    expect(screen.getByTestId('app-settings-panel')).toHaveTextContent('?no3d=1');
  });

  it('with no 3D scene, the fallback ticker plays lessons', async () => {
    setSearch('?no3d=1');
    let now = 0;
    const callbacks: FrameRequestCallback[] = [];
    const raf = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      callbacks.push(cb);
      return callbacks.length;
    });
    const caf = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
    render(<App />);
    fireEvent.click(screen.getByTestId('lesson-watch-tour'));
    const before = get().playerStatus?.progress ?? 0;
    act(() => {
      for (let i = 0; i < 30; i++) {
        now += 16;
        const cb = callbacks.shift();
        cb?.(now);
      }
    });
    await waitFor(() => expect(get().clock).toBeGreaterThan(0.3));
    expect(get().playerStatus?.progress ?? 0).toBeGreaterThan(before);
    raf.mockRestore();
    caf.mockRestore();
  });
});

describe('modeLabel / controlsLocked', () => {
  it('labels each mode', () => {
    expect(modeLabel({ kind: 'free' })).toBe('Free play');
    expect(modeLabel({ kind: 'lesson', id: 'tour', doItYourself: true })).toBe('Lesson: Machine Tour · Do it yourself');
    expect(modeLabel({ kind: 'lesson', id: 'nope', doItYourself: false })).toBe('Lesson: nope · Watch');
    expect(modeLabel({ kind: 'challenge', id: 'pin' })).toMatch(/^Challenge: /);
    expect(modeLabel({ kind: 'challenge', id: 'nope' })).toBe('Challenge: nope');
  });

  it('locks only while a demo plays', () => {
    expect(controlsLocked({ kind: 'free' }, true)).toBe(false);
    expect(controlsLocked({ kind: 'lesson', id: 'tour', doItYourself: false }, true)).toBe(true);
    expect(controlsLocked({ kind: 'lesson', id: 'tour', doItYourself: false }, false)).toBe(false);
    expect(controlsLocked({ kind: 'lesson', id: 'tour', doItYourself: true }, true)).toBe(false);
    expect(controlsLocked({ kind: 'challenge', id: 'pin' }, true)).toBe(true);
    // a Show me demo locks even in do-it-yourself mode
    expect(controlsLocked({ kind: 'lesson', id: 'tour', doItYourself: true }, true, { kind: 'showMe', stepId: 'a' })).toBe(true);
  });

  it('says what is locked and how to get the controls back', () => {
    expect(lockedMessage({ kind: 'lesson', id: 'tour', doItYourself: true }, { kind: 'showMe', stepId: 'a' })).toMatch(/until it finishes/);
    expect(lockedMessage({ kind: 'challenge', id: 'pin' }, null)).toMatch(/solution.*take over/i);
    expect(lockedMessage({ kind: 'lesson', id: 'tour', doItYourself: false }, null)).toMatch(/Pause it, or take over/);
  });
});
