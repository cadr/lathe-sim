// The "Project" bottom tab: home screen, lesson player or challenge panel depending on the store mode.
import { useLathe } from '../store';
import { ChallengePanel } from './ChallengePanel';
import { Home } from './Home';
import { LessonPanel } from './LessonPanel';

export function ProjectTab() {
  const mode = useLathe((s) => s.mode);
  switch (mode.kind) {
    case 'lesson':
      return <LessonPanel key={`lesson-${mode.id}`} />;
    case 'challenge':
      return <ChallengePanel key={`challenge-${mode.id}`} />;
    default:
      return <Home />;
  }
}
