// Totals for the Progress tab: what every completion and every ticked GTG slot added up to.
// Timer sessions store what was actually done (Completion.vol). Days marked as completed, and
// completions logged before totals existed, count the plan's full prescription for that day.

import { addVol, type Vol } from './movements';
import { gtgDay, nextPos, START, type Pos } from './plan';
import { buildGtg, buildSession, runVolume, type Run } from './steps';
import type { Completion, GtgLog } from './storage';

const sessions = new Map<string, Run>();
const gtgSets = new Map<string, Vol>();

function sessionAt(pos: Pos): Run {
  const key = `${pos.month}.${pos.week}.${pos.day}`;
  let run = sessions.get(key);
  if (!run) sessions.set(key, (run = buildSession(pos)));
  return run;
}

/** A whole plan day, warm-up included; optionally only some of its main exercises. */
export function dayVolume(pos: Pos, only?: Set<string>): Vol {
  const run = sessionAt(pos);
  const idxs = run.steps.flatMap((s, i) => {
    const ex = run.exercises[s.ex];
    return ex.warmup || !only || only.has(ex.name) ? [i] : [];
  });
  return runVolume(run, idxs);
}

export const completionVolume = (c: Completion): Vol =>
  c.vol ?? dayVolume(c.pos, c.manual ? undefined : new Set(c.done));

function gtgSetVolume(month: number, letter: string): Vol {
  const key = `${month}.${letter}`;
  let vol = gtgSets.get(key);
  if (!vol) {
    const run = buildGtg({ month, week: 1, day: 1 }, letter, '', '', 0);
    gtgSets.set(key, (vol = runVolume(run, run.steps.keys())));
  }
  return vol;
}

/** The plan day whose GTG column applied on a date: the day trained that date, else the day that was next. */
function gtgPosOn(date: string, log: Completion[]): Pos {
  const that = log.findLast((c) => c.date === date);
  if (that) return that.pos;
  const before = log.findLast((c) => c.date < date);
  return before ? nextPos(before.pos) ?? before.pos : START;
}

export function gtgVolume(gtg: GtgLog, log: Completion[]): Vol {
  const out: Vol = {};
  for (const [date, day] of Object.entries(gtg)) {
    const pos = gtgPosOn(date, log);
    const slots = gtgDay(pos).slots;
    for (const i of day.done) {
      const slot = slots.find((s) => s.index === i);
      if (slot) addVol(out, gtgSetVolume(pos.month, slot.letter));
    }
  }
  return out;
}

export interface SpinTotal {
  deg: '360' | '540' | '720';
  total: number;
  parts: { label: string; n: number }[];
}

export interface Totals {
  kicks: number;
  spins: SpinTotal[];
  jumps: number;
  /** Seconds in holds and stretches. */
  holdSec: number;
  movements: { name: string; n: number; sec: boolean }[];
}

const isKick = (m: string) => /kick/i.test(m);
const isJump = (m: string) => /jump|hop|bound|pogo/i.test(m);
const isHold = (m: string) => /split|stretch|hold|pnf|copenhagen|horse stance/i.test(m);
const SPIN_PART: [RegExp, string][] = [[/tuck jump$/, 'tuck jumps'], [/spin drill$/, 'spin drills'], [/kick$/, 'kicks']];

export function totals(log: Completion[], gtg: GtgLog): Totals {
  const vol: Vol = {};
  for (const c of log) addVol(vol, completionVolume(c));
  addVol(vol, gtgVolume(gtg, log));

  const movements = Object.entries(vol)
    .filter(([, n]) => n > 0)
    .map(([key, n]) => ({ name: key.slice(2), n, sec: key.startsWith('s:') }));
  const repsOf = (test: (m: string) => boolean) => movements.filter((m) => !m.sec && test(m.name)).reduce((s, m) => s + m.n, 0);

  const spins = (['360', '540', '720'] as const).map((deg): SpinTotal => {
    const parts = new Map<string, number>();
    for (const m of movements) {
      if (m.sec || !m.name.startsWith(`${deg} `)) continue;
      const label = SPIN_PART.find(([re]) => re.test(m.name))?.[1] ?? 'other';
      parts.set(label, (parts.get(label) ?? 0) + m.n);
    }
    const list = [...parts].map(([label, n]) => ({ label, n }));
    return { deg, total: list.reduce((s, p) => s + p.n, 0), parts: list };
  });

  return {
    kicks: repsOf(isKick),
    spins,
    jumps: repsOf(isJump),
    holdSec: movements.filter((m) => m.sec && isHold(m.name)).reduce((s, m) => s + m.n, 0),
    movements: movements.sort((a, b) => Number(a.sec) - Number(b.sec) || b.n - a.n || a.name.localeCompare(b.name)),
  };
}
