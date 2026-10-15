// Stats for the Progress tab, computed from saved completions and GTG history.

import { addDays, daysBetween, type Completion, type GtgLog } from './storage';

export type DayState = 'session' | 'gtg' | 'none';

/** Training sessions are plan days 1 to 6; Day 7 is GTG only. */
export const isSession = (c: Completion) => c.pos.day <= 6;

export const fullGtg = (gtg: GtgLog, date: string) => {
  const d = gtg[date];
  return !!d && d.total > 0 && d.done.length >= d.total;
};

/** A date counts when any plan day was completed on it, or all of its GTG slots were done. */
export function dayStates(log: Completion[], gtg: GtgLog): Map<string, DayState> {
  const states = new Map<string, DayState>();
  for (const date of Object.keys(gtg)) if (fullGtg(gtg, date)) states.set(date, 'gtg');
  for (const c of log) states.set(c.date, 'session');
  return states;
}

export function streaks(states: Map<string, DayState>, today: string) {
  const active = (d: string) => (states.get(d) ?? 'none') !== 'none';
  // Today still counts as "in progress", so an empty today does not break the streak.
  let day = active(today) ? today : addDays(today, -1);
  let current = 0;
  while (active(day)) {
    current++;
    day = addDays(day, -1);
  }
  const dates = [...states.keys()].filter(active).sort();
  let longest = 0;
  let run = 0;
  dates.forEach((d, i) => {
    run = i > 0 && daysBetween(dates[i - 1], d) === 1 ? run + 1 : 1;
    longest = Math.max(longest, run);
  });
  return { current, longest };
}

/** First date with any saved activity, or null. */
export function firstActivity(log: Completion[], gtg: GtgLog): string | null {
  const dates = [...log.map((c) => c.date), ...Object.keys(gtg).filter((d) => gtg[d].done.length)].sort();
  return dates[0] ?? null;
}

/**
 * Sessions done vs planned over the last `days` days, 6 planned per 7 days.
 * Days before the first logged activity are not counted as missed.
 */
export function windowStats(log: Completion[], start: string | null, today: string, days: number) {
  const windowStart = addDays(today, -(days - 1));
  const from = start && start > windowStart ? start : windowStart;
  const span = start ? Math.max(0, daysBetween(from, today) + 1) : 0;
  const planned = Math.round((span * 6) / 7);
  const done = log.filter((c) => isSession(c) && c.date >= windowStart && c.date <= today).length;
  return { done, planned, pct: planned ? Math.round((done / planned) * 100) : null };
}

export const planDaysCompleted = (log: Completion[]) =>
  new Set(log.map((c) => `${c.pos.month}-${c.pos.week}-${c.pos.day}`)).size;
