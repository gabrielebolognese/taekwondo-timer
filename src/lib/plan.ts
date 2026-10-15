import planJson from '../plan.json';
import type { Day, GtgSet, GtgVersion, Plan } from '../types';

export const plan = planJson as unknown as Plan;

export interface Pos {
  month: number;
  week: number;
  day: number;
}

export const START: Pos = { month: 1, week: 1, day: 1 };
export const LIMITS = { month: plan.months.length, week: 4, day: 7 };

export const getDay = (p: Pos): Day => plan.months[p.month - 1].weeks[p.week - 1].days[p.day - 1];
export const isDeload = (p: Pos) => plan.months[p.month - 1].weeks[p.week - 1].deload;
export const monthTarget = (p: Pos) => plan.months[p.month - 1].target;
/** 1 to 24, matching the week numbers in the plan's test log. */
export const planWeek = (p: Pick<Pos, 'month' | 'week'>) => (p.month - 1) * 4 + p.week;

/** The next plan day, or null after the last day of month 6. */
export function nextPos(p: Pos): Pos | null {
  if (p.day < 7) return { ...p, day: p.day + 1 };
  if (p.week < 4) return { ...p, week: p.week + 1, day: 1 };
  if (p.month < LIMITS.month) return { month: p.month + 1, week: 1, day: 1 };
  return null;
}

export interface GtgSlot {
  index: number;
  time: string;
  letter: string;
}

export function gtgDay(p: Pos) {
  const { columns, times, deloadSlots } = plan.gtg;
  const col = columns.find((c) => c.days.includes(p.day)) ?? columns[0];
  // The column with fewer days is the alternate one (Day 1 and Day 4, no set D).
  const alternate = columns.some((c) => c.days.length > col.days.length);
  const deload = isDeload(p);
  const all = times.map((time, index): GtgSlot => ({ index, time, letter: col.letters[index] }));
  return { slots: deload ? all.slice(0, deloadSlots) : all, alternate, altDays: col.days, deload };
}

export function gtgSet(letter: string, month: number): { set: GtgSet; version: GtgVersion } {
  const set = plan.gtg.sets.find((s) => s.letter === letter) ?? plan.gtg.sets[0];
  const version = set.versions.find((v) => v.months.includes(month)) ?? set.versions[0];
  return { set, version };
}
