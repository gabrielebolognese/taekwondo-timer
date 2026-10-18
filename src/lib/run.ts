// Pure state transitions for a run. Timers store an end timestamp, so the
// remaining time is always Date.now() based and survives backgrounding.

import { isCountdown, type Run, type Step, type TestField } from './steps';

export const isTimed = (s: Step | undefined) => !!s && (s.mode === 'timer' || s.mode === 'rest' || s.mode === 'emom');
const isAuto = (s: Step | undefined) => isTimed(s) && !!s?.auto;

/** Moves to step idx at time `at`. Auto steps start their timer from `at`, so chains stay exact. */
function enter(run: Run, idx: number, at: number): Run {
  const history = [...run.history, run.idx];
  if (idx >= run.steps.length) return { ...run, history, timer: null, finished: true };
  const step = run.steps[idx];
  const timer = isAuto(step) ? { endsAt: at + step.sec! * 1000 } : null;
  return { ...run, idx, history, timer, finished: false };
}

export const next = (run: Run, now: number) => enter(run, run.idx + 1, now);

export function startOrResume(run: Run, now: number): Run {
  const step = run.steps[run.idx];
  if (!isTimed(step)) return run;
  if (!run.timer) return { ...run, timer: { endsAt: now + step.sec! * 1000 } };
  if ('left' in run.timer) return { ...run, timer: { endsAt: now + run.timer.left } };
  return run;
}

export function pause(run: Run, now: number): Run {
  if (run.timer && 'endsAt' in run.timer) return { ...run, timer: { left: Math.max(0, run.timer.endsAt - now) } };
  return run;
}

export function addTime(run: Run, ms: number): Run {
  if (!run.timer) return run;
  return 'endsAt' in run.timer
    ? { ...run, timer: { endsAt: run.timer.endsAt + ms } }
    : { ...run, timer: { left: run.timer.left + ms } };
}

/** Advances past every timer that has ended by `now`. Returns the end times it passed. */
export function tick(run: Run, now: number): { run: Run; ended: number[] } {
  const ended: number[] = [];
  let r = run;
  while (!r.finished && r.timer && 'endsAt' in r.timer && now >= r.timer.endsAt && ended.length < 5000) {
    const at = r.timer.endsAt;
    ended.push(at);
    r = enter(r, r.idx + 1, at);
  }
  return { run: r, ended };
}

export function answer(run: Run, yes: boolean, now: number): Run {
  return next({ ...run, results: { ...run.results, [run.idx]: yes } }, now);
}

/** "Output dropped": end the current exercise and go to the next one. */
export function dropExercise(run: Run, now: number): Run {
  const ex = run.steps[run.idx].ex;
  const nextEx = run.exercises[ex + 1];
  const r = enter(run, nextEx ? nextEx.first : run.steps.length, now);
  return { ...r, dropped: [...run.dropped.filter((d) => d !== ex), ex] };
}

export const jumpToExercise = (run: Run, ex: number, now: number) => enter(run, run.exercises[ex].first, now);

export const finishNow = (run: Run, now: number) => enter(run, run.steps.length, now);

/** Undo the last move. Skips back over countdowns (rest, side switch, get ready). */
export function back(run: Run): Run {
  const history = [...run.history];
  let idx = history.pop();
  while (idx !== undefined && history.length && isCountdown(run.steps[idx])) idx = history.pop();
  if (idx === undefined) return run;
  const ex = run.steps[idx].ex;
  return { ...run, idx, history, timer: null, finished: false, dropped: run.dropped.filter((d) => d !== ex) };
}

export function counts(run: Run): Partial<Record<TestField, number>> {
  const out: Partial<Record<TestField, number>> = {};
  for (const [i, yes] of Object.entries(run.results)) {
    const field = run.steps[Number(i)]?.count?.field;
    if (field) out[field] = (out[field] ?? 0) + (yes ? 1 : 0);
  }
  return out;
}

/** Index of the last step that belongs to exercise `ex`. */
export function lastStepOf(run: Run, ex: number): number {
  const nextEx = run.exercises[ex + 1];
  return (nextEx ? nextEx.first : run.steps.length) - 1;
}
