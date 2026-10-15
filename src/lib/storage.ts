// All app state lives in localStorage under the "tkd." prefix.

import type { Pos } from './plan';

const PREFIX = 'tkd.';

export function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

export function save(key: string, value: unknown) {
  try {
    if (value === null || value === undefined) localStorage.removeItem(PREFIX + key);
    else localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    // Storage full or blocked. Nothing useful to do in the UI.
  }
}

/** One completed plan day. Stored oldest first under "tkd.log". */
export interface Completion {
  date: string;
  at: number;
  pos: Pos;
  title: string;
  /** Marked as completed from Home, without the timer. */
  manual?: boolean;
  /** Timer sessions only. */
  minutes?: number;
  /** Exercises ended early with "Output dropped". */
  dropped: string[];
  /** Exercises done (all of them for a manual completion). */
  done: string[];
}

export interface TestEntry {
  id: string;
  date: string;
  month: number;
  week: number;
  maxJump?: number;
  highestKick?: number;
  landed540?: number;
  landed720?: number;
  ballHeight?: number;
}

/** GTG slots done on one calendar date, and how many slots that date had. */
export interface GtgDay {
  done: number[];
  total: number;
}

export type GtgLog = Record<string, GtgDay>;

/** Ticked month goals, keyed by goalKey(). */
export type GoalTicks = Record<string, boolean>;
export const goalKey = (month: number, goal: string) => `${month}:${goal}`;

export function todayKey(d = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const toDate = (key: string) => {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
};

export function addDays(key: string, n: number): string {
  const d = toDate(key);
  d.setDate(d.getDate() + n);
  return todayKey(d);
}

/** Whole calendar days from a to b (b later = positive). */
export function daysBetween(a: string, b: string): number {
  const utc = (k: string) => {
    const [y, m, d] = k.split('-').map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((utc(b) - utc(a)) / 86_400_000);
}

export function shortDate(key: string): string {
  return toDate(key).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
