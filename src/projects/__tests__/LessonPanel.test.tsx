import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { getLesson } from '../../content';
import type { ScriptStep } from '../../engine';
import { selectControlsLocked, useLathe } from '../../store';
import { ALREADY_DONE_DELAY, DIY_ADVANCE_DELAY, LessonPanel, ProjectTab, StepIllustration, stepMotion, stepSummary } from '..';

const get = () => useLathe.getState();
const facing = getLesson('facing')!;
const brass = { material: 'brass', diameter: 1, length: 3, stickOut: 1.5 } as const;

function tickFor(seconds: number, dt = 0.1) {
  act(() => {
    for (let t = 0; t < seconds; t += dt) get().tick(dt);
  });
}

describe('LessonPanel (watch)', () => {
  beforeEach(() => {
    act(() => get().reset());
  });

  it('shows the title, step list and current narration', () => {
    act(() => get().startLesson('facing'));
    render(<ProjectTab />);
    expect(screen.getByRole('heading', { name: /Facing/ })).toBeInTheDocument();
    const list = screen.getByRole('list', { name: 'Lesson steps' });
    expect(within(list).getAllByRole('button')).toHaveLength(facing.steps.length);
    expect(screen.getByTestId('lesson-narration')).toHaveTextContent(facing.steps[0].narration);
    expect(screen.getByTestId('lesson-step-0')).toHaveAttribute('aria-current', 'step');
    expect(screen.getByTestId('lesson-why')).toHaveTextContent('Why?');
    expect(screen.getByTestId('lesson-position')).toHaveTextContent(`Step 1 of ${facing.steps.length}`);
    expect(screen.getByTestId('step-illustration')).toBeInTheDocument();
  });

  it('play/pause toggles playing and step forward advances', () => {
    act(() => get().startLesson('facing'));
    render(<LessonPanel />);
    const play = screen.getByTestId('lesson-play');
    expect(play).toHaveTextContent('Pause');
    fireEvent.click(play);
    expect(get().playerStatus?.playing).toBe(false);
    expect(play).toHaveTextContent('Play');
    fireEvent.click(play);
    expect(get().playerStatus?.playing).toBe(true);
    fireEvent.click(play);

    fireEvent.click(screen.getByTestId('lesson-step'));
    expect(get().playerStatus?.stepIndex).toBe(1);
    expect(get().state.workpiece).not.toBeNull();
    expect(screen.getByTestId('lesson-narration')).toHaveTextContent(facing.steps[1].narration);
    expect(screen.getByTestId('lesson-step-0')).toHaveAttribute('data-done', 'true');
  });

  it('clicking a step jumps to it, restart goes back to the start', () => {
    act(() => get().startLesson('facing'));
    render(<LessonPanel />);
    fireEvent.click(screen.getByTestId('lesson-step-3'));
    expect(get().playerStatus?.stepIndex).toBe(3);
    expect(get().state.tool).toBe('turning');
    expect(screen.getByTestId('lesson-step-title')).toHaveTextContent(facing.steps[3].title);
    fireEvent.click(screen.getByTestId('lesson-restart'));
    expect(get().playerStatus?.stepIndex).toBe(0);
    expect(get().state.workpiece).toBeNull();
  });

  it('progress follows the player and the end shows completion', () => {
    act(() => get().startLesson('facing'));
    render(<LessonPanel />);
    tickFor(0.2);
    const bar = screen.getByRole('progressbar');
    expect(Number(bar.getAttribute('aria-valuenow'))).toBeGreaterThan(0);
    act(() => {
      for (let i = 0; i < facing.steps.length; i++) get().stepForward();
    });
    expect(screen.getByTestId('lesson-complete')).toBeInTheDocument();
    expect(screen.getByTestId('lesson-play')).toBeDisabled();
    expect(bar).toHaveAttribute('aria-valuenow', '100');
  });

  it('shows captions while a say action plays', () => {
    act(() => get().startLesson('tour'));
    render(<LessonPanel />);
    tickFor(0.5);
    expect(screen.getByTestId('lesson-caption')).toHaveTextContent(/headstock/i);
  });

  it('speed buttons update the store', () => {
    act(() => get().startLesson('facing'));
    render(<LessonPanel />);
    fireEvent.click(screen.getByTestId('speed-4'));
    expect(get().speed).toBe(4);
    expect(screen.getByTestId('speed-4')).toHaveAttribute('aria-pressed', 'true');
  });

  it('switches to do-it-yourself and exits', () => {
    act(() => get().startLesson('facing'));
    render(<ProjectTab />);
    fireEvent.click(screen.getByTestId('lesson-switch-mode'));
    expect(get().mode).toEqual({ kind: 'lesson', id: 'facing', doItYourself: true });
    expect(screen.getByTestId('diy-instruction')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('lesson-exit'));
    expect(get().mode).toEqual({ kind: 'free' });
  });

  it('renders a fallback without a lesson', () => {
    render(<LessonPanel />);
    expect(screen.getByText('No lesson selected.')).toBeInTheDocument();
  });
});

describe('LessonPanel (do it yourself)', () => {
  beforeEach(() => {
    act(() => get().reset());
  });

  it('advances when the real engine state satisfies the step check, without replaying actions', async () => {
    act(() => get().startLesson('facing', true));
    render(<ProjectTab />);
    expect(get().player?.isPlaying).toBe(false);
    expect(screen.getByTestId('diy-instruction')).toHaveTextContent(facing.steps[0].narration);
    expect(screen.getByTestId('diy-check')).toHaveAttribute('data-ok', 'false');

    act(() => get().dispatch({ type: 'loadStock', stock: brass }));
    expect(screen.getByTestId('diy-check')).toHaveAttribute('data-ok', 'true');
    await waitFor(() => expect(screen.getByTestId('lesson-step-title')).toHaveTextContent(facing.steps[1].title), {
      timeout: 2000,
    });
    expect(screen.getByTestId('lesson-step-0')).toHaveAttribute('data-done', 'true');

    act(() => get().dispatch({ type: 'selectTool', tool: 'turning' }));
    await waitFor(() => expect(screen.getByTestId('lesson-step-title')).toHaveTextContent(facing.steps[2].title), {
      timeout: 2000,
    });
    // only the user's two actions are in the log
    expect(get().state.actions).toHaveLength(2);
    expect(get().playerStatus?.stepIndex).toBe(0);
  });

  it('Show me plays just the current step, then returns to the lesson player', async () => {
    act(() => get().startLesson('facing', true));
    render(<LessonPanel />);
    const lessonPlayer = get().player;
    fireEvent.click(screen.getByTestId('diy-show-me'));
    expect(get().player).not.toBe(lessonPlayer);
    expect(screen.getByTestId('diy-show-me')).toHaveTextContent('Stop the demo');
    tickFor(2);
    expect(get().state.workpiece).not.toBeNull();
    expect(get().player).toBe(lessonPlayer);
    await waitFor(() => expect(screen.getByTestId('lesson-step-title')).toHaveTextContent(facing.steps[1].title), {
      timeout: 2000,
    });
    // a multi-action step: set speed and start the spindle
    fireEvent.click(screen.getByTestId('diy-next'));
    expect(screen.getByTestId('lesson-step-title')).toHaveTextContent(facing.steps[2].title);
    fireEvent.click(screen.getByTestId('diy-show-me'));
    tickFor(3);
    expect(get().state.spindle.on).toBe(true);
    expect(get().state.spindle.rpm).toBe(600);
    expect(get().state.tool).toBe('none');
  });

  it('a step already satisfied on arrival moves on by itself after a pause', async () => {
    act(() => get().startLesson('tour', true));
    render(<LessonPanel />);
    // the tour's first check (spindle stopped) is true from the start
    expect(screen.getByTestId('diy-check')).toHaveTextContent('Already done: moving on');
    await new Promise((r) => setTimeout(r, DIY_ADVANCE_DELAY + 200));
    expect(screen.getByTestId('lesson-step-0')).toHaveAttribute('aria-current', 'step');
    await waitFor(() => expect(screen.getByTestId('lesson-step-1')).toHaveAttribute('aria-current', 'step'), {
      timeout: ALREADY_DONE_DELAY + 1000,
    });
    // picking a done step from the list to read it again does not bounce you off it
    fireEvent.click(screen.getByTestId('lesson-step-0'));
    expect(screen.getByTestId('diy-check')).toHaveTextContent(/^✔ Already done$/);
    await new Promise((r) => setTimeout(r, ALREADY_DONE_DELAY + 300));
    expect(screen.getByTestId('lesson-step-0')).toHaveAttribute('aria-current', 'step');
  }, 10000);

  it('Show me locks the controls while it plays and can be stopped', () => {
    act(() => get().startLesson('facing', true));
    render(<LessonPanel />);
    fireEvent.click(screen.getByTestId('diy-show-me'));
    expect(get().demo).toEqual({ kind: 'showMe', stepId: facing.steps[0].id });
    expect(selectControlsLocked(get())).toBe(true);
    expect(screen.getByTestId('diy-next')).toBeDisabled();
    fireEvent.click(screen.getByTestId('diy-show-me'));
    expect(get().demo).toBeNull();
    expect(selectControlsLocked(get())).toBe(false);
  });

  it('switching from watch to do-it-yourself keeps the step', () => {
    act(() => get().startLesson('facing'));
    render(<ProjectTab />);
    act(() => get().jumpTo(3));
    fireEvent.click(screen.getByTestId('lesson-switch-mode'));
    expect(get().mode).toEqual({ kind: 'lesson', id: 'facing', doItYourself: true });
    expect(screen.getByTestId('lesson-step-3')).toHaveAttribute('aria-current', 'step');
    // the machine was fast-forwarded to the start of step 4
    expect(get().state.tool).toBe('turning');
    fireEvent.click(screen.getByTestId('lesson-switch-mode'));
    expect(get().playerStatus?.stepIndex).toBe(3);
  });

  it('step list, skip, restart and completion', () => {
    act(() => get().startLesson('facing', true));
    render(<LessonPanel />);
    fireEvent.click(screen.getByTestId('diy-next'));
    expect(screen.getByTestId('lesson-step-1')).toHaveAttribute('aria-current', 'step');
    expect(get().state.actions).toHaveLength(0);
    fireEvent.click(screen.getByTestId(`lesson-step-${facing.steps.length - 1}`));
    fireEvent.click(screen.getByTestId('diy-next'));
    // steps 1 and 2 were skipped with Next or by jumping ahead, and so was the last: the end says so (QA P1-10)
    expect(screen.getByTestId('lesson-complete')).toHaveAttribute('data-deviations', '3');
    expect(screen.getByTestId('lesson-complete')).toHaveTextContent('3 steps skipped');
    expect(screen.getByTestId('lesson-deviations')).toHaveTextContent(`Step ${facing.steps.length}, ${facing.steps[facing.steps.length - 1].title}`);
    fireEvent.click(screen.getByTestId('lesson-restart'));
    expect(screen.getByTestId('lesson-step-0')).toHaveAttribute('aria-current', 'step');
    expect(get().mode).toEqual({ kind: 'lesson', id: 'facing', doItYourself: true });
  });
});

describe('LessonPanel completion (fix round 2)', () => {
  beforeEach(() => {
    act(() => {
      get().reset();
      get().setSpeed(8);
    });
  });

  it('a watched lesson run clean says "Lesson complete"', () => {
    act(() => get().startLesson('facing'));
    render(<LessonPanel />);
    tickFor(60, 0.25);
    expect(screen.getByTestId('lesson-complete')).toHaveTextContent('Lesson complete.');
    expect(screen.queryByTestId('lesson-deviations')).toBeNull();
  });

  it('a watched lesson disturbed while paused completes "with deviations" and lists them', () => {
    act(() => {
      get().setSpeed(1);
      get().startLesson('facing');
    });
    render(<LessonPanel />);
    act(() => {
      for (let i = 0; i < 100000 && (get().playerStatus?.stepIndex ?? 0) < facing.steps.length - 1; i++) get().tick(0.25);
      get().playPause();
      get().dispatch({ type: 'removeStock' });
      get().playPause();
    });
    tickFor(30, 0.25);
    expect(screen.getByTestId('lesson-complete')).toHaveTextContent('Lesson completed with deviations');
    expect(screen.getByTestId('lesson-deviations')).toHaveTextContent(facing.steps[facing.steps.length - 1].title);
  });

  it('a do-it-yourself lesson done step by step ends with "Nice work"', () => {
    act(() => get().startLesson('tour', true, getLesson('tour')!.steps.length - 1));
    render(<LessonPanel />);
    const last = getLesson('tour')!.steps[getLesson('tour')!.steps.length - 1];
    act(() => {
      for (const a of last.actions) if (a.type !== 'say' && a.type !== 'wait' && a.type !== 'moveTo') get().dispatch(a as never);
    });
    fireEvent.click(screen.getByTestId('diy-next'));
    expect(screen.getByTestId('lesson-complete')).toHaveTextContent('Nice work');
  });
});

describe('StepIllustration', () => {
  const step: ScriptStep = {
    id: 's',
    title: 'Move',
    narration: 'n',
    actions: [
      { type: 'turnHandwheel', axis: 'z', revolutions: -5 },
      { type: 'turnHandwheel', axis: 'x', revolutions: 2 },
      { type: 'turnHandwheel', axis: 'quill', revolutions: 3 },
      { type: 'say', text: 'Hello' },
      { type: 'wait', duration: 1 },
    ],
  };

  it('sums handwheel motion per axis', () => {
    const m = stepMotion(step);
    expect(m.z).toBeCloseTo(-0.5);
    expect(m.x).toBeCloseTo(0.1);
    expect(m.quill).toBeCloseTo(0.3);
    expect(stepSummary(step)).toHaveLength(4);
  });

  it('draws arrows for each moving axis', () => {
    render(<StepIllustration step={step} />);
    expect(screen.getByTestId('arrow-z')).toHaveTextContent('← chuck 0.500"');
    expect(screen.getByTestId('arrow-x')).toHaveTextContent('in 0.100"');
    expect(screen.getByTestId('arrow-quill')).toBeInTheDocument();
    expect(screen.getByTestId('step-actions')).toHaveTextContent('toward the chuck');
  });

  it('omits arrows for a step without motion', () => {
    render(<StepIllustration step={{ id: 'a', title: 'T', narration: '', actions: [{ type: 'turnHandwheel', axis: 'x', revolutions: -1 }] }} />);
    expect(screen.queryByTestId('arrow-z')).toBeNull();
    expect(screen.getByTestId('arrow-x')).toHaveTextContent('out 0.050"');
  });
});
