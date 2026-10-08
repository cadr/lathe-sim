import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { challenges, lessonMeta } from '../../content';
import { useLathe } from '../../store';
import { formatMinutes, Home, lessonLevel, ProjectTab, Stars } from '..';

const get = () => useLathe.getState();

describe('Home', () => {
  beforeEach(() => {
    act(() => get().reset());
  });

  it('lists every lesson and challenge with their buttons', () => {
    render(<Home />);
    for (const m of lessonMeta) {
      expect(screen.getByText(m.summary)).toBeInTheDocument();
      expect(screen.getByTestId(`lesson-watch-${m.id}`)).toBeInTheDocument();
      expect(screen.getByTestId(`lesson-diy-${m.id}`)).toBeInTheDocument();
    }
    for (const c of challenges) {
      expect(screen.getByText(c.title)).toBeInTheDocument();
      expect(screen.getByTestId(`challenge-start-${c.id}`)).toBeInTheDocument();
      for (const k of c.concepts) expect(screen.getAllByText(k).length).toBeGreaterThan(0);
    }
    expect(screen.getByAltText('Lathe Sim')).toBeInTheDocument();
    expect(screen.getByText(/Free play:/)).toBeInTheDocument();
  });

  it('Watch starts a playing lesson', () => {
    render(<Home />);
    fireEvent.click(screen.getByTestId('lesson-watch-facing'));
    expect(get().mode).toEqual({ kind: 'lesson', id: 'facing', doItYourself: false });
    expect(get().player?.isPlaying).toBe(true);
  });

  it('Do it yourself starts a paused lesson', () => {
    render(<Home />);
    fireEvent.click(screen.getByTestId('lesson-diy-turning'));
    expect(get().mode).toEqual({ kind: 'lesson', id: 'turning', doItYourself: true });
    expect(get().player?.isPlaying).toBe(false);
  });

  it('Start begins a challenge', () => {
    render(<Home />);
    fireEvent.click(screen.getByTestId('challenge-start-pin'));
    expect(get().mode).toEqual({ kind: 'challenge', id: 'pin' });
  });

  it('ProjectTab switches between home, lesson and challenge', () => {
    render(<ProjectTab />);
    expect(screen.getByTestId('project-home')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('lesson-watch-tour'));
    expect(screen.getByTestId('lesson-panel')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('lesson-exit'));
    expect(screen.getByTestId('project-home')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('challenge-start-bushing'));
    expect(screen.getByTestId('challenge-panel')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('challenge-exit'));
    expect(screen.getByTestId('project-home')).toBeInTheDocument();
    expect(get().mode).toEqual({ kind: 'free' });
  });

  it('helpers', () => {
    expect(lessonLevel(0, 6)).toBe('Beginner');
    expect(lessonLevel(3, 6)).toBe('Intermediate');
    expect(lessonLevel(5, 6)).toBe('Advanced');
    expect(formatMinutes(10)).toBe('~10 s');
    expect(formatMinutes(1)).toBe('~5 s');
    expect(formatMinutes(58)).toBe('~1 min');
    expect(formatMinutes(300)).toBe('~5 min');
    render(<Stars n={2} />);
    expect(screen.getByRole('img', { name: 'Difficulty 2 of 3' })).toHaveTextContent('★★☆');
  });
});
