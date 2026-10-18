// Turns plan exercises into a flat list of steps the runner walks through: work steps, and the
// countdowns between them (rest between sets, a short side switch, "get ready" before a timer).

import type { Exercise, GtgPart, SetsEx, WarmupItem } from '../types';
import { addVol, directionCount, kickList, movement, reps, secs, type Vol } from './movements';
import { getDay, gtgSet, type Pos } from './plan';

export type TestField = 'landed540' | 'landed720';
export type StepMode = 'tap' | 'timer' | 'rest' | 'emom' | 'count';
/** What a countdown ('rest' mode step) is for. Runs saved by older versions only have rest. */
export type Countdown = 'rest' | 'switch' | 'ready';

export interface Step {
  /** Index into Run.exercises. */
  ex: number;
  mode: StepMode;
  label: string;
  big?: string;
  unit?: string;
  detail?: string;
  /** Stacked lines instead of one big value, e.g. a shuffled kick order. */
  lines?: string[];
  sec?: number;
  /** Timer starts on its own when reached (countdowns, timers that follow one, later PNF phases). */
  auto?: boolean;
  done?: string;
  cues?: string[];
  perMinute?: string;
  count?: { field: TestField; yes: string; no: string };
  cd?: Countdown;
  /** What finishing this step adds to the totals. */
  vol?: Vol;
}

export interface RunExercise {
  name: string;
  summary: string;
  warmup: boolean;
  first: number;
}

export interface Run {
  v: 1;
  kind: 'session' | 'gtg';
  title: string;
  pos: Pos;
  gtgSlot?: { date: string; index: number };
  exercises: RunExercise[];
  steps: Step[];
  idx: number;
  history: number[];
  /** Running ({endsAt}) or paused ({left} ms) timer for the current step. */
  timer: { endsAt: number } | { left: number } | null;
  startedAt: number;
  dropped: number[];
  /** Answers to count steps, by step index. */
  results: Record<number, boolean>;
  finished: boolean;
}

/** Seconds to change sides: holds need a moment to get back into position. */
const SWITCH_HOLD = 10;
const SWITCH_REPS = 5;
/** Countdown when a session or GTG set starts, and before a timer that follows a tapped step. */
const READY_START = 10;
const READY = 5;
/** Rest between the warm-up and the first exercise, at least. */
const AFTER_WARMUP = 90;

type Draft = Omit<Step, 'ex'>;

const join = (...parts: (string | undefined | false)[]) => parts.filter(Boolean).join(' · ');
const of = (word: string, i: number, n: number) => `${word} ${i} of ${n}`;
const range = (n: number) => Array.from({ length: n }, (_, i) => i + 1);

function shuffle<T>(items: T[]): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const countdown = (cd: Countdown, sec: number, label: string): Draft => ({ mode: 'rest', cd, label, sec, auto: true });
const rest = (sec: number): Draft[] => (sec > 0 ? [countdown('rest', sec, 'Rest')] : []);
export const isCountdown = (s: Step | undefined) => s?.mode === 'rest';
const isTimedWork = (s: Draft) => s.mode === 'timer' || s.mode === 'emom';

/** One step, or left, a switch countdown, then right. */
function sides(perSide: boolean, make: (side?: string) => Draft, switchSec: number | null): Draft[] {
  if (!perSide) return [make()];
  return [make('Left'), ...(switchSec ? [countdown('switch', switchSec, 'Switch sides')] : []), make('Right')];
}

/** Sets in order with `between` after every set but the last. */
const withRests = (sets: Draft[][], between: Draft[]) => sets.flatMap((s, i) => (i ? [...between, ...s] : s));

/** Volume of one tapped step of a sets exercise, per superset part. */
function setVolumes(ex: SetsEx): Vol[] {
  if (ex.parts) return ex.parts.map((p) => reps(p, ex.reps));
  const kicks = kickList(ex.name);
  if (ex.unit === 'per kick') return [Object.assign({}, ...kicks.map((k) => reps(k, ex.reps)))];
  // "3×5 per side" of two spin kicks: the 5 are shared between them.
  if (kicks.length) return [Object.assign({}, ...kicks.map((k) => reps(k, ex.reps / kicks.length)))];
  if (ex.unit === 'per direction') return [reps(ex.name, ex.reps * directionCount(ex.name))];
  return [reps(ex.name, ex.reps)];
}

function exerciseSteps(ex: Exercise): Draft[] {
  switch (ex.kind) {
    case 'sets': {
      const vols = setVolumes(ex);
      const kicks = ex.unit === 'per kick' ? kickList(ex.name).join(', ') : undefined;
      const sets = range(ex.sets).map((s) => (ex.parts ?? [undefined]).flatMap((part, p) => sides(ex.perSide, (side) => ({
        mode: 'tap',
        label: join(of(ex.setWord, s, ex.sets), side),
        big: ex.target ?? String(ex.reps),
        unit: part ?? ex.unit,
        detail: join(kicks && kicks.charAt(0).toUpperCase() + kicks.slice(1), ex.note) || undefined,
        done: ex.setWord === 'Set' ? 'Set done' : 'Done',
        vol: vols[p],
      }), SWITCH_REPS)));
      const out = withRests(sets, rest(ex.restSec));
      if (ex.finalHoldSec) out.push({ mode: 'timer', label: 'Final hold', sec: ex.finalHoldSec, unit: 'hold', vol: secs(`${ex.name} hold`, ex.finalHoldSec) });
      return out;
    }
    case 'hold':
      return withRests(range(ex.sets).map((s) => sides(ex.perSide, (side) => ({
        mode: 'timer', label: join(of('Set', s, ex.sets), side), sec: ex.sec, unit: 'hold', detail: ex.note, vol: secs(ex.name, ex.sec),
      }), SWITCH_HOLD)), rest(ex.restSec));
    case 'pnf': {
      // Phases of a round run back to back; rounds have a rest between them.
      const side = (s?: string) => withRests(range(ex.rounds).map((r) => ex.phases.map((p, i): Draft => ({
        mode: 'timer', label: join(of('Round', r, ex.rounds), s), sec: p.sec, unit: p.label, auto: i > 0, vol: secs(ex.name, p.sec),
      }))), rest(ex.restSec));
      return ex.perSide ? [...side('Left'), countdown('switch', SWITCH_HOLD, 'Switch sides'), ...side('Right')] : side();
    }
    case 'contrast':
      return withRests(range(ex.rounds).map((r) => {
        const label = of('Round', r, ex.rounds);
        return [
          { mode: 'timer', label, sec: ex.pushSec, unit: 'Max push on strap', detail: ex.note, vol: reps('Isometric strap push', 1) },
          { mode: 'tap', label, big: String(ex.jumps), unit: 'box jumps', done: 'Jumps done', vol: reps('Box jump', ex.jumps) },
        ];
      }), rest(ex.restSec));
    case 'circuit':
      return withRests(range(ex.sets).map((s) => ex.items.flatMap((item) => sides(item.perSide, (side): Draft => {
        const label = join(of('Set', s, ex.sets), side);
        const detail = join(item.desc, item.note) || undefined;
        return item.sec
          ? { mode: 'timer', label, sec: item.sec, unit: item.name, detail, vol: secs(item.name, item.sec) }
          : { mode: 'tap', label, big: String(item.reps), unit: item.name, detail, done: 'Done', vol: reps(item.name, item.reps ?? 0) };
      }, item.sec ? SWITCH_HOLD : SWITCH_REPS))), rest(ex.restSec));
    case 'rounds':
      return withRests(range(ex.rounds).map((r) => [{
        mode: 'tap', label: of('Round', r, ex.rounds), lines: shuffle(ex.options), done: 'Round done',
        vol: Object.assign({}, ...ex.options.map((o) => reps(o, 1))),
      }]), rest(ex.restSec));
    case 'emom': {
      // One rep a minute counted (the plan's lower bound), cycling through the cues.
      const vol: Vol = {};
      for (let m = 0; m < ex.minutes; m++) {
        const key = `r:${movement(ex.cues.length ? ex.cues[m % ex.cues.length] : ex.name)}`;
        vol[key] = (vol[key] ?? 0) + 1;
      }
      return [{ mode: 'emom', label: `${ex.minutes} min EMOM`, sec: ex.minutes * 60, cues: ex.cues, perMinute: ex.perMinute, vol }];
    }
    case 'timed':
      return [{ mode: 'timer', label: `${Math.round(ex.sec / 60)} min`, sec: ex.sec, detail: ex.note, vol: secs(ex.name, ex.sec) }];
    case 'test':
      return withRests(range(ex.attempts).map((a): Draft[] => {
        const label = of('Attempt', a, ex.attempts);
        if (ex.log === 'best') {
          return sides(ex.perSide, (side) => ({
            mode: 'tap',
            label: join(label, side),
            big: ex.test === 'jump' ? 'Jump' : 'Kick',
            unit: ex.test === 'jump' ? 'max jump' : 'highest clean kick',
            detail: 'Note your best for the test log',
            done: 'Done',
            vol: reps(ex.test === 'jump' ? 'Max jump test' : 'Highest kick test', 1),
          }), SWITCH_REPS);
        }
        const rotations = ex.log === 'rotations';
        return [{
          mode: 'count',
          label,
          big: ex.test,
          unit: rotations ? 'spin drill' : undefined,
          count: { field: ex.test === '540' ? 'landed540' : 'landed720', yes: rotations ? 'Full' : 'Landed', no: rotations ? 'Short' : 'Missed' },
          vol: reps(rotations ? '720 spin drill' : ex.test, 1),
        }];
      }), rest(ex.restSec));
  }
}

function warmupSummary(w: WarmupItem): string {
  if (w.sec) return `${Math.round(w.sec / 60)} min`;
  if (w.sets) return `${w.sets}×${w.reps}`;
  return join(`${w.reps}${w.unit ? ` ${w.unit}` : ''}`, w.perSide && 'per side');
}

/** Warm-up items flow into each other: no rest and no side switch countdown. */
function warmupSteps(w: WarmupItem): Draft[] {
  if (w.sec) return [{ mode: 'timer', label: `${Math.round(w.sec / 60)} min`, sec: w.sec, vol: secs(w.name, w.sec) }];
  const step = (label: string): Draft => ({ mode: 'tap', label, big: String(w.reps), unit: w.unit ?? 'reps', done: 'Done', vol: reps(w.name, w.reps ?? 0) });
  if (w.sets) return range(w.sets).map((s) => step(of('Set', s, w.sets!)));
  return sides(w.perSide, (side) => step(side ?? 'Warm-up'), null);
}

interface Item {
  ex: Omit<RunExercise, 'first'>;
  steps: Draft[];
}

/**
 * Flattens the items, starting with a "get ready" countdown. A timer that comes right after a
 * countdown starts on its own when the countdown ends; one that comes after a tapped step gets a
 * short "get ready" first, so every timer is announced and starts with the whistle.
 */
function assemble(items: Item[]) {
  const exercises: RunExercise[] = [];
  const steps: Step[] = [];
  for (const it of items) {
    if (!it.steps.length) continue;
    const ex = exercises.length;
    exercises.push({ ...it.ex, first: steps.length });
    if (!steps.length) steps.push({ ...countdown('ready', READY_START, 'Get ready'), ex });
    for (const s of it.steps) {
      if (isTimedWork(s) && !s.auto) {
        if (!isCountdown(steps[steps.length - 1])) steps.push({ ...countdown('ready', READY, 'Get ready'), ex });
        steps.push({ ...s, auto: true, ex });
      } else {
        steps.push({ ...s, ex });
      }
    }
  }
  while (steps.length && isCountdown(steps[steps.length - 1])) steps.pop();
  return { exercises, steps };
}

function newRun(kind: Run['kind'], title: string, pos: Pos, built: ReturnType<typeof assemble>): Run {
  const now = Date.now();
  const first = built.steps[0];
  return {
    v: 1, kind, title, pos, ...built,
    idx: 0, history: [], timer: first?.auto ? { endsAt: now + first.sec! * 1000 } : null,
    startedAt: now, dropped: [], results: {}, finished: false,
  };
}

export function buildSession(pos: Pos): Run {
  const day = getDay(pos);
  const items: Item[] = (day.warmup?.items ?? []).map((w) => ({
    ex: { name: w.name, summary: warmupSummary(w), warmup: true }, steps: warmupSteps(w),
  }));
  day.exercises.forEach((e, i) => {
    // Rest before an exercise: the longer of the two exercises' rests, at least 90 s after the warm-up.
    const before = i > 0 ? Math.max(day.exercises[i - 1].restSec, e.restSec) : day.warmup ? Math.max(AFTER_WARMUP, e.restSec) : 0;
    items.push({ ex: { name: e.name, summary: e.do, warmup: false }, steps: [...rest(before), ...exerciseSteps(e)] });
  });
  return newRun('session', `Day ${pos.day} · ${day.title}`, pos, assemble(items));
}

function gtgPartSteps(p: GtgPart): Draft[] {
  return sides(p.perSide, (side): Draft => p.sec
    ? { mode: 'timer', label: side ?? 'Hold', sec: p.sec, unit: 'hold', detail: p.note, vol: secs(p.name, p.sec) }
    : { mode: 'tap', label: side ?? 'Set', big: String(p.reps), unit: 'reps', detail: p.note, done: 'Done', vol: reps(p.name, p.reps ?? 0) },
  p.sec ? SWITCH_HOLD : SWITCH_REPS);
}

export function buildGtg(pos: Pos, letter: string, time: string, date: string, index: number): Run {
  const { set, version } = gtgSet(letter, pos.month);
  const items = version.parts.map((p) => ({
    ex: { name: p.name, summary: p.sec ? `${p.sec} s${p.perSide ? ' per side' : ''}` : `${p.reps}${p.perSide ? ' per side' : ''}`, warmup: false },
    steps: gtgPartSteps(p),
  }));
  const run = newRun('gtg', `GTG ${set.letter} · ${set.label} · ${time}`, pos, assemble(items));
  return { ...run, gtgSlot: { date, index } };
}

/** Totals for the given steps (each counted once). */
export function runVolume(run: Run, idxs: Iterable<number>): Vol {
  const out: Vol = {};
  for (const i of new Set(idxs)) addVol(out, run.steps[i]?.vol);
  return out;
}
