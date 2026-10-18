// All app state lives in IndexedDB (database "tkd", store "state") and is mirrored in memory,
// so screens read it synchronously. Versions before this one kept it in localStorage under
// "tkd."; initStorage() moves that data over on the first launch and then removes the old keys.

import { createStore, entries, getMany, promisifyRequest, setMany, type UseStore } from 'idb-keyval';
import type { Pos } from './plan';

const PREFIX = 'tkd.';

/** The training record: what cloud sync and backups carry. Everything else stays on the device. */
export const SYNCED_KEYS = ['pos', 'log', 'tests', 'gtg', 'goals'] as const;

const cache = new Map<string, unknown>();
const listeners = new Set<() => void>();
const dirty = new Set<string>();
let db: UseStore | null = null;
let onChange: (() => void) | null = null;

export let backend: 'indexeddb' | 'localstorage' = 'indexeddb';

const openDb = () => createStore('tkd', 'state');

function readLegacy(): [string, unknown][] {
  const out: [string, unknown][] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k?.startsWith(PREFIX)) continue;
      try {
        out.push([k.slice(PREFIX.length), JSON.parse(localStorage.getItem(k)!)]);
      } catch {
        // Unreadable value: the old app ignored it too.
      }
    }
  } catch {
    // localStorage blocked.
  }
  return out;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Loads everything into memory. Call once before the first render. */
export async function initStorage() {
  const legacy = readLegacy();
  try {
    db = openDb();
    for (const [k, v] of await entries(db)) cache.set(String(k), v);
    if (!legacy.length) return;
    // A key already in IndexedDB is newer than its localStorage copy (an interrupted move, or a
    // launch where IndexedDB failed and the app started from what was left in localStorage).
    const move = legacy.filter(([k]) => !cache.has(k));
    for (const [k, v] of move) cache.set(k, v);
    if (move.length) {
      await setMany(move, db);
      // Drop the old copy only once IndexedDB hands back the same values.
      const back = await getMany(move.map(([k]) => k), db);
      if (!move.every(([, v], i) => same(back[i], v))) throw new Error('IndexedDB check failed');
    }
    for (const [k] of legacy) localStorage.removeItem(PREFIX + k);
  } catch {
    // No working IndexedDB: keep everything in localStorage so nothing is lost.
    db = null;
    backend = 'localstorage';
    for (const [k, v] of legacy) if (!cache.has(k)) cache.set(k, v);
    for (const k of cache.keys()) dirty.add(k);
    void flush();
  }
}

function persist(keys: string[]): Promise<void> {
  if (db) {
    return db('readwrite', (store) => {
      for (const k of keys) {
        if (cache.has(k)) store.put(cache.get(k), k);
        else store.delete(k);
      }
      return promisifyRequest(store.transaction);
    });
  }
  for (const k of keys) {
    if (cache.has(k)) localStorage.setItem(PREFIX + k, JSON.stringify(cache.get(k)));
    else localStorage.removeItem(PREFIX + k);
  }
  return Promise.resolve();
}

let flushing = false;
let queued = false;

/** Writes dirty keys in one transaction, always with their latest value, retrying on failure. */
async function flush() {
  if (flushing) return;
  flushing = true;
  try {
    let failures = 0;
    while (dirty.size) {
      const keys = [...dirty];
      dirty.clear();
      try {
        await persist(keys);
        failures = 0;
      } catch {
        for (const k of keys) dirty.add(k);
        // Safari sometimes drops the connection. Reopen and try again, then back off.
        if (db) db = openDb();
        if (++failures >= 3) {
          window.setTimeout(() => void flush(), 5000);
          break;
        }
        await new Promise((r) => setTimeout(r, 250 * failures));
      }
    }
  } finally {
    flushing = false;
  }
}

function schedule() {
  if (queued) return;
  queued = true;
  // Batch every write from one tap into a single transaction.
  queueMicrotask(() => {
    queued = false;
    void flush();
  });
}

export function load<T>(key: string, fallback: T): T {
  return cache.has(key) ? (cache.get(key) as T) : fallback;
}

/** Stores a value without counting it as a change (migrations, settings, applying a backup). */
export function write(key: string, value: unknown) {
  if (value === null || value === undefined) cache.delete(key);
  else cache.set(key, value);
  dirty.add(key);
  schedule();
  for (const l of listeners) l();
}

/** A change made in the app. Changes to the training record stamp `updatedAt` and start a cloud push. */
export function save(key: string, value: unknown) {
  write(key, value);
  if ((SYNCED_KEYS as readonly string[]).includes(key)) touchRecord();
}

/** Counts the training record as changed now: stamps `updatedAt` and starts a cloud push. */
export function touchRecord() {
  write('updatedAt', Math.max(Date.now(), load('updatedAt', 0) + 1));
  onChange?.();
}

export function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

export function onRecordChange(fn: () => void) {
  onChange = fn;
}

let persistence: Promise<boolean> | null = null;

/** Asks the browser not to evict our data. Called on launch; Settings shows the answer. */
export function requestPersistence(): Promise<boolean> {
  persistence ??= (async () => {
    try {
      return (await navigator.storage?.persist?.()) ?? false;
    } catch {
      return false;
    }
  })();
  return persistence;
}

/** One completed plan day. Stored oldest first under "log". */
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
  /** What the completed sets added up to ("r:" reps, "s:" seconds, by movement). Timer sessions only. */
  vol?: Record<string, number>;
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

/** "14:32" today, "Oct 15, 14:32" on other days. */
export function shortTime(ms: number): string {
  const d = new Date(ms);
  const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  return todayKey(d) === todayKey() ? time : `${shortDate(todayKey(d))}, ${time}`;
}
