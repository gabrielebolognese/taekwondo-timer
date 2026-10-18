// What the voice says and when the whistle blows. The runner calls coach() on every tick; it
// notices step changes (from taps or timers) and the time marks inside a step.
//
//   countdown starts   "Rest, 2 minutes. Next: Weighted pistol. Set 1 of 3, left. 5 reps."
//   10 s left          "10 seconds"
//   3, 2, 1            short beeps
//   countdown ends     whistle, work starts (a timer starts on its own)
//   work timer ends    long beep, then the next step is announced
//   tapped to a step   the step is announced

import { beep, whistle } from './audio';
import { isCountdown, type Run, type Step } from './steps';
import { say } from './voice';

export interface CoachMemory {
  idx: number;
  finished: boolean;
  key: string;
  sec: number;
  minute: number;
}

export const freshMemory = (): CoachMemory => ({ idx: -1, finished: false, key: '', sec: -1, minute: -1 });

const SPINS: Record<string, string> = { '360': 'three sixty', '480': 'four eighty', '540': 'five forty', '720': 'seven twenty' };

/** Plan text made speakable: no brackets, spins and units as people say them. */
export function spoken(text: string): string {
  return text
    .replace(/\s*\([^)]*\)/g, '')
    .replace(/\s*·\s*/g, ', ')
    .replace(/\s*\+\s*/g, ' and ')
    .replace(/\bEMOM:?/g, 'Every minute on the minute,')
    .replace(/\b(360|480|540|720)\b/g, (d) => SPINS[d])
    .replace(/(\d+)\s*×\s*(\d+)/g, '$1 by $2')
    .replace(/\b(\d+) m\b/g, '$1 meters')
    .replace(/\b1 s\b/g, '1 second')
    .replace(/\b(\d+) s\b/g, '$1 seconds')
    .replace(/\b(\d+) kg\b/g, '$1 kilos')
    .replace(/\bmin\b/g, 'minutes')
    .replace(/\s+,/g, ',')
    .trim();
}

export function duration(sec: number): string {
  if (sec <= 90) return `${sec} seconds`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  const mins = m === 1 ? '1 minute' : `${m} minutes`;
  return s ? `${mins} ${s}` : mins;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const sentence = (s: string) => (s && !/[.!?]$/.test(s) ? `${s}.` : s);

/** "5 reps", "Hold, 90 seconds", "In this order: 540, roundhouse, 720", ... */
function amount(s: Step): string {
  if (s.lines) return `In this order: ${s.lines.join(', ')}`;
  if (s.mode === 'emom') return `${duration(s.sec!)}. ${s.perMinute} per minute`;
  if (s.mode === 'timer') return s.unit ? `${cap(s.unit)}, ${duration(s.sec!)}` : duration(s.sec!);
  if (s.mode === 'count') return s.big ?? '';
  // "Jump" / "Kick" test steps: the description says it better.
  if (s.big && !/^\d/.test(s.big) && s.unit) return cap(s.unit);
  const what = [s.big, s.unit].filter(Boolean).join(' ');
  return s.unit === 'per kick' && s.detail ? `${what}: ${s.detail.split(' · ')[0]}` : what;
}

/** Label worth saying: "Set 2 of 4, left". Durations and generic labels are left out. */
function label(s: Step): string {
  if (!s.label || /^(Warm-up|Hold|Set|Final hold|\d+ min)$/.test(s.label) || s.mode === 'emom') return '';
  return s.label.replace(' · ', ', ').replace(/\b(Left|Right)\b/, (side) => side.toLowerCase() + ' side');
}

export function workText(run: Run, idx: number, withName: boolean): string {
  const s = run.steps[idx];
  if (!s) return '';
  const ex = run.exercises[s.ex];
  const name = withName ? (ex.warmup ? `Warm-up: ${ex.name}` : ex.name) : '';
  return [name, label(s), amount(s)].filter(Boolean).map((part) => cap(spoken(part))).join('. ');
}

const nextWork = (run: Run, idx: number) => {
  for (let i = idx + 1; i < run.steps.length; i++) if (!isCountdown(run.steps[i])) return i;
  return -1;
};

/** Is `idx` the first work step of its exercise (so the exercise name should be said)? */
function startsExercise(run: Run, idx: number): boolean {
  const s = run.steps[idx];
  for (let i = idx - 1; i >= 0; i--) {
    if (!isCountdown(run.steps[i])) return run.steps[i].ex !== s.ex;
  }
  return true;
}

export function countdownText(run: Run, idx: number): string {
  const s = run.steps[idx];
  const n = nextWork(run, idx);
  const next = n >= 0 ? workText(run, n, startsExercise(run, n)) : '';
  if (s.cd === 'switch') return `Switch sides.${next ? ` ${next}.` : ''}`;
  if (s.cd === 'ready') return `Get ready.${next ? ` ${next}.` : ''}`;
  const prevWork = run.steps.slice(0, idx).reverse().find((p) => !isCountdown(p));
  const afterWarmup = prevWork && run.exercises[prevWork.ex].warmup && !run.exercises[s.ex].warmup;
  return `${afterWarmup ? 'Warm-up done. ' : ''}Rest, ${duration(s.sec!)}.${next ? ` Next: ${next}.` : ''}`;
}

const isWorkTimer = (s: Step | undefined) => s?.mode === 'timer' || s?.mode === 'emom';

/** Sounds and words for a step change. `prevIdx` is -1 when the runner just opened. */
function entered(run: Run, prevIdx: number) {
  const step = run.steps[run.idx];
  const prev = prevIdx >= 0 ? run.steps[prevIdx] : undefined;
  const forward = run.idx > prevIdx;

  if (prevIdx < 0) {
    // Opened (or reopened) the runner: say where we are.
    const intro = run.idx === 0 ? `${spoken(run.title)}. ` : '';
    say(intro + (isCountdown(step) ? countdownText(run, run.idx) : sentence(workText(run, run.idx, true))));
    return;
  }
  if (isCountdown(step)) {
    if (forward && isWorkTimer(prev)) beep('long');
    say(countdownText(run, run.idx), forward && isWorkTimer(prev) ? 600 : 0);
    return;
  }
  if (forward && isCountdown(prev)) {
    // The start signal. Everything about the step was said during the countdown.
    whistle();
    if (step.mode === 'emom') say(`Minute 1. ${spoken(step.cues?.[0] ?? '')}`, 800);
    return;
  }
  if (forward && isWorkTimer(prev)) {
    beep('long');
    say(sentence(workText(run, run.idx, startsExercise(run, run.idx))), 600);
    return;
  }
  say(sentence(workText(run, run.idx, !forward || startsExercise(run, run.idx))));
}

/**
 * Call on every tick. `quiet` when the change only happened because time passed while the app
 * was away: nothing is played for steps that ended long ago.
 */
export function coach(run: Run, now: number, mem: CoachMemory, quiet: boolean) {
  if (run.finished) {
    if (!mem.finished && !quiet) say(run.kind === 'session' ? 'Session complete. Well done.' : 'Set complete.');
    mem.finished = true;
    mem.idx = -1;
    return;
  }
  mem.finished = false;
  if (run.idx !== mem.idx) {
    if (!quiet) entered(run, mem.idx);
    mem.idx = run.idx;
    mem.key = '';
  }

  const step = run.steps[run.idx];
  if (!run.timer || !('endsAt' in run.timer)) {
    mem.key = '';
    return;
  }
  const left = run.timer.endsAt - now;
  const key = `${run.idx}:${run.timer.endsAt}`;
  const same = mem.key === key;
  let sec: number;
  if (step.mode === 'emom') {
    const elapsed = step.sec! * 1000 - left;
    const minute = Math.floor(elapsed / 60000);
    if (same && minute > mem.minute && minute * 60 < step.sec!) {
      whistle();
      const cue = step.cues?.length ? step.cues[minute % step.cues.length] : '';
      say(`Minute ${minute + 1}. ${spoken(cue)}`, 800);
    }
    mem.minute = minute;
    sec = Math.ceil((60000 - (elapsed % 60000)) / 1000);
  } else {
    sec = Math.ceil(left / 1000);
    if (same && mem.sec > 10 && sec === 10 && (step.sec ?? 0) >= 20) say('10 seconds');
  }
  if (sec >= 1 && sec <= 3 && (!same || mem.sec !== sec)) beep('short');
  mem.key = key;
  mem.sec = sec;
}
