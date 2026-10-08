import type { Challenge, Script } from '../engine';
import { tourLesson } from './lessons/tour';
import { facingLesson } from './lessons/facing';
import { turningLesson } from './lessons/turning';
import { drillingLesson } from './lessons/drilling';
import { partingLesson } from './lessons/parting';
import { fullProjectLesson } from './lessons/full-project';
import { facedSlugChallenge } from './challenges/faced-slug';
import { pinChallenge } from './challenges/pin';
import { steppedShaftChallenge } from './challenges/stepped-shaft';
import { bushingChallenge } from './challenges/bushing';
import { spacerSetChallenge } from './challenges/spacer-set';

/** Lessons in teaching order (DESIGN.md section 10). */
export const lessons: Script[] = [
  tourLesson,
  facingLesson,
  turningLesson,
  drillingLesson,
  partingLesson,
  fullProjectLesson,
];

/** Challenges in the order listed in DESIGN.md section 10. */
export const challenges: Challenge[] = [
  facedSlugChallenge,
  pinChallenge,
  steppedShaftChallenge,
  bushingChallenge,
  spacerSetChallenge,
];

/** Display info for the lesson list (a Script itself only carries id and steps). */
export interface LessonMeta {
  id: string;
  title: string;
  summary: string;
}

export const lessonMeta: LessonMeta[] = [
  { id: 'tour', title: 'Machine Tour', summary: 'Name the parts, move each handwheel, zero a dial, start and stop the spindle.' },
  { id: 'facing', title: 'Facing', summary: 'Square up the end of a bar: approach from outside, cut past center, never rub.' },
  { id: 'turning', title: 'Turning', summary: 'Turn 1.000 down to 0.750 with roughing and finishing passes, and sneak up on the size.' },
  { id: 'drilling', title: 'Drilling', summary: 'Center drill, then peck-drill a 1/4" hole half an inch deep with the tailstock.' },
  { id: 'parting', title: 'Parting Off', summary: 'Cut a 1" piece off the bar at low speed with the parting blade.' },
  { id: 'full-project', title: 'Full Project: Bushing', summary: 'Face, turn, drill and part a brass bushing from start to finish.' },
];

export function getLesson(id: string): Script | undefined {
  return lessons.find((l) => l.id === id);
}

export function getLessonMeta(id: string): LessonMeta | undefined {
  return lessonMeta.find((l) => l.id === id);
}

export function getChallenge(id: string): Challenge | undefined {
  return challenges.find((c) => c.id === id);
}
