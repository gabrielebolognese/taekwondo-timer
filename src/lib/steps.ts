// Turns plan exercises into a flat list of steps the runner walks through.

import type { Exercise, GtgPart, WarmupItem } from '../types';
import { getDay, gtgSet, type Pos } from './plan';

export type TestField = 'landed540' | 'landed720';
export type StepMode = 'tap' | 'timer' | 'rest' | 'emom' | 'count';

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
  /** Timer starts on its own when reached (rest, later PNF phases). */
  auto?: boolean;
  done?: string;
  cues?: string[];
  perMinute?: string;
  count?: { field: TestField; yes: string; no: string };
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

const SIDES = ['Left', 'Right'];
const sidesFor = (perSide: boolean) => (perSide ? SIDES : [undefined]);
const join = (...parts: (string | undefined | false)[]) => parts.filter(Boolean).join(' · ');
const of = (word: string, i: number, n: number) => `${word} ${i} of ${n}`;

function shuffle<T>(items: T[]): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function rest(sec: number): Omit<Step, 'ex'>[] {
  return sec > 0 ? [{ mode: 'rest', label: 'Rest', sec, auto: true }] : [];
}

function exerciseSteps(ex: Exercise): Omit<Step, 'ex'>[] {
  const out: Omit<Step, 'ex'>[] = [];
  switch (ex.kind) {
    case 'sets':
      for (let s = 1; s <= ex.sets; s++) {
        for (const part of ex.parts ?? [undefined]) {
          for (const side of sidesFor(ex.perSide)) {
            out.push({
              mode: 'tap',
              label: join(of(ex.setWord, s, ex.sets), side),
              big: ex.target ?? String(ex.reps),
              unit: part ?? ex.unit,
              detail: ex.note,
              done: ex.setWord === 'Set' ? 'Set done' : 'Done',
            });
          }
        }
        out.push(...rest(ex.restSec));
      }
      if (ex.finalHoldSec) out.push({ mode: 'timer', label: 'Final hold', sec: ex.finalHoldSec, unit: 'hold' });
      break;
    case 'hold':
      for (let s = 1; s <= ex.sets; s++) {
        for (const side of sidesFor(ex.perSide)) {
          out.push({ mode: 'timer', label: join(of('Set', s, ex.sets), side), sec: ex.sec, unit: 'hold', detail: ex.note });
        }
        out.push(...rest(ex.restSec));
      }
      break;
    case 'pnf':
      for (const side of sidesFor(ex.perSide)) {
        for (let r = 1; r <= ex.rounds; r++) {
          ex.phases.forEach((p, i) => {
            out.push({ mode: 'timer', label: join(of('Round', r, ex.rounds), side), sec: p.sec, unit: p.label, auto: r > 1 || i > 0 });
          });
        }
      }
      break;
    case 'contrast':
      for (let r = 1; r <= ex.rounds; r++) {
        const label = of('Round', r, ex.rounds);
        out.push({ mode: 'timer', label, sec: ex.pushSec, unit: 'Max push on strap', detail: ex.note });
        out.push({ mode: 'tap', label, big: String(ex.jumps), unit: 'box jumps', done: 'Jumps done' });
        out.push(...rest(ex.restSec));
      }
      break;
    case 'circuit':
      for (let s = 1; s <= ex.sets; s++) {
        for (const item of ex.items) {
          for (const side of sidesFor(item.perSide)) {
            const label = join(of('Set', s, ex.sets), side);
            const detail = join(item.desc, item.note);
            out.push(item.sec
              ? { mode: 'timer', label, sec: item.sec, unit: item.name, detail }
              : { mode: 'tap', label, big: String(item.reps), unit: item.name, detail, done: 'Done' });
          }
        }
        out.push(...rest(ex.restSec));
      }
      break;
    case 'rounds':
      for (let r = 1; r <= ex.rounds; r++) {
        out.push({ mode: 'tap', label: of('Round', r, ex.rounds), lines: shuffle(ex.options), done: 'Round done' });
        out.push(...rest(ex.restSec));
      }
      break;
    case 'emom':
      out.push({ mode: 'emom', label: `${ex.minutes} min EMOM`, sec: ex.minutes * 60, cues: ex.cues, perMinute: ex.perMinute });
      out.push(...rest(ex.restSec));
      break;
    case 'timed':
      out.push({ mode: 'timer', label: `${Math.round(ex.sec / 60)} min`, sec: ex.sec, detail: ex.note });
      break;
    case 'test':
      for (let a = 1; a <= ex.attempts; a++) {
        const label = of('Attempt', a, ex.attempts);
        if (ex.log === 'best') {
          for (const side of sidesFor(ex.perSide)) {
            out.push({
              mode: 'tap',
              label: join(label, side),
              big: ex.test === 'jump' ? 'Jump' : 'Kick',
              unit: ex.test === 'jump' ? 'max jump' : 'highest clean kick',
              detail: 'Note your best for the test log',
              done: 'Done',
            });
          }
        } else {
          const rotations = ex.log === 'rotations';
          out.push({
            mode: 'count',
            label,
            big: ex.test,
            unit: rotations ? 'spin drill' : undefined,
            count: {
              field: ex.test === '540' ? 'landed540' : 'landed720',
              yes: rotations ? 'Full' : 'Landed',
              no: rotations ? 'Short' : 'Missed',
            },
          });
        }
        out.push(...rest(ex.restSec));
      }
      break;
  }
  return out;
}

function warmupSummary(w: WarmupItem): string {
  if (w.sec) return `${Math.round(w.sec / 60)} min`;
  if (w.sets) return `${w.sets}×${w.reps}`;
  return join(`${w.reps}${w.unit ? ` ${w.unit}` : ''}`, w.perSide && 'per side');
}

function warmupSteps(w: WarmupItem): Omit<Step, 'ex'>[] {
  if (w.sec) return [{ mode: 'timer', label: `${Math.round(w.sec / 60)} min`, sec: w.sec }];
  if (w.sets) {
    return Array.from({ length: w.sets }, (_, i) => ({
      mode: 'tap' as const, label: of('Set', i + 1, w.sets!), big: String(w.reps), unit: w.unit ?? 'reps', done: 'Done',
    }));
  }
  return sidesFor(w.perSide).map((side) => ({
    mode: 'tap' as const, label: side ?? 'Warm-up', big: String(w.reps), unit: w.unit ?? 'reps', done: 'Done',
  }));
}

function assemble(items: { ex: Omit<RunExercise, 'first'>; steps: Omit<Step, 'ex'>[] }[]) {
  const exercises: RunExercise[] = [];
  const steps: Step[] = [];
  for (const it of items) {
    if (!it.steps.length) continue;
    exercises.push({ ...it.ex, first: steps.length });
    for (const s of it.steps) steps.push({ ...s, ex: exercises.length - 1 });
  }
  // No rest after the very last step of a run.
  while (steps.length && steps[steps.length - 1].mode === 'rest') steps.pop();
  return { exercises, steps };
}

function newRun(kind: Run['kind'], title: string, pos: Pos, built: ReturnType<typeof assemble>): Run {
  return {
    v: 1, kind, title, pos, ...built,
    idx: 0, history: [], timer: null, startedAt: Date.now(), dropped: [], results: {}, finished: false,
  };
}

export function buildSession(pos: Pos): Run {
  const day = getDay(pos);
  const items = [
    ...(day.warmup?.items ?? []).map((w) => ({
      ex: { name: w.name, summary: warmupSummary(w), warmup: true }, steps: warmupSteps(w),
    })),
    ...day.exercises.map((e) => ({ ex: { name: e.name, summary: e.do, warmup: false }, steps: exerciseSteps(e) })),
  ];
  return newRun('session', `Day ${pos.day} · ${day.title}`, pos, assemble(items));
}

function gtgPartSteps(p: GtgPart): Omit<Step, 'ex'>[] {
  return sidesFor(p.perSide).map((side) => p.sec
    ? { mode: 'timer' as const, label: side ?? 'Hold', sec: p.sec, unit: 'hold', detail: p.note }
    : { mode: 'tap' as const, label: side ?? 'Set', big: String(p.reps), unit: 'reps', detail: p.note, done: 'Done' });
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
