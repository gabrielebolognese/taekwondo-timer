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

export interface LogEntry {
  date: string;
  at: number;
  pos: Pos;
  title: string;
  minutes: number;
  dropped: string[];
  /** Marked done from Home without running the session. */
  skipped?: boolean;
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

/** Done GTG slot indexes per calendar date. */
export type GtgDone = Record<string, number[]>;

export function todayKey(d = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function shortDate(key: string): string {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
