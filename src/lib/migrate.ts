// Upgrades saved data in place before the app renders. Never resets anything:
// the current day, completions, test log and GTG history all carry over.

import { getDay, gtgDay, START, type Pos } from './plan';
import { load, save, type Completion, type GtgLog } from './storage';

const SCHEMA = 2;

const validPos = (p: unknown): p is Pos => {
  const q = p as Pos;
  return !!q && [q.month, q.week, q.day].every(Number.isInteger) && q.month >= 1 && q.month <= 6
    && q.week >= 1 && q.week <= 4 && q.day >= 1 && q.day <= 7;
};

const exerciseNames = (p: Pos) => (validPos(p) ? getDay(p).exercises.map((e) => e.name) : []);

/** Schema 1 -> 2: completions get `manual` (was `skipped`) and `done`; GTG days remember their slot total. */
function toV2() {
  const pos = load<Pos>('pos', START);
  type V1Entry = Completion & { skipped?: boolean };
  const log = load<V1Entry[]>('log', []).filter((e) => e && validPos(e.pos)).map(({ skipped, ...e }): Completion => {
    const manual = e.manual ?? !!skipped;
    const entry: Completion = { ...e, manual, dropped: e.dropped ?? [], done: e.done ?? exerciseNames(e.pos) };
    if (manual) delete entry.minutes;
    return entry;
  });
  save('log', log);

  const old = load<Record<string, number[]> | null>('gtgDone', null);
  if (old) {
    const gtg = load<GtgLog>('gtg', {});
    for (const [date, list] of Object.entries(old)) {
      if (!Array.isArray(list) || gtg[date]) continue;
      // That date's slot count depends on the plan day trained that date, else the current day.
      const p = log.findLast((e) => e.date === date)?.pos ?? (validPos(pos) ? pos : START);
      gtg[date] = { done: [...new Set(list)], total: gtgDay(p).slots.length };
    }
    save('gtg', gtg);
    save('gtgDone', null);
  }
}

export function migrate() {
  const version = load<number>('schema', 1);
  if (version >= SCHEMA) return;
  try {
    if (version < 2) toV2();
    save('schema', SCHEMA);
  } catch {
    // Leave the old data untouched and try again next launch rather than lose anything.
  }
}
