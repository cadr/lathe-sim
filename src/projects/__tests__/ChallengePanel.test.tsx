import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getChallenge } from '../../content';
import type { GradeResult, Mistake } from '../../engine';
import { selectControlsLocked, useLathe } from '../../store';
import { ChallengePanel, formatTime, GradeCard, isStock, MistakeList, ProjectTab, RETRY_CONFIRM, SOLUTION_CONFIRM } from '..';

const get = () => useLathe.getState();

function runSolutionToEnd() {
  act(() => {
    get().setSpeed(8);
    for (let i = 0; i < 20000 && !get().playerStatus?.done; i++) get().tick(0.1);
  });
  expect(get().playerStatus?.done).toBe(true);
}

describe('ChallengePanel', () => {
  beforeEach(() => {
    act(() => get().reset());
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows the challenge, its stock and the drawing', () => {
    const pin = getChallenge('pin')!;
    act(() => get().startChallenge('pin'));
    render(<ProjectTab />);
    expect(screen.getByRole('heading', { name: pin.title })).toBeInTheDocument();
    expect(screen.getByText(pin.description)).toBeInTheDocument();
    const stock = screen.getByTestId('challenge-stock');
    expect(stock).toHaveTextContent('brass');
    expect(stock).toHaveTextContent('Ø1.000"');
    expect(stock).toHaveTextContent('1.500"');
    for (const k of pin.concepts) expect(screen.getByText(k)).toBeInTheDocument();
  });

  it('loads the challenge stock', () => {
    act(() => get().startChallenge('pin'));
    render(<ChallengePanel />);
    expect(screen.getByTestId('challenge-load-stock')).toHaveTextContent('Load this stock');
    fireEvent.click(screen.getByTestId('challenge-load-stock'));
    const wp = get().state.workpiece;
    expect(wp?.material).toBe('brass');
    expect(screen.getByTestId('challenge-load-stock')).toHaveTextContent('Reload this stock');
  });

  it('hint button gives a hint, then a more specific one', () => {
    act(() => get().startChallenge('pin'));
    render(<ChallengePanel />);
    expect(screen.queryByTestId('challenge-hint-text')).toBeNull();
    fireEvent.click(screen.getByTestId('challenge-hint'));
    expect(screen.getByTestId('challenge-hint-text')).toHaveAttribute('data-level', '1');
    expect(screen.getByTestId('challenge-hint-level')).toHaveTextContent('Hint');
    expect(screen.getByTestId('challenge-hint-text').textContent).toContain(get().hint!.text);
    fireEvent.click(screen.getByTestId('challenge-hint'));
    expect(get().hint?.level).toBe(2);
    expect(screen.getByTestId('challenge-hint-level')).toHaveTextContent('More specific');
  });

  it('a hint after an unfixable mistake shows the notice above the next step (QA2 P1-A)', () => {
    act(() => {
      get().startChallenge('pin');
      useLathe.setState({
        hint: {
          stepId: 'part-off',
          title: 'Part off',
          notice: 'The bar is already under 0.498.',
          text: 'The bar is already under 0.498.\n\nSwap to the parting blade.',
          level: 1,
        },
      });
    });
    render(<ChallengePanel />);
    expect(screen.getByTestId('challenge-hint-notice')).toHaveTextContent('The bar is already under 0.498.');
    const body = screen.getByTestId('challenge-hint-text');
    expect(body).toHaveTextContent('Swap to the parting blade.');
    expect(body.textContent!.match(/already under/g)).toHaveLength(1);
  });

  it('a level-2 hint with several moves shows them as a numbered list', () => {
    act(() => {
      get().startChallenge('pin');
      useLathe.setState({ hint: { stepId: 's', title: 'Face the end', text: 'a b', level: 2, lines: ['First move.', 'Second move.'] } });
    });
    render(<ChallengePanel />);
    const list = screen.getByTestId('challenge-hint-lines');
    expect(within(list).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['First move.', 'Second move.']);
  });

  it('checking empty work fails and lists mistakes', () => {
    act(() => get().startChallenge('pin'));
    render(<ChallengePanel />);
    fireEvent.click(screen.getByTestId('challenge-check'));
    expect(screen.getByTestId('grade-banner')).toHaveAttribute('data-passed', 'false');
    expect(screen.getByTestId('grade-banner')).toHaveTextContent('Not yet');
    expect(screen.getAllByTestId('grade-check').length).toBeGreaterThan(1);
    const mistakes = screen.getByTestId('mistake-list');
    expect(within(mistakes).getByText('Nothing made yet')).toBeInTheDocument();
  });

  it('Show solution asks first (inline) and does nothing when declined', () => {
    act(() => get().startChallenge('pin'));
    render(<ChallengePanel />);
    fireEvent.click(screen.getByTestId('challenge-solution'));
    expect(screen.getByTestId('challenge-confirm')).toHaveTextContent(SOLUTION_CONFIRM);
    fireEvent.click(screen.getByTestId('challenge-confirm-no'));
    expect(screen.queryByTestId('challenge-confirm')).toBeNull();
    expect(get().player).toBeNull();
  });

  it('solution playback has a transport, narration and take over', () => {
    act(() => get().startChallenge('pin'));
    render(<ChallengePanel />);
    fireEvent.click(screen.getByTestId('challenge-solution'));
    fireEvent.click(screen.getByTestId('challenge-confirm-yes'));
    const pin = getChallenge('pin')!;
    expect(screen.getByTestId('solution-playback')).toBeInTheDocument();
    expect(screen.getByTestId('solution-position')).toHaveTextContent(`Step 1 of ${pin.solution.steps.length}`);
    expect(screen.getByTestId('solution-step-title')).toHaveTextContent(pin.solution.steps[0].title);
    expect(screen.getByTestId('lesson-narration')).toHaveTextContent(pin.solution.steps[0].narration);
    expect(selectControlsLocked(get())).toBe(true);
    // pause unlocks, play resumes
    fireEvent.click(screen.getByTestId('solution-play'));
    expect(get().player?.isPlaying).toBe(false);
    expect(selectControlsLocked(get())).toBe(false);
    fireEvent.click(screen.getByTestId('solution-play'));
    expect(get().player?.isPlaying).toBe(true);
    fireEvent.click(screen.getByTestId('speed-8'));
    expect(get().speed).toBe(8);
    fireEvent.click(screen.getByTestId('solution-step'));
    expect(screen.getByTestId('solution-position')).toHaveTextContent('Step 2 of');
    // take over: the solution stops for good, the machine stays as it is
    const wp = get().state.workpiece;
    fireEvent.click(screen.getByTestId('solution-take-over'));
    expect(get().player).toBeNull();
    expect(get().state.workpiece).toBe(wp);
    expect(selectControlsLocked(get())).toBe(false);
    expect(screen.queryByTestId('solution-playback')).toBeNull();
    // the grade says the solution helped
    fireEvent.click(screen.getByTestId('challenge-check'));
    expect(screen.getByTestId('grade-solution-note')).toBeInTheDocument();
  });

  it('a played solution passes the check', () => {
    act(() => get().startChallenge('pin'));
    render(<ChallengePanel confirm={() => true} />);
    fireEvent.click(screen.getByTestId('challenge-solution'));
    expect(get().player?.isPlaying).toBe(true);
    expect(get().mode).toEqual({ kind: 'challenge', id: 'pin' });
    runSolutionToEnd();
    fireEvent.click(screen.getByTestId('challenge-check'));
    expect(screen.getByTestId('grade-banner')).toHaveAttribute('data-passed', 'true');
    expect(screen.getByTestId('grade-banner')).toHaveTextContent('Pass');
    for (const row of screen.getAllByTestId('grade-check')) expect(row).toHaveAttribute('data-ok', 'true');
  }, 60000);

  it('labels the stock button by what is in the chuck', () => {
    act(() => get().startChallenge('pin'));
    render(<ChallengePanel />);
    const btn = screen.getByTestId('challenge-load-stock');
    expect(btn).toHaveTextContent('Load this stock');
    fireEvent.click(btn);
    expect(btn).toHaveTextContent('Reload this stock');
    act(() => get().dispatch({ type: 'loadStock', stock: { material: 'steel', diameter: 0.75, length: 3, stickOut: 1.5 } }));
    expect(btn).toHaveTextContent('Load this stock');
    const pin = getChallenge('pin')!;
    expect(isStock(null, pin.stock)).toBe(false);
  });

  it('try again asks first once there is work, then restarts; exit returns home', () => {
    act(() => get().startChallenge('pin'));
    render(<ProjectTab />);
    fireEvent.click(screen.getByTestId('challenge-load-stock'));
    fireEvent.click(screen.getByTestId('challenge-check'));
    fireEvent.click(screen.getByTestId('challenge-retry'));
    expect(screen.getByTestId('challenge-confirm')).toHaveTextContent(RETRY_CONFIRM);
    expect(get().state.workpiece).not.toBeNull();
    fireEvent.click(screen.getByTestId('challenge-confirm-yes'));
    expect(get().state.workpiece).toBeNull();
    expect(get().grade).toBeNull();
    expect(screen.queryByTestId('grade-card')).toBeNull();
    fireEvent.click(screen.getByTestId('challenge-exit'));
    expect(screen.getByTestId('project-home')).toBeInTheDocument();
  });

  it('accepts an explicit challenge and confirm function', () => {
    const confirm = vi.fn(() => true);
    act(() => get().startChallenge('faced-slug'));
    render(<ChallengePanel challenge={getChallenge('faced-slug')} confirm={confirm} />);
    fireEvent.click(screen.getByTestId('challenge-solution'));
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(get().player).not.toBeNull();
  });

  it('renders a fallback without a challenge', () => {
    render(<ChallengePanel />);
    expect(screen.getByText('No challenge selected.')).toBeInTheDocument();
  });
});

describe('GradeCard and MistakeList', () => {
  const grade: GradeResult = {
    passed: false,
    score: 42,
    checks: [
      { label: 'Overall length', ok: true, actual: '1.000', expected: '1.000 ±0.010' },
      { label: 'Diameter', ok: false, actual: 'Ø0.480', expected: 'Ø0.500 ±0.005' },
    ],
    measured: { segments: [], length: 1 },
    deductions: [{ label: 'Rubbing ×2', points: 10 }],
  };
  const mistakes: Mistake[] = [
    { severity: 'error', title: 'Undersize', detail: 'Too small.', t: 75.4 },
    { severity: 'warning', title: 'Chatter', detail: 'Slow down.', t: 3.2 },
    { severity: 'tip', title: 'Skipped step', detail: 'Face first.' },
  ];

  it('shows score, checks, deductions and mistakes', () => {
    render(<GradeCard grade={grade} mistakes={mistakes} />);
    expect(screen.getByTestId('grade-score')).toHaveTextContent('42 / 100');
    expect(screen.getByRole('img', { name: 'out of spec' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'ok' })).toBeInTheDocument();
    expect(screen.getByTestId('grade-deductions')).toHaveTextContent('Rubbing ×2: −10');
    const items = screen.getAllByTestId('mistake');
    expect(items.map((i) => i.getAttribute('data-severity'))).toEqual(['error', 'warning', 'tip']);
    expect(items[0]).toHaveTextContent('at 1:15');
    expect(items[1]).toHaveTextContent('at 3.2 s');
    expect(screen.getByRole('img', { name: 'Warning' })).toBeInTheDocument();
  });

  it('renders nothing for no mistakes', () => {
    const { container } = render(<MistakeList mistakes={[]} />);
    expect(container).toBeEmptyDOMElement();
    expect(formatTime(5)).toBe('5.0 s');
    expect(formatTime(125)).toBe('2:05');
  });
});
